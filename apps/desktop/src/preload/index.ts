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
  /** Оценка оставшегося времени стадии, сек. */
  etaSec?: number | null;
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

export type UpdateState =
  | { state: "checking" }
  | { state: "none"; version: string }
  | { state: "available"; version: string; canAutoInstall: boolean }
  | { state: "downloading"; version: string; percent: number | null }
  | { state: "ready"; version: string }
  | { state: "error"; error: string };

const EVENT_CHANNELS = [
  "queue:changed",
  "queue:job-progress",
  "queue:job-finished",
  "queue:running-changed",
  "setup:progress",
  "updates:status",
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
    /** Переименовать пользовательский пресет (и его файл). */
    rename: (
      oldName: string,
      newName: string,
    ): Promise<{ ok: true; preset: Preset } | { ok: false; error: string }> =>
      ipcRenderer.invoke("presets:rename", oldName, newName),
    /** Сохранить пресет в .json по выбору пользователя; null — отменено. */
    export: (preset: Preset): Promise<string | null> =>
      ipcRenderer.invoke("presets:export", preset),
    /** Импортировать .json; error: null — диалог отменён. */
    import: (): Promise<
      { ok: true; preset: Preset } | { ok: false; error: string | null }
    > => ipcRenderer.invoke("presets:import"),
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
  media: {
    /** Разложить пути (включая папки) на аудио/клипы/картинки, natural-sort. */
    classify: (paths: string[]): Promise<{ audios: string[]; clips: string[]; images: string[] }> =>
      ipcRenderer.invoke("media:classify", paths),
  },
  dialog: {
    /** Любые медиафайлы (видео/аудио/картинки) — для добавления в очередь. */
    pickMedia: (): Promise<string[]> => ipcRenderer.invoke("dialog:pick-media"),
    pickVideos: (): Promise<string[]> => ipcRenderer.invoke("dialog:pick-videos"),
    pickAudio: (): Promise<string | null> => ipcRenderer.invoke("dialog:pick-audio"),
    pickVisuals: (): Promise<string[]> => ipcRenderer.invoke("dialog:pick-visuals"),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke("dialog:pick-folder"),
  },
  preview: {
    /** Выбрать картинку для живого превью пресетов; вернёт ужатый data URL. */
    pickImage: (): Promise<{ path: string; dataUrl: string } | null> =>
      ipcRenderer.invoke("dialog:pick-preview-image"),
    /** Перечитать сохранённую картинку превью по пути (null — файла больше нет). */
    loadImage: (path: string): Promise<string | null> =>
      ipcRenderer.invoke("preview:load-image", path),
  },
  shell: {
    showItem: (path: string): Promise<void> => ipcRenderer.invoke("shell:show-item", path),
    openPath: (path: string): Promise<void> => ipcRenderer.invoke("shell:open-path", path),
  },
  updates: {
    version: (): Promise<string> => ipcRenderer.invoke("app:version"),
    check: (): Promise<UpdateState> => ipcRenderer.invoke("updates:check"),
    download: (): Promise<UpdateState> => ipcRenderer.invoke("updates:download"),
    install: (): Promise<void> => ipcRenderer.invoke("updates:install"),
    lastStatus: (): Promise<UpdateState | null> => ipcRenderer.invoke("updates:last-status"),
  },
};

export type VicutApi = typeof api;

contextBridge.exposeInMainWorld("vicut", api);
