import { Minus, Square, X } from "lucide-react";
import { Mark } from "./Mark.js";

const isMac = window.vicut.platform === "darwin";

function WindowButton({
  onClick,
  danger = false,
  label,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`app-no-drag flex h-full w-11 items-center justify-center text-muted transition-colors duration-[var(--vc-dur-fast)] ${
        danger ? "hover:bg-danger hover:text-white" : "hover:bg-surface-2 hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

/** Кастомный тайтлбар 38px в цвет фона (frameless-окно). */
export function TitleBar() {
  return (
    <header className="app-drag flex h-[38px] shrink-0 items-center bg-bg">
      <div className={`flex items-center gap-2 ${isMac ? "pl-[76px]" : "pl-3"}`}>
        <Mark size={18} />
        <span className="font-wordmark text-[13px] font-medium tracking-wide text-muted">
          viCut
        </span>
      </div>
      {!isMac && (
        <div className="ml-auto flex h-full items-stretch">
          <WindowButton label="Свернуть" onClick={() => window.vicut.window.minimize()}>
            <Minus size={15} strokeWidth={1.5} />
          </WindowButton>
          <WindowButton label="Развернуть" onClick={() => window.vicut.window.maximize()}>
            <Square size={12.5} strokeWidth={1.5} />
          </WindowButton>
          <WindowButton danger label="Закрыть" onClick={() => window.vicut.window.close()}>
            <X size={16} strokeWidth={1.5} />
          </WindowButton>
        </div>
      )}
    </header>
  );
}
