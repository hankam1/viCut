/** Тумблер по дизайн-системе. */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[18px] w-8 shrink-0 rounded-pill transition-colors duration-[var(--vc-dur-base)] ${
        checked ? "bg-accent" : "bg-border"
      }`}
    >
      <span
        className={`absolute top-[2px] h-[14px] w-[14px] rounded-pill bg-white transition-[left] duration-[var(--vc-dur-base)] ${
          checked ? "left-[16px]" : "left-[2px]"
        }`}
      />
    </button>
  );
}
