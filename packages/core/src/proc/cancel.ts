/**
 * Задачу прервал пользователь. Отдельный тип, чтобы очередь отличала отмену
 * от настоящей ошибки рендера и не показывала её как «Ошибка».
 */
export class CancelError extends Error {
  constructor(message = "задача отменена") {
    super(message);
    this.name = "CancelError";
  }
}

/** Отмена ли это (свой CancelError или AbortError из стандартных API). */
export function isCancel(error: unknown): boolean {
  return (
    error instanceof CancelError ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "CancelError"))
  );
}

/** Прервать выполнение, если отмену уже запросили. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CancelError();
}
