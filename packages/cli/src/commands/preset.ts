import type { Command } from "commander";
import pc from "picocolors";
import {
  builtinPreset,
  builtinPresetNames,
  listUserPresets,
  loadPreset,
  presetsDir,
  savePreset,
} from "@vicut/core";

export function registerPreset(program: Command): void {
  const preset = program.command("preset").description("Manage editing presets");

  preset
    .command("list")
    .description("List builtin and user presets")
    .action(async () => {
      console.log(pc.bold("Builtin:"));
      for (const name of builtinPresetNames()) console.log(`  ${name}`);
      const user = await listUserPresets();
      console.log(pc.bold("User:"), user.length ? "" : pc.dim(`(none yet — try \`vicut preset init my-preset\`)`));
      for (const name of user) console.log(`  ${name}`);
      console.log(pc.dim(`\nUser presets dir: ${presetsDir()}`));
    });

  preset
    .command("show")
    .description("Print a preset as JSON (builtin name, user name or path)")
    .argument("<name>", "preset name or path to a .json file")
    .action(async (name: string) => {
      const loaded = await loadPreset(name);
      console.log(JSON.stringify(loaded, null, 2));
    });

  preset
    .command("init")
    .description("Create a user preset you can edit")
    .argument("<name>", "name for the new preset")
    .option("--from <builtin>", "builtin preset to start from", "youtube-subtitled")
    .action(async (name: string, options: { from: string }) => {
      const base = builtinPreset(options.from);
      if (!base) {
        throw new Error(
          `unknown builtin "${options.from}". Available: ${builtinPresetNames().join(", ")}`,
        );
      }
      const filePath = await savePreset({ ...base, name });
      console.log(`${pc.green("✓")} created ${pc.bold(name)}`);
      console.log(pc.dim(`  ${filePath}`));
      console.log(pc.dim("  Edit the JSON to tune output, subtitles, transitions and effects."));
    });

  preset
    .command("dir")
    .description("Print the user presets directory")
    .action(() => {
      console.log(presetsDir());
    });
}
