import type { SubtitleStyle } from "@vicut/core";

export type StylePatch = Partial<
  Pick<
    SubtitleStyle,
    | "bold"
    | "uppercase"
    | "primaryColor"
    | "outlineColor"
    | "outlineWidth"
    | "shadow"
    | "animation"
    | "highlightColor"
  >
>;

interface TextStyle {
  name: string;
  patch: StylePatch;
}

/** Готовые стили текста, как пресеты в CapCut. Шрифт и размер не трогают. */
const TEXT_STYLES: TextStyle[] = [
  {
    name: "Классика",
    patch: {
      bold: true,
      uppercase: false,
      primaryColor: "#FFFFFF",
      outlineColor: "#000000",
      outlineWidth: 3,
      shadow: 0,
      animation: "none",
    },
  },
  {
    name: "CapCut",
    patch: {
      bold: true,
      uppercase: true,
      primaryColor: "#FFFFFF",
      outlineColor: "#000000",
      outlineWidth: 4,
      shadow: 1,
      animation: "appear-highlight",
      highlightColor: "#2EC4B6",
    },
  },
  {
    name: "Жёлтый",
    patch: {
      bold: true,
      uppercase: true,
      primaryColor: "#FFE600",
      outlineColor: "#000000",
      outlineWidth: 4,
      shadow: 1,
      animation: "none",
    },
  },
  {
    name: "Неон",
    patch: {
      bold: true,
      uppercase: false,
      primaryColor: "#39FF88",
      outlineColor: "#062B18",
      outlineWidth: 2,
      shadow: 2,
      animation: "appear",
    },
  },
  {
    name: "Минимал",
    patch: {
      bold: false,
      uppercase: false,
      primaryColor: "#FFFFFF",
      outlineColor: "#000000",
      outlineWidth: 0,
      shadow: 2,
      animation: "none",
    },
  },
  {
    name: "Акцент",
    patch: {
      bold: true,
      uppercase: false,
      primaryColor: "#FFFFFF",
      outlineColor: "#000000",
      outlineWidth: 3,
      shadow: 0,
      animation: "highlight",
      highlightColor: "#7C5CFF",
    },
  },
];

function isActive(style: SubtitleStyle, patch: StylePatch): boolean {
  return Object.entries(patch).every(
    ([key, value]) => style[key as keyof StylePatch] === value,
  );
}

/** Плитки готовых стилей: Aa-превью, подсветка второй буквы у анимированных. */
export function TextStylePresets({
  style,
  onApply,
}: {
  style: SubtitleStyle;
  onApply: (patch: StylePatch) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {TEXT_STYLES.map((item) => {
        const p = item.patch;
        const active = isActive(style, p);
        const highlighted = p.animation === "highlight" || p.animation === "appear-highlight";
        const sample = p.uppercase ? ["A", "A"] : ["A", "a"];
        return (
          <button
            key={item.name}
            type="button"
            onClick={() => onApply(p)}
            title={item.name}
            className={`flex w-[72px] flex-col items-center gap-1 rounded-lg border p-1.5 pb-1 transition-colors duration-[var(--vc-dur-fast)] ${
              active ? "border-accent bg-accent-soft" : "border-border bg-surface-2 hover:border-accent"
            }`}
          >
            <span
              className="flex h-9 w-full items-center justify-center rounded-md text-[19px] leading-none"
              style={{
                background: "linear-gradient(135deg, #232838 0%, #101319 100%)",
                fontWeight: p.bold ? 800 : 400,
                WebkitTextStroke: `${Math.min(1.2, (p.outlineWidth ?? 0) * 0.35)}px ${p.outlineColor ?? "#000000"}`,
                paintOrder: "stroke fill",
                textShadow: p.shadow ? "0 1px 2px rgba(0,0,0,0.8)" : undefined,
              }}
            >
              <span style={{ color: p.primaryColor }}>{sample[0]}</span>
              <span style={{ color: highlighted ? p.highlightColor : p.primaryColor }}>
                {sample[1]}
              </span>
            </span>
            <span className={`text-[10.5px] ${active ? "text-accent" : "text-muted"}`}>
              {item.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
