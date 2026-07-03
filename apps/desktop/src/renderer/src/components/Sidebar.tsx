import { ListVideo, Settings, SlidersHorizontal } from "lucide-react";
import type { View } from "../App.js";

const ITEMS: Array<{ view: View; label: string; icon: typeof ListVideo }> = [
  { view: "queue", label: "Очередь", icon: ListVideo },
  { view: "presets", label: "Пресеты", icon: SlidersHorizontal },
  { view: "settings", label: "Настройки", icon: Settings },
];

/** Узкий сайдбар 56px с иконками разделов. */
export function Sidebar({ view, onNavigate }: { view: View; onNavigate: (v: View) => void }) {
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 pt-1" aria-label="Разделы">
      {ITEMS.map((item) => {
        const active = view === item.view;
        const Icon = item.icon;
        return (
          <button
            key={item.view}
            type="button"
            title={item.label}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            onClick={() => onNavigate(item.view)}
            className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors duration-[var(--vc-dur-base)] ${
              active
                ? "bg-accent-soft text-accent"
                : "text-muted hover:bg-surface-2 hover:text-text"
            }`}
          >
            <Icon size={20} strokeWidth={1.5} />
          </button>
        );
      })}
    </nav>
  );
}
