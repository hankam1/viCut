import { Mark } from "../components/Mark.js";

/** Экран «Очередь» — пока пустое состояние (макет 3a); карточки задач подключаются к IPC-мосту. */
export function QueueView() {
  return (
    <div className="flex h-full flex-col px-6 pb-6">
      <div className="flex h-14 shrink-0 items-center gap-3">
        <h1 className="text-[18px] font-semibold">Очередь</h1>
        <span className="text-[12px] text-muted">0 задач</span>
      </div>

      <button
        type="button"
        className="group flex flex-1 cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-transparent transition-colors duration-[var(--vc-dur-base)] hover:border-accent hover:bg-accent-soft/30"
      >
        <span className="text-faint opacity-80 transition-opacity group-hover:opacity-100">
          <Mark size={56} mono />
        </span>
        <div className="text-center">
          <div className="text-[14px] font-medium">Очередь пуста</div>
          <div className="mt-1 text-[12px] text-muted">
            Перетащи видео сюда или нажми, чтобы выбрать
          </div>
        </div>
      </button>
    </div>
  );
}
