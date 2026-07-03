import { useState } from "react";
import { ChevronDown } from "lucide-react";

/** Секция-аккордеон редактора пресетов. */
export function Section({
  title,
  aside,
  defaultOpen = true,
  children,
}: {
  title: string;
  /** Контрол в шапке секции (например, тумблер включения). */
  aside?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex h-11 items-center gap-2 px-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDown
            size={14}
            strokeWidth={1.5}
            className={`shrink-0 text-faint transition-transform duration-[var(--vc-dur-base)] ${
              open ? "" : "-rotate-90"
            }`}
          />
          <span className="text-[13px] font-medium">{title}</span>
        </button>
        {aside}
      </div>
      {open && <div className="border-t border-border px-4 py-3.5">{children}</div>}
    </div>
  );
}
