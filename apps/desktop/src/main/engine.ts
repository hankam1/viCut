import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import {
  applyOutputOverrides,
  builtinPreset,
  builtinPresetNames,
  ensureModel,
  ensureTools,
  ensureWhisper,
  listUserPresets,
  loadConfig,
  loadPreset,
  locateFfmpeg,
  locateFfprobe,
  locateWhisper,
  modelPath,
  presetSchema,
  probe,
  QueueStore,
  runQueue,
  naturalCompare,
  saveConfig,
  savePreset,
  specInputs,
  type Config,
  type DownloadProgress,
  type JobSpec,
  type OutputOverrides,
  type Preset,
  type Tools,
} from "@vicut/core";

export type { OutputOverrides };

const WHISPER_MODELS = ["tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"];

const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".mts", ".ts"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"]);

export interface ClassifiedMedia {
  audios: string[];
  clips: string[];
  images: string[];
}

/** Разложить брошенные пути (включая папки) на аудио/клипы/картинки, natural-sort. */
async function classifyMedia(paths: string[]): Promise<ClassifiedMedia> {
  const result: ClassifiedMedia = { audios: [], clips: [], images: [] };
  const push = (filePath: string): void => {
    const ext = path.extname(filePath).toLowerCase();
    if (AUDIO_EXT.has(ext)) result.audios.push(filePath);
    else if (VIDEO_EXT.has(ext)) result.clips.push(filePath);
    else if (IMAGE_EXT.has(ext)) result.images.push(filePath);
  };
  for (const p of paths) {
    const stat = await fsp.stat(p).catch(() => null);
    if (stat?.isDirectory()) {
      for (const name of await fsp.readdir(p)) push(path.join(p, name));
    } else if (stat?.isFile()) {
      push(p);
    }
  }
  result.audios.sort(naturalCompare);
  result.clips.sort(naturalCompare);
  result.images.sort(naturalCompare);
  return result;
}

let store: QueueStore | null = null;
const getStore = (): QueueStore => (store ??= new QueueStore());

let tools: Tools | null = null;
let queueRunning = false;
let pauseRequested = false;

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

function defaultOutputPath(inputs: string[], title?: string): string {
  const first = inputs[0]!;
  const dir = path.dirname(first);
  const base = title?.trim() || `${path.parse(first).name} — vicut`;
  let candidate = path.join(dir, `${base}.mp4`);
  for (let i = 2; fs.existsSync(candidate); i++) {
    candidate = path.join(dir, `${base} (${i}).mp4`);
  }
  return candidate;
}

/**
 * Цикл очереди с поддержкой «пауза после текущей». Кодирование строго
 * последовательное, но подготовка следующей задачи (анализ, громкость,
 * транскрипция) идёт параллельно с кодированием текущей — см. runQueue.
 */
async function runQueueLoop(): Promise<void> {
  if (queueRunning) return;
  queueRunning = true;
  pauseRequested = false;
  broadcast("queue:running-changed", true);

  try {
    tools ??= await ensureTools();
    await runQueue(getStore(), tools, {
      shouldPause: () => pauseRequested,
      onJobStart: () => broadcast("queue:changed"),
      onJobProgress: (job, event) => broadcast("queue:job-progress", { jobId: job.id, ...event }),
      onJobDone: (job, result) => {
        broadcast("queue:job-finished", { jobId: job.id, ok: true, srtPath: result.srtPath });
        broadcast("queue:changed");
      },
      onJobFailed: (job) => {
        broadcast("queue:job-finished", { jobId: job.id, ok: false });
        broadcast("queue:changed");
      },
    });
  } finally {
    queueRunning = false;
    broadcast("queue:running-changed", false);
  }
}

export function registerEngineIpc(): void {
  // ── Очередь ──
  ipcMain.handle("queue:list", () => getStore().list());

  ipcMain.handle(
    "queue:add",
    async (
      _event,
      payload: {
        /** Тип A — плоский список клипов; тип B — spec целиком. */
        inputs?: string[];
        spec?: JobSpec;
        output?: string;
        presetName: string;
        title?: string;
        overrides?: OutputOverrides;
        autoStart?: boolean;
      },
    ) => {
      const spec: JobSpec = payload.spec ?? { kind: "stitch", inputs: payload.inputs ?? [] };
      const preset = applyOutputOverrides(await loadPreset(payload.presetName), payload.overrides);
      const job = getStore().add({
        spec,
        output: payload.output ?? defaultOutputPath(specInputs(spec), payload.title),
        preset,
        title: payload.title,
      });
      broadcast("queue:changed");
      if (payload.autoStart !== false) void runQueueLoop();
      return job;
    },
  );

  ipcMain.handle("queue:start", () => void runQueueLoop());
  ipcMain.handle("queue:pause", () => {
    pauseRequested = true;
  });
  ipcMain.handle("queue:is-running", () => queueRunning);
  ipcMain.handle("queue:cancel", (_event, id: number) => {
    const changed = getStore().cancel(id);
    broadcast("queue:changed");
    return changed;
  });
  ipcMain.handle("queue:retry", (_event, id: number) => {
    const changed = getStore().retry(id);
    broadcast("queue:changed");
    void runQueueLoop();
    return changed;
  });
  ipcMain.handle("queue:remove", (_event, id: number) => {
    const changed = getStore().remove(id);
    broadcast("queue:changed");
    return changed;
  });
  ipcMain.handle("queue:clear-finished", () => {
    const removed = getStore().clearFinished();
    broadcast("queue:changed");
    return removed;
  });

  // ── Пресеты ──
  ipcMain.handle("presets:list", async () => {
    const builtins = builtinPresetNames().map((name) => builtinPreset(name)!);
    const user: Preset[] = [];
    for (const name of await listUserPresets()) user.push(await loadPreset(name));
    return { builtins, user };
  });
  ipcMain.handle("presets:save", async (_event, raw: unknown) => savePreset(presetSchema.parse(raw)));

  // Экспорт/импорт пресетов для обмена (обычный JSON-файл).
  ipcMain.handle("presets:export", async (event, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const preset = presetSchema.parse(raw);
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${preset.name}.vicut.json`,
      filters: [{ name: "Пресет ViCut", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fsp.writeFile(result.filePath, `${JSON.stringify(preset, null, 2)}\n`, "utf8");
    return result.filePath;
  });

  ipcMain.handle("presets:import", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false as const, error: "нет окна" };
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "Пресет ViCut", extensions: ["json"] }],
    });
    const file = result.canceled ? null : result.filePaths[0];
    if (!file) return { ok: false as const, error: null };
    try {
      const parsed = presetSchema.parse(JSON.parse(await fsp.readFile(file, "utf8")));
      // Имя не должно конфликтовать с существующими пресетами.
      const taken = new Set([...builtinPresetNames(), ...(await listUserPresets())]);
      let name = parsed.name;
      for (let i = 2; taken.has(name); i++) name = `${parsed.name}-${i}`;
      const preset = { ...parsed, name };
      await savePreset(preset);
      return { ok: true as const, preset };
    } catch {
      return { ok: false as const, error: "Файл не похож на пресет ViCut" };
    }
  });

  // ── Конфиг ──
  ipcMain.handle("config:get", () => loadConfig());
  ipcMain.handle("config:set", (_event, config: Config) => saveConfig(config));

  // ── Инструменты ──
  ipcMain.handle("tools:status", async () => {
    const [ffmpeg, ffprobe, whisper] = await Promise.all([
      locateFfmpeg(),
      locateFfprobe(),
      locateWhisper(),
    ]);
    const models = WHISPER_MODELS.filter((model) => fs.existsSync(modelPath(model)));
    return { ffmpeg, ffprobe, whisper, models };
  });

  ipcMain.handle("probe:file", async (_event, filePath: string) => {
    tools ??= await ensureTools();
    return probe(filePath, tools.ffprobe.path);
  });

  // ── Установка инструментов (онбординг / настройки) ──
  const setupProgress =
    (kind: string) =>
    (p: DownloadProgress): void =>
      broadcast("setup:progress", { kind, ...p });

  ipcMain.handle("setup:ffmpeg", async (_event, force?: boolean) => {
    tools = await ensureTools({ force, onProgress: setupProgress("ffmpeg") });
    return { ffmpeg: tools.ffmpeg, ffprobe: tools.ffprobe };
  });
  ipcMain.handle("setup:whisper", async (_event, model: string) => {
    const whisperPath = await ensureWhisper(setupProgress("whisper"));
    const modelFile = await ensureModel(model, setupProgress("model"));
    return { whisperPath, modelFile };
  });

  // ── Медиа ──
  ipcMain.handle("media:classify", (_event, paths: string[]) => classifyMedia(paths));

  // ── Диалоги и shell ──
  ipcMain.handle("dialog:pick-videos", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return [];
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Видео", extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v"] }],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("dialog:pick-audio", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "Аудио", extensions: ["mp3", "wav", "m4a", "aac", "flac", "ogg"] }],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("dialog:pick-visuals", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return [];
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Клипы и картинки",
          extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v", "jpg", "jpeg", "png", "webp", "bmp"],
        },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("dialog:pick-folder", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("shell:show-item", (_event, itemPath: string) => shell.showItemInFolder(itemPath));
  ipcMain.handle("shell:open-path", (_event, itemPath: string) => shell.openPath(itemPath));
}
