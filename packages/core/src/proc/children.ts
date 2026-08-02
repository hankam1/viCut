import type { ChildProcess } from "node:child_process";

/**
 * Все живые дочерние процессы (ffmpeg / ffprobe / whisper). Нужен по двум
 * причинам: отмена задачи должна убить именно её процессы, а выход из
 * приложения — вообще все. На Windows дочерний процесс переживает родителя,
 * так что без явного убийства закрытое приложение оставляет ffmpeg жечь CPU.
 */
const live = new Set<ChildProcess>();

export function trackChild(child: ChildProcess): void {
  live.add(child);
  child.once("close", () => live.delete(child));
}

/** Сколько процессов запущено прямо сейчас. */
export function liveChildCount(): number {
  return live.size;
}

/** Убить все запущенные процессы; возвращает, сколько их было. */
export function killAllChildren(): number {
  const count = live.size;
  for (const child of live) child.kill("SIGKILL");
  live.clear();
  return count;
}

/**
 * Убить процесс по сигналу отмены. Сначала мягко (на Windows Node всё равно
 * зовёт TerminateProcess — процесс умирает сразу), через несколько секунд —
 * жёстко, на случай зависшего процесса на macOS/Linux.
 * Возвращает функцию отписки — её обязательно звать при завершении процесса,
 * иначе слушатели копятся на общем сигнале задачи.
 */
export function killOnAbort(child: ChildProcess, signal?: AbortSignal): () => void {
  if (!signal) return () => {};
  let escalation: NodeJS.Timeout | null = null;
  const onAbort = (): void => {
    child.kill();
    escalation = setTimeout(() => child.kill("SIGKILL"), 4000);
    escalation.unref();
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  return () => {
    if (escalation) clearTimeout(escalation);
    signal.removeEventListener("abort", onAbort);
  };
}
