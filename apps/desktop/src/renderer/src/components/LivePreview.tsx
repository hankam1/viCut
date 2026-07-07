import { useEffect, useRef, useState } from "react";
import { ImagePlus, RotateCcw } from "lucide-react";
import type { SlideshowSettings, SubtitleStyle } from "@vicut/core";

const SAMPLE_WORDS = ["Так", "будут", "выглядеть", "субтитры", "в", "видео"];
/** Секунд на «произнесение» одного слова и пауза перед повтором цикла. */
const WORD_SEC = 0.55;
const TAIL_SEC = 1.0;
/** Фейковая длительность показа картинки в превью (движение эффектов). */
const PER_IMAGE_SEC = 4;

const IMAGE_PATH_KEY = "vicut.preview-image-path";
const IMAGE_EVENT = "vicut:preview-image";

const STARS =
  `<g fill="#ffffff" opacity="0.55"><circle cx="80" cy="52" r="1.6"/><circle cx="150" cy="90" r="1.2"/>` +
  `<circle cx="240" cy="40" r="1.4"/><circle cx="330" cy="76" r="1.1"/><circle cx="560" cy="48" r="1.5"/>` +
  `<circle cx="610" cy="110" r="1.2"/><circle cx="40" cy="130" r="1.3"/></g>`;

const svg = (body: string): string =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">${body}</svg>`,
  );

/** Встроенные «картинки» слайдшоу: разные сцены в одной плоской стилистике. */
const DEFAULT_SCENES = [
  // Сумеречные горы
  svg(
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c2749"/>` +
      `<stop offset="0.62" stop-color="#43406e"/><stop offset="1" stop-color="#8a5a68"/></linearGradient></defs>` +
      `<rect width="640" height="360" fill="url(#s)"/><circle cx="452" cy="132" r="46" fill="#f2b263" opacity="0.92"/>${STARS}` +
      `<path d="M0 260 L120 150 L210 232 L305 128 L420 250 L520 180 L640 268 L640 360 L0 360 Z" fill="#232038"/>` +
      `<path d="M0 306 L90 240 L200 300 L340 226 L470 308 L570 258 L640 300 L640 360 L0 360 Z" fill="#151327"/>`,
  ),
  // Ночное море: луна, дорожка, парусник
  svg(
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e1b33"/>` +
      `<stop offset="0.7" stop-color="#27436b"/><stop offset="1" stop-color="#4a6d8c"/></linearGradient>` +
      `<linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d3a57"/>` +
      `<stop offset="1" stop-color="#0b1524"/></linearGradient></defs>` +
      `<rect width="640" height="360" fill="url(#s)"/>${STARS}` +
      `<circle cx="170" cy="96" r="34" fill="#e9eef7" opacity="0.95"/>` +
      `<rect y="252" width="640" height="108" fill="url(#w)"/>` +
      `<g fill="#dce6f4" opacity="0.35"><ellipse cx="170" cy="272" rx="42" ry="3"/>` +
      `<ellipse cx="176" cy="292" rx="30" ry="2.5"/><ellipse cx="166" cy="314" rx="20" ry="2"/></g>` +
      `<path d="M420 252 L500 252 L488 240 L432 240 Z M458 236 L458 178 L492 236 Z" fill="#0a1322"/>`,
  ),
  // Пустыня на закате: дюны, большое солнце, птицы
  svg(
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b1e3f"/>` +
      `<stop offset="0.55" stop-color="#93454e"/><stop offset="1" stop-color="#e98e57"/></linearGradient></defs>` +
      `<rect width="640" height="360" fill="url(#s)"/><circle cx="320" cy="214" r="58" fill="#ffd08a" opacity="0.95"/>${STARS}` +
      `<path d="M500 96 q7 -8 14 0 q7 -8 14 0 M552 122 q6 -7 12 0 q6 -7 12 0" stroke="#1d1226" stroke-width="2.5" fill="none" stroke-linecap="round"/>` +
      `<path d="M0 252 C 150 214, 260 292, 410 258 C 510 236, 575 268, 640 250 L640 360 L0 360 Z" fill="#3a2433"/>` +
      `<path d="M0 302 C 130 272, 320 332, 640 288 L640 360 L0 360 Z" fill="#241722"/>`,
  ),
  // Ночной хвойный лес под луной
  svg(
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f2430"/>` +
      `<stop offset="0.65" stop-color="#1d4a44"/><stop offset="1" stop-color="#2f6b52"/></linearGradient></defs>` +
      `<rect width="640" height="360" fill="url(#s)"/>${STARS}` +
      `<circle cx="470" cy="92" r="30" fill="#f0f6e6" opacity="0.95"/>` +
      `<path d="M0 360 L0 252 L38 194 L76 250 L112 214 L150 258 L192 198 L232 254 L272 218 L310 260 L352 192 L394 256 L432 222 L470 262 L510 204 L548 256 L586 226 L640 252 L640 360 Z" fill="#132d28"/>` +
      `<path d="M0 360 L0 300 L46 244 L92 298 L138 262 L186 302 L234 250 L282 300 L330 266 L378 304 L426 248 L474 300 L520 268 L566 304 L612 260 L640 292 L640 360 Z" fill="#0a1b18"/>`,
  ),
];

/** «Картинка» фейкового слайдшоу: файл + кадрирование + цветокоррекция. */
interface BgVariant {
  url: string;
  filter: string;
  zoom: number;
  dx: number;
  dy: number;
}

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
 * таймлайну, фоновое слайдшоу двигается включёнными эффектами и растворяется
 * на границах «картинок» — та же математика, что в движке, но на CSS.
 * Кадр считается равным 1920×1080, размеры переводятся в cqw.
 */
export function LivePreview({ style, slideshow, withSubtitles = true }: LivePreviewProps) {
  // Два слоя фона: чётные картинки на одном, нечётные на другом — во время
  // кроссфейда верхний (следующий) проявляется поверх текущего.
  const layerRefs = [useRef<HTMLDivElement | null>(null), useRef<HTMLDivElement | null>(null)];
  const grainRef = useRef<HTMLDivElement | null>(null);
  const [activeWord, setActiveWord] = useState(0);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  // Часы превью общие и не сбрасываются правками настроек (иначе до перехода
  // не досмотреть); offset двигает таймлайн при перемотке к растворению.
  const epochRef = useRef(performance.now());
  const offsetRef = useRef(0);
  const lastFadeRef = useRef<number | null>(null);

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
      setBgUrl((event as CustomEvent<string | null>).detail);
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

  // Анимация: стили пишутся в ref-ы напрямую (без setState на каждый кадр),
  // React-состояние меняется только при смене активного слова.
  useEffect(() => {
    const ss = slideshow;
    const pend = ss.pendulum.enabled ? ss.pendulum : null;
    const pan = ss.pan.enabled ? ss.pan : null;
    const shake = ss.shake.enabled ? ss.shake : null;

    // Своя картинка одна, поэтому «соседние» кадры отличаются кадрированием
    // и лёгкой цветокоррекцией — иначе растворение не разглядеть.
    const variants: BgVariant[] = bgUrl
      ? [
          { url: bgUrl, filter: "none", zoom: 1, dx: 0, dy: 0 },
          { url: bgUrl, filter: "saturate(1.22) brightness(1.05)", zoom: 1.35, dx: 0.09, dy: -0.05 },
          { url: bgUrl, filter: "brightness(0.9) contrast(1.07)", zoom: 1.2, dx: -0.06, dy: 0.05 },
        ]
      : DEFAULT_SCENES.map((url) => ({ url, filter: "none", zoom: 1, dx: 0, dy: 0 }));

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

    // Как в движке: картинка живёт fade+perImage секунд (появляется в хвосте
    // предыдущей), движение размазано на всё это окно.
    const fade = Math.min(ss.crossfadeSec, 0.45 * PER_IMAGE_SEC);
    const span = PER_IMAGE_SEC + fade;
    const origin =
      pend?.pivot === "top" ? "50% 0%" : pend?.pivot === "bottom" ? "50% 100%" : "50% 50%";

    // Сменили длительность перехода — перемотать к началу растворения,
    // чтобы новое значение было видно сразу, а не через полцикла.
    if (lastFadeRef.current !== null && lastFadeRef.current !== fade) {
      const now = (performance.now() - epochRef.current) / 1000 + offsetRef.current;
      const local = now - Math.floor(now / PER_IMAGE_SEC) * PER_IMAGE_SEC;
      offsetRef.current += Math.max(0, PER_IMAGE_SEC - fade - 0.35) - local;
    }
    lastFadeRef.current = fade;

    /** Трансформация картинки idx в момент tLife от начала её появления. */
    const transformFor = (
      idx: number,
      tLife: number,
      variant: BgVariant,
      sh: [number, number, number],
    ): string => {
      const even = idx % 2 === 0;
      const progress = Math.min(1, Math.max(0, tLife / span));
      let zoom = 1;
      if (ss.kenBurns) {
        const p = Math.min(1, ss.speed * progress);
        zoom = even ? 1 + (ss.zoom - 1) * p : ss.zoom - (ss.zoom - 1) * p;
      }
      let theta = sh[2];
      if (pend) {
        const sign = pend.alternate && !even ? -1 : 1;
        theta += sign * pend.angleDeg * Math.sin((2 * Math.PI * tLife) / pend.periodSec);
      }
      let dx = sh[0];
      let dy = sh[1];
      if (pan) {
        const travel = 2 * progress - 1;
        const horizontal = pan.axis === "horizontal" || (pan.axis === "alternate" && even);
        const dir =
          pan.axis === "alternate"
            ? (Math.floor(idx / 2) % 2 === 0 ? 1 : -1)
            : (even ? 1 : -1);
        if (horizontal) dx += dir * (pan.amount / 2) * travel;
        else dy += dir * (pan.amount / 2) * travel;
      }
      // Движок двигает окно кропа по картинке; в CSS — обратное движение самой картинки.
      return (
        `translate(${((-dx + variant.dx) * 100).toFixed(3)}%, ${((-dy + variant.dy) * 100).toFixed(3)}%) ` +
        `rotate(${(-theta).toFixed(3)}deg) scale(${(zoom * zSafe * variant.zoom).toFixed(4)})`
      );
    };

    const assigned: [number, number] = [-1, -1];
    const applyLayer = (
      idx: number,
      tLife: number,
      opacity: number,
      onTop: boolean,
      sh: [number, number, number],
    ): void => {
      const el = layerRefs[idx % 2]!.current;
      if (!el) return;
      const variant = variants[idx % variants.length]!;
      if (assigned[idx % 2] !== idx) {
        assigned[idx % 2] = idx;
        el.style.background = `url("${variant.url}") center / cover no-repeat`;
        el.style.filter = variant.filter;
      }
      el.style.transformOrigin = origin;
      el.style.transform = transformFor(idx, tLife, variant, sh);
      el.style.opacity = opacity.toFixed(3);
      el.style.zIndex = onTop ? "1" : "0";
    };

    const cycleSec = SAMPLE_WORDS.length * WORD_SEC + TAIL_SEC;
    let raf = 0;
    const tick = (): void => {
      const t = (performance.now() - epochRef.current) / 1000 + offsetRef.current;

      // Шейк — «камера», общая для обоих слоёв (в движке — часы композиции).
      const sh: [number, number, number] = shake
        ? [
            shakeFrac * noise(0.35 * shake.speed, 0.9 * shake.speed, 1.3, 4.1, t),
            shakeFrac * noise(0.45 * shake.speed, 1.1 * shake.speed, 2.9, 0.7, t),
            rollDeg * noise(0.3 * shake.speed, 0.8 * shake.speed, 5.1, 2.3, t),
          ]
        : [0, 0, 0];

      const idx = Math.floor(t / PER_IMAGE_SEC);
      const tLocal = t - idx * PER_IMAGE_SEC;
      // Линейная маска растворения — как geq-маска движка.
      const fadeP = fade > 0 ? Math.min(1, Math.max(0, (tLocal - (PER_IMAGE_SEC - fade)) / fade)) : 0;
      applyLayer(idx, tLocal + fade, 1, false, sh);
      applyLayer(idx + 1, tLocal - (PER_IMAGE_SEC - fade), fadeP, true, sh);

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
  }, [slideshow, bgUrl]);

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
      <div ref={layerRefs[0]} className="absolute inset-0" style={{ willChange: "transform" }} />
      <div
        ref={layerRefs[1]}
        className="absolute inset-0"
        style={{ willChange: "transform", opacity: 0 }}
      />
      {slideshow.vignette.enabled && (
        <div
          className="pointer-events-none absolute inset-0 z-[2]"
          style={{
            background: `radial-gradient(ellipse at center, transparent 48%, rgba(0,0,0,${(0.85 * slideshow.vignette.strength).toFixed(3)}) 128%)`,
          }}
        />
      )}
      {slideshow.grain.enabled && (
        <div
          ref={grainRef}
          className="pointer-events-none absolute inset-0 z-[2]"
          style={{
            background: `url("${GRAIN_TILE}")`,
            mixBlendMode: "overlay",
            opacity: Math.min(0.55, 0.1 + (slideshow.grain.strength / 30) * 0.5),
          }}
        />
      )}
      {withSubtitles && (
        <span
          className="relative z-[3]"
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
      <div className="absolute right-1.5 top-1.5 z-[4] flex gap-1 opacity-0 transition-opacity duration-[var(--vc-dur-base)] group-hover:opacity-100">
        <button
          type="button"
          title="Своя картинка для превью"
          onClick={pickImage}
          className="flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white/85 hover:bg-black/75 hover:text-white"
        >
          <ImagePlus size={13} strokeWidth={1.5} />
        </button>
        {bgUrl !== null && (
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
