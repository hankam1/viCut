import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontData[]>;
  }
}

/** Если Local Font Access недоступен — набор шрифтов, которые есть почти везде. */
const FALLBACK_FONTS = [
  "Arial",
  "Arial Black",
  "Calibri",
  "Comic Sans MS",
  "Consolas",
  "Courier New",
  "Georgia",
  "Impact",
  "Segoe UI",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
];

let cachedFamilies: string[] | null = null;

async function loadFamilies(): Promise<string[]> {
  if (cachedFamilies) return cachedFamilies;
  try {
    const fonts = (await window.queryLocalFonts?.()) ?? [];
    const families = [...new Set(fonts.map((font) => font.family))].sort((a, b) =>
      a.localeCompare(b),
    );
    cachedFamilies = families.length > 0 ? families : FALLBACK_FONTS;
  } catch {
    cachedFamilies = FALLBACK_FONTS;
  }
  return cachedFamilies;
}

/** Выбор шрифта из установленных в системе: дропдаун с поиском и превью. */
export function FontSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (family: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [families, setFamilies] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Список запрашивается по клику: Local Font Access требует жеста пользователя.
  const toggle = (): void => {
    if (!open) {
      void loadFamilies().then(setFamilies);
      setQuery("");
    }
    setOpen((prev) => !prev);
  };

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Выбранный шрифт держится в зоне видимости при открытии.
  useEffect(() => {
    if (open && families) {
      listRef.current
        ?.querySelector("[data-selected=true]")
        ?.scrollIntoView({ block: "center" });
    }
  }, [open, families]);

  const filtered = useMemo(() => {
    if (!families) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return families;
    return families.filter((family) => family.toLowerCase().includes(needle));
  }, [families, query]);

  const trimmedQuery = query.trim();
  const exactMatch = filtered.some((family) => family.toLowerCase() === trimmedQuery.toLowerCase());

  const pick = (family: string): void => {
    onChange(family);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        className="flex h-7 w-52 items-center gap-2 rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text outline-none transition-colors duration-[var(--vc-dur-fast)] hover:border-accent focus:border-accent"
      >
        <span className="min-w-0 flex-1 truncate text-left" style={{ fontFamily: `"${value}", Inter, sans-serif` }}>
          {value}
        </span>
        <ChevronDown size={13} strokeWidth={1.5} className="shrink-0 text-faint" />
      </button>

      {open && (
        <div className="absolute left-0 top-8 z-50 flex w-72 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-pop">
          <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
            <Search size={13} strokeWidth={1.5} className="shrink-0 text-faint" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск шрифта…"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-text outline-none placeholder:text-faint"
            />
          </div>
          <div ref={listRef} className="max-h-64 overflow-y-auto p-1">
            {families === null && (
              <div className="px-2.5 py-2 text-[12px] text-faint">Загрузка шрифтов…</div>
            )}
            {families !== null && trimmedQuery && !exactMatch && (
              <button
                type="button"
                onClick={() => pick(trimmedQuery)}
                className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[12px] text-muted transition-colors duration-[var(--vc-dur-fast)] hover:bg-surface-2 hover:text-text"
              >
                Использовать «{trimmedQuery}»
              </button>
            )}
            {families !== null && filtered.length === 0 && !trimmedQuery && (
              <div className="px-2.5 py-2 text-[12px] text-faint">Шрифты не найдены</div>
            )}
            {filtered.map((family) => {
              const selected = family === value;
              return (
                <button
                  key={family}
                  type="button"
                  data-selected={selected}
                  onClick={() => pick(family)}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors duration-[var(--vc-dur-fast)] ${
                    selected ? "bg-accent-soft text-accent" : "text-text hover:bg-surface-2"
                  }`}
                >
                  <span
                    className="min-w-0 flex-1 truncate"
                    style={{ fontFamily: `"${family}", Inter, sans-serif` }}
                  >
                    {family}
                  </span>
                  {selected && <Check size={13} strokeWidth={1.5} className="shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
