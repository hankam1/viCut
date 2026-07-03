import crypto from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import {
  ensureTools,
  probe,
  run,
  segmentsToSrt,
  transcribeAudio,
  type TranscribeProgress,
} from "@vicut/core";
import { formatDuration } from "../format.js";

const PHASE_LABELS: Record<TranscribeProgress["phase"], string> = {
  "download-whisper": "Get whisper",
  "download-model": "Get model",
  prepare: "Preparing",
  upload: "Uploading",
  transcribe: "Transcribing",
};

export function makeTranscribeRenderer(): {
  onProgress: (p: TranscribeProgress) => void;
  finish: () => void;
} {
  let currentPhase = "";
  let lastRender = 0;
  const onProgress = (p: TranscribeProgress): void => {
    const now = Date.now();
    if (p.phase === currentPhase && now - lastRender < 100 && (p.percent ?? 0) < 100) return;
    lastRender = now;
    if (p.phase !== currentPhase) {
      if (currentPhase) process.stdout.write("\n");
      currentPhase = p.phase;
    }
    const label = PHASE_LABELS[p.phase].padEnd(13);
    const percent = p.percent !== null ? `${String(Math.floor(p.percent)).padStart(3)}%` : "…";
    const detail = p.detail ? `  ${pc.dim(p.detail)}` : "";
    process.stdout.write(`\r${label} ${percent}${detail}   `);
  };
  return {
    onProgress,
    finish: () => {
      if (currentPhase) process.stdout.write("\n");
    },
  };
}

export function registerTranscribe(program: Command): void {
  program
    .command("transcribe")
    .description("Transcribe a video/audio file to subtitles (.srt)")
    .argument("<file>", "media file to transcribe")
    .option("-p, --provider <provider>", "auto | whisper-local | groq | openai", "auto")
    .option("-l, --language <lang>", 'ISO code like "en", "ru" or "auto"', "auto")
    .option("-m, --model <model>", "local whisper model", "large-v3-turbo")
    .option("-o, --output <file>", ".srt output path (default: next to the input)")
    .option("--json", "print segments as JSON instead of writing .srt")
    .action(
      async (
        file: string,
        options: {
          provider: "auto" | "whisper-local" | "groq" | "openai";
          language: string;
          model: string;
          output?: string;
          json?: boolean;
        },
      ) => {
        const tools = await ensureTools();
        const info = await probe(file, tools.ffprobe.path);
        if (!info.audio) throw new Error(`${file} has no audio stream`);

        const wavPath = path.join(os.tmpdir(), `vicut-${crypto.randomUUID()}.wav`);
        const renderer = makeTranscribeRenderer();
        try {
          await run(tools.ffmpeg.path, [
            "-y",
            "-hide_banner", "-loglevel", "error",
            "-i", file,
            "-vn",
            "-ac", "1",
            "-ar", "16000",
            "-c:a", "pcm_s16le",
            wavPath,
          ]);

          const transcript = await transcribeAudio(wavPath, {
            provider: options.provider,
            language: options.language,
            model: options.model,
            durationSec: info.durationSec ?? 0,
            tools,
            onProgress: renderer.onProgress,
          });
          renderer.finish();

          if (options.json) {
            console.log(JSON.stringify(transcript, null, 2));
            return;
          }

          const outPath =
            options.output ?? path.join(path.dirname(file), `${path.parse(file).name}.srt`);
          await fsp.writeFile(outPath, segmentsToSrt(transcript.segments), "utf8");
          console.log(
            `${pc.green("✓")} ${transcript.segments.length} segments` +
              (transcript.language ? ` · language: ${transcript.language}` : "") +
              (info.durationSec ? ` · ${formatDuration(info.durationSec)} of audio` : ""),
          );
          console.log(`  ${pc.dim(outPath)}`);
        } catch (error) {
          renderer.finish();
          throw error;
        } finally {
          await fsp.rm(wavPath, { force: true });
        }
      },
    );
}
