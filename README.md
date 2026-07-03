# ViCut

**Preset-driven automatic video editing.** Drop in your footage, pick a preset, get a finished video — auto-subtitles, transitions, normalized audio and effects included. A batch queue renders videos one after another, each with its own preset.

> The editing engine and CLI are working today. A desktop app (Windows / macOS) built on the same engine is next.

## Features

- 🎬 **Clip stitching + transitions** — merge clips into one video with `fade`, `dissolve`, wipes and slides (FFmpeg xfade); mixed resolutions and frame rates are normalized automatically
- 💬 **Auto-subtitles** — Whisper speech recognition: local `whisper.cpp` (auto-downloaded, CUDA build on NVIDIA GPUs) or cloud via your Groq / OpenAI API key; styled burned-in subtitles (libass) and/or an `.srt` sidecar
- 🔊 **Loudness normalization** — broadcast-standard EBU R128 two-pass `loudnorm` (−14 LUFS by default, the YouTube reference)
- 🎨 **Effects** — brightness / contrast / saturation / gamma, sharpening, and `.cube` LUTs
- 📋 **Render queue** — jobs run sequentially, each with its own preset; the queue lives in SQLite and survives restarts
- ⚡ **Hardware encoding** — NVENC (NVIDIA) / VideoToolbox (Apple Silicon) picked automatically, `libx264` fallback

## Quick start

```sh
pnpm install && pnpm build

# one-time: download FFmpeg (if missing) and local Whisper + model
node packages/cli/dist/index.js setup --whisper

# render three clips into one video with transitions and subtitles
vicut render intro.mp4 main.mp4 outro.mp4 -p youtube-subtitled -o final.mp4
```

> During development run the CLI as `node packages/cli/dist/index.js …` or `pnpm cli …`.

## Commands

| Command | What it does |
|---|---|
| `vicut setup [--whisper] [--model <m>]` | Download FFmpeg and (optionally) whisper.cpp + a model |
| `vicut probe <file>` | Show media info: codecs, resolution, fps, audio |
| `vicut render <inputs...> -p <preset> -o <out>` | Render clips into a finished video |
| `vicut transcribe <file> [-p provider] [-l lang]` | Speech → `.srt` subtitles |
| `vicut preset list / show / init / dir` | Manage presets |
| `vicut queue add / list / run / cancel / remove / clear` | Manage the render queue |
| `vicut config set groqApiKey <key>` | Store API keys for cloud transcription |

## Presets

A preset is a JSON file describing everything ViCut should do to your footage. Start from a builtin and edit:

```sh
vicut preset init my-preset --from youtube-subtitled
```

```jsonc
{
  "name": "my-preset",
  "output": { "quality": "high", "videoCodec": "h264", "encoder": "auto" },
  "audio": { "normalize": true, "targetLufs": -14 },
  "transition": { "type": "fade", "durationSec": 0.5 },
  "subtitles": {
    "enabled": true,
    "provider": "auto",        // groq/openai if a key is set, else local whisper
    "burnIn": true,            // styled subtitles in the picture
    "exportSrt": true,         // .srt file next to the output
    "style": { "fontFamily": "Arial", "fontSize": 48, "position": "bottom" }
  },
  "effects": { "saturation": 1.1, "sharpen": 0.4, "lut": null }
}
```

## Transcription providers

| Provider | Speed (1 h video) | Cost | Notes |
|---|---|---|---|
| `whisper-local` (default) | ~1–3 min on an NVIDIA GPU, ~3–6 min on Apple Silicon | free | models auto-download; CUDA build picked automatically |
| `groq` | under a minute | ~$0.04 / hour of audio | needs `vicut config set groqApiKey …` |
| `openai` | a few minutes | ~$0.36 / hour of audio | needs `vicut config set openaiApiKey …` |

## How it works

ViCut is a TypeScript orchestrator on top of battle-tested native tools: **FFmpeg** does all decoding/encoding/filtering, **whisper.cpp** does speech recognition. One audio prepass both measures loudness and produces the transcription track, so subtitles always line up with the final stitched timeline.

```
packages/
  core/   — the engine: presets, probing, filter graphs, transcription, subtitles, queue
  cli/    — the vicut command-line interface
apps/
  desktop — Electron app (planned)
```

## Development

```sh
pnpm install
pnpm build        # compile all packages
pnpm cli -- …     # run the CLI from source (tsx)
```

Requires Node.js ≥ 22 and pnpm ≥ 9. FFmpeg and whisper.cpp are downloaded on demand — no manual installation needed on Windows; on macOS install whisper.cpp with `brew install whisper-cpp` for local transcription.

## License

[MIT](LICENSE)
