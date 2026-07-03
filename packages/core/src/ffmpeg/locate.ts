import fs from "node:fs";
import path from "node:path";
import { binDir } from "../platform/paths.js";
import { run } from "./run.js";

export type ToolName = "ffmpeg" | "ffprobe";

export interface ToolLocation {
  path: string;
  /** Where the tool was found: env var override, ViCut's own bin dir, or system PATH. */
  source: "env" | "vicut" | "system";
  /** First line of `-version` output, e.g. "ffmpeg version 7.1 ...". */
  version: string;
}

const EXE = process.platform === "win32" ? ".exe" : "";

async function versionOf(binaryPath: string): Promise<string | null> {
  try {
    const { stdout } = await run(binaryPath, ["-version"]);
    return stdout.split("\n")[0]?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve a tool, in priority order:
 * 1. VICUT_FFMPEG_PATH / VICUT_FFPROBE_PATH env var
 * 2. ViCut's own bin dir (populated by `vicut setup`)
 * 3. system PATH
 * Returns null when the tool is nowhere to be found (or not runnable).
 */
export async function locateTool(tool: ToolName): Promise<ToolLocation | null> {
  const envPath = process.env[`VICUT_${tool.toUpperCase()}_PATH`];
  const candidates: Array<{ path: string; source: ToolLocation["source"] }> = [];
  if (envPath) candidates.push({ path: envPath, source: "env" });
  candidates.push({ path: path.join(binDir(), tool + EXE), source: "vicut" });
  candidates.push({ path: tool, source: "system" });

  for (const candidate of candidates) {
    if (candidate.source !== "system" && !fs.existsSync(candidate.path)) continue;
    const version = await versionOf(candidate.path);
    if (version) return { path: candidate.path, source: candidate.source, version };
  }
  return null;
}

export const locateFfmpeg = (): Promise<ToolLocation | null> => locateTool("ffmpeg");
export const locateFfprobe = (): Promise<ToolLocation | null> => locateTool("ffprobe");
