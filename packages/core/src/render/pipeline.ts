import fsp from "node:fs/promises";
import path from "node:path";
import type { Tools } from "../ffmpeg/ensure.js";
import { runFfmpeg } from "../ffmpeg/progress.js";
import type { Preset } from "../preset/schema.js";
import { probe } from "../probe/probe.js";
import type { MediaInfo } from "../probe/types.js";
import { selectEncoder } from "./encoders.js";
import { buildGraph, RenderError, type LoudnormMeasured } from "./graph.js";

export type RenderStage = "probe" | "prepare-audio" | "encode";

export interface RenderProgressEvent {
  stage: RenderStage;
  /** 0-100 within the stage, null when indeterminate. */
  percent: number | null;
  detail?: string;
}

export interface RenderRequest {
  inputs: string[];
  output: string;
  preset: Preset;
}

export interface RenderResult {
  output: string;
  durationSec: number;
  encoder: string;
  srtPath: string | null;
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

export interface AudioPrepassResult {
  measured: LoudnormMeasured | null;
}

/**
 * Single decode pass over the stitched audio timeline. Measures loudness
 * (two-pass loudnorm, first pass) and can simultaneously write a 16 kHz mono
 * WAV for transcription — the timeline matches the final render exactly.
 */
export async function audioPrepass(
  infos: MediaInfo[],
  preset: Preset,
  tools: Tools,
  options: {
    measureLoudness: boolean;
    wavPath?: string | null;
    onProgress?: (percent: number | null) => void;
  },
): Promise<AudioPrepassResult> {
  const graph = buildGraph({
    inputs: infos,
    preset,
    audioOnly: true,
    loudnorm: options.measureLoudness ? { mode: "measure" } : null,
  });

  const args = ["-y", ...graph.inputArgs, "-filter_complex", graph.filterComplex, "-map", graph.audioLabel];
  if (options.wavPath) {
    args.push("-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", options.wavPath);
  } else {
    args.push("-f", "null", "-");
  }

  const { stderr } = await runFfmpeg(tools.ffmpeg.path, args, {
    totalDurationSec: graph.totalDurationSec,
    onProgress: (p) => options.onProgress?.(p.percent),
  });

  return { measured: options.measureLoudness ? parseLoudnorm(stderr) : null };
}

/** Render a job: probe inputs, prep audio, then encode with the preset. */
export async function renderJob(
  request: RenderRequest,
  options: RenderOptions,
): Promise<RenderResult> {
  const { preset } = request;
  const emit = (stage: RenderStage, percent: number | null, detail?: string): void =>
    options.onProgress?.({ stage, percent, detail });

  if (request.inputs.length === 0) throw new RenderError("no input files");

  emit("probe", null);
  const infos: MediaInfo[] = [];
  for (const input of request.inputs) {
    infos.push(await probe(input, options.tools.ffprobe.path));
  }

  let measured: LoudnormMeasured | null = null;
  if (preset.audio.normalize) {
    emit("prepare-audio", 0);
    const prepass = await audioPrepass(infos, preset, options.tools, {
      measureLoudness: true,
      onProgress: (percent) => emit("prepare-audio", percent),
    });
    measured = prepass.measured;
  }

  const encoder = await selectEncoder(
    options.tools.ffmpeg.path,
    preset.output.videoCodec,
    preset.output.encoder,
    preset.output.quality,
  );

  emit("encode", 0, encoder.name);
  const graph = buildGraph({
    inputs: infos,
    preset,
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
    srtPath: null,
  };
}
