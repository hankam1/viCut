import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Tools } from "../ffmpeg/ensure.js";
import { runFfmpeg } from "../ffmpeg/progress.js";
import { dataDir } from "../platform/paths.js";
import type { Preset } from "../preset/schema.js";
import { probe } from "../probe/probe.js";
import type { MediaInfo } from "../probe/types.js";
import { segmentsToAss } from "../subtitles/ass.js";
import { segmentsToSrt } from "../subtitles/srt.js";
import { transcribeAudio } from "../transcribe/transcribe.js";
import type { Transcript } from "../transcribe/types.js";
import { selectEncoder } from "./encoders.js";
import {
  buildAudioDrivenGraph,
  buildGraph,
  computeTargetSpec,
  RenderError,
  type BuiltGraph,
  type LoudnormMeasured,
  type LoudnormMode,
  type ProbedSection,
} from "./graph.js";
import type { JobSpec } from "./spec.js";

export type RenderStage = "probe" | "prepare-audio" | "transcribe" | "subtitles" | "encode";

export interface RenderProgressEvent {
  stage: RenderStage;
  /** 0-100 within the stage, null when indeterminate. */
  percent: number | null;
  detail?: string;
}

export interface RenderRequest {
  spec: JobSpec;
  output: string;
  preset: Preset;
}

export interface RenderResult {
  output: string;
  durationSec: number;
  encoder: string;
  srtPath: string | null;
  /** Detected transcript language, when subtitles were generated. */
  language: string | null;
}

export interface RenderOptions {
  tools: Tools;
  onProgress?: (event: RenderProgressEvent) => void;
}

function loudnormNumber(raw: string | undefined, key: string): number {
  if (raw === "-inf") return -99; // pure silence reports -inf true peak
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new RenderError(`loudnorm measurement missing ${key}`);
  return value;
}

function parseLoudnorm(stderr: string): LoudnormMeasured {
  const blocks = stderr.match(/\{[\s\S]*?\}/g);
  if (!blocks || blocks.length === 0) {
    throw new RenderError("loudnorm measurement not found in ffmpeg output");
  }
  let json: Record<string, string>;
  try {
    json = JSON.parse(blocks[blocks.length - 1]!) as Record<string, string>;
  } catch {
    throw new RenderError("could not parse loudnorm measurement");
  }
  return {
    inputI: loudnormNumber(json["input_i"], "input_i"),
    inputTp: loudnormNumber(json["input_tp"], "input_tp"),
    inputLra: loudnormNumber(json["input_lra"], "input_lra"),
    inputThresh: loudnormNumber(json["input_thresh"], "input_thresh"),
    targetOffset: loudnormNumber(json["target_offset"], "target_offset"),
  };
}

/**
 * Render a job end to end: probe inputs, one audio prepass (loudness
 * measurement + transcription WAV), transcribe and build subtitles when the
 * preset asks for them, then encode. Works for both stitch and audio-driven
 * jobs — only the graph construction differs.
 */
export async function renderJob(
  request: RenderRequest,
  options: RenderOptions,
): Promise<RenderResult> {
  const { preset, spec } = request;
  const emit = (stage: RenderStage, percent: number | null, detail?: string): void =>
    options.onProgress?.({ stage, percent, detail });

  const tmpDir = path.join(dataDir(), "tmp", `render-${crypto.randomUUID()}`);
  await fsp.mkdir(tmpDir, { recursive: true });

  try {
    // ── Анализ исходников ──
    emit("probe", null);
    const doProbe = (file: string): Promise<MediaInfo> => probe(file, options.tools.ffprobe.path);

    let stitchInfos: MediaInfo[] = [];
    let sectionInfos: ProbedSection[] = [];
    if (spec.kind === "stitch") {
      if (spec.inputs.length === 0) throw new RenderError("no input files");
      for (const input of spec.inputs) stitchInfos.push(await doProbe(input));
    } else {
      for (const section of spec.sections) {
        const audio = await doProbe(section.audio);
        const infos: MediaInfo[] = [];
        for (const file of section.visuals.files) infos.push(await doProbe(file));
        sectionInfos.push({ audio, visuals: { kind: section.visuals.kind, infos } });
      }
    }

    const makeGraph = async (opts: {
      audioOnly?: boolean;
      assPath?: string | null;
      loudnorm?: LoudnormMode;
    }): Promise<BuiltGraph> =>
      spec.kind === "stitch"
        ? buildGraph({ inputs: stitchInfos, preset, ...opts })
        : (await buildAudioDrivenGraph({ sections: sectionInfos, preset, tmpDir, ...opts })).graph;

    // ── Аудио-препасс: замер громкости + WAV для транскрипции за один проход ──
    const subsEnabled = preset.subtitles.enabled;
    const needPrepass = preset.audio.normalize || subsEnabled;
    const wavPath = subsEnabled ? path.join(tmpDir, "timeline.wav") : null;

    let measured: LoudnormMeasured | null = null;
    let prepassDurationSec = 0;
    if (needPrepass) {
      emit("prepare-audio", 0);
      const graph = await makeGraph({
        audioOnly: true,
        loudnorm: preset.audio.normalize ? { mode: "measure" } : null,
      });
      const args = ["-y", ...graph.inputArgs, "-filter_complex", graph.filterComplex, "-map", graph.audioLabel];
      if (wavPath) args.push("-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath);
      else args.push("-f", "null", "-");
      const { stderr } = await runFfmpeg(options.tools.ffmpeg.path, args, {
        totalDurationSec: graph.totalDurationSec,
        onProgress: (p) => emit("prepare-audio", p.percent),
      });
      if (preset.audio.normalize) measured = parseLoudnorm(stderr);
      prepassDurationSec = graph.totalDurationSec;
    }

    // ── Субтитры ──
    let assPath: string | null = null;
    let srtPath: string | null = null;
    let transcript: Transcript | null = null;

    if (subsEnabled && wavPath) {
      emit("transcribe", 0);
      transcript = await transcribeAudio(wavPath, {
        provider: preset.subtitles.provider,
        language: preset.subtitles.language,
        model: preset.subtitles.model,
        durationSec: prepassDurationSec,
        tools: options.tools,
        onProgress: (p) => emit("transcribe", p.percent, p.detail ?? p.phase),
      });

      if (transcript.segments.length === 0) {
        emit("subtitles", null, "no speech detected — skipping subtitles");
      } else {
        emit("subtitles", null);
        if (preset.subtitles.exportSrt || !preset.subtitles.burnIn) {
          const parsed = path.parse(request.output);
          srtPath = path.join(parsed.dir, `${parsed.name}.srt`);
          await fsp.writeFile(srtPath, segmentsToSrt(transcript.segments), "utf8");
        }
        if (preset.subtitles.burnIn) {
          const reference =
            spec.kind === "stitch"
              ? stitchInfos
              : [sectionInfos[0]!.visuals.infos[0]!];
          const target = computeTargetSpec(reference, preset);
          assPath = path.join(tmpDir, "subtitles.ass");
          await fsp.writeFile(
            assPath,
            segmentsToAss(transcript.segments, preset.subtitles.style, {
              playResX: target.width,
              playResY: target.height,
            }),
            "utf8",
          );
        }
      }
    }

    // ── Кодирование ──
    const encoder = await selectEncoder(
      options.tools.ffmpeg.path,
      preset.output.videoCodec,
      preset.output.encoder,
      preset.output.quality,
    );

    emit("encode", 0, encoder.name);
    const graph = await makeGraph({
      assPath,
      loudnorm: measured ? { mode: "apply", measured } : null,
    });

    await fsp.mkdir(path.dirname(path.resolve(request.output)), { recursive: true });
    const args = [
      "-y",
      ...graph.inputArgs,
      "-filter_complex", graph.filterComplex,
      "-map", graph.videoLabel!,
      "-map", graph.audioLabel,
      ...encoder.args,
      "-c:a", "aac",
      "-b:a", `${preset.output.audioBitrateKbps}k`,
      "-movflags", "+faststart",
      request.output,
    ];
    await runFfmpeg(options.tools.ffmpeg.path, args, {
      totalDurationSec: graph.totalDurationSec,
      onProgress: (p) =>
        emit("encode", p.percent, p.speed ? `${encoder.name} · ${p.speed.toFixed(1)}x` : encoder.name),
    });

    return {
      output: request.output,
      durationSec: graph.totalDurationSec,
      encoder: encoder.name,
      srtPath,
      language: transcript?.language ?? null,
    };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}
