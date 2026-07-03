import type { Command } from "commander";
import pc from "picocolors";
import { probe } from "@vicut/core";
import { formatBitrate, formatBytes, formatDuration } from "../format.js";

export function registerProbe(program: Command): void {
  program
    .command("probe")
    .description("Show key media properties of a video/audio file")
    .argument("<file>", "path to the media file")
    .option("--json", "print machine-readable JSON")
    .action(async (file: string, options: { json?: boolean }) => {
      const info = await probe(file);

      if (options.json) {
        console.log(JSON.stringify(info, null, 2));
        return;
      }

      const formatLine = [
        info.container,
        info.durationSec !== null ? formatDuration(info.durationSec) : null,
        info.sizeBytes !== null ? formatBytes(info.sizeBytes) : null,
        info.bitrateBps !== null ? formatBitrate(info.bitrateBps) : null,
      ]
        .filter(Boolean)
        .join(" · ");

      console.log(pc.bold(info.path));
      console.log(`  ${pc.dim("Container")}  ${formatLine}`);

      if (info.video) {
        const v = info.video;
        const line = [
          `${v.codec} ${v.width}x${v.height}`,
          v.fps !== null ? `${v.fps} fps` : null,
          v.pixelFormat,
          v.bitrateBps !== null ? formatBitrate(v.bitrateBps) : null,
        ]
          .filter(Boolean)
          .join(" · ");
        console.log(`  ${pc.dim("Video")}      ${line}`);
      } else {
        console.log(`  ${pc.dim("Video")}      ${pc.yellow("none")}`);
      }

      if (info.audio) {
        const a = info.audio;
        const line = [
          a.codec,
          a.sampleRateHz !== null ? `${a.sampleRateHz} Hz` : null,
          a.channels !== null
            ? `${a.channels} ch${a.channelLayout ? ` (${a.channelLayout})` : ""}`
            : null,
          a.bitrateBps !== null ? formatBitrate(a.bitrateBps) : null,
        ]
          .filter(Boolean)
          .join(" · ");
        console.log(`  ${pc.dim("Audio")}      ${line}`);
      } else {
        console.log(`  ${pc.dim("Audio")}      ${pc.yellow("none")}`);
      }

      if (info.videoStreamCount > 1 || info.audioStreamCount > 1) {
        console.log(
          `  ${pc.dim("Streams")}    ${info.videoStreamCount} video, ${info.audioStreamCount} audio`,
        );
      }
    });
}
