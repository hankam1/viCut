export interface TranscriptWord {
  startSec: number;
  endSec: number;
  text: string;
}

export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
  /** Word-level timing, present when the transcription requested it. */
  words?: TranscriptWord[];
}

export interface Transcript {
  /** Detected or requested language (ISO 639-1), null when unknown. */
  language: string | null;
  segments: TranscriptSegment[];
}

export type TranscriptionProviderName = "whisper-local" | "groq" | "openai";

export interface TranscribeProgress {
  phase: "download-whisper" | "download-model" | "prepare" | "upload" | "transcribe";
  /** 0-100, null when indeterminate. */
  percent: number | null;
  detail?: string;
}
