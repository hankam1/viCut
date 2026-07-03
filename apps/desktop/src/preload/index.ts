import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  Config,
  JobSpec,
  MediaInfo,
  Preset,
  QueueJob,
  RenderStage,
  ToolLocation,
} from "@vicut/core";

export interface OutputOverrides {
  resolution?: "source" | "480p" | "720p" | "1080p" | "1440p" | "2160p";
  fps?: "source" | 30 | 60;
  videoCodec?: "h264" | "hevc";
}

export interface AddJobPayload {
  /** Тип A — плоский список клипов; тип B — spec целиком. */
  inputs?: string[];
  spec?: JobSpec;
  output?: string;
  presetName: string;
  title?: string;
  overrides?: OutputOverrides;
  autoStart?: boolean;
}

export interface JobProgressEvent {
  jobId: number;
  stage: RenderStage;
  percent: number | null;
  detail?: string;
}

export interface JobFinishedEvent {
  jobId: number;
  ok: boolean;
  srtPath?: string | null;
}

export interface ToolsStatus {
  ffmpeg: ToolLocation | null;
  ffprobe: ToolLocation | null;
  whisper: string | null;
  models: string[];
}

const EVENT_CHANNELS = [
  "queue:changed",
  "queue:job-progress",
  "queue:job-finished",
  "queue:running-changed",
  "setup:progress",
  "debug:open-wizard",
  "debug:open-view",
] as const;

type EventChannel = (typeof EVENT_CHANNELS)[number];

function on(channel: EventChannel, callback: (payload: unknown) => void): () => void {
  if (!EVENT_CHANNELS.includes(channel)) throw new Error(`unknown event channel: ${channel}`);
  const listener = (_event: unknown, payload: unknown): void => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  platform: process.platform as NodeJS.Platform,
  window: {
    minimize: (): void => ipcRenderer.send("window:minimize"),
    maximize: (): void => ipcRenderer.send("window:maximize"),
    close: (): void => ipcRenderer.send("window:close"),
  },
  /** Абсолютный путь файла, брошенного drag&drop-ом. */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  on,
  queue: {
    list: (): Promise<QueueJob[]> => ipcRenderer.invoke("queue:list"),
    add: (payload: AddJobPayload): Promise<QueueJob> => ipcRenderer.invoke("queue:add", payload),
    start: (): Promise<void> => ipcRenderer.invoke("queue:start"),
    pause: (): Promise<void> => ipcRenderer.invoke("queue:pause"),
    isRunning: (): Promise<boolean> => ipcRenderer.invoke("queue:is-running"),
    cancel: (id: number): Promise<boolean> => ipcRenderer.invoke("queue:cancel", id),
    retry: (id: number): Promise<boolean> => ipcRenderer.invoke("queue:retry", id),
    remove: (id: number): Promise<boolean> => ipcRenderer.invoke("queue:remove", id),
    clearFinished: (): Promise<number> => ipcRenderer.invoke("queue:clear-finished"),
  },
  presets: {
    list: (): Promise<{ builtins: Preset[]; user: Preset[] }> => ipcRenderer.invoke("presets:list"),
    save: (preset: Preset): Promise<string> => ipcRenderer.invoke("presets:save", preset),
  },
  config: {
    get: (): Promise<Config> => ipcRenderer.invoke("config:get"),
    set: (config: Config): Promise<void> => ipcRenderer.invoke("config:set", config),
  },
  tools: {
    status: (): Promise<ToolsStatus> => ipcRenderer.invoke("tools:status"),
  },
  setup: {
    ffmpeg: (force?: boolean): Promise<{ ffmpeg: ToolLocation; ffprobe: ToolLocation }> =>
      ipcRenderer.invoke("setup:ffmpeg", force),
    whisper: (model: string): Promise<{ whisperPath: string; modelFile: string }> =>
      ipcRenderer.invoke("setup:whisper", model),
  },
  probeFile: (path: string): Promise<MediaInfo> => ipcRenderer.invoke("probe:file", path),
  dialog: {
    pickVideos: (): Promise<string[]> => ipcRenderer.invoke("dialog:pick-videos"),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke("dialog:pick-folder"),
  },
  shell: {
    showItem: (path: string): Promise<void> => ipcRenderer.invoke("shell:show-item", path),
    openPath: (path: string): Promise<void> => ipcRenderer.invoke("shell:open-path", path),
  },
};

export type VicutApi = typeof api;

contextBridge.exposeInMainWorld("vicut", api);
