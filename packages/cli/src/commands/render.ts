import type { Command } from "commander";
import pc from "picocolors";
import {
  applyOutputOverrides,
  ensureTools,
  loadPreset,
  parseOutputOverrides,
  renderJob,
  type RenderProgressEvent,
} from "@vicut/core";
import { formatDuration } from "../format.js";

const STAGE_LABELS: Record<string, string> = {
  probe: "Analyzing",
  "prepare-audio": "Audio pass",
  transcribe: "Transcribing",
  subtitles: "Subtitles",
  encode: "Encoding",
};

export function makeProgressRenderer(): { onEvent: (e: RenderProgressEvent) => void; finish: () => void } {
  let currentStage = "";
  let lastRender = 0;

  const onEvent = (e: RenderProgressEvent): void => {
    const now = Date.now();
    if (e.stage === currentStage && now - lastRender < 100 && (e.percent ?? 0) < 100) return;
    lastRender = now;
    if (e.stage !== currentStage) {
      if (currentStage) process.stdout.write("\n");
      currentStage = e.stage;
    }
    const label = (STAGE_LABELS[e.stage] ?? e.stage).padEnd(13);
    let line: string;
    if (e.percent !== null) {
      const width = 24;
      const filled = Math.round((Math.min(100, e.percent) / 100) * width);
      const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
      line = `${label} ${bar} ${String(Math.floor(e.percent)).padStart(3)}%`;
    } else {
      line = `${label} …`;
    }
    if (e.detail) line += `  ${pc.dim(e.detail)}`;
    process.stdout.write(`\r${line}   `);
  };

  return {
    onEvent,
    finish: () => {
      if (currentStage) process.stdout.write("\n");
    },
  };
}

export function registerRender(program: Command): void {
  program
    .command("render")
    .description("Render one or more clips into a finished video using a preset")
    .argument("<inputs...>", "input video file(s), stitched in the given order")
    .requiredOption("-o, --output <file>", "output video file (.mp4)")
    .option("-p, --preset <nameOrPath>", "preset name or path to a preset .json", "default")
    .option("--resolution <res>", "override: source | 480p | 720p | 1080p | 1440p | 2160p (4k)")
    .option("--fps <fps>", "override: source | 30 | 60")
    .option("--codec <codec>", "override: h264 | h265")
    .action(
      async (
        inputs: string[],
        options: {
          output: string;
          preset: string;
          resolution?: string;
          fps?: string;
          codec?: string;
        },
      ) => {
      const preset = applyOutputOverrides(
        await loadPreset(options.preset),
        parseOutputOverrides(options),
      );
      const tools = await ensureTools();

      console.log(
        `${pc.bold("ViCut")} · ${inputs.length} clip${inputs.length > 1 ? "s" : ""} → ${options.output} ` +
          pc.dim(`(preset: ${preset.name})`),
      );

      const progress = makeProgressRenderer();
      const started = Date.now();
      try {
        const result = await renderJob(
          { spec: { kind: "stitch", inputs }, output: options.output, preset },
          { tools, onProgress: progress.onEvent },
        );
        progress.finish();
        const elapsed = (Date.now() - started) / 1000;
        console.log(
          `${pc.green("✓")} done in ${formatDuration(elapsed)} · ` +
            `${formatDuration(result.durationSec)} of video · ${result.encoder}`,
        );
        if (result.srtPath) console.log(`  ${pc.dim(`subtitles: ${result.srtPath}`)}`);
      } catch (error) {
        progress.finish();
        throw error;
      }
      },
    );
}
