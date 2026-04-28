export type SessionState = "idle" | "running" | "warningActive" | "ended";

export type SessionEndReason = "completed" | "stopped";

export interface SessionSummary {
  distractionCount: number;
  elapsedMs: number;
  plannedMs: number;
  reason: SessionEndReason;
}

export interface SessionManagerEvents {
  onWarningRequired: () => void;
  onSessionEnded: (summary: SessionSummary) => void;
}

export interface Scheduler {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const defaultScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout)
};

export class LockInSessionManager {
  private state: SessionState = "idle";
  private distractionCount = 0;
  private isWindowFocused = true;
  private focusGraceMs: number;
  private sessionStartMs = 0;
  private plannedDurationMs = 0;
  private sessionTimer: unknown;
  private unfocusTimer: unknown;

  public constructor(
    private readonly events: SessionManagerEvents,
    focusGraceSeconds: number,
    private readonly scheduler: Scheduler = defaultScheduler
  ) {
    this.focusGraceMs = Math.max(0, focusGraceSeconds) * 1000;
  }

  public setFocusGraceSeconds(seconds: number): void {
    this.focusGraceMs = Math.max(0, seconds) * 1000;
  }

  public startSession(minutes: number): void {
    if (this.state === "running" || this.state === "warningActive") {
      throw new Error("A lock-in session is already running.");
    }

    const sessionMinutes = Math.max(1, minutes);

    this.clearTimers();
    this.distractionCount = 0;
    this.isWindowFocused = true;
    this.plannedDurationMs = sessionMinutes * 60_000;
    this.sessionStartMs = this.scheduler.now();
    this.state = "running";

    this.sessionTimer = this.scheduler.setTimeout(() => {
      this.endSession("completed");
    }, this.plannedDurationMs);
  }

  public stopSession(): SessionSummary | null {
    if (this.state === "idle") {
      return null;
    }

    return this.endSession("stopped");
  }

  public onWindowFocusChanged(focused: boolean): void {
    this.isWindowFocused = focused;

    if (this.state !== "running") {
      return;
    }

    if (focused) {
      this.clearUnfocusTimer();
      return;
    }

    this.startUnfocusTimer();
  }

  public dismissWarning(): boolean {
    if (this.state !== "warningActive") {
      return false;
    }

    this.distractionCount += 1;
    this.state = "running";
    if (!this.isWindowFocused) {
      this.startUnfocusTimer();
    }
    return true;
  }

  public getState(): SessionState {
    return this.state;
  }

  public getDistractionCount(): number {
    return this.distractionCount;
  }

  public getElapsedMs(): number {
    if (this.state === "idle") {
      return 0;
    }

    return Math.max(0, this.scheduler.now() - this.sessionStartMs);
  }

  public dispose(): void {
    this.clearTimers();
  }

  private endSession(reason: SessionEndReason): SessionSummary {
    if (this.state === "idle") {
      return {
        distractionCount: 0,
        elapsedMs: 0,
        plannedMs: 0,
        reason
      };
    }

    this.clearTimers();
    const summary: SessionSummary = {
      distractionCount: this.distractionCount,
      elapsedMs: Math.max(0, this.scheduler.now() - this.sessionStartMs),
      plannedMs: this.plannedDurationMs,
      reason
    };

    this.state = "ended";
    this.events.onSessionEnded(summary);

    return summary;
  }

  private clearTimers(): void {
    this.clearSessionTimer();
    this.clearUnfocusTimer();
  }

  private clearSessionTimer(): void {
    if (this.sessionTimer !== undefined) {
      this.scheduler.clearTimeout(this.sessionTimer);
      this.sessionTimer = undefined;
    }
  }

  private clearUnfocusTimer(): void {
    if (this.unfocusTimer !== undefined) {
      this.scheduler.clearTimeout(this.unfocusTimer);
      this.unfocusTimer = undefined;
    }
  }

  private startUnfocusTimer(): void {
    this.clearUnfocusTimer();
    this.unfocusTimer = this.scheduler.setTimeout(() => {
      if (this.state === "running" && !this.isWindowFocused) {
        this.state = "warningActive";
        this.events.onWarningRequired();
      }
    }, this.focusGraceMs);
  }
}
