import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { dataDir } from "./platform/paths.js";

export const configSchema = z.object({
  groqApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  /** Папка вывода по умолчанию для новых задач (используется приложением). */
  defaultOutputDir: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

export const CONFIG_KEYS = Object.keys(configSchema.shape) as Array<keyof Config>;

export function configPath(): string {
  return path.join(dataDir(), "config.json");
}

export async function loadConfig(): Promise<Config> {
  try {
    const raw = await fsp.readFile(configPath(), "utf8");
    return configSchema.parse(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await fsp.mkdir(dataDir(), { recursive: true });
  await fsp.writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/** API keys resolve from env vars first, then the config file. */
export async function resolveApiKeys(): Promise<{ groq: string | null; openai: string | null }> {
  const config = await loadConfig();
  return {
    groq: process.env.GROQ_API_KEY ?? config.groqApiKey ?? null,
    openai: process.env.OPENAI_API_KEY ?? config.openaiApiKey ?? null,
  };
}
