export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
}

/** Segmented control по дизайн-системе. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  accent = false,
}: {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Подсветка рамки, когда значение переопределено. */
  accent?: boolean;
}) {
  return (
    <div
      className={`inline-flex h-7 items-center gap-0.5 rounded-md border bg-surface-2 p-0.5 ${
        accent ? "border-accent" : "border-border"
      }`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            className={`h-full rounded-[5px] px-2.5 text-[12px] font-medium transition-colors duration-[var(--vc-dur-fast)] ${
              active ? "bg-surface text-text shadow-pop" : "text-muted hover:text-text"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
