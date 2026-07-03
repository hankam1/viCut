import os from "node:os";
import path from "node:path";

/**
 * Root directory for ViCut's per-user data: downloaded binaries, Whisper
 * models, the render queue database. Overridable via VICUT_DATA_DIR.
 */
export function dataDir(): string {
  const override = process.env.VICUT_DATA_DIR;
  if (override) return override;

  switch (process.platform) {
    case "win32":
      return path.join(
        process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
        "ViCut",
      );
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", "ViCut");
    default:
      return path.join(
        process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
        "vicut",
      );
  }
}

/** Directory where downloaded tool binaries (ffmpeg, ffprobe, whisper) live. */
export function binDir(): string {
  return path.join(dataDir(), "bin");
}
