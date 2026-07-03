import { z } from "zod";

/** Hex color like #RRGGBB or #RRGGBBAA. */
const hexColor = z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "expected #RRGGBB or #RRGGBBAA");

export const resolutionSchema = z.union([
  z.literal("source"),
  z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
]);

export const outputSchema = z.object({
  container: z.literal("mp4").default("mp4"),
  /** "source" keeps the first input's resolution; otherwise scale+pad to fit. */
  resolution: resolutionSchema.default("source"),
  fps: z.union([z.literal("source"), z.number().positive().max(240)]).default("source"),
  videoCodec: z.enum(["h264", "hevc"]).default("h264"),
  /** "auto" picks NVENC → VideoToolbox → software, whichever actually works. */
  encoder: z.enum(["auto", "nvenc", "videotoolbox", "software"]).default("auto"),
  quality: z.enum(["high", "medium", "low"]).default("high"),
  audioBitrateKbps: z.number().int().min(32).max(320).default(192),
});

export const audioSchema = z.object({
  /** EBU R128 two-pass loudness normalization. */
  normalize: z.boolean().default(true),
  /** -14 LUFS is the YouTube reference level. */
  targetLufs: z.number().min(-70).max(-5).default(-14),
});

export const subtitleStyleSchema = z.object({
  fontFamily: z.string().default("Arial"),
  /** Font size at 1080p; scales proportionally with output height. */
  fontSize: z.number().int().min(8).max(200).default(48),
  bold: z.boolean().default(true),
  primaryColor: hexColor.default("#FFFFFF"),
  outlineColor: hexColor.default("#000000"),
  outlineWidth: z.number().min(0).max(10).default(3),
  shadow: z.number().min(0).max(10).default(0),
  position: z.enum(["bottom", "center", "top"]).default("bottom"),
  /** Vertical margin from the screen edge, in pixels at 1080p. */
  marginVertical: z.number().int().min(0).max(400).default(64),
  maxLineChars: z.number().int().min(10).max(120).default(42),
  maxLines: z.number().int().min(1).max(4).default(2),
});

export const subtitlesSchema = z.object({
  enabled: z.boolean().default(false),
  /** "auto" prefers a configured API key (fastest), then local whisper.cpp. */
  provider: z.enum(["auto", "whisper-local", "groq", "openai"]).default("auto"),
  /** ISO 639-1 code ("en", "ru", ...) or "auto" for detection. */
  language: z.string().default("auto"),
  /** Whisper model for local transcription. */
  model: z.enum(["tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"]).default("large-v3-turbo"),
  /** Burn styled subtitles into the picture (libass). */
  burnIn: z.boolean().default(true),
  /** Write an .srt file next to the output. */
  exportSrt: z.boolean().default(true),
  style: subtitleStyleSchema.prefault({}),
});

export const TRANSITION_TYPES = [
  "none",
  "fade",
  "dissolve",
  "fadeblack",
  "fadewhite",
  "wipeleft",
  "wiperight",
  "slideleft",
  "slideright",
  "circleopen",
  "circleclose",
] as const;

export const transitionSchema = z.object({
  /** xfade transition between stitched clips; "none" = hard cut. */
  type: z.enum(TRANSITION_TYPES).default("none"),
  durationSec: z.number().min(0.1).max(5).default(0.5),
});

export const effectsSchema = z.object({
  /** Path to a .cube LUT file, applied to all clips. */
  lut: z.string().nullable().default(null),
  /** eq filter: 0 is neutral for brightness; 1 is neutral for the rest. */
  brightness: z.number().min(-1).max(1).default(0),
  contrast: z.number().min(0).max(3).default(1),
  saturation: z.number().min(0).max(3).default(1),
  gamma: z.number().min(0.1).max(3).default(1),
  /** unsharp amount, 0 = off. */
  sharpen: z.number().min(0).max(2).default(0),
});

export const presetSchema = z.object({
  name: z.string().min(1),
  version: z.literal(1).default(1),
  output: outputSchema.prefault({}),
  audio: audioSchema.prefault({}),
  subtitles: subtitlesSchema.prefault({}),
  transition: transitionSchema.prefault({}),
  effects: effectsSchema.prefault({}),
});

export type Preset = z.infer<typeof presetSchema>;
export type PresetInput = z.input<typeof presetSchema>;
export type SubtitleStyle = z.infer<typeof subtitleStyleSchema>;
export type TransitionType = (typeof TRANSITION_TYPES)[number];
