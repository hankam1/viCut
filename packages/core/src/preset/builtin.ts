import { presetSchema, type Preset, type PresetInput } from "./schema.js";

/**
 * Presets shipped with ViCut. Users can start from one of these with
 * `vicut preset init <name> --from <builtin>` and tweak the JSON.
 */
const BUILTIN_INPUTS: Record<string, PresetInput> = {
  default: {
    name: "default",
  },
  "youtube": {
    name: "youtube",
    output: { quality: "high" },
    audio: { normalize: true, targetLufs: -14 },
    transition: { type: "fade", durationSec: 0.5 },
  },
  "youtube-subtitled": {
    name: "youtube-subtitled",
    output: { quality: "high" },
    audio: { normalize: true, targetLufs: -14 },
    transition: { type: "fade", durationSec: 0.5 },
    subtitles: {
      enabled: true,
      burnIn: true,
      exportSrt: true,
      style: {
        fontFamily: "Arial",
        fontSize: 48,
        bold: true,
        primaryColor: "#FFFFFF",
        outlineColor: "#000000",
        outlineWidth: 3,
        position: "bottom",
      },
    },
  },
};

export function builtinPresetNames(): string[] {
  return Object.keys(BUILTIN_INPUTS);
}

export function builtinPreset(name: string): Preset | null {
  const input = BUILTIN_INPUTS[name];
  return input ? presetSchema.parse(input) : null;
}
