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

/** Word-level text animation, timed to speech (CapCut-style). */
export const SUBTITLE_ANIMATIONS = ["none", "appear", "highlight", "appear-highlight"] as const;

export const subtitleStyleSchema = z.object({
  fontFamily: z.string().default("Arial"),
  /** Font size at 1080p; scales proportionally with output height. */
  fontSize: z.number().int().min(8).max(200).default(48),
  bold: z.boolean().default(true),
  uppercase: z.boolean().default(false),
  primaryColor: hexColor.default("#FFFFFF"),
  outlineColor: hexColor.default("#000000"),
  outlineWidth: z.number().min(0).max(10).default(3),
  shadow: z.number().min(0).max(10).default(0),
  /**
   * "appear" — words show up as they are spoken; "highlight" — the whole line
   * is visible and the current word is colored; "appear-highlight" — both.
   */
  animation: z.enum(SUBTITLE_ANIMATIONS).default("none"),
  /** Color of the currently spoken word in highlight animations. */
  highlightColor: hexColor.default("#2EC4B6"),
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

/** Pendulum swing: the frame slowly rocks side to side (CapCut-style). */
export const slideshowPendulumSchema = z.object({
  enabled: z.boolean().default(false),
  /** Peak tilt, degrees. */
  angleDeg: z.number().min(0.5).max(12).default(3),
  /** Seconds for a full left-right-left swing. */
  periodSec: z.number().min(1).max(20).default(6),
  /** Rotation anchor: swing around the frame center or one of its edges. */
  pivot: z.enum(["center", "top", "bottom"]).default("center"),
  /** Alternate the initial swing direction on every image. */
  alternate: z.boolean().default(true),
});

/** Slow drift across the image — the "pan" half of classic Ken Burns. */
export const slideshowPanSchema = z.object({
  enabled: z.boolean().default(false),
  /** Fraction of the frame the window travels while an image is shown. */
  amount: z.number().min(0.02).max(0.3).default(0.08),
  /** Drift axis; "alternate" switches per image. */
  axis: z.enum(["horizontal", "vertical", "alternate"]).default("alternate"),
});

/** Subtle handheld-camera wobble (smooth pseudo-noise, not jitter). */
export const slideshowShakeSchema = z.object({
  enabled: z.boolean().default(false),
  intensity: z.number().min(0.2).max(3).default(1),
  speed: z.number().min(0.25).max(3).default(1),
});

export const slideshowVignetteSchema = z.object({
  enabled: z.boolean().default(false),
  /** 0..1 — how much the frame corners darken. */
  strength: z.number().min(0.1).max(1).default(0.4),
});

export const slideshowGrainSchema = z.object({
  enabled: z.boolean().default(false),
  /** Film-grain noise strength. */
  strength: z.number().min(1).max(30).default(8),
});

/** Slideshow behavior for image sections in audio-driven jobs. */
export const slideshowSchema = z.object({
  /** Ken Burns: slow zoom on each image instead of a static frame. */
  kenBurns: z.boolean().default(true),
  /** Max zoom an image reaches (1.15 = +15%). */
  zoom: z.number().min(1.02).max(2).default(1.15),
  /** Zoom pace: 1 reaches max zoom exactly as the image ends; higher is faster, then holds. */
  speed: z.number().min(0.25).max(4).default(1),
  /** Crossfade between neighboring images, seconds; 0 = hard cuts. */
  crossfadeSec: z.number().min(0).max(2).default(0.5),
  pendulum: slideshowPendulumSchema.prefault({}),
  pan: slideshowPanSchema.prefault({}),
  shake: slideshowShakeSchema.prefault({}),
  vignette: slideshowVignetteSchema.prefault({}),
  grain: slideshowGrainSchema.prefault({}),
});

export const effectsSchema = z.object({
  /**
   * Zoom into source clips (1.15 = crop 15% of the edges) — hides watermarks
   * near the borders (e.g. AI-video badges). Images are not affected.
   */
  inputZoom: z.number().min(1).max(1.5).default(1),
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
  slideshow: slideshowSchema.prefault({}),
});

export type Preset = z.infer<typeof presetSchema>;
export type PresetInput = z.input<typeof presetSchema>;
export type SubtitleStyle = z.infer<typeof subtitleStyleSchema>;
export type SlideshowSettings = z.infer<typeof slideshowSchema>;
export type SubtitleAnimation = (typeof SUBTITLE_ANIMATIONS)[number];
export type TransitionType = (typeof TRANSITION_TYPES)[number];
