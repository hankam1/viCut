import type { SubtitleStyle } from "@vicut/core";

const SAMPLE_TEXT = "Так будут выглядеть субтитры в видео";

/**
 * Живой превью-кадр 16:9 со стилем субтитров из пресета. Кадр считается
 * равным 1920×1080, размеры переводятся в cqw (100cqw = 1920px кадра).
 */
export function SubtitlePreview({ style }: { style: SubtitleStyle }) {
  const align =
    style.position === "bottom" ? "flex-end" : style.position === "top" ? "flex-start" : "center";
  const px = (value: number): string => `${((value / 1920) * 100).toFixed(3)}cqw`;

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
          fontFamily: `${style.fontFamily}, Inter, sans-serif`,
          fontSize: px(style.fontSize),
          fontWeight: style.bold ? 700 : 400,
          color: style.primaryColor,
          WebkitTextStroke: `${px(style.outlineWidth)} ${style.outlineColor}`,
          paintOrder: "stroke fill",
          textAlign: "center",
          lineHeight: 1.25,
          maxWidth: "88%",
          marginBottom: style.position === "bottom" ? px(style.marginVertical) : 0,
          marginTop: style.position === "top" ? px(style.marginVertical) : 0,
        }}
      >
        {SAMPLE_TEXT}
      </span>
    </div>
  );
}
