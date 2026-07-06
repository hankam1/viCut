import fsp from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "../ffmpeg/progress.js";
import type { Preset } from "../preset/schema.js";
import { probe } from "../probe/probe.js";
import type { MediaInfo } from "../probe/types.js";
import {
  concatListPath,
  videoNormalizeChain,
  type ProbedSection,
  type TargetSpec,
} from "./graph.js";

export interface PrestitchOptions {
  section: ProbedSection;
  preset: Preset;
  target: TargetSpec;
  tmpDir: string;
  /** Уникальный ключ для имён временных файлов (номер секции). */
  key: string;
  ffmpegPath: string;
  ffprobePath: string;
  /** Аргументы видеокодека финального рендера — куски кодируются ими же. */
  encoderArgs: string[];
  onProgress?: (detail: string) => void;
}

/**
 * Пред-сборка секции клипов с переходами: тела клипов и короткие куски
 * переходов рендерятся отдельными запусками ffmpeg (максимум два входа и пара
 * секунд наложения за раз — память плоская) и склеиваются без перекодирования.
 * Цепочка xfade в одном графе не годится: framesync тянет все клипы
 * одновременно, и кадры поздних клипов копятся в памяти до гигабайтов.
 *
 * Длительность перехода берётся в исходном времени так, чтобы после спидфита
 * секции под аудио переход на экране длился ровно как задано в пресете.
 *
 * Возвращает MediaInfo сшитого файла или null, когда переходы не нужны.
 */
export async function prestitchClips(options: PrestitchOptions): Promise<MediaInfo | null> {
  const { section, preset, target, tmpDir, key } = options;
  const infos = section.visuals.infos;
  const n = infos.length;
  const transition = preset.transition;
  if (transition.type === "none" || n < 2) return null;

  const audioDur = section.audio.durationSec!;
  const durations = infos.map((info) => info.durationSec!);
  const clipsTotal = durations.reduce((sum, d) => sum + d, 0);
  // Вывод: speed = (total − (n−1)·f)/audioDur и f = T·speed ⇒
  // f = T·total/(audioDur + (n−1)·T). Клэмп: у каждого клипа должно остаться
  // тело между двумя переходами.
  let f =
    (transition.durationSec * clipsTotal) /
    (audioDur + (n - 1) * transition.durationSec);
  f = Math.min(f, Math.min(...durations) / 2 - 0.1);
  if (f < 0.05) return null;

  const normalize = videoNormalizeChain(target, preset.effects.inputZoom);
  const pieces: string[] = [];
  const encode = async (args: string[], out: string): Promise<void> => {
    await runFfmpeg(options.ffmpegPath, [
      "-y",
      ...args,
      ...options.encoderArgs,
      "-an",
      out,
    ]);
    pieces.push(out);
  };

  for (let i = 0; i < n; i++) {
    options.onProgress?.(`переходы · клип ${i + 1}/${n}`);
    // Тело клипа — без краёв, которые уходят в переходы.
    const head = i > 0 ? f : 0;
    const tail = i < n - 1 ? f : 0;
    await encode(
      [
        "-i", infos[i]!.path,
        "-filter_complex",
        `[0:v]${normalize},trim=start=${head.toFixed(4)}:end=${(durations[i]! - tail).toFixed(4)},` +
          `setpts=PTS-STARTPTS[v]`,
        "-map", "[v]",
      ],
      path.join(tmpDir, `stitch-${key}-body-${i}.mp4`),
    );
    if (i === n - 1) break;
    // Кусок перехода: хвост клипа i растворяется в голову клипа i+1.
    await encode(
      [
        "-i", infos[i]!.path,
        "-i", infos[i + 1]!.path,
        "-filter_complex",
        `[0:v]${normalize},trim=start=${(durations[i]! - f).toFixed(4)},setpts=PTS-STARTPTS[a];` +
          `[1:v]${normalize},trim=end=${f.toFixed(4)},setpts=PTS-STARTPTS[b];` +
          // format после xfade обязателен: он отдаёт yuv444p, и смена формата
          // между кусками ломает фильтры при декодировании склейки.
          `[a][b]xfade=transition=${transition.type}:duration=${f.toFixed(4)}:offset=0,format=yuv420p[v]`,
        "-map", "[v]",
      ],
      path.join(tmpDir, `stitch-${key}-x-${i}.mp4`),
    );
  }

  // Куски закодированы одинаково — склейка без перекодирования.
  const listPath = path.join(tmpDir, `stitch-${key}-list.txt`);
  await fsp.writeFile(
    listPath,
    `${pieces.map((piece) => `file ${concatListPath(piece)}`).join("\n")}\n`,
    "utf8",
  );
  const stitched = path.join(tmpDir, `stitch-${key}.mp4`);
  await runFfmpeg(options.ffmpegPath, [
    "-y", "-f", "concat", "-safe", "0", "-i", listPath,
    "-c", "copy", stitched,
  ]);
  return probe(stitched, options.ffprobePath);
}
