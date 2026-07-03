#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { ensureTools, probe, type DownloadProgress } from "@vicut/core";
import { formatBitrate, formatBytes, formatDuration } from "./format.js";

const program = new Command();

program
  .name("vicut")
  .description("Preset-driven automatic video editing")
  .version("0.1.0");

program
  .command("setup")
  .description("Download FFmpeg and verify all tools are ready")
  .option("-f, --force", "re-download even if tools are already present")
  .action(async (options: { force?: boolean }) => {
    let currentFile = "";
    let lastRender = 0;

    const renderProgress = (p: DownloadProgress): void => {
      const now = Date.now();
      const finished = p.totalBytes !== null && p.receivedBytes >= p.totalBytes;
      if (now - lastRender < 100 && !finished) return;
      lastRender = now;
      if (p.file !== currentFile) {
        if (currentFile) process.stdout.write("\n");
        currentFile = p.file;
      }
      const total = p.totalBytes ? formatBytes(p.totalBytes) : "?";
      const percent = p.totalBytes
        ? ` ${String(Math.floor((p.receivedBytes / p.totalBytes) * 100)).padStart(3)}%`
        : "";
      process.stdout.write(
        `\r${pc.cyan("↓")} ${p.file}  ${formatBytes(p.receivedBytes)} / ${total}${percent}   `,
      );
    };

    const tools = await ensureTools({ force: options.force, onProgress: renderProgress });
    if (currentFile) process.stdout.write("\n");

    console.log(`${pc.green("✓")} ffmpeg   ${pc.dim(tools.ffmpeg.path)}`);
    console.log(`           ${pc.dim(tools.ffmpeg.version)}`);
    console.log(`${pc.green("✓")} ffprobe  ${pc.dim(tools.ffprobe.path)}`);
    console.log(`           ${pc.dim(tools.ffprobe.version)}`);
  });

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
        a.channels !== null ? `${a.channels} ch${a.channelLayout ? ` (${a.channelLayout})` : ""}` : null,
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

program.parseAsync().catch((error: unknown) => {
  console.error(pc.red("Error:"), error instanceof Error ? error.message : error);
  process.exit(1);
});
