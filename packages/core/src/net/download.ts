import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { run } from "../ffmpeg/run.js";

export interface DownloadProgress {
  file: string;
  receivedBytes: number;
  totalBytes: number | null;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

export async function downloadFile(
  url: string,
  dest: string,
  onProgress?: ProgressCallback,
): Promise<void> {
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

/**
 * Extract .zip / .tar.gz / .tar.xz with the system tar (bsdtar handles zip
 * on Windows 10+ and macOS out of the box).
 */
export async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  await fsp.mkdir(destDir, { recursive: true });
  await run("tar", ["-xf", archivePath, "-C", destDir]);
}

export async function findFileRecursive(root: string, name: string): Promise<string | null> {
  const entries = await fsp.readdir(root, { withFileTypes: true, recursive: true });
  const match = entries.find((entry) => entry.isFile() && entry.name === name);
  return match ? path.join(match.parentPath, match.name) : null;
}
