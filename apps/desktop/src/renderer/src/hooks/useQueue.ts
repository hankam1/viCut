import { useCallback, useEffect, useRef, useState } from "react";
import type { QueueJob } from "@vicut/core";
import type { JobProgressEvent } from "../../../preload/index.js";

export interface LiveProgress {
  stage: string;
  percent: number | null;
  detail?: string;
  etaSec?: number | null;
}

export interface QueueState {
  jobs: QueueJob[];
  running: boolean;
  /** Живой прогресс по running-задачам (jobId → стадия/процент/скорость). */
  progress: Map<number, LiveProgress>;
  addJobs: (inputs: string[], presetName: string, title?: string) => Promise<void>;
  start: () => void;
  pause: () => void;
  cancel: (id: number) => void;
  retry: (id: number) => void;
  remove: (id: number) => void;
}

export function useQueue(): QueueState {
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Map<number, LiveProgress>>(new Map());
  const alive = useRef(true);

  const refresh = useCallback(() => {
    void window.vicut.queue.list().then((list) => {
      if (alive.current) setJobs(list);
    });
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    void window.vicut.queue.isRunning().then((r) => {
      if (alive.current) setRunning(r);
    });

    const offChanged = window.vicut.on("queue:changed", refresh);
    const offRunning = window.vicut.on("queue:running-changed", (payload) => {
      setRunning(Boolean(payload));
    });
    const offProgress = window.vicut.on("queue:job-progress", (payload) => {
      const event = payload as JobProgressEvent;
      setProgress((prev) => {
        const next = new Map(prev);
        next.set(event.jobId, {
          stage: event.stage,
          percent: event.percent,
          detail: event.detail,
          etaSec: event.etaSec,
        });
        return next;
      });
    });
    const offFinished = window.vicut.on("queue:job-finished", (payload) => {
      const event = payload as { jobId: number };
      setProgress((prev) => {
        const next = new Map(prev);
        next.delete(event.jobId);
        return next;
      });
      refresh();
    });

    return () => {
      alive.current = false;
      offChanged();
      offRunning();
      offProgress();
      offFinished();
    };
  }, [refresh]);

  const addJobs = useCallback(
    async (inputs: string[], presetName: string, title?: string) => {
      if (inputs.length === 0) return;
      await window.vicut.queue.add({ inputs, presetName, title });
    },
    [],
  );

  return {
    jobs,
    running,
    progress,
    addJobs,
    start: () => void window.vicut.queue.start(),
    pause: () => void window.vicut.queue.pause(),
    cancel: (id) => void window.vicut.queue.cancel(id),
    retry: (id) => void window.vicut.queue.retry(id),
    remove: (id) => void window.vicut.queue.remove(id),
  };
}
