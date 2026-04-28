import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { LockInCoordinator, SummaryPresenter, VideoSelector } from "./coordinator";
import { NativeReminderPresenter } from "./nativeReminderPresenter";
import { SessionSummary } from "./sessionManager";

const CONFIG_NAMESPACE = "tungTungLockIn";
const DEFAULT_FOCUS_GRACE_SECONDS = 2;

class VsCodeSummaryPresenter implements SummaryPresenter {
  public showSummary(summary: SessionSummary): void {
    const reasonLabel = summary.reason === "completed" ? "Session complete" : "Session stopped";
    const detail = [
      `Distractions: ${summary.distractionCount}`,
      `Elapsed: ${formatDuration(summary.elapsedMs)}`,
      `Planned: ${formatDuration(summary.plannedMs)}`
    ].join("\n");

    void vscode.window.showInformationMessage(`Tung Tung Lock-In: ${reasonLabel}`, { modal: true, detail });
  }
}

class RandomVideoSelector implements VideoSelector {
  public constructor(private readonly videoFiles: string[]) {}

  public pickVideo(): string {
    if (this.videoFiles.length === 0) {
      throw new Error("No warning videos were found in assets.");
    }

    const randomIndex = Math.floor(Math.random() * this.videoFiles.length);
    return this.videoFiles[randomIndex];
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  const focusGraceSeconds = config.get<number>("focusGraceSeconds", DEFAULT_FOCUS_GRACE_SECONDS);

  const videoFiles = getVideoFiles(context.extensionPath);
  if (videoFiles.length === 0) {
    void vscode.window.showWarningMessage("Tung Tung Lock-In could not find any .mp4 warning videos in the assets folder.");
  }

  const warningPresenter = new NativeReminderPresenter(context.extensionUri);
  const summaryPresenter = new VsCodeSummaryPresenter();
  const videoSelector = new RandomVideoSelector(videoFiles);
  const coordinator = new LockInCoordinator(warningPresenter, summaryPresenter, videoSelector, {
    focusGraceSeconds
  });

  context.subscriptions.push(warningPresenter);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${CONFIG_NAMESPACE}.focusGraceSeconds`)) {
        const updatedGraceSeconds = vscode.workspace
          .getConfiguration(CONFIG_NAMESPACE)
          .get<number>("focusGraceSeconds", DEFAULT_FOCUS_GRACE_SECONDS);
        coordinator.setFocusGraceSeconds(updatedGraceSeconds);
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      coordinator.onWindowFocusChanged(state.focused);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("tungTungLockIn.startSession", async () => {
      const state = coordinator.getState();
      if (state === "running" || state === "warningActive") {
        void vscode.window.showWarningMessage("A Tung Tung Lock-In session is already running.");
        return;
      }

      if (videoFiles.length === 0) {
        void vscode.window.showErrorMessage("No warning videos are available in assets. Add at least one .mp4 file.");
        return;
      }

      const defaultMinutes = vscode.workspace
        .getConfiguration(CONFIG_NAMESPACE)
        .get<number>("defaultSessionMinutes", 25);

      const value = await vscode.window.showInputBox({
        title: "Start Tung Tung Lock-In Session",
        prompt: "Enter session length in minutes",
        value: String(defaultMinutes),
        ignoreFocusOut: true,
        validateInput: (raw) => {
          const parsed = Number(raw);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            return "Enter a number greater than 0.";
          }

          return undefined;
        }
      });

      if (!value) {
        return;
      }

      const minutes = Number(value);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return;
      }

      try {
        coordinator.startSession(minutes);
        void vscode.window.showInformationMessage(`Tung Tung Lock-In started for ${minutes} minute(s). Stay focused.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to start a session.";
        void vscode.window.showErrorMessage(message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("tungTungLockIn.stopSession", () => {
      const summary = coordinator.stopSession();
      if (!summary) {
        void vscode.window.showInformationMessage("No active Tung Tung Lock-In session to stop.");
      }
    })
  );

  context.subscriptions.push({
    dispose: () => {
      coordinator.dispose();
    }
  });
}

export function deactivate(): void {
  // VS Code disposes subscriptions from activate().
}

function getVideoFiles(extensionPath: string): string[] {
  const assetsPath = path.join(extensionPath, "assets");

  if (!fs.existsSync(assetsPath)) {
    return [];
  }

  const files = fs.readdirSync(assetsPath);
  return files.filter((file) => file.toLowerCase().endsWith(".mp4"));
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}
