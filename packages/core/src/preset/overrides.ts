import type { Preset } from "./schema.js";

/** Быстрые оверрайды вывода (мастер задачи / CLI-флаги) поверх пресета. */
export interface OutputOverrides {
  resolution?: "source" | "480p" | "720p" | "1080p" | "1440p" | "2160p";
  fps?: "source" | 30 | 60;
  videoCodec?: "h264" | "hevc";
}

export const RESOLUTION_PRESETS: Record<
  Exclude<NonNullable<OutputOverrides["resolution"]>, "source">,
  { width: number; height: number }
> = {
  "480p": { width: 854, height: 480 },
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
  "2160p": { width: 3840, height: 2160 },
};

/** Копия пресета с применёнными оверрайдами; сам пресет не меняется. */
export function applyOutputOverrides(preset: Preset, overrides?: OutputOverrides): Preset {
  if (!overrides) return preset;
  const output = { ...preset.output };
  if (overrides.resolution) {
    output.resolution =
      overrides.resolution === "source" ? "source" : RESOLUTION_PRESETS[overrides.resolution];
  }
  if (overrides.fps) output.fps = overrides.fps;
  if (overrides.videoCodec) output.videoCodec = overrides.videoCodec;
  return { ...preset, output };
}

/** Разбор CLI-флагов --resolution/--fps/--codec в OutputOverrides. */
export function parseOutputOverrides(flags: {
  resolution?: string;
  fps?: string;
  codec?: string;
}): OutputOverrides {
  const overrides: OutputOverrides = {};
  if (flags.resolution) {
    const value = flags.resolution === "4k" ? "2160p" : flags.resolution;
    if (value !== "source" && !(value in RESOLUTION_PRESETS)) {
      throw new Error(
        `unknown resolution "${flags.resolution}" — use source, 480p, 720p, 1080p, 1440p or 2160p`,
      );
    }
    overrides.resolution = value as OutputOverrides["resolution"];
  }
  if (flags.fps) {
    if (flags.fps !== "source" && flags.fps !== "30" && flags.fps !== "60") {
      throw new Error(`unknown fps "${flags.fps}" — use source, 30 or 60`);
    }
    overrides.fps = flags.fps === "source" ? "source" : (Number(flags.fps) as 30 | 60);
  }
  if (flags.codec) {
    const codec = flags.codec === "h265" ? "hevc" : flags.codec;
    if (codec !== "h264" && codec !== "hevc") {
      throw new Error(`unknown codec "${flags.codec}" — use h264 or hevc`);
    }
    overrides.videoCodec = codec;
  }
  return overrides;
}
