import { useEffect, useRef, useState } from "react";
import { ImagePlus, RotateCcw } from "lucide-react";
import type { SlideshowSettings, SubtitleStyle } from "@vicut/core";

const SAMPLE_WORDS = ["Так", "будут", "выглядеть", "субтитры", "в", "видео"];
/** Секунд на «произнесение» одного слова и пауза перед повтором цикла. */
const WORD_SEC = 0.55;
const TAIL_SEC = 1.0;
/** Фейковая длительность показа картинки в превью (движение эффектов). */
const PER_IMAGE_SEC = 5;

const IMAGE_PATH_KEY = "vicut.preview-image-path";
const IMAGE_EVENT = "vicut:preview-image";

/** Встроенный фон: простая SVG-сцена с контрастными деталями, чтобы движение было видно. */
const DEFAULT_BG =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">` +
      `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#1c2749"/><stop offset="0.62" stop-color="#43406e"/>` +
      `<stop offset="1" stop-color="#8a5a68"/></linearGradient></defs>` +
      `<rect width="640" height="360" fill="url(#s)"/>` +
      `<circle cx="452" cy="132" r="46" fill="#f2b263" opacity="0.92"/>` +
      `<g fill="#ffffff" opacity="0.55"><circle cx="80" cy="52" r="1.6"/><circle cx="150" cy="90" r="1.2"/>` +
      `<circle cx="240" cy="40" r="1.4"/><circle cx="330" cy="76" r="1.1"/><circle cx="560" cy="48" r="1.5"/>` +
      `<circle cx="610" cy="110" r="1.2"/><circle cx="40" cy="130" r="1.3"/></g>` +
      `<path d="M0 260 L120 150 L210 232 L305 128 L420 250 L520 180 L640 268 L640 360 L0 360 Z" fill="#232038"/>` +
      `<path d="M0 306 L90 240 L200 300 L340 226 L470 308 L570 258 L640 300 L640 360 L0 360 Z" fill="#151327"/>` +
    `</svg>`,
  );

/** Плавный псевдошум −1..1 — та же пара синусов, что в движке (graph.ts). */
function noise(freqA: number, freqB: number, phaseA: number, phaseB: number, t: number): number {
  return (Math.sin(2 * Math.PI * freqA * t + phaseA) + 0.6 * Math.sin(2 * Math.PI * freqB * t + phaseB)) / 1.6;
}

/** Текстура зерна: полупрозрачный SVG-шум, тайлится и дрожит по позиции. */
const GRAIN_TILE =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140">` +
      `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/>` +
      `<feColorMatrix type="saturate" values="0"/></filter>` +
      `<rect width="140" height="140" filter="url(#n)"/></svg>`,
  );

export interface LivePreviewProps {
  style: SubtitleStyle;
  slideshow: SlideshowSettings;
  /** Показывать ли строку субтитров (в секции «Слайдшоу» она тоже полезна). */
  withSubtitles?: boolean;
}

/**
 * Живой предпросмотр 16:9: субтитры появляются и подсвечиваются по фейковому
 * таймлайну, фон-картинка двигается включёнными эффектами слайдшоу — та же
 * математика, что в движке, но на CSS-трансформациях. Кадр считается равным
 * 1920×1080, размеры переводятся в cqw (100cqw = 1920px кадра).
 */
export function LivePreview({ style, slideshow, withSubtitles = true }: LivePreviewProps) {
  const bgRef = useRef<HTMLDivElement | null>(null);
  const grainRef = useRef<HTMLDivElement | null>(null);
  const [activeWord, setActiveWord] = useState(0);
  const [bgUrl, setBgUrl] = useState<string>(DEFAULT_BG);
  const hasCustomBg = bgUrl !== DEFAULT_BG;

  // Своя картинка: путь в localStorage, содержимое перечитывается через main;
  // выбор в одном экземпляре превью разлетается в остальные через CustomEvent.
  useEffect(() => {
    const saved = localStorage.getItem(IMAGE_PATH_KEY);
    if (saved) {
      void window.vicut.preview.loadImage(saved).then((dataUrl) => {
        if (dataUrl) setBgUrl(dataUrl);
        else localStorage.removeItem(IMAGE_PATH_KEY);
      });
    }
    const onImage = (event: Event): void => {
      setBgUrl((event as CustomEvent<string | null>).detail ?? DEFAULT_BG);
    };
    window.addEventListener(IMAGE_EVENT, onImage);
    return () => window.removeEventListener(IMAGE_EVENT, onImage);
  }, []);

  const pickImage = (): void => {
    void window.vicut.preview.pickImage().then((picked) => {
      if (!picked) return;
      localStorage.setItem(IMAGE_PATH_KEY, picked.path);
      window.dispatchEvent(new CustomEvent(IMAGE_EVENT, { detail: picked.dataUrl }));
    });
  };
  const resetImage = (): void => {
    localStorage.removeItem(IMAGE_PATH_KEY);
    window.dispatchEvent(new CustomEvent(IMAGE_EVENT, { detail: null }));
  };

  // Анимация: transform пишется в ref напрямую (без setState на каждый кадр),
  // React-состояние меняется только при смене активного слова.
  useEffect(() => {
    const ss = slideshow;
    const pend = ss.pendulum.enabled ? ss.pendulum : null;
    const pan = ss.pan.enabled ? ss.pan : null;
    const shake = ss.shake.enabled ? ss.shake : null;

    // Запас масштаба от чёрных краёв — та же формула, что zSafe в движке.
    const rollDeg = shake ? 0.15 * shake.intensity : 0;
    const maxRad = (((pend?.angleDeg ?? 0) + rollDeg) * Math.PI) / 180;
    const sinM = Math.sin(maxRad);
    const cosM = Math.cos(maxRad);
    const panX = pan && pan.axis !== "vertical" ? pan.amount / 2 : 0;
    const panY = pan && pan.axis !== "horizontal" ? pan.amount / 2 : 0;
    const shakeFrac = shake ? 0.004 * shake.intensity : 0;
    const edgePivot = pend && pend.pivot !== "center" ? 1 : 0;
    const zx = (16 * cosM + 9 * sinM * (1 + edgePivot)) / (16 * (1 - 2 * (panX + shakeFrac)));
    const zy = (16 * sinM + 9 * cosM + edgePivot * 9 * (1 - cosM)) / (9 * (1 - 2 * (panY + shakeFrac)));
    const zSafe = Math.max(1, zx, zy);

    const cycleSec = SAMPLE_WORDS.length * WORD_SEC + TAIL_SEC;
    const start = performance.now();
    let raf = 0;
    const tick = (): void => {
      const t = (performance.now() - start) / 1000;

      const imageIdx = Math.floor(t / PER_IMAGE_SEC);
      const even = imageIdx % 2 === 0;
      const progress = (t % PER_IMAGE_SEC) / PER_IMAGE_SEC;

      let zoom = 1;
      if (ss.kenBurns) {
        const p = Math.min(1, ss.speed * progress);
        zoom = even ? 1 + (ss.zoom - 1) * p : ss.zoom - (ss.zoom - 1) * p;
      }
      let theta = 0;
      if (pend) {
        const sign = pend.alternate && !even ? -1 : 1;
        theta = sign * pend.angleDeg * Math.sin((2 * Math.PI * (t % PER_IMAGE_SEC)) / pend.periodSec);
      }
      let dx = 0;
      let dy = 0;
      if (pan) {
        const travel = 2 * progress - 1;
        const horizontal = pan.axis === "horizontal" || (pan.axis === "alternate" && even);
        const dir =
          pan.axis === "alternate"
            ? (Math.floor(imageIdx / 2) % 2 === 0 ? 1 : -1)
            : (even ? 1 : -1);
        if (pan.axis === "vertical" || !horizontal) dy = dir * (pan.amount / 2) * travel;
        else dx = dir * (pan.amount / 2) * travel;
      }
      if (shake) {
        dx += shakeFrac * noise(0.35 * shake.speed, 0.9 * shake.speed, 1.3, 4.1, t);
        dy += shakeFrac * noise(0.45 * shake.speed, 1.1 * shake.speed, 2.9, 0.7, t);
        theta += rollDeg * noise(0.3 * shake.speed, 0.8 * shake.speed, 5.1, 2.3, t);
      }
      if (bgRef.current) {
        // Движок двигает окно кропа по картинке; в CSS — обратное движение самой картинки.
        bgRef.current.style.transformOrigin =
          pend?.pivot === "top" ? "50% 0%" : pend?.pivot === "bottom" ? "50% 100%" : "50% 50%";
        bgRef.current.style.transform =
          `translate(${(-dx * 100).toFixed(3)}%, ${(-dy * 100).toFixed(3)}%) ` +
          `rotate(${(-theta).toFixed(3)}deg) scale(${(zoom * zSafe).toFixed(4)})`;
      }
      if (grainRef.current && ss.grain.enabled) {
        grainRef.current.style.backgroundPosition = `${Math.floor(Math.random() * 140)}px ${Math.floor(Math.random() * 140)}px`;
      }

      const tc = t % cycleSec;
      const word = Math.min(SAMPLE_WORDS.length - 1, Math.floor(tc / WORD_SEC));
      setActiveWord((prev) => (prev === word ? prev : word));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [slideshow]);

  const align =
    style.position === "bottom" ? "flex-end" : style.position === "top" ? "flex-start" : "center";
  const px = (value: number): string => `${((value / 1920) * 100).toFixed(3)}cqw`;

  const reveal = style.animation === "appear" || style.animation === "appear-highlight";
  const highlight = style.animation === "highlight" || style.animation === "appear-highlight";
  const words = (reveal ? SAMPLE_WORDS.slice(0, activeWord + 1) : SAMPLE_WORDS).map((word) =>
    style.uppercase ? word.toUpperCase() : word,
  );

  return (
    <div
      className="group relative flex aspect-video w-full overflow-hidden rounded-md border border-border bg-black"
      style={{ containerType: "inline-size", alignItems: align, justifyContent: "center" }}
    >
      <div
        ref={bgRef}
        className="absolute inset-0"
        style={{ background: `url("${bgUrl}") center / cover no-repeat`, willChange: "transform" }}
      />
      {slideshow.vignette.enabled && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(ellipse at center, transparent 48%, rgba(0,0,0,${(0.85 * slideshow.vignette.strength).toFixed(3)}) 128%)`,
          }}
        />
      )}
      {slideshow.grain.enabled && (
        <div
          ref={grainRef}
          className="pointer-events-none absolute inset-0"
          style={{
            background: `url("${GRAIN_TILE}")`,
            mixBlendMode: "overlay",
            opacity: Math.min(0.55, 0.1 + (slideshow.grain.strength / 30) * 0.5),
          }}
        />
      )}
      {withSubtitles && (
        <span
          className="relative"
          style={{
            fontFamily: `"${style.fontFamily}", Inter, sans-serif`,
            fontSize: px(style.fontSize),
            fontWeight: style.bold ? 700 : 400,
            color: style.primaryColor,
            WebkitTextStroke: `${px(style.outlineWidth)} ${style.outlineColor}`,
            paintOrder: "stroke fill",
            textShadow:
              style.shadow > 0
                ? `0 ${px(style.shadow * 2)} ${px(style.shadow * 3)} rgba(0,0,0,0.85)`
                : undefined,
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
              style={highlight && index === activeWord ? { color: style.highlightColor } : undefined}
            >
              {word}
              {index < words.length - 1 ? " " : ""}
            </span>
          ))}
        </span>
      )}
      <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity duration-[var(--vc-dur-base)] group-hover:opacity-100">
        <button
          type="button"
          title="Своя картинка для превью"
          onClick={pickImage}
          className="flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white/85 hover:bg-black/75 hover:text-white"
        >
          <ImagePlus size={13} strokeWidth={1.5} />
        </button>
        {hasCustomBg && (
          <button
            type="button"
            title="Вернуть стандартный фон"
            onClick={resetImage}
            className="flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white/85 hover:bg-black/75 hover:text-white"
          >
            <RotateCcw size={13} strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
}
