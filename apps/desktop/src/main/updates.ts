import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { dataDir, downloadFile } from "@vicut/core";

const RELEASES_API = "https://api.github.com/repos/hankam1/viCut/releases/latest";
const RELEASES_PAGE = "https://github.com/hankam1/viCut/releases/latest";

export type UpdateState =
  | { state: "checking" }
  | { state: "none"; version: string }
  | { state: "available"; version: string; canAutoInstall: boolean }
  | { state: "downloading"; version: string; percent: number | null }
  | { state: "ready"; version: string }
  | { state: "error"; error: string };

interface LatestRelease {
  version: string;
  pageUrl: string;
  installer: { name: string; url: string } | null;
}

let latest: LatestRelease | null = null;
let installerPath: string | null = null;
let lastStatus: UpdateState | null = null;

function broadcast(status: UpdateState): void {
  lastStatus = status;
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send("updates:status", status);
}

/** "0.2.10" vs "0.2.9" — покомпонентное числовое сравнение. */
function newerThan(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db;
  }
  return false;
}

async function check(): Promise<UpdateState> {
  broadcast({ state: "checking" });
  try {
    const response = await fetch(RELEASES_API, {
      headers: { "user-agent": "ViCut", accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub API: HTTP ${response.status}`);
    const json = (await response.json()) as {
      tag_name?: string;
      html_url?: string;
      assets?: Array<{ name: string; browser_download_url: string }>;
    };
    const version = (json.tag_name ?? "").replace(/^v/, "");
    if (!version) throw new Error("релиз без версии");

    const installer =
      json.assets?.find((asset) => /\.exe$/i.test(asset.name)) ?? null;
    latest = {
      version,
      pageUrl: json.html_url ?? RELEASES_PAGE,
      installer: installer
        ? { name: installer.name, url: installer.browser_download_url }
        : null,
    };

    const status: UpdateState = newerThan(version, app.getVersion())
      ? {
          state: "available",
          version,
          canAutoInstall: process.platform === "win32" && latest.installer !== null,
        }
      : { state: "none", version: app.getVersion() };
    broadcast(status);
    return status;
  } catch (error) {
    const status: UpdateState = {
      state: "error",
      error: error instanceof Error ? error.message : String(error),
    };
    broadcast(status);
    return status;
  }
}

/** Скачать установщик (Windows) с прогрессом в updates:status. */
async function download(): Promise<UpdateState> {
  if (!latest?.installer || process.platform !== "win32") {
    return { state: "error", error: "автообновление доступно только на Windows" };
  }
  const { version, installer } = latest;
  try {
    const dir = path.join(dataDir(), "updates");
    await fsp.mkdir(dir, { recursive: true });
    const dest = path.join(dir, installer.name);
    broadcast({ state: "downloading", version, percent: 0 });
    let lastSent = 0;
    await downloadFile(installer.url, dest, (p) => {
      const now = Date.now();
      if (now - lastSent < 300) return;
      lastSent = now;
      broadcast({
        state: "downloading",
        version,
        percent: p.totalBytes ? (p.receivedBytes / p.totalBytes) * 100 : null,
      });
    });
    installerPath = dest;
    const status: UpdateState = { state: "ready", version };
    broadcast(status);
    return status;
  } catch (error) {
    const status: UpdateState = {
      state: "error",
      error: error instanceof Error ? error.message : String(error),
    };
    broadcast(status);
    return status;
  }
}

/**
 * Тихо обновиться и выйти; без установщика — открыть страницу релиза.
 * /S — NSIS ставит в прежнюю папку без окон, --updated помечает запуск как
 * обновление, --force-run перезапускает приложение после установки.
 */
function install(): void {
  if (installerPath) {
    spawn(installerPath, ["/S", "--updated", "--force-run"], {
      detached: true,
      stdio: "ignore",
    }).unref();
    app.quit();
  } else {
    void shell.openExternal(latest?.pageUrl ?? RELEASES_PAGE);
  }
}

export function registerUpdatesIpc(): void {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("updates:check", () => check());
  ipcMain.handle("updates:download", () => download());
  ipcMain.handle("updates:install", () => install());
  ipcMain.handle("updates:last-status", () => lastStatus);

  // Тихая проверка после запуска — рендерер покажет тост, если есть обновление.
  if (app.isPackaged) {
    setTimeout(() => void check(), 8000);
  }
}
