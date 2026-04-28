import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import * as vscode from "vscode";
import { WarningPresenter } from "./coordinator";

const AUDIO_FILE_NAME = "tung-tung-sahur.mp3";
const LOCALHOST = "127.0.0.1";

type ActiveWarning = {
  token: string;
  videoFileName: string;
  onDismiss: () => void;
};

export class BrowserWarningPresenter implements WarningPresenter, vscode.Disposable {
  private server: http.Server | undefined;
  private port: number | undefined;
  private activeWarning: ActiveWarning | undefined;

  public constructor(private readonly extensionUri: vscode.Uri) {}

  public showWarning(videoFileName: string, onDismiss: () => void): void {
    const token = createNonce();
    this.activeWarning = { token, videoFileName, onDismiss };
    void this.openBrowserReminder(token);
  }

  public hideWarning(): void {
    this.activeWarning = undefined;
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

  private async openBrowserReminder(token: string): Promise<void> {
    try {
      const port = await this.ensureServer();
      const reminderUri = vscode.Uri.parse(`http://${LOCALHOST}:${port}/launch?token=${encodeURIComponent(token)}`);
      const opened = await vscode.env.openExternal(reminderUri);

      if (!opened && this.activeWarning?.token === token) {
        void vscode.window.showWarningMessage("Tung Tung Lock-In could not open the browser reminder automatically.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to launch the browser reminder.";
      void vscode.window.showErrorMessage(`Tung Tung Lock-In: ${message}`);
    }
  }

  private async ensureServer(): Promise<number> {
    if (this.server && this.port !== undefined) {
      return this.port;
    }

    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(0, LOCALHOST, () => {
        const address = this.server?.address();
        if (!address || typeof address === "string") {
          reject(new Error("Unable to determine a localhost port for the reminder server."));
          return;
        }

        this.port = address.port;
        resolve();
      });
    });

    return this.port!;
  }

  private async handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const port = this.port;
    if (!port) {
      this.respondNotFound(response);
      return;
    }

    try {
      const requestUrl = new URL(request.url ?? "/", `http://${LOCALHOST}:${port}`);

      if (requestUrl.pathname === "/launch") {
        this.respondLaunchPage(requestUrl, response);
        return;
      }

      if (requestUrl.pathname === "/warning") {
        this.respondWarningPage(requestUrl, response);
        return;
      }

      if (requestUrl.pathname === "/dismiss") {
        this.respondDismiss(requestUrl, request.method ?? "GET", response);
        return;
      }

      if (requestUrl.pathname === "/state") {
        this.respondState(requestUrl, response);
        return;
      }

      if (requestUrl.pathname.startsWith("/assets/")) {
        await this.respondAsset(requestUrl.pathname, response);
        return;
      }

      this.respondNotFound(response);
    } catch {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Tung Tung Lock-In reminder server error.");
    }
  }

  private respondLaunchPage(requestUrl: URL, response: http.ServerResponse): void {
    const warning = this.activeWarning;
    const token = requestUrl.searchParams.get("token");

    if (!warning || token !== warning.token) {
      response.writeHead(410, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end("<!DOCTYPE html><html><body><h1>Reminder expired</h1><p>You can close this tab.</p></body></html>");
      return;
    }

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(buildLauncherHtml(createNonce(), token));
  }

  private respondWarningPage(requestUrl: URL, response: http.ServerResponse): void {
    const warning = this.activeWarning;
    const token = requestUrl.searchParams.get("token");

    if (!warning || token !== warning.token) {
      response.writeHead(410, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end("<!DOCTYPE html><html><body><h1>Reminder expired</h1><p>You can close this tab.</p></body></html>");
      return;
    }

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(buildReminderHtml(createNonce(), token, warning.videoFileName));
  }

  private respondDismiss(requestUrl: URL, method: string, response: http.ServerResponse): void {
    if (method !== "POST") {
      response.writeHead(405, { Allow: "POST" });
      response.end();
      return;
    }

    const warning = this.activeWarning;
    const token = requestUrl.searchParams.get("token");
    if (!warning || token !== warning.token) {
      response.writeHead(410);
      response.end();
      return;
    }

    warning.onDismiss();
    response.writeHead(204);
    response.end();
  }

  private respondState(requestUrl: URL, response: http.ServerResponse): void {
    const active = Boolean(this.activeWarning && requestUrl.searchParams.get("token") === this.activeWarning.token);
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ active }));
  }

  private async respondAsset(requestPath: string, response: http.ServerResponse): Promise<void> {
    const assetName = decodeURIComponent(requestPath.replace("/assets/", ""));
    if (!isSafeAssetName(assetName)) {
      this.respondNotFound(response);
      return;
    }

    const assetPath = path.join(this.extensionUri.fsPath, "assets", assetName);
    if (!fs.existsSync(assetPath)) {
      this.respondNotFound(response);
      return;
    }

    response.writeHead(200, { "Content-Type": getContentType(assetName), "Cache-Control": "no-store" });
    fs.createReadStream(assetPath).pipe(response);
  }

  private respondNotFound(response: http.ServerResponse): void {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found.");
  }
}

function buildLauncherHtml(nonce: string, token: string): string {
  const popupUrl = `/warning?token=${encodeURIComponent(token)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self';" />
  <title>Launching Tung Tung Reminder</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: radial-gradient(circle at top, #40050a, #120103 70%);
      color: #ffe9a8;
      font-family: "Segoe UI", sans-serif;
    }

    .card {
      width: min(90vw, 560px);
      padding: 28px;
      border-radius: 18px;
      border: 1px solid rgba(255, 233, 168, 0.24);
      background: rgba(0, 0, 0, 0.62);
      box-shadow: 0 20px 48px rgba(0, 0, 0, 0.35);
      text-align: center;
    }

    h1 {
      margin: 0 0 12px;
      font-size: 1.9rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    p {
      margin: 10px 0;
      line-height: 1.5;
      color: rgba(255, 233, 168, 0.9);
    }

    a {
      color: #fff1be;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Launching reminder</h1>
    <p id="status">Trying to open a front-most popup window.</p>
    <p>If nothing appears, <a href="${popupUrl}" target="tungTungLockInReminder" rel="noopener noreferrer">open the reminder manually</a>.</p>
  </div>

  <script nonce="${nonce}">
    const status = document.getElementById("status");
    const popupFeatures = [
      "popup=yes",
      "noopener=no",
      "noreferrer=no",
      "resizable=yes",
      "scrollbars=no",
      "toolbar=no",
      "menubar=no",
      "location=no",
      "status=no",
      "width=" + Math.max(1100, Math.floor(window.screen.availWidth * 0.94)),
      "height=" + Math.max(760, Math.floor(window.screen.availHeight * 0.92)),
      "left=20",
      "top=20"
    ].join(",");

    const popup = window.open(${JSON.stringify(popupUrl)}, "tungTungLockInReminder", popupFeatures);

    if (popup) {
      status.textContent = "Popup launched. Bringing it to the front now.";
      try {
        popup.focus();
      } catch {}

      window.setTimeout(() => {
        try {
          popup.focus();
          window.close();
        } catch {}
      }, 400);
    } else {
      status.textContent = "The browser blocked the popup, so this tab stays as your fallback launcher.";
      window.location.replace(${JSON.stringify(popupUrl)});
    }
  </script>
</body>
</html>`;
}

function buildReminderHtml(nonce: string, token: string, videoFileName: string): string {
  const audioPath = `/assets/${encodeURIComponent(AUDIO_FILE_NAME)}`;
  const videoPath = `/assets/${encodeURIComponent(videoFileName)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self';" />
  <title>TUNG TUNG TUNG SAHUR</title>
  <style>
    :root {
      --bg-start: #110102;
      --bg-end: #3b0307;
      --text-glow: #ffde59;
      --text-main: #ffe9a8;
      --accent: #ff2b2b;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      user-select: none;
      -webkit-user-select: none;
      font-family: "Trebuchet MS", "Segoe UI", sans-serif;
    }

    html,
    body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: radial-gradient(circle at 20% 10%, var(--bg-end), var(--bg-start));
      color: white;
    }

    .stage {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      border: 6px solid rgba(255, 43, 43, 0.65);
      background: radial-gradient(circle at center, rgba(255, 255, 255, 0.08), rgba(0, 0, 0, 0.9));
    }

    .video-background,
    .video-foreground {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }

    .video-background {
      object-fit: cover;
      opacity: 0.26;
      filter: blur(16px) saturate(1.25);
      transform: scale(1.08);
    }

    .video-foreground {
      object-fit: contain;
      opacity: 0.92;
      filter: contrast(1.08) saturate(1.2) drop-shadow(0 12px 28px rgba(0, 0, 0, 0.45));
    }

    .overlay {
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0.72));
    }

    .warning-banner {
      position: absolute;
      top: 32px;
      left: 50%;
      transform: translateX(-50%);
      width: min(92vw, 1280px);
      padding: 0 16px;
      text-align: center;
      pointer-events: none;
    }

    .warning-text {
      font-size: clamp(2.2rem, 5vw, 4.8rem);
      line-height: 0.98;
      font-weight: 900;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--text-main);
      text-shadow: 0 0 22px var(--text-glow), 0 0 60px rgba(255, 75, 75, 0.75);
      word-break: break-word;
    }

    .warning-subtext {
      margin-top: 14px;
      font-size: clamp(0.95rem, 1.6vw, 1.35rem);
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: rgba(255, 233, 168, 0.92);
      text-shadow: 0 0 18px rgba(0, 0, 0, 0.85);
    }

    .controls {
      position: absolute;
      bottom: 22px;
      left: 50%;
      transform: translateX(-50%);
      width: min(92vw, 720px);
      text-align: center;
    }

    button {
      border: none;
      font-size: 1rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 800;
      padding: 12px 20px;
      border-radius: 10px;
      background: linear-gradient(120deg, #ff4d4d, var(--accent));
      color: #fff;
      cursor: pointer;
      box-shadow: 0 8px 22px rgba(255, 43, 43, 0.45);
    }

    button:hover {
      filter: brightness(1.08);
      transform: translateY(-1px);
    }

    button:disabled {
      cursor: default;
      opacity: 0.72;
      transform: none;
    }

    .hint,
    .status,
    .sound-overlay {
      border-radius: 12px;
      background: rgba(0, 0, 0, 0.62);
      border: 1px solid rgba(255, 233, 168, 0.35);
      color: rgba(255, 233, 168, 0.95);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .hint,
    .status {
      position: absolute;
      padding: 10px 12px;
      font-size: 0.85rem;
      opacity: 0;
      transition: opacity 180ms ease, transform 180ms ease;
    }

    .hint {
      top: 18px;
      right: 18px;
      pointer-events: none;
      transform: translateY(-6px);
    }

    .status {
      bottom: 82px;
      left: 50%;
      max-width: min(90vw, 600px);
      text-align: center;
      transform: translate(-50%, 12px);
    }

    .sound-overlay {
      position: absolute;
      inset: auto 50% 110px auto;
      transform: translateX(50%);
      display: none;
      width: min(92vw, 520px);
      padding: 14px 18px;
      text-align: center;
      box-shadow: 0 14px 36px rgba(0, 0, 0, 0.4);
      z-index: 2;
    }

    .sound-overlay.visible,
    .hint.visible,
    .status.visible {
      opacity: 1;
    }

    .sound-overlay.visible {
      display: block;
    }

    .hint.visible {
      transform: translateY(0);
    }

    .status.visible {
      transform: translate(-50%, 0);
    }
  </style>
</head>
<body>
  <div class="stage">
    <video id="sahurVideoBackground" class="video-background" autoplay loop muted playsinline preload="auto" src="${videoPath}"></video>
    <video id="sahurVideo" class="video-foreground" autoplay loop muted playsinline preload="auto" src="${videoPath}"></video>
    <audio id="sahurAudio" autoplay loop preload="auto" src="${audioPath}"></audio>
    <div class="overlay"></div>
    <div class="warning-banner">
      <div id="warningText" class="warning-text">TUNG TUNG TUNG SAHUR</div>
      <div class="warning-subtext">Lock back in now</div>
    </div>
    <div id="hint" class="hint">Attempting auto-play</div>
    <div id="soundOverlay" class="sound-overlay">If your browser blocks sound, click anywhere once to enable SAHUR audio.</div>
    <div id="status" class="status"></div>
    <div class="controls">
      <button id="dismissButton" type="button">I am back in VS Code</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const token = ${JSON.stringify(token)};
    const reminderText = document.getElementById("warningText");
    const primaryVideo = document.getElementById("sahurVideo");
    const backgroundVideo = document.getElementById("sahurVideoBackground");
    const audio = document.getElementById("sahurAudio");
    const dismissButton = document.getElementById("dismissButton");
    const hint = document.getElementById("hint");
    const soundOverlay = document.getElementById("soundOverlay");
    const status = document.getElementById("status");

    let reminderResolved = false;
    let soundEnabled = false;
    let retryTimer;
    let stateTimer;

    const setStatus = (message) => {
      if (!status) {
        return;
      }

      status.textContent = message;
      status.classList.toggle("visible", Boolean(message));
    };

    const setSoundPromptVisible = (visible) => {
      hint?.classList.toggle("visible", visible);
      soundOverlay?.classList.toggle("visible", visible);
    };

    const tryRaiseWindow = () => {
      try {
        window.focus();
        window.moveTo(0, 0);
        window.resizeTo(window.screen.availWidth, window.screen.availHeight);
      } catch {}
    };

    const attemptMediaPlayback = async () => {
      let blocked = false;

      try {
        await primaryVideo?.play();
      } catch {}

      try {
        await backgroundVideo?.play();
      } catch {}

      try {
        if (audio) {
          audio.volume = 1;
          audio.muted = false;
          await audio.play();
          soundEnabled = true;
        }
      } catch {
        blocked = true;
        soundEnabled = false;
      }

      setSoundPromptVisible(blocked);
      if (!blocked && retryTimer) {
        window.clearInterval(retryTimer);
        retryTimer = undefined;
      }
    };

    const acknowledgeReminder = (useBeacon) => {
      if (reminderResolved) {
        return;
      }

      reminderResolved = true;
      dismissButton.disabled = true;

      const url = "/dismiss?token=" + encodeURIComponent(token);
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(url, "");
        return;
      }

      void fetch(url, { method: "POST", keepalive: true });
    };

    const pollReminderState = async () => {
      try {
        const response = await fetch("/state?token=" + encodeURIComponent(token), { cache: "no-store" });
        const data = await response.json();
        if (!data.active) {
          reminderResolved = true;
          dismissButton.disabled = true;
          setStatus("Reminder cleared. You can close this window.");
          if (stateTimer) {
            window.clearInterval(stateTimer);
            stateTimer = undefined;
          }
        }
      } catch {}
    };

    dismissButton.addEventListener("click", () => {
      if (reminderResolved) {
        return;
      }

      acknowledgeReminder(false);
      setStatus("Nice. Head back to VS Code and keep cooking.");
    });

    const retryWithUserGesture = () => {
      void attemptMediaPlayback();
    };

    document.addEventListener("pointerdown", retryWithUserGesture);
    document.addEventListener("keydown", retryWithUserGesture);
    window.addEventListener("focus", () => {
      tryRaiseWindow();
      void attemptMediaPlayback();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        tryRaiseWindow();
        void attemptMediaPlayback();
      }
    });
    window.addEventListener("pagehide", () => {
      acknowledgeReminder(true);
    });
    window.addEventListener("beforeunload", () => {
      acknowledgeReminder(true);
    });

    audio?.addEventListener("playing", () => {
      soundEnabled = true;
      setSoundPromptVisible(false);
    });

    audio?.addEventListener("pause", () => {
      if (!reminderResolved && document.visibilityState === "visible") {
        void attemptMediaPlayback();
      }
    });

    let x = 0;
    let y = 0;
    let dx = 4;
    let dy = 3.2;

    const animateText = () => {
      const width = reminderText.offsetWidth;
      const height = reminderText.offsetHeight;
      const margin = 24;
      const controlsBuffer = 170;
      const maxX = Math.max(margin, window.innerWidth - width - margin);
      const maxY = Math.max(120, window.innerHeight - height - controlsBuffer);

      x += dx;
      y += dy;

      if (x <= margin || x >= maxX) {
        dx *= -1;
        x = Math.max(margin, Math.min(maxX, x));
      }

      if (y <= margin || y >= maxY) {
        dy *= -1;
        y = Math.max(margin, Math.min(maxY, y));
      }

      reminderText.style.transform = "translate(" + x + "px, " + y + "px)";
      window.requestAnimationFrame(animateText);
    };

    tryRaiseWindow();
    void attemptMediaPlayback();
    retryTimer = window.setInterval(() => {
      tryRaiseWindow();
      if (!soundEnabled && !reminderResolved) {
        void attemptMediaPlayback();
      }
    }, 1500);
    stateTimer = window.setInterval(pollReminderState, 1000);
    window.requestAnimationFrame(animateText);
  </script>
</body>
</html>`;
}

function isSafeAssetName(fileName: string): boolean {
  return fileName.length > 0 && path.basename(fileName) === fileName;
}

function getContentType(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".mp4") {
    return "video/mp4";
  }

  if (extension === ".mp3") {
    return "audio/mpeg";
  }

  return "application/octet-stream";
}

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let index = 0; index < 32; index += 1) {
    result += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }

  return result;
}
