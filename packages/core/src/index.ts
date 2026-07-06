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
  slideshowSchema,
  TRANSITION_TYPES,
  SUBTITLE_ANIMATIONS,
  type Preset,
  type PresetInput,
  type SubtitleStyle,
  type SubtitleAnimation,
  type SlideshowSettings,
  type TransitionType,
} from "./preset/schema.js";
export { builtinPreset, builtinPresetNames } from "./preset/builtin.js";
export {
  applyOutputOverrides,
  parseOutputOverrides,
  RESOLUTION_PRESETS,
  type OutputOverrides,
} from "./preset/overrides.js";
export {
  loadPreset,
  savePreset,
  renamePreset,
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
  buildAudioDrivenGraph,
  computeTargetSpec,
  escapeFilterPath,
  RenderError,
  type BuiltGraph,
  type BuildGraphOptions,
  type BuildAudioDrivenGraphOptions,
  type ProbedSection,
  type SectionTiming,
  type LoudnormMeasured,
  type TargetSpec,
} from "./render/graph.js";
export {
  specInputs,
  naturalCompare,
  type JobSpec,
  type SectionSpec,
} from "./render/spec.js";
export { prestitchClips, type PrestitchOptions } from "./render/prestitch.js";
export {
  renderJob,
  prepareRender,
  encodeRender,
  type PreparedRender,
  type RenderRequest,
  type RenderResult,
  type RenderOptions,
  type RenderStage,
  type RenderProgressEvent,
} from "./render/pipeline.js";
export { downloadFile, extractArchive, findFileRecursive } from "./net/download.js";
export type {
  Transcript,
  TranscriptSegment,
  TranscriptWord,
  TranscriptionProviderName,
  TranscribeProgress,
} from "./transcribe/types.js";
export {
  groupWordsIntoSegments,
  approximateWords,
  type GroupWordsOptions,
} from "./transcribe/words.js";
export { transcribeAudio, resolveProvider, type TranscribeAudioOptions } from "./transcribe/transcribe.js";
export {
  ensureWhisper,
  ensureModel,
  locateWhisper,
  downloadWhisper,
  whisperDir,
  modelsDir,
  modelPath,
} from "./transcribe/whisperLocal.js";
export { API_PROVIDERS, type ApiProviderName } from "./transcribe/api.js";
export { segmentsToSrt } from "./subtitles/srt.js";
export { segmentsToAss, type AssRenderOptions } from "./subtitles/ass.js";
export { QueueStore, type QueueJob, type JobStatus, type AddJobInput } from "./queue/store.js";
export { runQueue, type QueueRunEvents, type QueueRunSummary } from "./queue/runner.js";
