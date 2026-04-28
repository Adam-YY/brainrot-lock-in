import { strict as assert } from "assert";
import { LockInSessionManager, SessionSummary } from "../src/sessionManager";
import { FakeScheduler } from "./helpers/fakeScheduler";

describe("LockInSessionManager", () => {
  it("ends the session when the timer completes", () => {
    const scheduler = new FakeScheduler();
    const summaries: SessionSummary[] = [];
    const manager = new LockInSessionManager(
      {
        onWarningRequired: () => {
          throw new Error("Warning should not be triggered.");
        },
        onSessionEnded: (summary) => summaries.push(summary)
      },
      2,
      scheduler
    );

    manager.startSession(1);
    scheduler.advanceBy(59_999);
    assert.equal(summaries.length, 0);

    scheduler.advanceBy(1);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].reason, "completed");
    assert.equal(manager.getState(), "ended");
  });

  it("respects the focus grace period before triggering a warning", () => {
    const scheduler = new FakeScheduler();
    let warningEvents = 0;

    const manager = new LockInSessionManager(
      {
        onWarningRequired: () => {
          warningEvents += 1;
        },
        onSessionEnded: () => {
          throw new Error("Session should still be running.");
        }
      },
      2,
      scheduler
    );

    manager.startSession(10);
    manager.onWindowFocusChanged(false);
    scheduler.advanceBy(1_500);

    assert.equal(warningEvents, 0);
    assert.equal(manager.getState(), "running");

    manager.onWindowFocusChanged(true);
    manager.onWindowFocusChanged(false);
    scheduler.advanceBy(2_000);

    assert.equal(warningEvents, 1);
    assert.equal(manager.getState(), "warningActive");
  });

  it("counts distractions only after qualified unfocus and explicit dismiss", () => {
    const scheduler = new FakeScheduler();
    let warningEvents = 0;

    const manager = new LockInSessionManager(
      {
        onWarningRequired: () => {
          warningEvents += 1;
        },
        onSessionEnded: () => {
          throw new Error("Session should not end.");
        }
      },
      2,
      scheduler
    );

    manager.startSession(10);

    manager.onWindowFocusChanged(false);
    scheduler.advanceBy(1_000);
    assert.equal(warningEvents, 0);
    assert.equal(manager.getDistractionCount(), 0);

    manager.onWindowFocusChanged(true);
    manager.onWindowFocusChanged(false);
    scheduler.advanceBy(2_500);

    assert.equal(warningEvents, 1);
    assert.equal(manager.getDistractionCount(), 0);

    const dismissed = manager.dismissWarning();
    assert.equal(dismissed, true);
    assert.equal(manager.getDistractionCount(), 1);
    assert.equal(manager.getState(), "running");
  });

  it("does not double count a single unfocus-return cycle", () => {
    const scheduler = new FakeScheduler();
    let warningEvents = 0;

    const manager = new LockInSessionManager(
      {
        onWarningRequired: () => {
          warningEvents += 1;
        },
        onSessionEnded: () => {
          throw new Error("Session should not end.");
        }
      },
      2,
      scheduler
    );

    manager.startSession(10);
    manager.onWindowFocusChanged(false);
    scheduler.advanceBy(8_000);

    assert.equal(warningEvents, 1);

    const firstDismiss = manager.dismissWarning();
    const secondDismiss = manager.dismissWarning();

    assert.equal(firstDismiss, true);
    assert.equal(secondDismiss, false);
    assert.equal(manager.getDistractionCount(), 1);
  });

  it("re-arms the warning after dismiss when the window is still unfocused", () => {
    const scheduler = new FakeScheduler();
    let warningEvents = 0;

    const manager = new LockInSessionManager(
      {
        onWarningRequired: () => {
          warningEvents += 1;
        },
        onSessionEnded: () => {
          throw new Error("Session should not end.");
        }
      },
      2,
      scheduler
    );

    manager.startSession(10);
    manager.onWindowFocusChanged(false);
    scheduler.advanceBy(2_000);

    assert.equal(warningEvents, 1);

    const dismissed = manager.dismissWarning();
    assert.equal(dismissed, true);
    assert.equal(manager.getState(), "running");

    scheduler.advanceBy(1_999);
    assert.equal(warningEvents, 1);

    scheduler.advanceBy(1);
    assert.equal(warningEvents, 2);
    assert.equal(manager.getState(), "warningActive");
  });
});
