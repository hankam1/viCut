import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Lock, Plus } from "lucide-react";
import type { Preset } from "@vicut/core";
import { Button } from "../components/Button.js";
import { FontSelect } from "../components/FontSelect.js";
import {
  OutputParams,
  paramsFromPreset,
  RESOLUTION_DIMS,
  type OutputField,
  type OutputParamsValue,
} from "../components/OutputParams.js";
import { TextStylePresets } from "../components/TextStylePresets.js";
import { Section } from "../components/Section.js";
import { Segmented } from "../components/Segmented.js";
import { Slider } from "../components/Slider.js";
import { SubtitlePreview } from "../components/SubtitlePreview.js";
import { Toggle } from "../components/Toggle.js";
import { useToast } from "../components/toast.js";

const TRANSITIONS: Array<{ value: Preset["transition"]["type"]; label: string }> = [
  { value: "none", label: "Без перехода" },
  { value: "fade", label: "Fade" },
  { value: "dissolve", label: "Dissolve" },
  { value: "fadeblack", label: "Fade black" },
  { value: "fadewhite", label: "Fade white" },
  { value: "wipeleft", label: "Wipe ←" },
  { value: "wiperight", label: "Wipe →" },
  { value: "slideleft", label: "Slide ←" },
  { value: "slideright", label: "Slide →" },
  { value: "circleopen", label: "Circle open" },
  { value: "circleclose", label: "Circle close" },
];

const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: "auto", label: "Автоопределение" },
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "pt", label: "Português" },
  { value: "uk", label: "Українська" },
  { value: "tr", label: "Türkçe" },
];

function uniqueName(base: string, taken: Set<string>): string {
  let candidate = `${base}-copy`;
  for (let i = 2; taken.has(candidate); i++) candidate = `${base}-copy-${i}`;
  return candidate;
}

export function PresetsView() {
  const toast = useToast();
  const [builtins, setBuiltins] = useState<Preset[]>([]);
  const [userPresets, setUserPresets] = useState<Preset[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [current, setCurrent] = useState<Preset | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async (): Promise<{ builtins: Preset[]; user: Preset[] }> => {
    const lists = await window.vicut.presets.list();
    setBuiltins(lists.builtins);
    setUserPresets(lists.user);
    return lists;
  }, []);

  useEffect(() => {
    void refresh().then(({ builtins: b, user }) => {
      const first = user[0] ?? b[0];
      if (first) {
        setSelectedName(first.name);
        setCurrent(first);
      }
    });
  }, [refresh]);

  const builtinNames = new Set(builtins.map((p) => p.name));
  const readonly = current !== null && builtinNames.has(current.name);
  const allNames = new Set([...builtins, ...userPresets].map((p) => p.name));

  const select = (preset: Preset): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSelectedName(preset.name);
    setCurrent(preset);
  };

  /** Автосохранение: правка → 500 мс тишины → save + toast. */
  const update = (patch: Partial<Preset>): void => {
    setCurrent((prev) => {
      if (!prev || builtinNames.has(prev.name)) return prev;
      const next = { ...prev, ...patch };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void window.vicut.presets.save(next).then(() => {
          toast("Сохранено");
          void refresh();
        });
      }, 500);
      return next;
    });
  };

  const duplicate = async (): Promise<void> => {
    if (!current) return;
    const copy = { ...current, name: uniqueName(current.name, allNames) };
    await window.vicut.presets.save(copy);
    await refresh();
    select(copy);
    toast(`Создан пресет ${copy.name}`);
  };

  const createNew = async (): Promise<void> => {
    const base = builtins.find((p) => p.name === "youtube-subtitled") ?? builtins[0];
    if (!base) return;
    const copy = { ...base, name: uniqueName("my-preset", allNames) };
    await window.vicut.presets.save(copy);
    await refresh();
    select(copy);
    toast(`Создан пресет ${copy.name}`);
  };

  const updateStyle = (patch: Partial<Preset["subtitles"]["style"]>): void => {
    if (!current) return;
    update({
      subtitles: {
        ...current.subtitles,
        style: { ...current.subtitles.style, ...patch },
      },
    });
  };

  const outputParams = current ? paramsFromPreset(current) : null;
  const changeOutputParam = (field: OutputField, value: OutputParamsValue[OutputField]): void => {
    if (!current) return;
    const output = { ...current.output };
    if (field === "resolution") {
      const key = value as OutputParamsValue["resolution"];
      output.resolution = key === "source" ? "source" : RESOLUTION_DIMS[key];
    } else if (field === "fps") {
      output.fps = value as OutputParamsValue["fps"];
    } else {
      output.videoCodec = value as OutputParamsValue["codec"];
    }
    update({ output });
  };

  return (
    <div className="flex h-full flex-col px-6 pb-6">
      <div className="flex h-14 shrink-0 items-center gap-3">
        <h1 className="text-[18px] font-semibold">Пресеты</h1>
        <div className="ml-auto">
          <Button variant="primary" onClick={() => void createNew()}>
            <Plus size={14} strokeWidth={1.5} /> Новый пресет
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Список пресетов */}
        <div className="flex w-52 shrink-0 flex-col gap-1 overflow-y-auto">
          {[...userPresets, ...builtins].map((preset) => {
            const isBuiltin = builtinNames.has(preset.name);
            const active = preset.name === selectedName;
            return (
              <button
                key={preset.name}
                type="button"
                onClick={() => select(preset)}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-[12.5px] transition-colors duration-[var(--vc-dur-fast)] ${
                  active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-text"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                {isBuiltin && <Lock size={12} strokeWidth={1.5} className="shrink-0 text-faint" />}
              </button>
            );
          })}
        </div>

        {/* Редактор */}
        {current && (
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto pb-2 pr-1">
            {readonly && (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2.5 text-[12px] text-muted">
                <Lock size={14} strokeWidth={1.5} className="shrink-0" />
                Встроенный пресет нельзя менять — сделай копию.
                <div className="ml-auto">
                  <Button onClick={() => void duplicate()}>
                    <Copy size={13} strokeWidth={1.5} /> Дублировать и редактировать
                  </Button>
                </div>
              </div>
            )}

            <div className={readonly ? "pointer-events-none flex flex-col gap-2.5 opacity-60" : "flex flex-col gap-2.5"}>
              <Section title="Выход">
                <div className="flex flex-col gap-3.5">
                  <div className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-[12px] text-muted">Качество</span>
                    <Segmented
                      options={[
                        { value: "high" as const, label: "Высокое" },
                        { value: "medium" as const, label: "Среднее" },
                        { value: "low" as const, label: "Низкое" },
                      ]}
                      value={current.output.quality}
                      onChange={(quality) => update({ output: { ...current.output, quality } })}
                    />
                  </div>
                  {outputParams && (
                    <OutputParams value={outputParams} onChange={changeOutputParam} />
                  )}
                </div>
              </Section>

              <Section
                title="Звук"
                aside={
                  <Toggle
                    label="Нормализация громкости"
                    checked={current.audio.normalize}
                    onChange={(normalize) => update({ audio: { ...current.audio, normalize } })}
                  />
                }
              >
                <Slider
                  label="Громкость (LUFS)"
                  value={current.audio.targetLufs}
                  min={-24}
                  max={-8}
                  step={1}
                  neutral={-14}
                  onChange={(targetLufs) => update({ audio: { ...current.audio, targetLufs } })}
                />
                <div className="mt-1.5 pl-[124px] text-[11.5px] text-faint">
                  −14 LUFS — стандарт YouTube.
                </div>
              </Section>

              <Section
                title="Субтитры"
                aside={
                  <Toggle
                    label="Субтитры"
                    checked={current.subtitles.enabled}
                    onChange={(enabled) => update({ subtitles: { ...current.subtitles, enabled } })}
                  />
                }
              >
                <div className="flex flex-col gap-3.5">
                  <div className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-[12px] text-muted">Распознавание</span>
                    <Segmented
                      options={[
                        { value: "auto" as const, label: "Авто" },
                        { value: "whisper-local" as const, label: "Локально" },
                        { value: "groq" as const, label: "Groq" },
                        { value: "openai" as const, label: "OpenAI" },
                      ]}
                      value={current.subtitles.provider}
                      onChange={(provider) =>
                        update({ subtitles: { ...current.subtitles, provider } })
                      }
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-[12px] text-muted">Язык</span>
                    <select
                      value={current.subtitles.language}
                      onChange={(event) =>
                        update({
                          subtitles: { ...current.subtitles, language: event.target.value },
                        })
                      }
                      className="h-7 rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text outline-none"
                    >
                      {LANGUAGES.map((lang) => (
                        <option key={lang.value} value={lang.value}>
                          {lang.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-[12px] text-muted">Шрифт</span>
                    <FontSelect
                      value={current.subtitles.style.fontFamily}
                      onChange={(fontFamily) => updateStyle({ fontFamily })}
                    />
                    <label className="flex items-center gap-2 text-[12px] text-muted">
                      <Toggle
                        label="Жирный"
                        checked={current.subtitles.style.bold}
                        onChange={(bold) => updateStyle({ bold })}
                      />
                      Жирный
                    </label>
                    <label className="flex items-center gap-2 text-[12px] text-muted">
                      <Toggle
                        label="Заглавными"
                        checked={current.subtitles.style.uppercase}
                        onChange={(uppercase) => updateStyle({ uppercase })}
                      />
                      Заглавными
                    </label>
                  </div>
                  <Slider
                    label="Размер"
                    value={current.subtitles.style.fontSize}
                    min={24}
                    max={96}
                    step={2}
                    neutral={48}
                    onChange={(fontSize) => updateStyle({ fontSize })}
                  />
                  <div className="flex items-start gap-3">
                    <span className="w-28 shrink-0 pt-1.5 text-[12px] text-muted">Стиль текста</span>
                    <TextStylePresets style={current.subtitles.style} onApply={updateStyle} />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-[12px] text-muted">Цвет / обводка</span>
                    <input
                      type="color"
                      aria-label="Цвет текста"
                      value={current.subtitles.style.primaryColor.slice(0, 7)}
                      onChange={(event) =>
                        updateStyle({ primaryColor: event.target.value.toUpperCase() })
                      }
                      className="h-7 w-10 cursor-pointer rounded-md border border-border bg-surface-2"
                    />
                    <input
                      type="color"
                      aria-label="Цвет обводки"
                      value={current.subtitles.style.outlineColor.slice(0, 7)}
                      onChange={(event) =>
                        updateStyle({ outlineColor: event.target.value.toUpperCase() })
                      }
                      className="h-7 w-10 cursor-pointer rounded-md border border-border bg-surface-2"
                    />
                    <span className="w-16" />
                    <span className="shrink-0 text-[12px] text-muted">Позиция</span>
                    <Segmented
                      options={[
                        { value: "bottom" as const, label: "Низ" },
                        { value: "center" as const, label: "Центр" },
                        { value: "top" as const, label: "Верх" },
                      ]}
                      value={current.subtitles.style.position}
                      onChange={(position) => updateStyle({ position })}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-[12px] text-muted">Анимация</span>
                    <Segmented
                      options={[
                        { value: "none" as const, label: "Нет" },
                        { value: "appear" as const, label: "Появление" },
                        { value: "highlight" as const, label: "Подсветка" },
                        { value: "appear-highlight" as const, label: "Оба" },
                      ]}
                      value={current.subtitles.style.animation}
                      onChange={(animation) => updateStyle({ animation })}
                    />
                    {current.subtitles.style.animation !== "none" &&
                      current.subtitles.style.animation !== "appear" && (
                        <>
                          <span className="shrink-0 text-[12px] text-muted">Цвет слова</span>
                          <input
                            type="color"
                            aria-label="Цвет активного слова"
                            value={current.subtitles.style.highlightColor.slice(0, 7)}
                            onChange={(event) =>
                              updateStyle({ highlightColor: event.target.value.toUpperCase() })
                            }
                            className="h-7 w-10 cursor-pointer rounded-md border border-border bg-surface-2"
                          />
                        </>
                      )}
                  </div>
                  <div className="pl-[124px] text-[11.5px] text-faint">
                    Появление — слова возникают по мере произнесения; подсветка — активное слово
                    выделяется цветом.
                  </div>
                  <SubtitlePreview style={current.subtitles.style} />
                  <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2 text-[12px] text-muted">
                      <Toggle
                        label="Вшить в видео"
                        checked={current.subtitles.burnIn}
                        onChange={(burnIn) =>
                          update({ subtitles: { ...current.subtitles, burnIn } })
                        }
                      />
                      Вшить в видео
                    </label>
                    <label className="flex items-center gap-2 text-[12px] text-muted">
                      <Toggle
                        label="Сохранить .srt"
                        checked={current.subtitles.exportSrt}
                        onChange={(exportSrt) =>
                          update({ subtitles: { ...current.subtitles, exportSrt } })
                        }
                      />
                      Сохранить .srt
                    </label>
                  </div>
                </div>
              </Section>

              <Section title="Переходы">
                <div className="flex flex-col gap-3.5">
                  <div className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-[12px] text-muted">Тип</span>
                    <select
                      value={current.transition.type}
                      onChange={(event) =>
                        update({
                          transition: {
                            ...current.transition,
                            type: event.target.value as Preset["transition"]["type"],
                          },
                        })
                      }
                      className="h-7 rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text outline-none"
                    >
                      {TRANSITIONS.map((transition) => (
                        <option key={transition.value} value={transition.value}>
                          {transition.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {current.transition.type !== "none" && (
                    <Slider
                      label="Длительность"
                      value={current.transition.durationSec}
                      min={0.2}
                      max={2}
                      step={0.1}
                      neutral={0.5}
                      format={(v) => `${v.toFixed(1)}с`}
                      onChange={(durationSec) =>
                        update({ transition: { ...current.transition, durationSec } })
                      }
                    />
                  )}
                </div>
              </Section>

              <Section title="Эффекты" defaultOpen={false}>
                <div className="flex flex-col gap-3">
                  <Slider
                    label="Яркость"
                    value={current.effects.brightness}
                    min={-0.5}
                    max={0.5}
                    step={0.05}
                    neutral={0}
                    format={(v) => v.toFixed(2)}
                    onChange={(brightness) => update({ effects: { ...current.effects, brightness } })}
                  />
                  <Slider
                    label="Контраст"
                    value={current.effects.contrast}
                    min={0.5}
                    max={2}
                    step={0.05}
                    neutral={1}
                    format={(v) => v.toFixed(2)}
                    onChange={(contrast) => update({ effects: { ...current.effects, contrast } })}
                  />
                  <Slider
                    label="Насыщенность"
                    value={current.effects.saturation}
                    min={0}
                    max={2}
                    step={0.05}
                    neutral={1}
                    format={(v) => v.toFixed(2)}
                    onChange={(saturation) => update({ effects: { ...current.effects, saturation } })}
                  />
                  <Slider
                    label="Резкость"
                    value={current.effects.sharpen}
                    min={0}
                    max={2}
                    step={0.1}
                    neutral={0}
                    format={(v) => v.toFixed(1)}
                    onChange={(sharpen) => update({ effects: { ...current.effects, sharpen } })}
                  />
                </div>
              </Section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
