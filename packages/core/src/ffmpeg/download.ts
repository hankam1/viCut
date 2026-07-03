import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { binDir, dataDir } from "../platform/paths.js";
import { run } from "./run.js";

export interface DownloadProgress {
  file: string;
  receivedBytes: number;
  totalBytes: number | null;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

interface ArchiveSource {
  url: string;
  /** Exact file names to pull out of the extracted archive. */
  binaries: string[];
}

const EXE = process.platform === "win32" ? ".exe" : "";

/**
 * Trusted prebuilt FFmpeg sources per platform. GPL builds are used because
 * they bundle libass (styled subtitle burn-in) and the full filter set.
 */
function sourcesForPlatform(): ArchiveSource[] {
  const key = `${process.platform}-${process.arch}`;
  switch (key) {
    case "win32-x64":
      return [
        {
          url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
          binaries: ["ffmpeg.exe", "ffprobe.exe"],
        },
      ];
    case "darwin-arm64":
      return [
        {
          url: "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip",
          binaries: ["ffmpeg"],
        },
        {
          url: "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffprobe.zip",
          binaries: ["ffprobe"],
        },
      ];
    case "darwin-x64":
      return [
        {
          url: "https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/release/ffmpeg.zip",
          binaries: ["ffmpeg"],
        },
        {
          url: "https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/release/ffprobe.zip",
          binaries: ["ffprobe"],
        },
      ];
    case "linux-x64":
      return [
        {
          url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz",
          binaries: ["ffmpeg", "ffprobe"],
        },
      ];
    default:
      throw new Error(
        `No prebuilt FFmpeg source configured for ${key}. ` +
          `Install FFmpeg manually and point VICUT_FFMPEG_PATH / VICUT_FFPROBE_PATH at it.`,
      );
  }
}

async function downloadFile(url: string, dest: string, onProgress?: ProgressCallback): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${url} → HTTP ${response.status}`);
  }
  const totalBytes = Number(response.headers.get("content-length")) || null;
  const file = path.basename(new URL(url).pathname);
  let receivedBytes = 0;

  const body = Readable.fromWeb(response.body as WebReadableStream);
  body.on("data", (chunk: Buffer) => {
    receivedBytes += chunk.length;
    onProgress?.({ file, receivedBytes, totalBytes });
  });
  await pipeline(body, fs.createWriteStream(dest));
}

async function findFile(root: string, name: string): Promise<string | null> {
  const entries = await fsp.readdir(root, { withFileTypes: true, recursive: true });
  const match = entries.find((entry) => entry.isFile() && entry.name === name);
  return match ? path.join(match.parentPath, match.name) : null;
}

/**
 * Download FFmpeg + ffprobe for the current platform into ViCut's bin dir.
 * Archives are extracted with the system `tar` (bsdtar handles .zip on
 * Windows 10+ and macOS out of the box).
 */
export async function downloadFfmpeg(
  onProgress?: ProgressCallback,
): Promise<{ ffmpeg: string; ffprobe: string }> {
  const bin = binDir();
  await fsp.mkdir(bin, { recursive: true });
  const tmp = path.join(dataDir(), "tmp-download");
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });

  try {
    for (const source of sourcesForPlatform()) {
      const archivePath = path.join(tmp, path.basename(new URL(source.url).pathname));
      await downloadFile(source.url, archivePath, onProgress);

      const extractDir = `${archivePath}-extracted`;
      await fsp.mkdir(extractDir, { recursive: true });
      await run("tar", ["-xf", archivePath, "-C", extractDir]);

      for (const binary of source.binaries) {
        const found = await findFile(extractDir, binary);
        if (!found) throw new Error(`${binary} not found inside archive from ${source.url}`);
        const target = path.join(bin, binary);
        await fsp.copyFile(found, target);
        if (process.platform !== "win32") await fsp.chmod(target, 0o755);
      }
    }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }

  return {
    ffmpeg: path.join(bin, `ffmpeg${EXE}`),
    ffprobe: path.join(bin, `ffprobe${EXE}`),
  };
}
