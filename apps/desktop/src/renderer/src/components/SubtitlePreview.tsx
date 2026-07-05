import type { SubtitleStyle } from "@vicut/core";

const SAMPLE_WORDS = ["Так", "будут", "выглядеть", "субтитры", "в", "видео"];
/** Слово, «произносимое» в момент превью. */
const ACTIVE_INDEX = 2;

/**
 * Живой превью-кадр 16:9 со стилем субтитров из пресета. Кадр считается
 * равным 1920×1080, размеры переводятся в cqw (100cqw = 1920px кадра).
 */
export function SubtitlePreview({ style }: { style: SubtitleStyle }) {
  const align =
    style.position === "bottom" ? "flex-end" : style.position === "top" ? "flex-start" : "center";
  const px = (value: number): string => `${((value / 1920) * 100).toFixed(3)}cqw`;

  const reveal = style.animation === "appear" || style.animation === "appear-highlight";
  const highlight = style.animation === "highlight" || style.animation === "appear-highlight";
  const words = (reveal ? SAMPLE_WORDS.slice(0, ACTIVE_INDEX + 1) : SAMPLE_WORDS).map((word) =>
    style.uppercase ? word.toUpperCase() : word,
  );

  return (
    <div
      className="flex aspect-video w-full overflow-hidden rounded-md border border-border"
      style={{
        background: "linear-gradient(135deg, #232838 0%, #101319 55%, #1a1420 100%)",
        containerType: "inline-size",
        alignItems: align,
        justifyContent: "center",
      }}
    >
      <span
        style={{
          fontFamily: `"${style.fontFamily}", Inter, sans-serif`,
          fontSize: px(style.fontSize),
          fontWeight: style.bold ? 700 : 400,
          color: style.primaryColor,
          WebkitTextStroke: `${px(style.outlineWidth)} ${style.outlineColor}`,
          paintOrder: "stroke fill",
          textShadow:
            style.shadow > 0 ? `0 ${px(style.shadow * 2)} ${px(style.shadow * 3)} rgba(0,0,0,0.85)` : undefined,
          textAlign: "center",
          lineHeight: 1.25,
          maxWidth: "88%",
          marginBottom: style.position === "bottom" ? px(style.marginVertical) : 0,
          marginTop: style.position === "top" ? px(style.marginVertical) : 0,
        }}
      >
        {words.map((word, index) => (
          <span
            key={index}
            style={highlight && index === ACTIVE_INDEX ? { color: style.highlightColor } : undefined}
          >
            {word}
            {index < words.length - 1 ? " " : ""}
          </span>
        ))}
      </span>
    </div>
  );
}
