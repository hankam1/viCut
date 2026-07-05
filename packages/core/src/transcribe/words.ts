import type { TranscriptSegment, TranscriptWord } from "./types.js";

export interface GroupWordsOptions {
  /** Max characters per display segment (line capacity of the subtitle style). */
  maxChars?: number;
  maxDurationSec?: number;
  /** Silence between words that forces a new segment. */
  maxGapSec?: number;
}

const SENTENCE_END = /[.!?…]["»)]?$/;

/**
 * Group word-level timing into display segments: break on line capacity,
 * duration, silence gaps and sentence-ending punctuation.
 */
export function groupWordsIntoSegments(
  words: TranscriptWord[],
  options: GroupWordsOptions = {},
): TranscriptSegment[] {
  const maxChars = options.maxChars ?? 60;
  const maxDurationSec = options.maxDurationSec ?? 5.5;
  const maxGapSec = options.maxGapSec ?? 1;

  const segments: TranscriptSegment[] = [];
  let current: TranscriptWord[] = [];
  let chars = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    segments.push({
      startSec: current[0]!.startSec,
      endSec: current[current.length - 1]!.endSec,
      text: current.map((word) => word.text).join(" "),
      words: current,
    });
    current = [];
    chars = 0;
  };

  for (const word of words) {
    const prev = current[current.length - 1];
    if (prev) {
      const tooLong = chars + 1 + word.text.length > maxChars;
      const tooSlow = word.endSec - current[0]!.startSec > maxDurationSec;
      const gap = word.startSec - prev.endSec > maxGapSec;
      if (tooLong || tooSlow || gap) flush();
    }
    current.push(word);
    chars += (current.length > 1 ? 1 : 0) + word.text.length;
    if (SENTENCE_END.test(word.text)) flush();
  }
  flush();
  return segments;
}

/**
 * When a transcript has no word timing, spread the segment's duration across
 * its words proportionally to their length — close enough for text animation.
 */
export function approximateWords(segment: TranscriptSegment): TranscriptWord[] {
  const texts = segment.text.split(/\s+/).filter(Boolean);
  if (texts.length === 0) return [];
  const weights = texts.map((text) => text.length + 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const duration = Math.max(0, segment.endSec - segment.startSec);

  const words: TranscriptWord[] = [];
  let cursor = segment.startSec;
  for (let i = 0; i < texts.length; i++) {
    const end = i === texts.length - 1 ? segment.endSec : cursor + (weights[i]! / total) * duration;
    words.push({ startSec: cursor, endSec: end, text: texts[i]! });
    cursor = end;
  }
  return words;
}
