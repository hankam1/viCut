import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run } from "../ffmpeg/run.js";
import {
  downloadFile,
  extractArchive,
  findFileRecursive,
  type ProgressCallback,
} from "../net/download.js";
import { binDir, dataDir } from "../platform/paths.js";
import type { Transcript, TranscribeProgress } from "./types.js";

const EXE = process.platform === "win32" ? ".exe" : "";
const WHISPER_RELEASE = "v1.9.1";

export function whisperDir(): string {
  return path.join(binDir(), "whisper");
}

export function modelsDir(): string {
  return path.join(dataDir(), "models");
}

export function modelPath(model: string): string {
  return path.join(modelsDir(), `ggml-${model}.bin`);
}

async function runnable(binary: string): Promise<boolean> {
  try {
    await run(binary, ["--help"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the whisper.cpp CLI, in priority order: VICUT_WHISPER_PATH env var,
 * ViCut's own bin dir, then the system PATH.
 */
export async function locateWhisper(): Promise<string | null> {
  const envPath = process.env.VICUT_WHISPER_PATH;
  if (envPath && fs.existsSync(envPath) && (await runnable(envPath))) return envPath;

  for (const name of [`whisper-cli${EXE}`, `main${EXE}`]) {
    const own = path.join(whisperDir(), name);
    if (fs.existsSync(own) && (await runnable(own))) return own;
  }

  for (const name of ["whisper-cli", "whisper-cpp"]) {
    if (await runnable(name)) return name;
  }
  return null;
}

async function hasNvidiaGpu(): Promise<boolean> {
  try {
    await run("nvidia-smi", ["-L"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Download prebuilt whisper.cpp for Windows x64 (CUDA build when an NVIDIA
 * GPU is present, CPU build otherwise; override with VICUT_WHISPER_FLAVOR).
 * Other platforms install it themselves (macOS: `brew install whisper-cpp`).
 */
export async function downloadWhisper(onProgress?: ProgressCallback): Promise<string> {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error(
      "Automatic whisper.cpp download is only available on Windows x64 for now. " +
        "Install it manually (macOS: `brew install whisper-cpp`) or set VICUT_WHISPER_PATH.",
    );
  }

  const flavor = process.env.VICUT_WHISPER_FLAVOR ?? ((await hasNvidiaGpu()) ? "cuda" : "cpu");
  const asset = flavor === "cuda" ? "whisper-cublas-12.4.0-bin-x64.zip" : "whisper-bin-x64.zip";
  const url = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE}/${asset}`;

  const tmp = path.join(dataDir(), "tmp-whisper");
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });
  try {
    const archivePath = path.join(tmp, asset);
    await downloadFile(url, archivePath, onProgress);
    const extractDir = path.join(tmp, "extracted");
    await extractArchive(archivePath, extractDir);

    const cliPath =
      (await findFileRecursive(extractDir, `whisper-cli${EXE}`)) ??
      (await findFileRecursive(extractDir, `main${EXE}`));
    if (!cliPath) throw new Error(`whisper CLI not found inside ${asset}`);

    // The CLI needs its sibling DLLs, so keep the whole directory together.
    await fsp.rm(whisperDir(), { recursive: true, force: true });
    await fsp.cp(path.dirname(cliPath), whisperDir(), { recursive: true });
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }

  const located = await locateWhisper();
  if (!located) throw new Error("whisper.cpp download finished but the binary is not runnable");
  return located;
}

export async function ensureWhisper(onProgress?: ProgressCallback): Promise<string> {
  return (await locateWhisper()) ?? downloadWhisper(onProgress);
}

/** Download a ggml model from Hugging Face into the models dir if missing. */
export async function ensureModel(model: string, onProgress?: ProgressCallback): Promise<string> {
  const dest = modelPath(model);
  if (fs.existsSync(dest)) return dest;
  await fsp.mkdir(modelsDir(), { recursive: true });
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`;
  const tmpDest = `${dest}.download`;
  await downloadFile(url, tmpDest, onProgress);
  await fsp.rename(tmpDest, dest);
  return dest;
}

interface WhisperJsonOutput {
  result?: { language?: string };
  transcription?: Array<{
    offsets?: { from?: number; to?: number };
    text?: string;
  }>;
}

export interface WhisperLocalOptions {
  model: string;
  /** ISO 639-1 code or "auto". */
  language: string;
  onProgress?: (progress: TranscribeProgress) => void;
}

const downloadToPercent = (p: { receivedBytes: number; totalBytes: number | null }): number | null =>
  p.totalBytes ? (p.receivedBytes / p.totalBytes) * 100 : null;

/** Transcribe a 16 kHz mono WAV with whisper.cpp. */
export async function transcribeWhisperLocal(
  wavPath: string,
  options: WhisperLocalOptions,
): Promise<Transcript> {
  const binary = await ensureWhisper((p) =>
    options.onProgress?.({ phase: "download-whisper", percent: downloadToPercent(p), detail: p.file }),
  );
  const model = await ensureModel(options.model, (p) =>
    options.onProgress?.({ phase: "download-model", percent: downloadToPercent(p), detail: p.file }),
  );

  const outPrefix = `${wavPath}.whisper`;
  const threads = Math.max(1, os.cpus().length - 2);
  await run(
    binary,
    [
      "-m", model,
      "-f", wavPath,
      "-l", options.language,
      "-t", String(threads),
      "-oj",
      "-of", outPrefix,
      "-pp",
      "-np",
    ],
    {
      onStderrLine: (line) => {
        const match = /progress\s*=\s*(\d+)%/.exec(line);
        if (match) options.onProgress?.({ phase: "transcribe", percent: Number(match[1]) });
      },
    },
  );

  const jsonPath = `${outPrefix}.json`;
  const raw = JSON.parse(await fsp.readFile(jsonPath, "utf8")) as WhisperJsonOutput;
  await fsp.rm(jsonPath, { force: true });

  const segments = (raw.transcription ?? [])
    .map((entry) => ({
      startSec: (entry.offsets?.from ?? 0) / 1000,
      endSec: (entry.offsets?.to ?? 0) / 1000,
      text: (entry.text ?? "").trim(),
    }))
    .filter((segment) => segment.text.length > 0);

  return { language: raw.result?.language ?? null, segments };
}
