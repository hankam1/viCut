import type { Tools } from "../ffmpeg/ensure.js";
import {
  encodeRender,
  prepareRender,
  type PreparedRender,
  type RenderProgressEvent,
  type RenderResult,
} from "../render/pipeline.js";
import type { QueueJob, QueueStore } from "./store.js";

export interface QueueRunEvents {
  onJobStart?: (job: QueueJob) => void;
  onJobProgress?: (job: QueueJob, event: RenderProgressEvent) => void;
  onJobDone?: (job: QueueJob, result: RenderResult) => void;
  onJobFailed?: (job: QueueJob, error: Error) => void;
  /** Возвращает true, когда после текущей задачи нужно остановиться. */
  shouldPause?: () => boolean;
}

export interface QueueRunSummary {
  done: number;
  failed: number;
}

interface Pretranscribed {
  job: QueueJob;
  prepared: PreparedRender;
}

/**
 * Process the queue until no pending jobs remain. Jobs encode strictly one at
 * a time, but the next job's preparation (probe, loudness pass, transcription,
 * subtitles) runs in parallel with the current job's encode — on long queues
 * with subtitles this hides most of the transcription time.
 */
export async function runQueue(
  store: QueueStore,
  tools: Tools,
  events?: QueueRunEvents,
): Promise<QueueRunSummary> {
  store.resetInterrupted();
  const summary: QueueRunSummary = { done: 0, failed: 0 };

  const requestOf = (job: QueueJob) => ({ spec: job.spec, output: job.output, preset: job.preset });

  const progressFor = (job: QueueJob) => {
    let lastPersist = 0;
    return (event: RenderProgressEvent): void => {
      const now = Date.now();
      if (now - lastPersist >= 500) {
        lastPersist = now;
        store.updateProgress(job.id, event.stage, event.percent ?? 0);
      }
      events?.onJobProgress?.(job, event);
    };
  };

  const failJob = (job: QueueJob, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    store.markFailed(job.id, message);
    summary.failed++;
    events?.onJobFailed?.(job, error instanceof Error ? error : new Error(message));
  };

  let ahead: Pretranscribed | null = null;

  for (;;) {
    if (events?.shouldPause?.()) break;

    // Следующая задача: подготовленная заранее (если её не отменили/удалили,
    // пока она ждала) или первая ожидающая.
    let job: QueueJob | null = null;
    let prepared: PreparedRender | null = null;
    if (ahead) {
      const fresh = store.get(ahead.job.id);
      if (fresh?.status === "pending") {
        job = fresh;
        prepared = ahead.prepared;
      } else {
        await ahead.prepared.cleanup();
      }
      ahead = null;
    }
    job ??= store.nextPending();
    if (!job) break;

    store.markRunning(job.id);
    events?.onJobStart?.(job);
    const onProgress = progressFor(job);

    if (!prepared) {
      try {
        prepared = await prepareRender(requestOf(job), { tools, onProgress });
      } catch (error) {
        failJob(job, error);
        continue;
      }
    }

    // Пока текущая задача кодируется — готовим следующую.
    const encoding = encodeRender(prepared, { tools, onProgress });
    let nextPreparing: Promise<Pretranscribed | null> | null = null;
    const next = events?.shouldPause?.() ? null : store.nextPending();
    if (next) {
      nextPreparing = prepareRender(requestOf(next), { tools, onProgress: progressFor(next) }).then(
        (p) => ({ job: next, prepared: p }),
        (error: unknown) => {
          // Пока готовили, задачу могли отменить — её статус не трогаем.
          if (store.get(next.id)?.status === "pending") failJob(next, error);
          return null;
        },
      );
    }

    try {
      const result = await encoding;
      store.markDone(job.id);
      summary.done++;
      events?.onJobDone?.(job, result);
    } catch (error) {
      failJob(job, error);
    }

    if (nextPreparing) ahead = await nextPreparing;
  }

  if (ahead) await ahead.prepared.cleanup();
  return summary;
}
