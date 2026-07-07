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
 * smooth=true converts frame rate with blending (framerate) instead of
 * duplication (fps) — smooths judder on mismatched-fps clips; NOT for image
 * slideshows (blending across image cuts would smear them).
 */
export function videoNormalizeChain(target: TargetSpec, inputZoom = 1, smooth = false): string {
  const crop =
    inputZoom > 1.001
      ? `crop=trunc(iw/${inputZoom.toFixed(3)}/2)*2:trunc(ih/${inputZoom.toFixed(3)}/2)*2,`
      : "";
  const rate = smooth ? `framerate=${target.fps}` : `fps=${target.fps}`;
  return (
    `${crop}scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease,` +
    `pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
    `${rate},settb=AVTB,setsar=1,format=yuv420p`
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
      chains.push(
        `[${i}:v]${videoNormalizeChain(target, preset.effects.inputZoom, true)}[v${i}]`,
      );
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

/** True when any slideshow motion effect needs the perspective pass. */
export function slideshowWantsMotion(preset: Preset): boolean {
  const ss = preset.slideshow;
  return ss.kenBurns || ss.pendulum.enabled || ss.pan.enabled || ss.shake.enabled;
}

/**
 * Плавный псевдошум −1..1: сумма двух несоизмеримых синусов. Детерминирован
 * и непрерывен (random() в ffmpeg некогерентен между кадрами — не годится).
 */
function noiseExpr(
  freqA: number,
  freqB: number,
  phaseA: number,
  phaseB: number,
  speed: number,
  frame: string,
  fps: number,
): string {
  const ka = ((2 * Math.PI * freqA * speed) / fps).toFixed(6);
  const kb = ((2 * Math.PI * freqB * speed) / fps).toFixed(6);
  return `((sin(${ka}*${frame}+${phaseA})+0.6*sin(${kb}*${frame}+${phaseB}))/1.6)`;
}

/**
 * Motion pass for a uniform slideshow stream: Ken Burns zoom, pendulum swing,
 * pan drift and handheld shake, all expressed as one per-frame `perspective`
 * quad (fractional corner coordinates → subpixel-smooth, effects compose).
 * The stream is supersampled beforehand so the crop never upscales, and a
 * constant safety zoom guarantees the rotated/shifted window stays inside
 * the frame (no black corners).
 *
 * With a crossfade, an image is visible for fade+perImage seconds (it fades in
 * during the previous image's tail), so per-image motion spans that window.
 * The "shifted" phase generates the same images as the crossfade overlay
 * stream (which starts one image ahead): its motion starts at the fade start
 * and lands exactly on the "main" stream's phase at the cut, so zoom/pan/swing
 * are continuous across the transition. Shake is keyed to the composite clock
 * (both streams share it), so the blend never double-exposes.
 */
function motionChain(
  target: TargetSpec,
  perImageSec: number,
  preset: Preset,
  fadeSec = 0,
  phase: "main" | "shifted" = "main",
): string {
  const ss = preset.slideshow;
  const pend = ss.pendulum.enabled ? ss.pendulum : null;
  const pan = ss.pan.enabled ? ss.pan : null;
  const shake = ss.shake.enabled ? ss.shake : null;
  const fps = target.fps;

  // Запас зума, чтобы повёрнутое/сдвинутое окно не выехало за кадр: габарит
  // повёрнутого окна + смещение центра (пивот у края качает центр) + пан/шейк.
  const rollDeg = shake ? 0.15 * shake.intensity : 0;
  const maxRad = (((pend?.angleDeg ?? 0) + rollDeg) * Math.PI) / 180;
  const sinM = Math.sin(maxRad);
  const cosM = Math.cos(maxRad);
  const panX = pan && pan.axis !== "vertical" ? pan.amount / 2 : 0;
  const panY = pan && pan.axis !== "horizontal" ? pan.amount / 2 : 0;
  const shakeFrac = shake ? 0.004 * shake.intensity : 0;
  const edgePivot = pend && pend.pivot !== "center" ? 1 : 0;
  const w0 = target.width;
  const h0 = target.height;
  const zx = (w0 * cosM + h0 * sinM * (1 + edgePivot)) / (w0 * (1 - 2 * (panX + shakeFrac)));
  const zy =
    (w0 * sinM + h0 * cosM + edgePivot * h0 * (1 - cosM)) / (h0 * (1 - 2 * (panY + shakeFrac)));
  const zSafe = Math.max(1, zx, zy);

  // Зум — через perspective, НЕ zoompan: zoompan сдвигает окно кропа целыми
  // пикселями, и на медленном зуме (десятки секунд на картинку) движение
  // превращается в заметное «тиканье». perspective принимает дробные
  // координаты и ресэмплирует субпиксельно — движение гладкое.
  // Суперсэмпл — запас, чтобы кроп не апскейлил исходник.
  const maxZoom = (ss.kenBurns ? ss.zoom : 1) * zSafe;
  const ssFactor = Math.min(2.5, Math.max(2, maxZoom + 0.5));
  const ssW = Math.round((target.width * ssFactor) / 2) * 2;
  const ssH = Math.round((target.height * ssFactor) / 2) * 2;

  const fpi = (perImageSec * fps).toFixed(4);
  const ff = (fadeSec * fps).toFixed(4);
  const span = ((perImageSec + fadeSec) * fps).toFixed(4);
  // Commas are safe: every expression is single-quoted for the graph parser.
  // ВАЖНО: у perspective счётчик `in` начинается с 1 (у zoompan — с 0);
  // без поправки движение прыгает на один кадр на каждой границе картинок.
  const frame = `(in-1)`;
  // Кадр внутри жизни текущей картинки и её индекс в ИСХОДНОМ списке
  // (список shifted-потока начат на одну картинку вперёд — индекс сдвинут).
  const offset = phase === "main" ? `+${ff}` : `-(${fpi}-${ff})`;
  const local = `(mod(${frame},${fpi})${offset})`;
  const oi = phase === "main" ? `floor(${frame}/${fpi})` : `(floor(${frame}/${fpi})+1)`;
  // Линейный прогресс жизни картинки 0..1 (пан) — без учёта скорости зума.
  const linProgress = `clip(${local}/${span},0,1)`;

  // --- Зум Ken Burns: чётные картинки приближаются, нечётные отдаляются ---
  let zoomExpr = "1";
  if (ss.kenBurns) {
    const z = ss.zoom.toFixed(3);
    const p = `clip(${ss.speed.toFixed(3)}*${local}/${span},0,1)`;
    zoomExpr = `if(eq(mod(${oi},2),0),1+(${z}-1)*${p},${z}-(${z}-1)*${p})`;
  }
  const ztot = zSafe > 1.0001 ? `(${zoomExpr})*${zSafe.toFixed(4)}` : zoomExpr;

  // --- Угол поворота: маятник + микро-ролл дрожания, радианы ---
  const thetaParts: string[] = [];
  if (pend) {
    const amp = ((pend.angleDeg * Math.PI) / 180).toFixed(6);
    const periodF = (pend.periodSec * fps).toFixed(4);
    const sign = pend.alternate ? `(1-2*mod(${oi},2))*` : "";
    thetaParts.push(`${sign}${amp}*sin(2*PI*${local}/${periodF})`);
  }
  if (shake) {
    const rollAmp = ((rollDeg * Math.PI) / 180).toFixed(6);
    thetaParts.push(`${rollAmp}*${noiseExpr(0.3, 0.8, 5.1, 2.3, shake.speed, frame, fps)}`);
  }
  const theta = thetaParts.length > 0 ? thetaParts.join("+") : "0";

  // --- Центр окна: середина кадра + дрейф панорамы + шейк ---
  // Шейк — по счётчику кадров композиции (у main и shifted он совпадает),
  // чтобы во время кроссфейда оба потока тряслись одинаково.
  let cx = `W/2`;
  let cy = `H/2`;
  if (pan) {
    const travel = `(2*${linProgress}-1)`;
    const ax = (pan.amount / 2).toFixed(5);
    if (pan.axis === "horizontal") {
      cx += `+(1-2*mod(${oi},2))*${ax}*W*${travel}`;
    } else if (pan.axis === "vertical") {
      cy += `+(1-2*mod(${oi},2))*${ax}*H*${travel}`;
    } else {
      const dir = `(1-2*mod(floor(${oi}/2),2))`;
      cx += `+eq(mod(${oi},2),0)*${dir}*${ax}*W*${travel}`;
      cy += `+eq(mod(${oi},2),1)*${dir}*${ax}*H*${travel}`;
    }
  }
  if (shake) {
    const sAmp = (0.004 * shake.intensity).toFixed(6);
    cx += `+${sAmp}*W*${noiseExpr(0.35, 0.9, 1.3, 4.1, shake.speed, frame, fps)}`;
    cy += `+${sAmp}*H*${noiseExpr(0.45, 1.1, 2.9, 0.7, shake.speed, frame, fps)}`;
  }

  // --- Углы квада: окно W/Z × H/Z в центре (cx,cy), повёрнутое на theta
  // вокруг точки опоры (центр или середина верхнего/нижнего края).
  // st/ld локальны для каждого из 8 выражений — общий пролог в каждом.
  const py = !pend || pend.pivot === "center" ? "0" : pend.pivot === "top" ? "(0-ld(3))" : "ld(3)";
  const corner = (sx: number, sy: number, coord: "x" | "y"): string => {
    const pre = `st(0,${theta});st(1,${ztot});st(2,W/(2*ld(1)));st(3,H/(2*ld(1)));`;
    const rel = `((${sy})*ld(3)-(${py}))`;
    return coord === "x"
      ? `${pre}(${cx})+cos(ld(0))*(${sx})*ld(2)-sin(ld(0))*${rel}`
      : `${pre}(${cy})+(${py})+sin(ld(0))*(${sx})*ld(2)+cos(ld(0))*${rel}`;
  };

  return (
    `scale=${ssW}:${ssH}:force_original_aspect_ratio=decrease,` +
    `pad=${ssW}:${ssH}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${fps},` +
    `perspective=x0='${corner(-1, -1, "x")}':y0='${corner(-1, -1, "y")}'` +
    `:x1='${corner(1, -1, "x")}':y1='${corner(1, -1, "y")}'` +
    `:x2='${corner(-1, 1, "x")}':y2='${corner(-1, 1, "y")}'` +
    `:x3='${corner(1, 1, "x")}':y3='${corner(1, 1, "y")}'` +
    `:interpolation=linear:eval=frame,` +
    `scale=${target.width}:${target.height},` +
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
        // Переходы между клипами здесь НЕ делаются: xfade (framesync) тянет
        // все входы одновременно и копит кадры поздних клипов в памяти без
        // лимита. Секции с переходами заранее сшивает prestitchClips — сюда
        // приходит уже один готовый файл.
        const infos = section.visuals.infos;
        const clipLabels: string[] = [];
        let clipsTotal = 0;
        for (const [ci, info] of infos.entries()) {
          inputArgs.push("-i", info.path);
          chains.push(
            `[${inputIndex}:v]${videoNormalizeChain(target, preset.effects.inputZoom, true)}[s${si}c${ci}]`,
          );
          clipLabels.push(`[s${si}c${ci}]`);
          clipsTotal += info.durationSec!;
          inputIndex++;
        }
        const speed = clipsTotal / audioDur;
        timings.push({ audioDurationSec: audioDur, speed, secondsPerImage: null });

        let merged = `s${si}c0`;
        if (clipLabels.length > 1) {
          merged = `s${si}cat`;
          chains.push(`${clipLabels.join("")}concat=n=${clipLabels.length}:v=1:a=0[${merged}]`);
        }
        // framerate вместо fps: спидфит даёт нецелый исходный fps, жёсткий
        // дроп кадров превращает движение камеры в рывки — смешивание глаже.
        chains.push(
          `[${merged}]setpts=PTS/${speed.toFixed(6)},framerate=${target.fps},` +
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
          slideshowWantsMotion(preset)
            ? motionChain(target, perImage, preset, useCrossfade ? fade : 0, phase)
            : videoNormalizeChain(target);
        // Виньетка и зерно — один раз поверх готовой ленты секции (после
        // кроссфейда), чтобы шум не смешивался и не считался дважды.
        const post: string[] = [];
        if (preset.slideshow.vignette.enabled) {
          post.push(`vignette=angle=${(preset.slideshow.vignette.strength * 1.35).toFixed(4)}`);
        }
        if (preset.slideshow.grain.enabled) {
          post.push(`noise=alls=${Math.round(preset.slideshow.grain.strength)}:allf=t+u`);
        }
        const postStr = post.length > 0 ? `${post.join(",")},` : "";

        inputArgs.push("-f", "concat", "-safe", "0", "-i", listPath);
        if (!useCrossfade) {
          chains.push(
            `[${inputIndex}:v]${chainFor("main")},${postStr}` +
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
          // Форма перехода — из секции «Переходы»; длительность у слайдшоу
          // своя (crossfadeSec, 0 = без перехода), а «none» оставляет обычное
          // растворение — иначе старые пресеты молча потеряли бы кроссфейд.
          // Равномерная альфа считается на 2×2 и растягивается neighbor'ом;
          // пространственные маски (шторки, круг, дизолв) — на 1/8 разрешения
          // с билинейным растяжением: мягкая кромка бесплатно, geq дёшев.
          // ДВЕ тонкости синхронизации в прологе,
          // без которых на части границ вспыхивает картинка через одну:
          // (1) границы картинок квантуются в сетку демьюксера — 1/25 с
          //     округлением накопленной суммы (st(1));
          // (2) закрытие окна — по той же round-логике, по которой fps-фильтр
          //     выбирает кадр для слота (round(pts·fps)), а не по lt(T,b).
          // +0.0001 тика: демьюксер округляет точной рациональной арифметикой
          // (X.525 → вверх), а double в geq даёт X.5249999 → вниз; эпсилон
          // выравнивает поведение и на честных ties (NEAR-округление — вверх).
          // Третья строка: кадр, лежащий ровно на номинальной границе k·per,
          // попадает floor'ом в окно k+1, хотя квантованная граница k ещё не
          // наступила — тогда шаг назад (иначе альфа обнуляется на кадр
          // раньше смены картинки и старый кадр «вспыхивает»).
          const per = perImage.toFixed(6);
          const fps = target.fps;
          const fd = fade.toFixed(4);
          // Пролог одинаков для geq (время T) и overlay/eq (время t):
          // ld(1) — квантованная граница текущей картинки, ld(2) — прогресс
          // перехода 0..1 (0 вне окна и после границы).
          const pro = (t: string): string =>
            `st(0,floor(${t}/${per})+1);` +
            `st(1,round((ld(0)-1)*${per}*25+0.0001)/25);` +
            `st(0,ld(0)-lt(round(${t}*${fps}),round(ld(1)*${fps})));` +
            `st(1,round(ld(0)*${per}*25+0.0001)/25);` +
            `st(2,clip((${t}-(ld(1)-${fd}))/${fd},0,1)` +
            `*lt(round(${t}*${fps}),round(ld(1)*${fps})))`;
          const tt = preset.transition.type;
          let alphaExpr = "255*ld(2)"; // none | fade: равномерное растворение
          let spatial = false;
          let overlayPos = "";
          let eqStr = "";
          switch (tt) {
            case "dissolve":
              // Порог из пиксельного хэша — классический зернистый дизолв;
              // на маске 1/8 разрешения зерно получается ~8 px.
              alphaExpr = "255*lt(mod(abs(sin(X*12.9898+Y*78.233))*43758.545,1),ld(2))";
              spatial = true;
              break;
            case "wipeleft":
              alphaExpr = "255*gt(X+0.5,W*(1-ld(2)))";
              spatial = true;
              break;
            case "wiperight":
              alphaExpr = "255*lt(X,W*ld(2))";
              spatial = true;
              break;
            case "circleopen":
              alphaExpr = "255*lt(hypot(X-W/2,Y-H/2),hypot(W/2,H/2)*ld(2)*1.05)";
              spatial = true;
              break;
            case "circleclose":
              // gt(ld(2),0): при прогрессе 0 радиус равен диагонали и углы
              // проходили бы порог — вне окна маска обязана быть нулевой.
              alphaExpr = "255*gte(hypot(X-W/2,Y-H/2),hypot(W/2,H/2)*(1-ld(2)*1.04))*gt(ld(2),0)";
              spatial = true;
              break;
            case "slideleft":
            case "slideright":
              // Новая картинка наезжает целиком непрозрачной; движет её x
              // оверлея — вне окна перехода W*(1-0) уводит слой за кадр.
              alphaExpr = "255*gt(ld(2),0)";
              overlayPos =
                tt === "slideleft"
                  ? `:x='${pro("t")};W*(1-ld(2))':y=0`
                  : `:x='${pro("t")};0-W*(1-ld(2))':y=0`;
              break;
            case "fadeblack":
            case "fadewhite": {
              // Затухание в цвет: подмена картинки — шаг альфы на середине
              // окна, спрятанный дипом яркости (насыщенность в ноль, иначе
              // хрома красит «чёрный»). Крутизна 1.4 держит кадр полностью
              // залитым вокруг шага. lt(ld(0),N) — чтобы конец последней
              // картинки секции не гас без смены.
              alphaExpr = "255*gte(ld(2),0.5)";
              const dip =
                `clip((1-abs(2*ld(2)-1))*1.4,0,1)*lt(ld(0),${section.visuals.infos.length})`;
              const sign = tt === "fadeblack" ? "0-" : "";
              eqStr =
                `eq=brightness='${pro("t")};${sign}(${dip})'` +
                `:saturation='${pro("t")};1-(${dip})':eval=frame,`;
              break;
            }
            default:
              break;
          }
          const maskW = spatial ? Math.max(16, 2 * Math.round(target.width / 16)) : 2;
          const maskH = spatial ? Math.max(16, 2 * Math.round(target.height / 16)) : 2;
          chains.push(
            `color=c=white:s=${maskW}x${maskH}:r=${target.fps}:d=${nextDur.toFixed(4)},format=gray,` +
              `geq=lum='${pro("T")};${alphaExpr}',` +
              `scale=${target.width}:${target.height}:flags=${spatial ? "bilinear" : "neighbor"},` +
              `settb=AVTB[s${si}mask]`,
          );
          chains.push(`[s${si}next][s${si}mask]alphamerge[s${si}over]`);
          chains.push(
            `[s${si}base][s${si}over]overlay=eof_action=pass:format=auto${overlayPos},` +
              `format=yuv420p,${eqStr}${postStr}setsar=1[v${si}]`,
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
