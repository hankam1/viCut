import { useEffect, useState } from "react";
import { AlertTriangle, Check, FolderOpen, Play, RotateCcw, X } from "lucide-react";
import type { QueueJob } from "@vicut/core";
import type { LiveProgress } from "../hooks/useQueue.js";
import { formatDuration, formatEta } from "../lib/format.js";
import { Button } from "./Button.js";
import { Mark } from "./Mark.js";

/** "YYYY-MM-DD HH:MM:SS" из SQLite (localtime) → миллисекунды. */
function parseDbTime(value: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value.replace(" ", "T")).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Стадия → полоса общего прогресса (из прототипа: 0–25 / 25–45 / 45–70 / 70–100). */
const STAGE_BANDS: Record<string, { start: number; width: number; index: number }> = {
  probe: { start: 0, width: 25, index: 0 },
  "prepare-audio": { start: 25, width: 20, index: 1 },
  transcribe: { start: 45, width: 20, index: 2 },
  subtitles: { start: 65, width: 5, index: 2 },
  encode: { start: 70, width: 30, index: 3 },
};

const STAGE_LABELS = ["Анализ", "Аудио", "Субтитры", "Кодирование"];

function overallPercent(live: LiveProgress | undefined, job: QueueJob): number {
  const stage = live?.stage ?? job.stage ?? "probe";
  const band = STAGE_BANDS[stage] ?? STAGE_BANDS["probe"]!;
  const inStage = live?.percent ?? job.progress ?? 0;
  return Math.min(100, band.start + (band.width * inStage) / 100);
}

function StagesRow({ activeIndex }: { activeIndex: number }) {
  return (
    <div className="flex items-center gap-1.5 text-[11.5px] text-faint">
      {STAGE_LABELS.map((label, i) => (
        <span key={label} className="flex items-center gap-1.5">
          {i > 0 && <span>→</span>}
          <span className={i === activeIndex ? "font-medium text-accent" : undefined}>{label}</span>
        </span>
      ))}
    </div>
  );
}

export function JobCard({
  job,
  live,
  onCancel,
  onRetry,
  onRemove,
}: {
  job: QueueJob;
  live?: LiveProgress;
  onCancel: (id: number) => void;
  onRetry: (id: number) => void;
  onRemove: (id: number) => void;
}) {
  const running = job.status === "running";
  const percent = running ? overallPercent(live, job) : 0;
  const stageIndex = running
    ? (STAGE_BANDS[live?.stage ?? job.stage ?? "probe"]?.index ?? 0)
    : 0;
  const etaSec = live?.etaSec;

  // Тикающее «идёт N» у running-задачи; у готовой — статичное «за N».
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const startedMs = parseDbTime(job.startedAt);
  const finishedMs = parseDbTime(job.finishedAt);
  const elapsedSec = running && startedMs ? Math.max(0, (nowMs - startedMs) / 1000) : null;
  const tookSec =
    job.status === "done" && startedMs && finishedMs
      ? Math.max(0, (finishedMs - startedMs) / 1000)
      : null;

  return (
    <div
      className={`relative overflow-hidden rounded-lg border bg-surface p-3.5 transition-colors duration-[var(--vc-dur-base)] ${
        job.status === "failed" ? "border-[#3A2A2E]" : "border-border"
      }`}
    >
      {running && <div className="absolute inset-y-0 left-0 w-[2.5px] bg-accent" />}

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-16 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-faint">
          <Mark size={18} mono />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium">{job.title}</span>
            <span className="shrink-0 rounded-pill bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
              {job.preset.name}
            </span>
          </div>
          <div className="mt-0.5 text-[12px] text-muted">
            {job.inputs.length} клип{job.inputs.length === 1 ? "" : job.inputs.length < 5 ? "а" : "ов"}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {job.status === "pending" && (
            <>
              <span className="text-[12px] text-muted">в очереди</span>
              <Button variant="ghost" onClick={() => onCancel(job.id)}>
                <X size={14} strokeWidth={1.5} /> Отменить
              </Button>
            </>
          )}
          {running && (
            <span className="tnum text-[13px] font-medium text-accent">{Math.floor(percent)}%</span>
          )}
          {job.status === "done" && (
            <>
              <span
                className="flex items-center gap-1 text-[12px] font-medium text-success"
                title={job.startedAt ? `Старт: ${job.startedAt}` : undefined}
              >
                <Check size={14} strokeWidth={2} /> Готово
                {tookSec !== null && (
                  <span className="tnum font-normal text-muted">за {formatDuration(tookSec)}</span>
                )}
              </span>
              <Button onClick={() => void window.vicut.shell.openPath(job.output)}>
                <Play size={13} strokeWidth={1.5} /> Открыть
              </Button>
              <Button variant="ghost" onClick={() => void window.vicut.shell.showItem(job.output)}>
                <FolderOpen size={14} strokeWidth={1.5} /> В папке
              </Button>
            </>
          )}
          {job.status === "failed" && (
            <>
              <span className="flex items-center gap-1 text-[12px] font-medium text-danger">
                <AlertTriangle size={14} strokeWidth={1.5} /> Ошибка
              </span>
              <Button onClick={() => onRetry(job.id)}>
                <RotateCcw size={13} strokeWidth={1.5} /> Повторить
              </Button>
            </>
          )}
          {(job.status === "canceled" || job.status === "failed" || job.status === "done") && (
            <Button variant="ghost" aria-label="Убрать из списка" onClick={() => onRemove(job.id)}>
              <X size={14} strokeWidth={1.5} />
            </Button>
          )}
          {job.status === "canceled" && <span className="text-[12px] text-faint">отменена</span>}
        </div>
      </div>

      {running && (
        <div className="mt-3 flex items-center gap-3 pl-[76px]">
          <div className="h-[5px] flex-1 overflow-hidden rounded-pill bg-surface-2">
            <div
              className="h-full rounded-pill bg-gradient-to-r from-[#9070FF] to-[#7C5CFF] transition-[width] duration-400 ease-linear"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}
      {running && (
        <div className="mt-2 flex items-center justify-between pl-[76px]">
          <StagesRow activeIndex={stageIndex} />
          <span className="tnum text-[11.5px] text-muted">
            {elapsedSec !== null ? `идёт ${formatDuration(elapsedSec)}` : ""}
            {elapsedSec !== null && etaSec != null ? " · " : ""}
            {etaSec != null ? formatEta(etaSec) : ""}
          </span>
        </div>
      )}

      {job.status === "failed" && job.error && (
        <details className="mt-2 pl-[76px] text-[12px] text-muted">
          <summary className="cursor-pointer select-none text-danger/80">Детали</summary>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-faint">
            {job.error}
          </pre>
        </details>
      )}
    </div>
  );
}
