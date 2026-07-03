import type { TranscriptSegment } from "../transcribe/types.js";

function srtTime(totalSeconds: number): string {
  const ms = Math.max(0, Math.round(totalSeconds * 1000));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  const pad = (value: number, length: number): string => String(value).padStart(length, "0");
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
}

export function segmentsToSrt(segments: TranscriptSegment[]): string {
  return segments
    .map(
      (segment, index) =>
        `${index + 1}\n${srtTime(segment.startSec)} --> ${srtTime(segment.endSec)}\n${segment.text}\n`,
    )
    .join("\n");
}
