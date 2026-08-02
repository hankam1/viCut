#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { killAllChildren } from "@vicut/core";
import { registerAssemble } from "./commands/assemble.js";
import { registerConfig } from "./commands/config.js";
import { registerPreset } from "./commands/preset.js";
import { registerProbe } from "./commands/probe.js";
import { registerQueue } from "./commands/queue.js";
import { registerRender } from "./commands/render.js";
import { registerSetup } from "./commands/setup.js";
import { registerTranscribe } from "./commands/transcribe.js";

// Ctrl+C не должен оставлять ffmpeg/whisper доживать своё уже без нас.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    const killed = killAllChildren();
    if (killed > 0) console.error(pc.dim(`\nstopped ${killed} running process(es)`));
    process.exit(130);
  });
}

const program = new Command();

program
  .name("vicut")
  .description("Preset-driven automatic video editing")
  .version("0.1.0");

registerSetup(program);
registerProbe(program);
registerPreset(program);
registerConfig(program);
registerRender(program);
registerAssemble(program);
registerTranscribe(program);
registerQueue(program);

program.parseAsync().catch((error: unknown) => {
  console.error(pc.red("Error:"), error instanceof Error ? error.message : error);
  process.exit(1);
});
