# ViCut

**Preset-driven automatic video editing.** Drop in your footage, pick a preset, get a finished video — auto-subtitles, transitions, normalized audio and effects included. A batch queue renders videos one after another, each with its own preset.

> ⚠️ Early development — the editing engine is being built first, the desktop app (Windows / macOS) comes next.

## Planned features (v1)

- 🎬 **Clip stitching + transitions** — merge a folder of clips into one video with fade/dissolve transitions
- 💬 **Auto-subtitles** — speech recognition via Whisper (local `whisper.cpp` by default, optional Groq/OpenAI API key for speed), styled burned-in subtitles (ASS) and/or `.srt` sidecar
- 🔊 **Loudness normalization** — broadcast-standard EBU R128 (two-pass `loudnorm`)
- 🎨 **Clip effects** — filters and LUTs applied per preset
- 📋 **Render queue** — jobs run sequentially, each with its own preset; queue survives restarts
- ⚡ **Hardware encoding** — NVENC (NVIDIA) / VideoToolbox (Apple Silicon), `libx264` fallback

## How it works

ViCut is an orchestrator on top of battle-tested native tools: **FFmpeg** does all rendering, **whisper.cpp** does speech recognition. Presets are plain JSON files — easy to version, share and edit.

## Project structure

```
packages/
  core/   — the editing engine (FFmpeg orchestration, probing, presets, queue)
  cli/    — command-line interface for the engine
apps/
  desktop — Electron app (planned)
```

## Development

```sh
pnpm install
pnpm build
```

Requires Node.js ≥ 22 and pnpm ≥ 9.

## License

[MIT](LICENSE)
