import type { Command } from "commander";
import pc from "picocolors";
import { ensureModel, ensureTools, ensureWhisper, type DownloadProgress } from "@vicut/core";
import { formatBytes } from "../format.js";

export function registerSetup(program: Command): void {
  program
    .command("setup")
    .description("Download FFmpeg (and optionally whisper.cpp) so ViCut is ready to run")
    .option("-f, --force", "re-download even if tools are already present")
    .option("-w, --whisper", "also set up local transcription (whisper.cpp + model)")
    .option("-m, --model <model>", "whisper model to download with --whisper", "large-v3-turbo")
    .action(async (options: { force?: boolean; whisper?: boolean; model: string }) => {
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
      currentFile = "";

      console.log(`${pc.green("✓")} ffmpeg   ${pc.dim(tools.ffmpeg.path)}`);
      console.log(`           ${pc.dim(tools.ffmpeg.version)}`);
      console.log(`${pc.green("✓")} ffprobe  ${pc.dim(tools.ffprobe.path)}`);
      console.log(`           ${pc.dim(tools.ffprobe.version)}`);

      if (options.whisper) {
        const whisperPath = await ensureWhisper(renderProgress);
        if (currentFile) process.stdout.write("\n");
        currentFile = "";
        console.log(`${pc.green("✓")} whisper  ${pc.dim(whisperPath)}`);

        const modelFile = await ensureModel(options.model, renderProgress);
        if (currentFile) process.stdout.write("\n");
        currentFile = "";
        console.log(`${pc.green("✓")} model    ${pc.dim(modelFile)}`);
      }
    });
}
