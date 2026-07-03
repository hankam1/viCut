import fsp from "node:fs/promises";
import path from "node:path";
import { run } from "../ffmpeg/run.js";
import type { Transcript, TranscribeProgress, TranscriptSegment } from "./types.js";

/** Whisper API providers speaking the OpenAI transcription protocol. */
export const API_PROVIDERS = {
  groq: {
    name: "groq" as const,
    baseUrl: "https://api.groq.com/openai/v1",
    model: "whisper-large-v3-turbo",
  },
  openai: {
    name: "openai" as const,
    baseUrl: "https://api.openai.com/v1",
    model: "whisper-1",
  },
};

export type ApiProviderName = keyof typeof API_PROVIDERS;

/** Chunk length keeps each upload well under the 25 MB API file limit. */
const CHUNK_SEC = 1200;

interface ApiResponse {
  language?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
}

export interface ApiTranscribeOptions {
  provider: ApiProviderName;
  apiKey: string;
  /** ISO 639-1 code or "auto". */
  language: string;
  ffmpegPath: string;
  durationSec: number;
  tmpDir: string;
  onProgress?: (progress: TranscribeProgress) => void;
}

/** Transcribe a 16 kHz mono WAV via a cloud Whisper API, chunking long audio. */
export async function transcribeViaApi(
  wavPath: string,
  options: ApiTranscribeOptions,
): Promise<Transcript> {
  const spec = API_PROVIDERS[options.provider];
  const chunkCount = Math.max(1, Math.ceil(options.durationSec / CHUNK_SEC));
  const segments: TranscriptSegment[] = [];
  let language: string | null = null;

  for (let i = 0; i < chunkCount; i++) {
    const chunkStartSec = i * CHUNK_SEC;
    options.onProgress?.({
      phase: "upload",
      percent: (i / chunkCount) * 100,
      detail: chunkCount > 1 ? `part ${i + 1}/${chunkCount}` : undefined,
    });

    const mp3Path = path.join(options.tmpDir, `chunk-${i}.mp3`);
    await run(options.ffmpegPath, [
      "-y",
      "-hide_banner", "-loglevel", "error",
      "-ss", String(chunkStartSec),
      "-t", String(CHUNK_SEC),
      "-i", wavPath,
      "-ac", "1",
      "-b:a", "48k",
      mp3Path,
    ]);

    const form = new FormData();
    form.append("file", new Blob([await fsp.readFile(mp3Path)], { type: "audio/mpeg" }), "audio.mp3");
    form.append("model", spec.model);
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");
    if (options.language !== "auto") form.append("language", options.language);

    const response = await fetch(`${spec.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${options.apiKey}` },
      body: form,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `${spec.name} transcription failed: HTTP ${response.status} ${body.slice(0, 500)}`,
      );
    }

    const json = (await response.json()) as ApiResponse;
    language ??= json.language ?? null;
    for (const segment of json.segments ?? []) {
      const text = segment.text.trim();
      if (text) {
        segments.push({
          startSec: segment.start + chunkStartSec,
          endSec: segment.end + chunkStartSec,
          text,
        });
      }
    }
    await fsp.rm(mp3Path, { force: true });
  }

  return { language, segments };
}
