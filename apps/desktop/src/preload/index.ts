import { contextBridge, ipcRenderer } from "electron";

const api = {
  platform: process.platform as NodeJS.Platform,
  window: {
    minimize: (): void => ipcRenderer.send("window:minimize"),
    maximize: (): void => ipcRenderer.send("window:maximize"),
    close: (): void => ipcRenderer.send("window:close"),
  },
};

export type VicutApi = typeof api;

contextBridge.exposeInMainWorld("vicut", api);
