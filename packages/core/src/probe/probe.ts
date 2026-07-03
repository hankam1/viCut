import { locateFfprobe } from "../ffmpeg/locate.js";
import { run } from "../ffmpeg/run.js";
import type { AudioStreamInfo, MediaInfo, VideoStreamInfo } from "./types.js";

interface RawStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  bit_rate?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
}

interface RawFormat {
  format_name?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
}

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse an ffprobe rational like "30000/1001" into a frame rate. */
function parseFps(stream: RawStream): number | null {
  for (const value of [stream.avg_frame_rate, stream.r_frame_rate]) {
    if (!value) continue;
    const [num, den] = value.split("/").map(Number);
    if (!num || !den) continue;
    const fps = num / den;
    if (Number.isFinite(fps) && fps > 0) return Math.round(fps * 1000) / 1000;
  }
  return null;
}

function toVideoInfo(stream: RawStream): VideoStreamInfo {
  return {
    codec: stream.codec_name ?? "unknown",
    width: stream.width ?? 0,
    height: stream.height ?? 0,
    fps: parseFps(stream),
    pixelFormat: stream.pix_fmt ?? null,
    bitrateBps: toNumber(stream.bit_rate),
  };
}

function toAudioInfo(stream: RawStream): AudioStreamInfo {
  return {
    codec: stream.codec_name ?? "unknown",
    sampleRateHz: toNumber(stream.sample_rate),
    channels: stream.channels ?? null,
    channelLayout: stream.channel_layout ?? null,
    bitrateBps: toNumber(stream.bit_rate),
  };
}

/** Inspect a media file with ffprobe and return its key properties. */
export async function probe(filePath: string, ffprobePath?: string): Promise<MediaInfo> {
  const ffprobe = ffprobePath ?? (await locateFfprobe())?.path;
  if (!ffprobe) {
    throw new Error("ffprobe not found. Run `vicut setup` to download FFmpeg first.");
  }

  const { stdout } = await run(ffprobe, [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  const raw = JSON.parse(stdout) as { format?: RawFormat; streams?: RawStream[] };
  const format = raw.format ?? {};
  const streams = raw.streams ?? [];
  const videoStreams = streams.filter((s) => s.codec_type === "video");
  const audioStreams = streams.filter((s) => s.codec_type === "audio");

  return {
    path: filePath,
    container: format.format_name ?? "unknown",
    durationSec: toNumber(format.duration),
    sizeBytes: toNumber(format.size),
    bitrateBps: toNumber(format.bit_rate),
    video: videoStreams[0] ? toVideoInfo(videoStreams[0]) : null,
    audio: audioStreams[0] ? toAudioInfo(audioStreams[0]) : null,
    videoStreamCount: videoStreams.length,
    audioStreamCount: audioStreams.length,
  };
}
