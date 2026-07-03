import { contextBridge, ipcRenderer } from "electron";
//#region src/preload/index.ts
var api = {
	platform: process.platform,
	window: {
		minimize: () => ipcRenderer.send("window:minimize"),
		maximize: () => ipcRenderer.send("window:maximize"),
		close: () => ipcRenderer.send("window:close")
	}
};
contextBridge.exposeInMainWorld("vicut", api);
//#endregion
export {};
