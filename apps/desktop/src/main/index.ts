import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";

const rendererUrl = process.env["ELECTRON_RENDERER_URL"];

ipcMain.on("window:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});
ipcMain.on("window:maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on("window:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    frame: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : undefined,
    trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: "#0B0D10",
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.mjs"),
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  if (rendererUrl) win.loadURL(rendererUrl);
  else void win.loadFile(path.join(import.meta.dirname, "../renderer/index.html"));
}

void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
