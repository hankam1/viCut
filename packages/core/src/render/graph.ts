import fsp from "node:fs/promises";
import path from "node:path";
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
  const first = inputs.find((info) => info.video)?.video;
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
 * Per-input video normalization: fit target frame, unify fps/timebase/format.
 * inputZoom > 1 crops the frame edges first (hides border watermarks).
 */
function videoNormalizeChain(target: TargetSpec, inputZoom = 1): string {
  const crop =
    inputZoom > 1.001
      ? `crop=trunc(iw/${inputZoom.toFixed(3)}/2)*2:trunc(ih/${inputZoom.toFixed(3)}/2)*2,`
      : "";
  return (
    `${crop}scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease,` +
    `pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
    `fps=${target.fps},settb=AVTB,setsar=1,format=yuv420p`
  );
}

const AUDIO_NORMALIZE = "aresample=48000:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo";

interface PostChainOptions {
  audioOnly: boolean;
  assPath?: string | null;
  loudnorm?: LoudnormMode;
}

/** Final effects/subtitles/pixel-format video chain and loudnorm audio chain. */
function appendPostChains(
  chains: string[],
  mergedVideo: string,
  mergedAudio: string,
  preset: Preset,
  options: PostChainOptions,
): { videoLabel: string | null; audioLabel: string } {
  let videoLabel: string | null = null;
  if (!options.audioOnly) {
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

  return { videoLabel, audioLabel: "[aout]" };
}

/* ═══════════════ Тип A — склейка клипов ═══════════════ */

export interface BuildGraphOptions {
  inputs: MediaInfo[];
  preset: Preset;
  /** Skip all video chains — used for the audio prepass (loudness/transcription). */
  audioOnly?: boolean;
  /** Path to an .ass file to burn in as the last video filter. */
  assPath?: string | null;
  loudnorm?: LoudnormMode;
}

/**
 * Build the -filter_complex graph for a stitch job: per-input normalization
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
      chains.push(`[${i}:v]${videoNormalizeChain(target, preset.effects.inputZoom)}[v${i}]`);
    }
    const audioSrc = silenceIndexByInput.get(i) ?? i;
    chains.push(`[${audioSrc}:a]${AUDIO_NORMALIZE}[a${i}]`);
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

  const { videoLabel, audioLabel } = appendPostChains(chains, mergedVideo, mergedAudio, preset, {
    audioOnly,
    assPath: options.assPath,
    loudnorm: options.loudnorm,
  });

  return {
    inputArgs,
    filterComplex: chains.join(";"),
    videoLabel,
    audioLabel,
    totalDurationSec,
  };
}

/* ═══════════════ Тип B — сборка под аудио ═══════════════ */

export interface ProbedSection {
  audio: MediaInfo;
  visuals: {
    kind: "clips" | "images";
    infos: MediaInfo[];
  };
}

export interface BuildAudioDrivenGraphOptions {
  sections: ProbedSection[];
  preset: Preset;
  /** Directory for generated slideshow list files (concat demuxer). */
  tmpDir: string;
  /**
   * Output resolution/fps. Defaults to computeTargetSpec of the first visual;
   * pass explicitly when sections are rendered as separate ffmpeg runs so all
   * parts share one format (required for lossless concat).
   */
  target?: TargetSpec;
  audioOnly?: boolean;
  assPath?: string | null;
  loudnorm?: LoudnormMode;
}

export interface SectionTiming {
  audioDurationSec: number;
  /** Speed factor applied to clips (1 = untouched); null for image sections. */
  speed: number | null;
  /** Seconds per image; null for clip sections. */
  secondsPerImage: number | null;
}

/** Path line for the concat demuxer list file (single quotes, ' → '\''). */
export function concatListPath(filePath: string): string {
  return `'${filePath.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
}

/**
 * Ken Burns for a uniform slideshow stream: zoompan whose zoom expression
 * restarts on every image boundary (frames-per-image is constant within a
 * section), alternating zoom-in / zoom-out per image. The stream is
 * supersampled ×2 beforehand so the crop never upscales.
 *
 * With a crossfade, an image is visible for fade+perImage seconds (it fades in
 * during the previous image's tail), so the zoom spans that window. The
 * "shifted" phase generates the same images as the crossfade overlay stream
 * (which starts one image ahead): its zoom starts at the fade start and
 * lands exactly on the "main" stream's phase at the cut, so the zoom is
 * continuous across the transition.
 */
function kenBurnsChain(
  target: TargetSpec,
  perImageSec: number,
  preset: Preset,
  fadeSec = 0,
  phase: "main" | "shifted" = "main",
): string {
  const ss = preset.slideshow;
  // Суперсэмпл минимум ×2: сдвиг кропа zoompan квантуется в пикселях ВХОДА,
  // и при малом запасе картинка заметно дрожит (проверено на реальном рендере).
  const ssFactor = Math.min(2.5, Math.max(2, ss.zoom + 0.5));
  const ssW = Math.round((target.width * ssFactor) / 2) * 2;
  const ssH = Math.round((target.height * ssFactor) / 2) * 2;
  const fpi = (perImageSec * target.fps).toFixed(4);
  const ff = (fadeSec * target.fps).toFixed(4);
  const span = ((perImageSec + fadeSec) * target.fps).toFixed(4);
  const z = ss.zoom.toFixed(3);
  const speed = ss.speed.toFixed(3);
  // Commas are safe: the whole expression is single-quoted for the graph
  // parser. zoompan's frame counter is `in` (not the usual `n`).
  // Progress of the current image's zoom, 0..1, scaled by speed and capped.
  const offset = phase === "main" ? `+${ff}` : `-(${fpi}-${ff})`;
  const p = `clip(${speed}*(mod(in,${fpi})${offset})/${span},0,1)`;
  const zoomIn = `1+(${z}-1)*${p}`;
  const zoomOut = `${z}-(${z}-1)*${p}`;
  // The shifted stream's list starts one image ahead, so its local frame
  // counter maps local image k to original image k+1 — parity is inverted.
  const [even, odd] = phase === "main" ? [zoomIn, zoomOut] : [zoomOut, zoomIn];
  const zoomExpr = `if(eq(mod(floor(in/${fpi}),2),0),${even},${odd})`;
  return (
    `scale=${ssW}:${ssH}:force_original_aspect_ratio=decrease,` +
    `pad=${ssW}:${ssH}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${target.fps},` +
    `zoompan=z='${zoomExpr}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'` +
    `:d=1:s=${target.width}x${target.height}:fps=${target.fps},` +
    `settb=AVTB,setsar=1,format=yuv420p`
  );
}

/**
 * Build the graph for an audio-driven job: each section's audio track defines
 * its duration; clips are speed-fitted to end exactly with the audio, images
 * are spread evenly across it. Sections are then concatenated.
 */
export async function buildAudioDrivenGraph(
  options: BuildAudioDrivenGraphOptions,
): Promise<{ graph: BuiltGraph; timings: SectionTiming[] }> {
  const { sections, preset, tmpDir } = options;
  const audioOnly = options.audioOnly ?? false;
  if (sections.length === 0) throw new RenderError("no sections");

  for (const [i, section] of sections.entries()) {
    if (!section.audio.audio) {
      throw new RenderError(`section ${i + 1}: ${section.audio.path} has no audio stream`);
    }
    if (section.audio.durationSec === null) {
      throw new RenderError(`section ${i + 1}: cannot determine duration of ${section.audio.path}`);
    }
    if (section.visuals.infos.length === 0) {
      throw new RenderError(`section ${i + 1} has no visual files`);
    }
    for (const info of section.visuals.infos) {
      if (!info.video) throw new RenderError(`${info.path} has no video/image stream`);
      if (section.visuals.kind === "clips" && info.durationSec === null) {
        throw new RenderError(`cannot determine duration of ${info.path}`);
      }
    }
  }

  const firstVisual = sections[0]!.visuals.infos[0]!;
  const target = options.target ?? computeTargetSpec([firstVisual], preset);

  const chains: string[] = [];
  const inputArgs: string[] = [];
  let inputIndex = 0;
  const timings: SectionTiming[] = [];

  for (const [si, section] of sections.entries()) {
    const audioDur = section.audio.durationSec!;

    if (!audioOnly) {
      if (section.visuals.kind === "clips") {
        const infos = section.visuals.infos;
        const durations: number[] = [];
        let clipsTotal = 0;
        for (const [ci, info] of infos.entries()) {
          inputArgs.push("-i", info.path);
          chains.push(
            `[${inputIndex}:v]${videoNormalizeChain(target, preset.effects.inputZoom)}[s${si}c${ci}]`,
          );
          durations.push(info.durationSec!);
          clipsTotal += info.durationSec!;
          inputIndex++;
        }

        // Переход между клипами — xfade в исходном времени; длительность
        // подобрана так, чтобы ПОСЛЕ спидфита переход длился как в пресете:
        // tSrc = T·total/(audioDur+(n−1)·T). Каждый переход съедает tSrc из
        // суммарного хронометража, отсюда пересчёт скорости.
        const transition = preset.transition;
        const n = infos.length;
        let tSrc = 0;
        if (transition.type !== "none" && n > 1) {
          tSrc =
            (transition.durationSec * clipsTotal) /
            (audioDur + (n - 1) * transition.durationSec);
          const minClip = Math.min(...durations);
          tSrc = Math.min(tSrc, Math.max(0, (minClip - 0.25) * 0.9));
          if (tSrc < 0.05) tSrc = 0;
        }
        const speed = (clipsTotal - (n - 1) * tSrc) / audioDur;
        timings.push({ audioDurationSec: audioDur, speed, secondsPerImage: null });

        let merged = `s${si}c0`;
        if (n > 1 && tSrc > 0) {
          let accumulated = durations[0]!;
          for (let ci = 1; ci < n; ci++) {
            const offset = accumulated - tSrc;
            const out = `s${si}x${ci}`;
            chains.push(
              `[${merged}][s${si}c${ci}]xfade=transition=${transition.type}` +
                `:duration=${tSrc.toFixed(4)}:offset=${offset.toFixed(4)}[${out}]`,
            );
            merged = out;
            accumulated = accumulated + durations[ci]! - tSrc;
          }
        } else if (n > 1) {
          merged = `s${si}cat`;
          chains.push(
            `${infos.map((_, ci) => `[s${si}c${ci}]`).join("")}concat=n=${n}:v=1:a=0[${merged}]`,
          );
        }
        chains.push(
          `[${merged}]setpts=PTS/${speed.toFixed(6)},fps=${target.fps},` +
            `trim=duration=${audioDur.toFixed(3)},setpts=PTS-STARTPTS[v${si}]`,
        );
      } else {
        // Слайдшоу: один вход через concat-демуксер со временем на кадр.
        const perImage = audioDur / section.visuals.infos.length;
        timings.push({ audioDurationSec: audioDur, speed: null, secondsPerImage: perImage });

        const lines = ["ffconcat version 1.0"];
        for (const info of section.visuals.infos) {
          lines.push(`file ${concatListPath(info.path)}`);
          lines.push(`duration ${perImage.toFixed(4)}`);
        }
        // Последний кадр дублируется, чтобы демуксер закрыл его длительность.
        lines.push(`file ${concatListPath(section.visuals.infos.at(-1)!.path)}`);
        const listPath = path.join(tmpDir, `section-${si}-images.txt`);
        await fsp.writeFile(listPath, `${lines.join("\n")}\n`, "utf8");

        // Кроссфейд не длиннее ~половины показа картинки; совсем короткий не имеет смысла.
        const fade = Math.min(preset.slideshow.crossfadeSec, 0.45 * perImage);
        const useCrossfade = section.visuals.infos.length > 1 && fade >= 0.05;
        const chainFor = (phase: "main" | "shifted"): string =>
          preset.slideshow.kenBurns
            ? kenBurnsChain(target, perImage, preset, useCrossfade ? fade : 0, phase)
            : videoNormalizeChain(target);

        inputArgs.push("-f", "concat", "-safe", "0", "-i", listPath);
        if (!useCrossfade) {
          chains.push(
            `[${inputIndex}:v]${chainFor("main")},` +
              `trim=duration=${audioDur.toFixed(3)},setpts=PTS-STARTPTS[v${si}]`,
          );
          inputIndex++;
        } else {
          // Кроссфейд без цепочки xfade (не влезла бы в лимит аргументов при
          // 100+ картинках): то же слайдшоу вторым потоком, начатым на одну
          // картинку вперёд, подмешивается поверх основного периодической
          // альфа-маской в последние fade секунд каждой картинки. Сдвиг — свой
          // список без первой картинки: старт ровно на кадровой сетке, без
          // seek (и без trim=start, который декодировал бы картинку впустую).
          const linesB = ["ffconcat version 1.0"];
          for (const info of section.visuals.infos.slice(1)) {
            linesB.push(`file ${concatListPath(info.path)}`);
            linesB.push(`duration ${perImage.toFixed(4)}`);
          }
          linesB.push(`file ${concatListPath(section.visuals.infos.at(-1)!.path)}`);
          const listPathB = path.join(tmpDir, `section-${si}-images-b.txt`);
          await fsp.writeFile(listPathB, `${linesB.join("\n")}\n`, "utf8");
          inputArgs.push("-f", "concat", "-safe", "0", "-i", listPathB);
          const a = inputIndex;
          const b = inputIndex + 1;
          inputIndex += 2;
          const nextDur = audioDur - perImage;
          chains.push(
            `[${a}:v]${chainFor("main")},` +
              `trim=duration=${audioDur.toFixed(3)},setpts=PTS-STARTPTS[s${si}base]`,
          );
          chains.push(
            `[${b}:v]${chainFor("shifted")},` +
              `trim=duration=${nextDur.toFixed(4)},setpts=PTS-STARTPTS[s${si}next]`,
          );
          // Альфа одинакова по всему кадру — считается на 2×2 (geq дёшев) и
          // растягивается до целевого размера.
          chains.push(
            `color=c=white:s=2x2:r=${target.fps}:d=${nextDur.toFixed(4)},format=gray,` +
              `geq=lum='255*clip((mod(T,${perImage.toFixed(4)})-${(perImage - fade).toFixed(4)})/${fade.toFixed(4)},0,1)',` +
              `scale=${target.width}:${target.height}:flags=neighbor,settb=AVTB[s${si}mask]`,
          );
          chains.push(`[s${si}next][s${si}mask]alphamerge[s${si}over]`);
          chains.push(
            `[s${si}base][s${si}over]overlay=eof_action=pass:format=auto,` +
              `format=yuv420p,setsar=1[v${si}]`,
          );
        }
      }
    } else {
      timings.push({
        audioDurationSec: audioDur,
        speed:
          section.visuals.kind === "clips"
            ? section.visuals.infos.reduce((sum, i) => sum + (i.durationSec ?? 0), 0) / audioDur
            : null,
        secondsPerImage:
          section.visuals.kind === "images" ? audioDur / section.visuals.infos.length : null,
      });
    }

    inputArgs.push("-i", section.audio.path);
    chains.push(
      `[${inputIndex}:a]${AUDIO_NORMALIZE},atrim=duration=${audioDur.toFixed(3)}[a${si}]`,
    );
    inputIndex++;
  }

  let mergedVideo = "v0";
  let mergedAudio = "a0";
  if (sections.length > 1) {
    if (!audioOnly) {
      const pairs = sections.map((_, i) => `[v${i}][a${i}]`).join("");
      chains.push(`${pairs}concat=n=${sections.length}:v=1:a=1[vcat][acat]`);
      mergedVideo = "vcat";
    } else {
      const labels = sections.map((_, i) => `[a${i}]`).join("");
      chains.push(`${labels}concat=n=${sections.length}:v=0:a=1[acat]`);
    }
    mergedAudio = "acat";
  }

  const { videoLabel, audioLabel } = appendPostChains(chains, mergedVideo, mergedAudio, preset, {
    audioOnly,
    assPath: options.assPath,
    loudnorm: options.loudnorm,
  });

  const totalDurationSec = sections.reduce((sum, s) => sum + s.audio.durationSec!, 0);

  return {
    graph: {
      inputArgs,
      filterComplex: chains.join(";"),
      videoLabel,
      audioLabel,
      totalDurationSec,
    },
    timings,
  };
}
