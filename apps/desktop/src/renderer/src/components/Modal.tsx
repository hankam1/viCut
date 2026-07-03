import { useEffect } from "react";
import { X } from "lucide-react";

/** Модальный лист 600px по дизайн-системе (radius 14, тень modal). */
export function Modal({
  title,
  header,
  onClose,
  children,
  footer,
}: {
  title: string;
  /** Дополнительный контент шапки (например, шаг-индикатор). */
  header?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-full w-[600px] flex-col rounded-2xl border border-border bg-surface shadow-modal">
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3.5">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          {header}
          <button
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
