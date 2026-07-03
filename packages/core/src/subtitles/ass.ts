import type { SubtitleStyle } from "../preset/schema.js";
import type { TranscriptSegment } from "../transcribe/types.js";

/** #RRGGBB or #RRGGBBAA → ASS &HAABBGGRR (ASS alpha: 00 opaque, FF transparent). */
function assColor(hex: string): string {
  const rr = hex.slice(1, 3);
  const gg = hex.slice(3, 5);
  const bb = hex.slice(5, 7);
  const alpha =
    hex.length === 9
      ? (255 - Number.parseInt(hex.slice(7, 9), 16)).toString(16).padStart(2, "0")
      : "00";
  return `&H${alpha}${bb}${gg}${rr}`.toUpperCase();
}

function assTime(totalSeconds: number): string {
  const cs = Math.max(0, Math.round(totalSeconds * 100));
  const hours = Math.floor(cs / 360_000);
  const minutes = Math.floor((cs % 360_000) / 6000);
  const seconds = Math.floor((cs % 6000) / 100);
  const centis = cs % 100;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${hours}:${pad(minutes)}:${pad(seconds)}.${String(centis).padStart(2, "0")}`;
}

/** Greedy word wrap into at most maxLines lines joined with ASS hard breaks. */
function wrapText(text: string, maxChars: number, maxLines: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  while (lines.length > maxLines) {
    const last = lines.pop()!;
    lines[lines.length - 1] = `${lines[lines.length - 1]} ${last}`;
  }
  return lines.join("\\N");
}

/** Braces would start ASS override blocks; neutralize them. */
function sanitize(text: string): string {
  return text.replace(/\{/g, "(").replace(/\}/g, ")");
}

const ALIGNMENT: Record<SubtitleStyle["position"], number> = { bottom: 2, center: 5, top: 8 };

export interface AssRenderOptions {
  /** Output video resolution — ASS coordinates are laid out against it. */
  playResX: number;
  playResY: number;
}

/** Render transcript segments as a styled ASS subtitle script for libass burn-in. */
export function segmentsToAss(
  segments: TranscriptSegment[],
  style: SubtitleStyle,
  options: AssRenderOptions,
): string {
  // Style values are authored against 1080p; scale to the actual output.
  const scale = options.playResY / 1080;
  const fontSize = Math.max(8, Math.round(style.fontSize * scale));
  const marginV = Math.round(style.marginVertical * scale);
  const outline = (style.outlineWidth * scale).toFixed(2);
  const shadow = (style.shadow * scale).toFixed(2);
  const marginH = Math.round(60 * scale);

  const header = [
    "[Script Info]",
    "Title: ViCut subtitles",
    "ScriptType: v4.00+",
    `PlayResX: ${options.playResX}`,
    `PlayResY: ${options.playResY}`,
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, " +
      "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, " +
      "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: ViCut,${style.fontFamily},${fontSize},${assColor(style.primaryColor)},${assColor(style.primaryColor)},` +
      `${assColor(style.outlineColor)},&H7F000000,${style.bold ? -1 : 0},0,0,0,100,100,0,0,1,` +
      `${outline},${shadow},${ALIGNMENT[style.position]},${marginH},${marginH},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events = segments.map((segment) => {
    const text = wrapText(sanitize(segment.text), style.maxLineChars, style.maxLines);
    return `Dialogue: 0,${assTime(segment.startSec)},${assTime(segment.endSec)},ViCut,,0,0,0,,${text}`;
  });

  return `${[...header, ...events].join("\n")}\n`;
}
