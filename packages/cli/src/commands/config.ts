import type { Command } from "commander";
import pc from "picocolors";
import { CONFIG_KEYS, configPath, loadConfig, saveConfig, type Config } from "@vicut/core";

const SECRET_KEYS = new Set<keyof Config>(["groqApiKey", "openaiApiKey"]);

function mask(value: string): string {
  return value.length <= 8 ? "****" : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function assertKnownKey(key: string): asserts key is keyof Config {
  if (!(CONFIG_KEYS as string[]).includes(key)) {
    throw new Error(`unknown config key "${key}". Known keys: ${CONFIG_KEYS.join(", ")}`);
  }
}

export function registerConfig(program: Command): void {
  const config = program
    .command("config")
    .description("Configure ViCut (API keys for cloud transcription, etc.)");

  config
    .command("set")
    .description("Set a config value, e.g. `vicut config set groqApiKey gsk_...`")
    .argument("<key>", `one of: ${CONFIG_KEYS.join(", ")}`)
    .argument("<value>", "the value to store")
    .action(async (key: string, value: string) => {
      assertKnownKey(key);
      const current = await loadConfig();
      await saveConfig({ ...current, [key]: value });
      const shown = SECRET_KEYS.has(key) ? mask(value) : value;
      console.log(`${pc.green("✓")} ${key} = ${shown}`);
    });

  config
    .command("unset")
    .description("Remove a config value")
    .argument("<key>", `one of: ${CONFIG_KEYS.join(", ")}`)
    .action(async (key: string) => {
      assertKnownKey(key);
      const current = await loadConfig();
      delete current[key];
      await saveConfig(current);
      console.log(`${pc.green("✓")} ${key} removed`);
    });

  config
    .command("list")
    .description("Show current config (secrets are masked)")
    .action(async () => {
      const current = await loadConfig();
      if (Object.keys(current).length === 0) {
        console.log(pc.dim("(empty)"));
      }
      for (const [key, value] of Object.entries(current)) {
        if (value === undefined) continue;
        const shown = SECRET_KEYS.has(key as keyof Config) ? mask(value) : value;
        console.log(`${key} = ${shown}`);
      }
      console.log(pc.dim(`\nConfig file: ${configPath()}`));
      console.log(pc.dim("Env vars GROQ_API_KEY / OPENAI_API_KEY take precedence."));
    });
}
