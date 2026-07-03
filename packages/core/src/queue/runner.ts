import type { Tools } from "../ffmpeg/ensure.js";
import { renderJob, type RenderProgressEvent, type RenderResult } from "../render/pipeline.js";
import type { QueueJob, QueueStore } from "./store.js";

export interface QueueRunEvents {
  onJobStart?: (job: QueueJob) => void;
  onJobProgress?: (job: QueueJob, event: RenderProgressEvent) => void;
  onJobDone?: (job: QueueJob, result: RenderResult) => void;
  onJobFailed?: (job: QueueJob, error: Error) => void;
}

export interface QueueRunSummary {
  done: number;
  failed: number;
}

/**
 * Process the queue sequentially until no pending jobs remain. Each job uses
 * its own stored preset. Progress is persisted so other processes (or a
 * future UI) can watch the queue live.
 */
export async function runQueue(
  store: QueueStore,
  tools: Tools,
  events?: QueueRunEvents,
): Promise<QueueRunSummary> {
  store.resetInterrupted();
  const summary: QueueRunSummary = { done: 0, failed: 0 };

  for (;;) {
    const job = store.nextPending();
    if (!job) break;

    store.markRunning(job.id);
    events?.onJobStart?.(job);

    let lastPersist = 0;
    try {
      const result = await renderJob(
        { spec: job.spec, output: job.output, preset: job.preset },
        {
          tools,
          onProgress: (event) => {
            const now = Date.now();
            if (now - lastPersist >= 500) {
              lastPersist = now;
              store.updateProgress(job.id, event.stage, event.percent ?? 0);
            }
            events?.onJobProgress?.(job, event);
          },
        },
      );
      store.markDone(job.id);
      summary.done++;
      events?.onJobDone?.(job, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.markFailed(job.id, message);
      summary.failed++;
      events?.onJobFailed?.(job, error instanceof Error ? error : new Error(message));
    }
  }

  return summary;
}
