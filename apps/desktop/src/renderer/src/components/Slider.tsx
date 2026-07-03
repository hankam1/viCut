import { RotateCcw } from "lucide-react";

/** Слайдер со значением и опциональным сбросом к нейтральному. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  neutral,
  format = (v) => String(v),
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Нейтральное значение — показывает кнопку сброса, когда value отличается. */
  neutral?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const showReset = neutral !== undefined && Math.abs(value - neutral) > 1e-9;
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-[12px] text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-pill bg-border accent-[var(--vc-accent)]"
      />
      <span className="tnum w-12 shrink-0 text-right text-[12px]">{format(value)}</span>
      <span className="w-4 shrink-0">
        {showReset && (
          <button
            type="button"
            aria-label={`Сбросить ${label}`}
            title="Сбросить"
            onClick={() => onChange(neutral)}
            className="flex h-4 w-4 items-center justify-center rounded text-faint hover:text-text"
          >
            <RotateCcw size={11} strokeWidth={1.5} />
          </button>
        )}
      </span>
    </div>
  );
}
