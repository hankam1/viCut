import { spawn } from "node:child_process";
import { ProcessError } from "./run.js";

export interface EncodeProgress {
  outTimeSec: number;
  fps: number | null;
  /** Realtime multiplier, e.g. 3.5 means 3.5x faster than playback. */
  speed: number | null;
  /** 0-100 when total duration is known, null otherwise. */
  percent: number | null;
}

export interface FfmpegRunOptions {
  totalDurationSec?: number;
  onProgress?: (progress: EncodeProgress) => void;
}

/**
 * Run ffmpeg with machine-readable progress on stdout (-progress pipe:1).
 * Resolves with collected stderr (needed e.g. for loudnorm measurements).
 */
export function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  options?: FfmpegRunOptions,
): Promise<{ stderr: string }> {
  const fullArgs = [
    "-hide_banner",
    "-nostdin",
    "-loglevel", "info",
    "-progress", "pipe:1",
    "-nostats",
    ...args,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, fullArgs, { windowsHide: true });
    let stderr = "";
    let buffer = "";
    const current: Record<string, string> = {};

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq);
        const value = line.slice(eq + 1);
        current[key] = value;
        if (key !== "progress") continue;

        const outTimeUs = Number(current["out_time_us"] ?? current["out_time_ms"] ?? 0);
        const outTimeSec = Number.isFinite(outTimeUs) && outTimeUs > 0 ? outTimeUs / 1_000_000 : 0;
        const fps = Number(current["fps"]);
        const speedRaw = current["speed"];
        const speed = speedRaw?.endsWith("x") ? Number(speedRaw.slice(0, -1)) : NaN;
        const total = options?.totalDurationSec;
        options?.onProgress?.({
          outTimeSec,
          fps: Number.isFinite(fps) && fps > 0 ? fps : null,
          speed: Number.isFinite(speed) && speed > 0 ? speed : null,
          percent: total && total > 0 ? Math.min(100, (outTimeSec / total) * 100) : null,
        });
      }
    });

    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stderr });
      else reject(new ProcessError(ffmpegPath, code ?? -1, stderr));
    });
  });
}
