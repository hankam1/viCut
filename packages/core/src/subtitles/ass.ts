import type { SubtitleStyle } from "../preset/schema.js";
import type { TranscriptSegment, TranscriptWord } from "../transcribe/types.js";
import { approximateWords } from "../transcribe/words.js";

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

/** #RRGGBB → inline override color &HBBGGRR& (no alpha, as \1c expects). */
function assColorTag(hex: string): string {
  return `&H${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}&`.toUpperCase();
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

/** Greedy wrap of words into at most maxLines lines (arrays of word indices). */
function wrapIntoLines(words: string[], maxChars: number, maxLines: number): number[][] {
  const lines: number[][] = [];
  let current: number[] = [];
  let chars = 0;
  for (let i = 0; i < words.length; i++) {
    const extra = (current.length > 0 ? 1 : 0) + words[i]!.length;
    if (chars + extra > maxChars && current.length > 0) {
      lines.push(current);
      current = [];
      chars = 0;
    }
    current.push(i);
    chars += (current.length > 1 ? 1 : 0) + words[i]!.length;
  }
  if (current.length > 0) lines.push(current);
  while (lines.length > maxLines) {
    const last = lines.pop()!;
    lines[lines.length - 1]!.push(...last);
  }
  return lines;
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

interface AssEvent {
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Word-by-word events for one segment: at word i's start time the line is
 * re-rendered with words 0..i visible (appear) and/or word i colored
 * (highlight). Line breaks come from the full line's wrap, so the text does
 * not reflow as words appear.
 */
function animatedEvents(segment: TranscriptSegment, style: SubtitleStyle): AssEvent[] {
  const source =
    segment.words && segment.words.length > 0 ? segment.words : approximateWords(segment);
  const words: TranscriptWord[] = [];
  for (const word of source) {
    const text = sanitize(style.uppercase ? word.text.toUpperCase() : word.text).trim();
    if (text) words.push({ ...word, text });
  }
  if (words.length === 0) return [];

  const reveal = style.animation === "appear" || style.animation === "appear-highlight";
  const highlight = style.animation === "highlight" || style.animation === "appear-highlight";
  const lines = wrapIntoLines(
    words.map((word) => word.text),
    style.maxLineChars,
    style.maxLines,
  );
  const highlightOn = `{\\1c${assColorTag(style.highlightColor)}}`;
  const highlightOff = `{\\1c${assColorTag(style.primaryColor)}}`;

  // Word start times, clamped to the segment and made monotonic.
  const starts = words.map((word) =>
    Math.min(Math.max(word.startSec, segment.startSec), segment.endSec),
  );
  for (let i = 1; i < starts.length; i++) starts[i] = Math.max(starts[i]!, starts[i - 1]!);

  const events: AssEvent[] = [];
  // Highlight-only mode: show the plain line from segment start until speech begins.
  if (!reveal && starts[0]! - segment.startSec > 0.05) {
    const plain = lines
      .map((line) => line.map((index) => words[index]!.text).join(" "))
      .join("\\N");
    events.push({ startSec: segment.startSec, endSec: starts[0]!, text: plain });
  }
  for (let active = 0; active < words.length; active++) {
    const startSec = starts[active]!;
    const endSec = active < words.length - 1 ? starts[active + 1]! : segment.endSec;
    if (endSec - startSec < 0.001) continue; // word pops in together with the next one

    const rendered = lines
      .map((line) => {
        const visible = reveal ? line.filter((index) => index <= active) : line;
        return visible
          .map((index) =>
            highlight && index === active
              ? `${highlightOn}${words[index]!.text}${highlightOff}`
              : words[index]!.text,
          )
          .join(" ");
      })
      .filter((line) => line.length > 0)
      .join("\\N");
    if (rendered) events.push({ startSec, endSec, text: rendered });
  }
  return events;
}

/** Static single event: the whole segment text, wrapped. */
function staticEvent(segment: TranscriptSegment, style: SubtitleStyle): AssEvent[] {
  const raw = style.uppercase ? segment.text.toUpperCase() : segment.text;
  const words = sanitize(raw).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const text = wrapIntoLines(words, style.maxLineChars, style.maxLines)
    .map((line) => line.map((index) => words[index]!).join(" "))
    .join("\\N");
  return [{ startSec: segment.startSec, endSec: segment.endSec, text }];
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

  const events = segments
    .flatMap((segment) =>
      style.animation === "none" ? staticEvent(segment, style) : animatedEvents(segment, style),
    )
    .map(
      (event) =>
        `Dialogue: 0,${assTime(event.startSec)},${assTime(event.endSec)},ViCut,,0,0,0,,${event.text}`,
    );

  return `${[...header, ...events].join("\n")}\n`;
}
