# ViCut Roadmap

Shipped in **v0.1.0**: stitch mode with transitions, audio-driven assembly (speed-fitted clips + image slideshows), auto-subtitles (local whisper.cpp / Groq / OpenAI) with styled burn-in and `.srt`, EBU R128 loudness normalization, effects, presets with per-job output overrides, persistent render queue, desktop app (Windows/macOS) and CLI.

Shipped in **v0.2.0**: karaoke subtitles (word-by-word appear/highlight timed to speech, CapCut-style), system font picker with search, text style presets, Ken Burns for slideshows (zoom strength/speed settings), drag & drop onto wizard section slots, preset import/export, in-app updates from GitHub Releases, pipelined queue (next job transcribes while the current one encodes).

## Editing engine

- **Silence / pause removal** (jump cuts) with configurable thresholds
- **Transitions between sections** in audio-driven mode (currently hard cuts)
- **Pan directions for Ken Burns** (currently center zoom in/out alternation)
- **Background music** with sidechain ducking under speech
- **Watermark / logo overlay**, intro & outro clips from the preset
- **Filler-word removal** («эээ», «uhm») driven by the transcript
- **Subtitle translation** (second `.srt` in another language)
- **Vertical export** (9:16 crop preset for Shorts/Reels from the same project)

## Desktop app

- Real first-frame **thumbnails** in queue cards
- **History** screen (finished jobs archive with stats)
- **Edit a queued job** before it starts (change preset/output)
- **English localization** (RU is the only UI language today)
- System **notification** when the queue finishes

## Distribution

- **Code signing** (Windows SmartScreen / macOS notarization)
- **Delta updates** (blockmap-based; today the updater downloads the full installer)
