import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../platform/paths.js";
import { builtinPreset, builtinPresetNames } from "./builtin.js";
import { presetSchema, type Preset } from "./schema.js";

/** Directory where user presets live as <name>.json. */
export function presetsDir(): string {
  return path.join(dataDir(), "presets");
}

export class PresetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PresetError";
  }
}

function parsePresetJson(raw: string, source: string): Preset {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new PresetError(`${source} is not valid JSON`);
  }
  const result = presetSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new PresetError(`${source} is not a valid preset:\n${issues}`);
  }
  return result.data;
}

/**
 * Resolve a preset by name or path, in priority order:
 * 1. a path to a .json file (contains a slash or ends with .json)
 * 2. a user preset in the presets dir
 * 3. a builtin preset
 */
export async function loadPreset(nameOrPath: string): Promise<Preset> {
  const looksLikePath =
    nameOrPath.endsWith(".json") || nameOrPath.includes("/") || nameOrPath.includes("\\");

  if (looksLikePath) {
    const raw = await fsp.readFile(nameOrPath, "utf8").catch(() => {
      throw new PresetError(`preset file not found: ${nameOrPath}`);
    });
    return parsePresetJson(raw, nameOrPath);
  }

  const userPath = path.join(presetsDir(), `${nameOrPath}.json`);
  if (fs.existsSync(userPath)) {
    return parsePresetJson(await fsp.readFile(userPath, "utf8"), userPath);
  }

  const builtin = builtinPreset(nameOrPath);
  if (builtin) return builtin;

  throw new PresetError(
    `preset "${nameOrPath}" not found. Available builtins: ${builtinPresetNames().join(", ")}. ` +
      `User presets dir: ${presetsDir()}`,
  );
}

/** Write a preset as pretty JSON into the user presets dir; returns the path. */
export async function savePreset(preset: Preset): Promise<string> {
  const dir = presetsDir();
  await fsp.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${preset.name}.json`);
  await fsp.writeFile(filePath, `${JSON.stringify(preset, null, 2)}\n`, "utf8");
  return filePath;
}

/** List user presets (names without .json) found in the presets dir. */
export async function listUserPresets(): Promise<string[]> {
  const dir = presetsDir();
  const entries = await fsp.readdir(dir).catch(() => [] as string[]);
  return entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.slice(0, -".json".length))
    .sort();
}
