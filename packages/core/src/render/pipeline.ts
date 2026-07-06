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
  concatListPath,
  RenderError,
  type BuiltGraph,
  type LoudnormMeasured,
  type LoudnormMode,
  type ProbedSection,
  type TargetSpec,
} from "./graph.js";
import type { TranscriptSegment } from "../transcribe/types.js";
import type { JobSpec } from "./spec.js";

export type RenderStage = "probe" | "prepare-audio" | "transcribe" | "subtitles" | "encode";

export interface RenderProgressEvent {
  stage: RenderStage;
  /** 0-100 within the stage, null when indeterminate. */
  percent: number | null;
  detail?: string;
  /** Оценка оставшегося времени стадии, сек; null когда неизвестно. */
  etaSec?: number | null;
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
 * Everything before encoding, ready to be run ahead of time (e.g. while the
 * previous job is still encoding): probed inputs, loudness measurement,
 * transcript and subtitle files.
 */
export interface PreparedRender {
  request: RenderRequest;
  measured: LoudnormMeasured | null;
  assPath: string | null;
  srtPath: string | null;
  transcript: Transcript | null;
  /** Probed sections (audio-driven jobs; empty for stitch). */
  sectionInfos: ProbedSection[];
  /** Output resolution/fps, shared by every encode of this job. */
  target: TargetSpec;
  tmpDir: string;
  makeGraph: (opts: {
    audioOnly?: boolean;
    assPath?: string | null;
    loudnorm?: LoudnormMode;
  }) => Promise<BuiltGraph>;
  /** Remove the temp files; encodeRender does this itself. */
  cleanup: () => Promise<void>;
}

/** Сегменты, попадающие в окно секции, со сдвигом в её локальное время. */
function sliceTranscript(
  segments: TranscriptSegment[],
  startSec: number,
  endSec: number,
): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const segment of segments) {
    if (segment.endSec <= startSec || segment.startSec >= endSec) continue;
    const words = segment.words
      ?.filter((word) => word.endSec > startSec && word.startSec < endSec)
      .map((word) => ({
        ...word,
        startSec: Math.max(0, word.startSec - startSec),
        endSec: Math.min(endSec - startSec, word.endSec - startSec),
      }));
    out.push({
      ...segment,
      startSec: Math.max(0, segment.startSec - startSec),
      endSec: Math.min(endSec - startSec, segment.endSec - startSec),
      ...(words && words.length > 0 ? { words } : {}),
    });
  }
  return out;
}

/**
 * Prepare a job: probe inputs, one audio prepass (loudness measurement +
 * transcription WAV), transcribe and build subtitles when the preset asks for
 * them. Works for both stitch and audio-driven jobs.
 */
export async function prepareRender(
  request: RenderRequest,
  options: RenderOptions,
): Promise<PreparedRender> {
  const { preset, spec } = request;
  const emit = (stage: RenderStage, percent: number | null, detail?: string): void =>
    options.onProgress?.({ stage, percent, detail });

  const tmpDir = path.join(dataDir(), "tmp", `render-${crypto.randomUUID()}`);
  await fsp.mkdir(tmpDir, { recursive: true });
  const cleanup = (): Promise<void> => fsp.rm(tmpDir, { recursive: true, force: true });

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

    const reference =
      spec.kind === "stitch" ? stitchInfos : [sectionInfos[0]!.visuals.infos[0]!];
    const target = computeTargetSpec(reference, preset);

    const makeGraph = async (opts: {
      audioOnly?: boolean;
      assPath?: string | null;
      loudnorm?: LoudnormMode;
    }): Promise<BuiltGraph> =>
      spec.kind === "stitch"
        ? buildGraph({ inputs: stitchInfos, preset, ...opts })
        : (await buildAudioDrivenGraph({ sections: sectionInfos, preset, tmpDir, target, ...opts }))
            .graph;

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
      const style = preset.subtitles.style;
      transcript = await transcribeAudio(wavPath, {
        provider: preset.subtitles.provider,
        language: preset.subtitles.language,
        model: preset.subtitles.model,
        durationSec: prepassDurationSec,
        // Пословный тайминг нужен только для анимации текста.
        wordTimestamps: style.animation !== "none" && preset.subtitles.burnIn,
        maxSegmentChars: style.maxLineChars * style.maxLines,
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

    return {
      request,
      measured,
      assPath,
      srtPath,
      transcript,
      sectionInfos,
      target,
      tmpDir,
      makeGraph,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Encode a prepared job; always removes the prepared temp files. */
export async function encodeRender(
  prepared: PreparedRender,
  options: RenderOptions,
): Promise<RenderResult> {
  const { request, measured, assPath, srtPath, transcript } = prepared;
  const { preset, spec } = request;
  const emit = (
    stage: RenderStage,
    percent: number | null,
    detail?: string,
    etaSec?: number | null,
  ): void => options.onProgress?.({ stage, percent, detail, etaSec });

  try {
    const encoder = await selectEncoder(
      options.tools.ffmpeg.path,
      preset.output.videoCodec,
      preset.output.encoder,
      preset.output.quality,
    );

    await fsp.mkdir(path.dirname(path.resolve(request.output)), { recursive: true });

    // Многосекционные задачи кодируются по секциям отдельными процессами:
    // один граф на весь фильм копит кадры неактивных веток concat без
    // ограничения (ffmpeg подтягивает все входы по наименьшему таймстемпу) —
    // на часовом видео это гигабайты. Куски склеиваются без перекодирования.
    if (spec.kind === "audio-driven" && prepared.sectionInfos.length > 1) {
      return await encodeSections(prepared, options, encoder.name, encoder.args, emit);
    }

    emit("encode", 0, encoder.name);
    const graph = await prepared.makeGraph({
      assPath,
      loudnorm: measured ? { mode: "apply", measured } : null,
    });

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
        emit(
          "encode",
          p.percent,
          p.speed ? `${encoder.name} · ${p.speed.toFixed(1)}x` : encoder.name,
          p.speed ? Math.max(0, (graph.totalDurationSec - p.outTimeSec) / p.speed) : null,
        ),
    });

    return {
      output: request.output,
      durationSec: graph.totalDurationSec,
      encoder: encoder.name,
      srtPath,
      language: transcript?.language ?? null,
    };
  } finally {
    await prepared.cleanup();
  }
}

/** Посекционное кодирование + склейка кусков copy-ремуксом. */
async function encodeSections(
  prepared: PreparedRender,
  options: RenderOptions,
  encoderName: string,
  encoderArgs: string[],
  emit: (stage: RenderStage, percent: number | null, detail?: string, etaSec?: number | null) => void,
): Promise<RenderResult> {
  const { request, measured, transcript, sectionInfos, target, tmpDir } = prepared;
  const { preset } = request;
  const totalDur = sectionInfos.reduce((sum, s) => sum + s.audio.durationSec!, 0);
  const style = preset.subtitles.style;

  emit("encode", 0, encoderName);
  const parts: string[] = [];
  let doneDur = 0;
  for (const [si, section] of sectionInfos.entries()) {
    const secDur = section.audio.durationSec!;

    // Субтитры секции: вырезка из общего транскрипта в локальном времени.
    let assPath: string | null = null;
    if (prepared.assPath && transcript) {
      const slice = sliceTranscript(transcript.segments, doneDur, doneDur + secDur);
      if (slice.length > 0) {
        assPath = path.join(tmpDir, `subtitles-${si}.ass`);
        await fsp.writeFile(
          assPath,
          segmentsToAss(slice, style, { playResX: target.width, playResY: target.height }),
          "utf8",
        );
      }
    }

    const { graph } = await buildAudioDrivenGraph({
      sections: [section],
      preset,
      tmpDir,
      target,
      assPath,
      loudnorm: measured ? { mode: "apply", measured } : null,
    });

    const partPath = path.join(tmpDir, `part-${si}.mp4`);
    const args = [
      "-y",
      ...graph.inputArgs,
      "-filter_complex", graph.filterComplex,
      "-map", graph.videoLabel!,
      "-map", graph.audioLabel,
      ...encoderArgs,
      "-c:a", "aac",
      "-b:a", `${preset.output.audioBitrateKbps}k`,
      partPath,
    ];
    const base = doneDur;
    await runFfmpeg(options.tools.ffmpeg.path, args, {
      totalDurationSec: graph.totalDurationSec,
      onProgress: (p) =>
        emit(
          "encode",
          ((base + ((p.percent ?? 0) / 100) * secDur) / totalDur) * 99,
          `${encoderName} · секция ${si + 1}/${sectionInfos.length}` +
            (p.speed ? ` · ${p.speed.toFixed(1)}x` : ""),
          // Скорость соседних секций близка — оценка на весь остаток кодирования.
          p.speed ? Math.max(0, (totalDur - (base + p.outTimeSec)) / p.speed) : null,
        ),
    });
    parts.push(partPath);
    doneDur += secDur;
  }

  // Куски закодированы одинаково — финальная склейка без перекодирования.
  emit("encode", 99, "склейка");
  const listPath = path.join(tmpDir, "parts.txt");
  await fsp.writeFile(
    listPath,
    `${parts.map((part) => `file ${concatListPath(part)}`).join("\n")}\n`,
    "utf8",
  );
  await runFfmpeg(
    options.tools.ffmpeg.path,
    ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", request.output],
    { totalDurationSec: totalDur, onProgress: () => emit("encode", 99.5, "склейка") },
  );

  return {
    output: request.output,
    durationSec: totalDur,
    encoder: encoderName,
    srtPath: prepared.srtPath,
    language: transcript?.language ?? null,
  };
}

/**
 * Render a job end to end: prepare (probe, audio prepass, transcription,
 * subtitles), then encode.
 */
export async function renderJob(
  request: RenderRequest,
  options: RenderOptions,
): Promise<RenderResult> {
  return encodeRender(await prepareRender(request, options), options);
}
