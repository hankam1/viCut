import fsp from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import {
  applyOutputOverrides,
  ensureTools,
  loadPreset,
  naturalCompare,
  parseOutputOverrides,
  renderJob,
  type SectionSpec,
} from "@vicut/core";
import { formatDuration } from "../format.js";
import { makeProgressRenderer } from "./render.js";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".mts", ".ts"]);

/** "<audio>::<файлы или папка через запятую>" → секция с natural-sort визуалом. */
async function parseSection(raw: string, index: number): Promise<SectionSpec> {
  const separator = raw.indexOf("::");
  if (separator < 0) {
    throw new Error(
      `section ${index + 1}: expected "<audio>::<files or folder>", got "${raw}"`,
    );
  }
  const audio = raw.slice(0, separator).trim();
  const visualParts = raw
    .slice(separator + 2)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!audio || visualParts.length === 0) {
    throw new Error(`section ${index + 1}: audio and visuals are both required`);
  }

  const files: string[] = [];
  for (const part of visualParts) {
    const stat = await fsp.stat(part).catch(() => null);
    if (stat?.isDirectory()) {
      const entries = await fsp.readdir(part);
      const media = entries
        .filter((name) => {
          const ext = path.extname(name).toLowerCase();
          return IMAGE_EXT.has(ext) || VIDEO_EXT.has(ext);
        })
        .sort(naturalCompare)
        .map((name) => path.join(part, name));
      if (media.length === 0) throw new Error(`section ${index + 1}: no media files in ${part}`);
      files.push(...media);
    } else {
      files.push(part);
    }
  }

  const imageCount = files.filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase())).length;
  const kind: SectionSpec["visuals"]["kind"] = imageCount > files.length / 2 ? "images" : "clips";
  const mismatched = files.filter((f) => {
    const isImage = IMAGE_EXT.has(path.extname(f).toLowerCase());
    return kind === "images" ? !isImage : isImage;
  });
  if (mismatched.length > 0) {
    throw new Error(
      `section ${index + 1}: mix of clips and images is not supported (${mismatched[0]} does not match)`,
    );
  }

  return { audio, visuals: { kind, files } };
}

export function registerAssemble(program: Command): void {
  program
    .command("assemble")
    .description(
      "Assemble a video from audio-driven sections: clips are speed-fitted to the audio, " +
        "images are spread evenly across it",
    )
    .requiredOption(
      "-s, --section <spec...>",
      'section as "<audio>::<files or folder>", e.g. "hook.mp3::./hook-clips"',
    )
    .requiredOption("-o, --output <file>", "output video file (.mp4)")
    .option("-p, --preset <nameOrPath>", "preset name or path to a preset .json", "default")
    .option("--resolution <res>", "override: source | 480p | 720p | 1080p | 1440p | 2160p (4k)")
    .option("--fps <fps>", "override: source | 30 | 60")
    .option("--codec <codec>", "override: h264 | h265")
    .action(
      async (options: {
        section: string[];
        output: string;
        preset: string;
        resolution?: string;
        fps?: string;
        codec?: string;
      }) => {
        const preset = applyOutputOverrides(
          await loadPreset(options.preset),
          parseOutputOverrides(options),
        );
        const sections: SectionSpec[] = [];
        for (const [i, raw] of options.section.entries()) {
          sections.push(await parseSection(raw, i));
        }
        const tools = await ensureTools();

        console.log(
          `${pc.bold("ViCut")} · ${sections.length} секц${sections.length === 1 ? "ия" : "ии"} → ${options.output} ` +
            pc.dim(`(preset: ${preset.name})`),
        );
        for (const [i, section] of sections.entries()) {
          console.log(
            pc.dim(
              `  ${i + 1}. ${path.basename(section.audio)} + ${section.visuals.files.length} ` +
                (section.visuals.kind === "images" ? "картинок" : "клипов"),
            ),
          );
        }

        const progress = makeProgressRenderer();
        const started = Date.now();
        try {
          const result = await renderJob(
            { spec: { kind: "audio-driven", sections }, output: options.output, preset },
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
