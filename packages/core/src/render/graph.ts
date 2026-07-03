import type { MediaInfo } from "../probe/types.js";
import type { Preset } from "../preset/schema.js";

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}

export interface LoudnormMeasured {
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
  targetOffset: number;
}

export type LoudnormMode =
  | { mode: "measure" }
  | { mode: "apply"; measured: LoudnormMeasured }
  | null;

export interface BuildGraphOptions {
  inputs: MediaInfo[];
  preset: Preset;
  /** Skip all video chains — used for the audio prepass (loudness/transcription). */
  audioOnly?: boolean;
  /** Path to an .ass file to burn in as the last video filter. */
  assPath?: string | null;
  loudnorm?: LoudnormMode;
}

export interface BuiltGraph {
  /** Ordered ffmpeg input args (real files plus generated silence). */
  inputArgs: string[];
  filterComplex: string;
  videoLabel: string | null;
  audioLabel: string;
  totalDurationSec: number;
}

/**
 * Escape a path for use as a filter option value (ass=, lut3d=). Filter args
 * are parsed twice, so a Windows drive colon needs BOTH the backslash escape
 * and surrounding single quotes (the pattern FFmpeg documents for subtitles).
 */
export function escapeFilterPath(filePath: string): string {
  const escaped = filePath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
  return `'${escaped}'`;
}

export interface TargetSpec {
  width: number;
  height: number;
  fps: number;
}

/** Output resolution/fps a job will render at (used for ASS layout too). */
export function computeTargetSpec(inputs: MediaInfo[], preset: Preset): TargetSpec {
  const first = inputs[0]?.video;
  const raw =
    preset.output.resolution === "source"
      ? { width: first?.width ?? 1920, height: first?.height ?? 1080 }
      : preset.output.resolution;
  const fps = preset.output.fps === "source" ? (first?.fps ?? 30) : preset.output.fps;
  return {
    width: raw.width - (raw.width % 2),
    height: raw.height - (raw.height % 2),
    fps,
  };
}

function effectFilters(preset: Preset): string[] {
  const filters: string[] = [];
  const e = preset.effects;
  if (e.brightness !== 0 || e.contrast !== 1 || e.saturation !== 1 || e.gamma !== 1) {
    filters.push(
      `eq=brightness=${e.brightness}:contrast=${e.contrast}:saturation=${e.saturation}:gamma=${e.gamma}`,
    );
  }
  if (e.sharpen > 0) filters.push(`unsharp=5:5:${e.sharpen}`);
  if (e.lut) filters.push(`lut3d=${escapeFilterPath(e.lut)}`);
  return filters;
}

function loudnormFilter(preset: Preset, loudnorm: LoudnormMode): string[] {
  if (!loudnorm) return [];
  const base = `loudnorm=I=${preset.audio.targetLufs}:TP=-1.5:LRA=11`;
  if (loudnorm.mode === "measure") return [`${base}:print_format=json`];
  const m = loudnorm.measured;
  return [
    `${base}:measured_I=${m.inputI}:measured_TP=${m.inputTp}:measured_LRA=${m.inputLra}` +
      `:measured_thresh=${m.inputThresh}:offset=${m.targetOffset}:linear=true`,
    "aresample=48000",
  ];
}

/**
 * Build the -filter_complex graph for a job: per-input normalization
 * (scale+pad, fps, stereo 48k audio, silence for mute clips), concat or
 * xfade/acrossfade stitching, effects, subtitle burn-in and loudnorm.
 */
export function buildGraph(options: BuildGraphOptions): BuiltGraph {
  const { inputs, preset } = options;
  const audioOnly = options.audioOnly ?? false;
  if (inputs.length === 0) throw new RenderError("no input files");

  const durations = inputs.map((info) => {
    if (info.durationSec === null) {
      throw new RenderError(`cannot determine duration of ${info.path}`);
    }
    return info.durationSec;
  });

  if (!audioOnly) {
    for (const info of inputs) {
      if (!info.video) throw new RenderError(`${info.path} has no video stream`);
    }
  }

  const transition = inputs.length > 1 ? preset.transition : null;
  const useXfade = transition !== null && transition.type !== "none";
  if (useXfade) {
    const minDur = transition.durationSec + 0.2;
    for (const [i, d] of durations.entries()) {
      if (d < minDur) {
        throw new RenderError(
          `clip ${inputs[i]?.path} is too short (${d.toFixed(2)}s) for a ` +
            `${transition.durationSec}s "${transition.type}" transition`,
        );
      }
    }
  }

  const target = computeTargetSpec(inputs, preset);
  const chains: string[] = [];
  const inputArgs: string[] = [];

  for (const info of inputs) inputArgs.push("-i", info.path);

  // Clips without audio get a bounded silent track so stitching stays aligned.
  const silenceIndexByInput = new Map<number, number>();
  let nextExtraIndex = inputs.length;
  for (const [i, info] of inputs.entries()) {
    if (!info.audio) {
      inputArgs.push(
        "-f", "lavfi",
        "-t", durations[i]!.toFixed(3),
        "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
      );
      silenceIndexByInput.set(i, nextExtraIndex++);
    }
  }

  for (const [i] of inputs.entries()) {
    if (!audioOnly) {
      chains.push(
        `[${i}:v]scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease,` +
          `pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
          `fps=${target.fps},settb=AVTB,setsar=1,format=yuv420p[v${i}]`,
      );
    }
    const audioSrc = silenceIndexByInput.get(i) ?? i;
    chains.push(
      `[${audioSrc}:a]aresample=48000:async=1,` +
        `aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`,
    );
  }

  let mergedVideo = "v0";
  let mergedAudio = "a0";
  let totalDurationSec = durations[0]!;

  if (inputs.length > 1 && !useXfade) {
    if (!audioOnly) {
      const pairs = inputs.map((_, i) => `[v${i}][a${i}]`).join("");
      chains.push(`${pairs}concat=n=${inputs.length}:v=1:a=1[vcat][acat]`);
      mergedVideo = "vcat";
    } else {
      const labels = inputs.map((_, i) => `[a${i}]`).join("");
      chains.push(`${labels}concat=n=${inputs.length}:v=0:a=1[acat]`);
    }
    mergedAudio = "acat";
    totalDurationSec = durations.reduce((sum, d) => sum + d, 0);
  } else if (useXfade) {
    const t = transition.durationSec;
    let accumulated = durations[0]!;
    for (let i = 1; i < inputs.length; i++) {
      const offset = accumulated - t;
      if (!audioOnly) {
        const outV = `vx${i}`;
        chains.push(
          `[${mergedVideo}][v${i}]xfade=transition=${transition.type}:duration=${t}:offset=${offset.toFixed(3)}[${outV}]`,
        );
        mergedVideo = outV;
      }
      const outA = `ax${i}`;
      chains.push(`[${mergedAudio}][a${i}]acrossfade=d=${t}[${outA}]`);
      mergedAudio = outA;
      accumulated = accumulated + durations[i]! - t;
    }
    totalDurationSec = accumulated;
  }

  let videoLabel: string | null = null;
  if (!audioOnly) {
    const post = effectFilters(preset);
    if (options.assPath) post.push(`ass=${escapeFilterPath(options.assPath)}`);
    // Effects (e.g. lut3d via RGB) and filter negotiation can drift the pixel
    // format; pin the encoder input to the universally playable yuv420p.
    post.push("format=yuv420p");
    chains.push(`[${mergedVideo}]${post.join(",")}[vout]`);
    videoLabel = "[vout]";
  }

  const audioPost = loudnormFilter(preset, options.loudnorm ?? null);
  chains.push(`[${mergedAudio}]${audioPost.length ? audioPost.join(",") : "anull"}[aout]`);

  return {
    inputArgs,
    filterComplex: chains.join(";"),
    videoLabel,
    audioLabel: "[aout]",
    totalDurationSec,
  };
}
