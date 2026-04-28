import { ChildProcess, spawn } from "child_process";
import * as http from "http";
import * as path from "path";
import * as process from "process";
import * as vscode from "vscode";
import { WarningPresenter } from "./coordinator";

const LOCALHOST = "127.0.0.1";

type ActiveReminder = {
  dismissHandler: () => void;
  process: ChildProcess;
  token: string;
};

export class NativeReminderPresenter implements WarningPresenter, vscode.Disposable {
  private server: http.Server | undefined;
  private port: number | undefined;
  private activeReminder: ActiveReminder | undefined;

  public constructor(private readonly extensionUri: vscode.Uri) {}

  public showWarning(videoFileName: string, onDismiss: () => void): void {
    void this.launchReminder(videoFileName, onDismiss);
  }

  public hideWarning(): void {
    const reminder = this.activeReminder;
    this.activeReminder = undefined;

    if (!reminder) {
      return;
    }

    reminder.process.kill();
  }

  public dispose(): void {
    this.hideWarning();

    if (!this.server) {
      return;
    }

    this.server.close();
    this.server = undefined;
    this.port = undefined;
  }

  private async launchReminder(videoFileName: string, onDismiss: () => void): Promise<void> {
    this.hideWarning();

    if (process.platform !== "win32") {
      void vscode.window.showErrorMessage("Native Tung Tung reminder is currently supported on Windows only.");
      return;
    }

    const port = await this.ensureServer();
    const token = createNonce();
    const dismissUrl = `http://${LOCALHOST}:${port}/dismiss?token=${encodeURIComponent(token)}`;
    const scriptPath = path.join(this.extensionUri.fsPath, "resources", "nativeReminderWindow.ps1");
    const videoPath = path.join(this.extensionUri.fsPath, "assets", videoFileName);
    const audioPath = path.join(this.extensionUri.fsPath, "assets", "tung-tung-sahur.mp3");

    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-STA",
        "-File",
        scriptPath,
        "-VideoPath",
        videoPath,
        "-AudioPath",
        audioPath,
        "-DismissUrl",
        dismissUrl
      ],
      {
        cwd: this.extensionUri.fsPath,
        windowsHide: true
      }
    );

    this.activeReminder = {
      dismissHandler: onDismiss,
      process: child,
      token
    };

    child.once("error", (error) => {
      if (this.activeReminder?.token !== token) {
        return;
      }

      this.activeReminder = undefined;
      void vscode.window.showErrorMessage(`Tung Tung Lock-In: failed to launch native reminder (${error.message}).`);
    });

    child.once("exit", () => {
      const reminder = this.activeReminder;
      if (!reminder || reminder.token !== token) {
        return;
      }

      this.activeReminder = undefined;
    });
  }

  private async ensureServer(): Promise<number> {
    if (this.server && this.port !== undefined) {
      return this.port;
    }

    this.server = http.createServer((request, response) => {
      this.handleRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(0, LOCALHOST, () => {
        const address = this.server?.address();
        if (!address || typeof address === "string") {
          reject(new Error("Unable to determine a localhost port for the native reminder."));
          return;
        }

        this.port = address.port;
        resolve();
      });
    });

    return this.port!;
  }

  private handleRequest(request: http.IncomingMessage, response: http.ServerResponse): void {
    if (!this.port) {
      this.respond(response, 404, "Not found.");
      return;
    }

    try {
      const requestUrl = new URL(request.url ?? "/", `http://${LOCALHOST}:${this.port}`);
      if (requestUrl.pathname !== "/dismiss" || request.method !== "POST") {
        this.respond(response, 404, "Not found.");
        return;
      }

      const reminder = this.activeReminder;
      const token = requestUrl.searchParams.get("token");
      if (!reminder || token !== reminder.token) {
        this.respond(response, 410, "Expired.");
        return;
      }

      this.activeReminder = undefined;
      reminder.dismissHandler();
      this.respond(response, 204, "");
    } catch {
      this.respond(response, 500, "Reminder server error.");
    }
  }

  private respond(response: http.ServerResponse, statusCode: number, body: string): void {
    response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end(body);
  }
}

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let index = 0; index < 32; index += 1) {
    result += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }

  return result;
}
