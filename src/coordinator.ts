import { LockInSessionManager, Scheduler, SessionState, SessionSummary } from "./sessionManager";

export interface WarningPresenter {
  showWarning: (videoFileName: string, onDismiss: () => void) => void;
  hideWarning: () => void;
}

export interface SummaryPresenter {
  showSummary: (summary: SessionSummary) => void;
}

export interface VideoSelector {
  pickVideo: () => string;
}

export interface CoordinatorOptions {
  focusGraceSeconds: number;
  scheduler?: Scheduler;
}

export class LockInCoordinator {
  private readonly manager: LockInSessionManager;
  private warningVisible = false;

  public constructor(
    private readonly warningPresenter: WarningPresenter,
    private readonly summaryPresenter: SummaryPresenter,
    private readonly videoSelector: VideoSelector,
    options: CoordinatorOptions
  ) {
    this.manager = new LockInSessionManager(
      {
        onWarningRequired: () => {
          this.warningVisible = true;
          const selectedVideo = this.videoSelector.pickVideo();
          this.warningPresenter.showWarning(selectedVideo, () => this.dismissWarning());
        },
        onSessionEnded: (summary) => {
          this.warningVisible = false;
          this.warningPresenter.hideWarning();
          this.summaryPresenter.showSummary(summary);
        }
      },
      options.focusGraceSeconds,
      options.scheduler
    );
  }

  public startSession(minutes: number): void {
    this.warningVisible = false;
    this.warningPresenter.hideWarning();
    this.manager.startSession(minutes);
  }

  public stopSession(): SessionSummary | null {
    return this.manager.stopSession();
  }

  public onWindowFocusChanged(focused: boolean): void {
    this.manager.onWindowFocusChanged(focused);
  }

  public dismissWarning(): void {
    const wasDismissed = this.manager.dismissWarning();
    if (wasDismissed) {
      this.warningVisible = false;
      this.warningPresenter.hideWarning();
    }
  }

  public setFocusGraceSeconds(seconds: number): void {
    this.manager.setFocusGraceSeconds(seconds);
  }

  public getState(): SessionState {
    return this.manager.getState();
  }

  public getDistractionCount(): number {
    return this.manager.getDistractionCount();
  }

  public isWarningVisible(): boolean {
    return this.warningVisible;
  }

  public dispose(): void {
    this.warningVisible = false;
    this.warningPresenter.hideWarning();
    this.manager.dispose();
  }
}