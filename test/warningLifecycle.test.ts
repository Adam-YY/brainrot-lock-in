import { strict as assert } from "assert";
import { CoordinatorOptions, LockInCoordinator, SummaryPresenter, VideoSelector, WarningPresenter } from "../src/coordinator";
import { SessionSummary } from "../src/sessionManager";
import { FakeScheduler } from "./helpers/fakeScheduler";

class MockWarningPresenter implements WarningPresenter {
  public showCount = 0;
  public hideCount = 0;
  public lastVideo = "";
  private dismissHandler: (() => void) | undefined;

  public showWarning(videoFileName: string, onDismiss: () => void): void {
    this.showCount += 1;
    this.lastVideo = videoFileName;
    this.dismissHandler = onDismiss;
  }

  public hideWarning(): void {
    this.hideCount += 1;
    this.dismissHandler = undefined;
  }

  public triggerDismiss(): void {
    this.dismissHandler?.();
  }
}

class MockSummaryPresenter implements SummaryPresenter {
  public summaries: SessionSummary[] = [];

  public showSummary(summary: SessionSummary): void {
    this.summaries.push(summary);
  }
}

class FixedVideoSelector implements VideoSelector {
  public pickVideo(): string {
    return "Sahur1.mp4";
  }
}

function createCoordinator(scheduler: FakeScheduler): {
  coordinator: LockInCoordinator;
  warningPresenter: MockWarningPresenter;
  summaryPresenter: MockSummaryPresenter;
} {
  const warningPresenter = new MockWarningPresenter();
  const summaryPresenter = new MockSummaryPresenter();
  const options: CoordinatorOptions = {
    focusGraceSeconds: 2,
    scheduler
  };

  const coordinator = new LockInCoordinator(warningPresenter, summaryPresenter, new FixedVideoSelector(), options);
  return { coordinator, warningPresenter, summaryPresenter };
}

describe("Warning lifecycle via LockInCoordinator", () => {
  it("opens a warning overlay after a qualified unfocus interval", () => {
    const scheduler = new FakeScheduler();
    const { coordinator, warningPresenter } = createCoordinator(scheduler);

    coordinator.startSession(5);
    coordinator.onWindowFocusChanged(false);
    scheduler.advanceBy(2_000);

    assert.equal(warningPresenter.showCount, 1);
    assert.equal(warningPresenter.lastVideo, "Sahur1.mp4");
    assert.equal(coordinator.getState(), "warningActive");
  });

  it("increments distraction count and hides warning on dismiss", () => {
    const scheduler = new FakeScheduler();
    const { coordinator, warningPresenter } = createCoordinator(scheduler);

    coordinator.startSession(5);
    coordinator.onWindowFocusChanged(false);
    scheduler.advanceBy(2_100);

    warningPresenter.triggerDismiss();

    assert.equal(coordinator.getDistractionCount(), 1);
    assert.equal(coordinator.getState(), "running");
    assert.equal(warningPresenter.hideCount, 2);
  });

  it("hides an active warning when session is stopped or naturally ends", () => {
    const scheduler = new FakeScheduler();
    const { coordinator, warningPresenter, summaryPresenter } = createCoordinator(scheduler);

    coordinator.startSession(5);
    coordinator.onWindowFocusChanged(false);
    scheduler.advanceBy(2_000);

    coordinator.stopSession();

    assert.equal(summaryPresenter.summaries.length, 1);
    assert.equal(summaryPresenter.summaries[0].reason, "stopped");
    assert.equal(warningPresenter.hideCount, 2);

    coordinator.startSession(1);
    scheduler.advanceBy(60_000);

    assert.equal(summaryPresenter.summaries.length, 2);
    assert.equal(summaryPresenter.summaries[1].reason, "completed");
    assert.ok(warningPresenter.hideCount >= 3);
  });
});
