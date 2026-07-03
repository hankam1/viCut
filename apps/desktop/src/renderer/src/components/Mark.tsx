/** Знак ViCut — три полосы-плёнки со сдвигом (из дизайн-хендоффа). */
export function Mark({ size = 20, mono = false }: { size?: number; mono?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="ViCut">
      {!mono && (
        <defs>
          <linearGradient id="vicut-accent" gradientUnits="userSpaceOnUse" x1="32" y1="0" x2="32" y2="64">
            <stop offset="0" stopColor="#9070FF" />
            <stop offset="1" stopColor="#7C5CFF" />
          </linearGradient>
        </defs>
      )}
      <g fill={mono ? "currentColor" : "url(#vicut-accent)"}>
        <rect x="11" y="14" width="36" height="10" rx="3" />
        <rect x="17" y="27" width="36" height="10" rx="3" />
        <rect x="11" y="40" width="36" height="10" rx="3" />
      </g>
    </svg>
  );
}
