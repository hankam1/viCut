import { run } from "../ffmpeg/run.js";

export type Quality = "high" | "medium" | "low";
export type VideoCodec = "h264" | "hevc";
export type EncoderKind = "nvenc" | "videotoolbox" | "software";

export interface SelectedEncoder {
  kind: EncoderKind;
  /** FFmpeg encoder name, e.g. "h264_nvenc". */
  name: string;
  /** Complete video codec args including -c:v. */
  args: string[];
}

const ENCODER_NAMES: Record<VideoCodec, Record<EncoderKind, string>> = {
  h264: { nvenc: "h264_nvenc", videotoolbox: "h264_videotoolbox", software: "libx264" },
  hevc: { nvenc: "hevc_nvenc", videotoolbox: "hevc_videotoolbox", software: "libx265" },
};

/**
 * A listed encoder is not necessarily usable (nvenc shows up without a
 * working GPU), so availability is checked with a tiny real encode.
 */
async function encoderWorks(ffmpegPath: string, encoder: string): Promise<boolean> {
  try {
    await run(ffmpegPath, [
      "-hide_banner",
      "-loglevel", "error",
      "-f", "lavfi",
      "-i", "color=c=black:s=256x256:d=0.3:r=30",
      "-frames:v", "3",
      "-c:v", encoder,
      "-f", "null",
      "-",
    ]);
    return true;
  } catch {
    return false;
  }
}

const availabilityCache = new Map<string, boolean>();

export async function isEncoderAvailable(ffmpegPath: string, encoder: string): Promise<boolean> {
  const key = `${ffmpegPath}|${encoder}`;
  const cached = availabilityCache.get(key);
  if (cached !== undefined) return cached;
  const works = await encoderWorks(ffmpegPath, encoder);
  availabilityCache.set(key, works);
  return works;
}

function encoderArgs(name: string, quality: Quality): string[] {
  switch (name) {
    case "h264_nvenc": {
      const cq = { high: "19", medium: "23", low: "28" }[quality];
      return ["-c:v", name, "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", cq, "-b:v", "0", "-spatial-aq", "1"];
    }
    case "hevc_nvenc": {
      const cq = { high: "21", medium: "25", low: "30" }[quality];
      return ["-c:v", name, "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", cq, "-b:v", "0", "-spatial-aq", "1", "-tag:v", "hvc1"];
    }
    case "h264_videotoolbox": {
      const q = { high: "65", medium: "55", low: "45" }[quality];
      return ["-c:v", name, "-q:v", q];
    }
    case "hevc_videotoolbox": {
      const q = { high: "65", medium: "55", low: "45" }[quality];
      return ["-c:v", name, "-q:v", q, "-tag:v", "hvc1"];
    }
    case "libx264": {
      const crf = { high: "18", medium: "21", low: "26" }[quality];
      const speed = { high: "slow", medium: "medium", low: "fast" }[quality];
      return ["-c:v", name, "-preset", speed, "-crf", crf];
    }
    case "libx265": {
      const crf = { high: "20", medium: "23", low: "28" }[quality];
      return ["-c:v", name, "-preset", "medium", "-crf", crf, "-tag:v", "hvc1"];
    }
    default:
      throw new Error(`no argument mapping for encoder ${name}`);
  }
}

/**
 * Pick a working encoder. "auto" prefers hardware (NVENC on Windows/Linux,
 * VideoToolbox on macOS) and silently falls back to software; an explicitly
 * requested hardware encoder that doesn't work is an error.
 */
export async function selectEncoder(
  ffmpegPath: string,
  codec: VideoCodec,
  requested: "auto" | EncoderKind,
  quality: Quality,
): Promise<SelectedEncoder> {
  const hardwareKind: EncoderKind = process.platform === "darwin" ? "videotoolbox" : "nvenc";
  const kinds: EncoderKind[] =
    requested === "auto"
      ? [hardwareKind, "software"]
      : [requested];

  for (const kind of kinds) {
    const name = ENCODER_NAMES[codec][kind];
    if (await isEncoderAvailable(ffmpegPath, name)) {
      return { kind, name, args: encoderArgs(name, quality) };
    }
  }

  throw new Error(
    requested === "auto"
      ? `no working ${codec} encoder found (tried ${kinds.map((k) => ENCODER_NAMES[codec][k]).join(", ")})`
      : `requested encoder ${ENCODER_NAMES[codec][requested as EncoderKind]} is not available on this machine`,
  );
}
