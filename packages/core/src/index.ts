export { dataDir, binDir } from "./platform/paths.js";
export { run, ProcessError, type RunResult } from "./ffmpeg/run.js";
export {
  locateTool,
  locateFfmpeg,
  locateFfprobe,
  type ToolName,
  type ToolLocation,
} from "./ffmpeg/locate.js";
export {
  downloadFfmpeg,
  type DownloadProgress,
  type ProgressCallback,
} from "./ffmpeg/download.js";
export { ensureTools, type Tools } from "./ffmpeg/ensure.js";
export { probe } from "./probe/probe.js";
export type { MediaInfo, VideoStreamInfo, AudioStreamInfo } from "./probe/types.js";
export {
  presetSchema,
  subtitleStyleSchema,
  TRANSITION_TYPES,
  type Preset,
  type PresetInput,
  type SubtitleStyle,
  type TransitionType,
} from "./preset/schema.js";
export { builtinPreset, builtinPresetNames } from "./preset/builtin.js";
export {
  loadPreset,
  savePreset,
  listUserPresets,
  presetsDir,
  PresetError,
} from "./preset/load.js";
export {
  loadConfig,
  saveConfig,
  resolveApiKeys,
  configPath,
  CONFIG_KEYS,
  type Config,
} from "./config.js";
export { runFfmpeg, type EncodeProgress, type FfmpegRunOptions } from "./ffmpeg/progress.js";
export {
  selectEncoder,
  isEncoderAvailable,
  type SelectedEncoder,
  type EncoderKind,
  type Quality,
  type VideoCodec,
} from "./render/encoders.js";
export {
  buildGraph,
  escapeFilterPath,
  RenderError,
  type BuiltGraph,
  type BuildGraphOptions,
  type LoudnormMeasured,
} from "./render/graph.js";
export {
  renderJob,
  audioPrepass,
  type RenderRequest,
  type RenderResult,
  type RenderOptions,
  type RenderStage,
  type RenderProgressEvent,
} from "./render/pipeline.js";
