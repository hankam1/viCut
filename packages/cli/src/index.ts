#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { registerConfig } from "./commands/config.js";
import { registerPreset } from "./commands/preset.js";
import { registerProbe } from "./commands/probe.js";
import { registerRender } from "./commands/render.js";
import { registerSetup } from "./commands/setup.js";

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

program.parseAsync().catch((error: unknown) => {
  console.error(pc.red("Error:"), error instanceof Error ? error.message : error);
  process.exit(1);
});
