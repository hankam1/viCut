import { downloadFfmpeg, type ProgressCallback } from "./download.js";
import { locateFfmpeg, locateFfprobe, type ToolLocation } from "./locate.js";

export interface Tools {
  ffmpeg: ToolLocation;
  ffprobe: ToolLocation;
}

/**
 * Make sure ffmpeg and ffprobe are available, downloading them into ViCut's
 * bin dir when missing. Pass `force` to re-download even if already present.
 */
export async function ensureTools(options?: {
  force?: boolean;
  onProgress?: ProgressCallback;
}): Promise<Tools> {
  if (!options?.force) {
    const [ffmpeg, ffprobe] = await Promise.all([locateFfmpeg(), locateFfprobe()]);
    if (ffmpeg && ffprobe) return { ffmpeg, ffprobe };
  }

  await downloadFfmpeg(options?.onProgress);

  const [ffmpeg, ffprobe] = await Promise.all([locateFfmpeg(), locateFfprobe()]);
  if (!ffmpeg || !ffprobe) {
    throw new Error("FFmpeg download finished but the binaries are not runnable.");
  }
  return { ffmpeg, ffprobe };
}
