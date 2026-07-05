import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { resolveApiKeys } from "../config.js";
import type { Tools } from "../ffmpeg/ensure.js";
import { dataDir } from "../platform/paths.js";
import { transcribeViaApi } from "./api.js";
import type { Transcript, TranscribeProgress, TranscriptionProviderName } from "./types.js";
import { transcribeWhisperLocal } from "./whisperLocal.js";

export interface TranscribeAudioOptions {
  /** "auto" prefers a configured API key (fastest), then local whisper.cpp. */
  provider: "auto" | TranscriptionProviderName;
  /** ISO 639-1 code or "auto". */
  language: string;
  /** whisper.cpp model for local transcription. */
  model: string;
  durationSec: number;
  /** Request word-level timing (needed for text animation). */
  wordTimestamps?: boolean;
  /** Line capacity used to regroup words into display segments (local whisper). */
  maxSegmentChars?: number;
  tools: Tools;
  onProgress?: (progress: TranscribeProgress) => void;
}

export async function resolveProvider(
  requested: "auto" | TranscriptionProviderName,
): Promise<TranscriptionProviderName> {
  if (requested !== "auto") return requested;
  const keys = await resolveApiKeys();
  if (keys.groq) return "groq";
  if (keys.openai) return "openai";
  return "whisper-local";
}

/** Transcribe a 16 kHz mono WAV with the configured provider. */
export async function transcribeAudio(
  wavPath: string,
  options: TranscribeAudioOptions,
): Promise<Transcript> {
  const provider = await resolveProvider(options.provider);

  if (provider === "groq" || provider === "openai") {
    const keys = await resolveApiKeys();
    const apiKey = provider === "groq" ? keys.groq : keys.openai;
    if (!apiKey) {
      throw new Error(
        `no API key for ${provider} — set it with \`vicut config set ${provider}ApiKey <key>\``,
      );
    }
    const tmpDir = path.join(dataDir(), "tmp", `transcribe-${crypto.randomUUID()}`);
    await fsp.mkdir(tmpDir, { recursive: true });
    try {
      return await transcribeViaApi(wavPath, {
        provider,
        apiKey,
        language: options.language,
        wordTimestamps: options.wordTimestamps,
        ffmpegPath: options.tools.ffmpeg.path,
        durationSec: options.durationSec,
        tmpDir,
        onProgress: options.onProgress,
      });
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  }

  return transcribeWhisperLocal(wavPath, {
    model: options.model,
    language: options.language,
    wordTimestamps: options.wordTimestamps,
    maxSegmentChars: options.maxSegmentChars,
    onProgress: options.onProgress,
  });
}
