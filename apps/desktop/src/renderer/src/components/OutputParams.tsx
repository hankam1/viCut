import { RotateCcw } from "lucide-react";
import type { Preset } from "@vicut/core";
import { Segmented } from "./Segmented.js";

export type ResolutionKey = "source" | "480p" | "720p" | "1080p" | "1440p" | "2160p";

export interface OutputParamsValue {
  resolution: ResolutionKey;
  fps: "source" | 30 | 60;
  codec: "h264" | "hevc";
}

export type OutputField = keyof OutputParamsValue;

const RESOLUTION_OPTIONS: Array<{ value: ResolutionKey; label: string }> = [
  { value: "source", label: "Как у исходника" },
  { value: "480p", label: "480p" },
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "1440p", label: "1440p" },
  { value: "2160p", label: "4K" },
];

export const RESOLUTION_HEIGHTS: Record<Exclude<ResolutionKey, "source">, number> = {
  "480p": 480,
  "720p": 720,
  "1080p": 1080,
  "1440p": 1440,
  "2160p": 2160,
};

export const RESOLUTION_DIMS: Record<
  Exclude<ResolutionKey, "source">,
  { width: number; height: number }
> = {
  "480p": { width: 854, height: 480 },
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
  "2160p": { width: 3840, height: 2160 },
};

/** Значения OutputParams, унаследованные из пресета. */
export function paramsFromPreset(preset: Preset): OutputParamsValue {
  const res = preset.output.resolution;
  let resolution: ResolutionKey = "source";
  if (res !== "source") {
    const match = (Object.entries(RESOLUTION_HEIGHTS) as Array<[ResolutionKey, number]>).find(
      ([, height]) => height === res.height,
    );
    resolution = match?.[0] ?? "source";
  }
  const fps = preset.output.fps === "source" ? "source" : preset.output.fps >= 45 ? 60 : 30;
  return { resolution, fps, codec: preset.output.videoCodec };
}

function FieldLabel({
  label,
  overridden,
  onReset,
}: {
  label: string;
  overridden: boolean;
  onReset: () => void;
}) {
  return (
    <div className="flex h-5 items-center gap-1.5">
      <span className="text-[11.5px] text-muted">{label}</span>
      {overridden && (
        <>
          <span className="rounded-pill bg-accent-soft px-1.5 py-px text-[10.5px] font-medium text-accent">
            изменено
          </span>
          <button
            type="button"
            aria-label={`Сбросить ${label} к пресету`}
            title="Сбросить к пресету"
            onClick={onReset}
            className="flex h-4 w-4 items-center justify-center rounded text-muted hover:text-text"
          >
            <RotateCcw size={11} strokeWidth={1.5} />
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Ряд «Параметры вывода» — единый компонент для мастера задачи (с логикой
 * «изменено»/сброс) и редактора пресетов (overridden не передаётся).
 */
export function OutputParams({
  value,
  overridden,
  onChange,
  onReset,
  maxSourceHeight,
}: {
  value: OutputParamsValue;
  /** Какие поля переопределены относительно пресета (мастер задачи). */
  overridden?: Set<OutputField>;
  onChange: (field: OutputField, fieldValue: OutputParamsValue[OutputField]) => void;
  onReset?: (field: OutputField) => void;
  /** Наибольшая высота кадра исходников — для предупреждения об апскейле. */
  maxSourceHeight?: number | null;
}) {
  const isOverridden = (field: OutputField): boolean => overridden?.has(field) ?? false;
  const chosenHeight =
    value.resolution === "source" ? null : RESOLUTION_HEIGHTS[value.resolution];
  const upscale =
    chosenHeight !== null && maxSourceHeight != null && chosenHeight > maxSourceHeight;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <FieldLabel
            label="Разрешение"
            overridden={isOverridden("resolution")}
            onReset={() => onReset?.("resolution")}
          />
          <select
            value={value.resolution}
            onChange={(event) => onChange("resolution", event.target.value as ResolutionKey)}
            className={`h-7 rounded-md border bg-surface-2 px-2 text-[12px] font-medium text-text outline-none ${
              isOverridden("resolution") ? "border-accent" : "border-border"
            }`}
          >
            {RESOLUTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel
            label="Частота кадров"
            overridden={isOverridden("fps")}
            onReset={() => onReset?.("fps")}
          />
          <Segmented
            accent={isOverridden("fps")}
            options={[
              { value: "source" as const, label: "Исходник" },
              { value: 30 as const, label: "30" },
              { value: 60 as const, label: "60" },
            ]}
            value={value.fps}
            onChange={(fps) => onChange("fps", fps)}
          />
        </div>

        <div>
          <FieldLabel
            label="Кодек"
            overridden={isOverridden("codec")}
            onReset={() => onReset?.("codec")}
          />
          <Segmented
            accent={isOverridden("codec")}
            options={[
              { value: "h264" as const, label: "H.264" },
              { value: "hevc" as const, label: "H.265" },
            ]}
            value={value.codec}
            onChange={(codec) => onChange("codec", codec)}
          />
        </div>
      </div>

      <div className="mt-1.5 text-[11.5px] text-faint">
        H.264 — максимальная совместимость, H.265 — меньше вес файла.
      </div>
      {upscale && (
        <div className="mt-1 text-[11.5px] text-warning">
          Исходник ниже ({maxSourceHeight}p) — картинка не станет чётче.
        </div>
      )}
    </div>
  );
}
