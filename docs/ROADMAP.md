# ViCut Roadmap

Shipped in **v0.1.0**: stitch mode with transitions, audio-driven assembly (speed-fitted clips + image slideshows), auto-subtitles (local whisper.cpp / Groq / OpenAI) with styled burn-in and `.srt`, EBU R128 loudness normalization, effects, presets with per-job output overrides, persistent render queue, desktop app (Windows/macOS) and CLI.

## Editing engine

- **Silence / pause removal** (jump cuts) with configurable thresholds
- **Transitions between sections** in audio-driven mode (currently hard cuts)
- **Ken Burns effect** for image slideshows (slow zoom/pan instead of static stills)
- **Background music** with sidechain ducking under speech
- **Watermark / logo overlay**, intro & outro clips from the preset
- **Karaoke-style subtitles** (word-by-word highlight — whisper already gives word timestamps)
- **Filler-word removal** («эээ», «uhm») driven by the transcript
- **Subtitle translation** (second `.srt` in another language)
- **Vertical export** (9:16 crop preset for Shorts/Reels from the same project)

## Desktop app

- Real first-frame **thumbnails** in queue cards
- **History** screen (finished jobs archive with stats)
- **Edit a queued job** before it starts (change preset/output)
- Drag & drop **directly onto section slots** in the wizard
- **English localization** (RU is the only UI language today)
- System **notification** when the queue finishes
- **Pipeline parallelism**: transcribe the next job while the current one encodes

## Distribution

- **Auto-updates** (electron-updater + GitHub Releases)
- **Code signing** (Windows SmartScreen / macOS notarization)
- Preset **import/export buttons** for sharing (presets are already plain JSON files)
