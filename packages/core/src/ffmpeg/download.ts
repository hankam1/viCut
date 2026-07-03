import fsp from "node:fs/promises";
import path from "node:path";
import {
  downloadFile,
  extractArchive,
  findFileRecursive,
  type ProgressCallback,
} from "../net/download.js";
import { binDir, dataDir } from "../platform/paths.js";

export type { DownloadProgress, ProgressCallback } from "../net/download.js";

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

/** Download FFmpeg + ffprobe for the current platform into ViCut's bin dir. */
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
      await extractArchive(archivePath, extractDir);

      for (const binary of source.binaries) {
        const found = await findFileRecursive(extractDir, binary);
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
