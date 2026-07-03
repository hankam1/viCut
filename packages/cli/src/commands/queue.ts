import type { Command } from "commander";
import pc from "picocolors";
import {
  ensureTools,
  loadPreset,
  QueueStore,
  runQueue,
  type QueueJob,
} from "@vicut/core";
import { formatDuration } from "../format.js";
import { makeProgressRenderer } from "./render.js";

const STATUS_ICONS: Record<QueueJob["status"], string> = {
  pending: "○",
  running: "◐",
  done: "✓",
  failed: "✗",
  canceled: "−",
};

function statusColor(status: QueueJob["status"], text: string): string {
  switch (status) {
    case "done":
      return pc.green(text);
    case "failed":
      return pc.red(text);
    case "running":
      return pc.cyan(text);
    case "canceled":
      return pc.dim(text);
    default:
      return text;
  }
}

export function registerQueue(program: Command): void {
  const queue = program.command("queue").description("Manage the render queue");

  queue
    .command("add")
    .description("Add a render job to the queue")
    .argument("<inputs...>", "input video file(s), stitched in the given order")
    .requiredOption("-o, --output <file>", "output video file (.mp4)")
    .option("-p, --preset <nameOrPath>", "preset name or path to a preset .json", "default")
    .option("-t, --title <title>", "job title shown in the queue")
    .action(
      async (inputs: string[], options: { output: string; preset: string; title?: string }) => {
        const preset = await loadPreset(options.preset);
        const store = new QueueStore();
        try {
          const job = store.add({ inputs, output: options.output, preset, title: options.title });
          console.log(
            `${pc.green("✓")} job #${job.id} queued: ${pc.bold(job.title)} ` +
              pc.dim(`(${inputs.length} clip${inputs.length > 1 ? "s" : ""}, preset: ${preset.name})`),
          );
          console.log(pc.dim("  run the queue with `vicut queue run`"));
        } finally {
          store.close();
        }
      },
    );

  queue
    .command("list")
    .description("Show all jobs in the queue")
    .action(() => {
      const store = new QueueStore();
      try {
        const jobs = store.list();
        if (jobs.length === 0) {
          console.log(pc.dim("queue is empty — add a job with `vicut queue add`"));
          return;
        }
        for (const job of jobs) {
          const icon = statusColor(job.status, STATUS_ICONS[job.status]);
          let line = `${icon} #${String(job.id).padEnd(3)} ${job.title.padEnd(28)} ${statusColor(job.status, job.status)}`;
          if (job.status === "running" && job.stage) {
            line += pc.dim(`  ${job.stage} ${Math.floor(job.progress)}%`);
          }
          if (job.status === "failed" && job.error) {
            line += pc.red(`  ${job.error.split("\n")[0]?.slice(0, 60)}`);
          }
          console.log(line);
        }
      } finally {
        store.close();
      }
    });

  queue
    .command("run")
    .description("Process the queue: render every pending job in order")
    .action(async () => {
      const tools = await ensureTools();
      const store = new QueueStore();
      try {
        let progress: ReturnType<typeof makeProgressRenderer> | null = null;
        const started = Date.now();
        const summary = await runQueue(store, tools, {
          onJobStart: (job) => {
            progress = makeProgressRenderer();
            console.log(
              `\n${pc.bold(`▶ job #${job.id}`)} ${job.title} ` +
                pc.dim(`(${job.inputs.length} clip${job.inputs.length > 1 ? "s" : ""} → ${job.output})`),
            );
          },
          onJobProgress: (_job, event) => progress?.onEvent(event),
          onJobDone: (_job, result) => {
            progress?.finish();
            console.log(
              `${pc.green("✓")} done · ${formatDuration(result.durationSec)} of video · ${result.encoder}` +
                (result.srtPath ? pc.dim(`  subtitles: ${result.srtPath}`) : ""),
            );
          },
          onJobFailed: (_job, error) => {
            progress?.finish();
            console.log(`${pc.red("✗")} failed: ${error.message.split("\n")[0]}`);
          },
        });
        const elapsed = (Date.now() - started) / 1000;
        console.log(
          `\n${pc.bold("Queue finished")} in ${formatDuration(elapsed)}: ` +
            `${summary.done} done, ${summary.failed} failed`,
        );
        if (summary.done === 0 && summary.failed === 0) {
          console.log(pc.dim("nothing was pending"));
        }
      } finally {
        store.close();
      }
    });

  queue
    .command("cancel")
    .description("Cancel a pending job")
    .argument("<id>", "job id")
    .action((id: string) => {
      const store = new QueueStore();
      try {
        if (store.cancel(Number(id))) console.log(`${pc.green("✓")} job #${id} canceled`);
        else console.log(pc.yellow(`job #${id} is not pending (or does not exist)`));
      } finally {
        store.close();
      }
    });

  queue
    .command("remove")
    .description("Remove a job from the queue (unless it is running)")
    .argument("<id>", "job id")
    .action((id: string) => {
      const store = new QueueStore();
      try {
        if (store.remove(Number(id))) console.log(`${pc.green("✓")} job #${id} removed`);
        else console.log(pc.yellow(`job #${id} is running (or does not exist)`));
      } finally {
        store.close();
      }
    });

  queue
    .command("clear")
    .description("Remove all finished jobs (done/failed/canceled)")
    .action(() => {
      const store = new QueueStore();
      try {
        const removed = store.clearFinished();
        console.log(`${pc.green("✓")} removed ${removed} finished job${removed === 1 ? "" : "s"}`);
      } finally {
        store.close();
      }
    });
}
