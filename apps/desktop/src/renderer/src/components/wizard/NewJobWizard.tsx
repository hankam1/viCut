import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft,
  Captions,
  FolderOpen,
  GripVertical,
  Images,
  Music,
  Plus,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import type { JobSpec, Preset } from "@vicut/core";
import { basename, dirname, formatDuration, stripExtension } from "../../lib/format.js";
import { Button } from "../Button.js";
import { Modal } from "../Modal.js";
import { Segmented } from "../Segmented.js";
import { useToast } from "../toast.js";
import {
  OutputParams,
  paramsFromPreset,
  type OutputField,
  type OutputParamsValue,
} from "../OutputParams.js";

type JobType = "stitch" | "audio";

/** Пути из drag&drop; папки разворачивает media.classify. */
function pathsFromDrop(event: React.DragEvent): string[] {
  return Array.from(event.dataTransfer.files).map((file) => window.vicut.getPathForFile(file));
}

interface WFile {
  path: string;
  durationSec: number | null;
}

interface WSection {
  id: number;
  audio: WFile | null;
  kind: "clips" | "images" | null;
  visuals: WFile[];
}

let nextSectionId = 1;

function StepIndicator({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center gap-1.5 text-[11.5px] text-faint">
      <span className={step === 1 ? "font-medium text-accent" : undefined}>1 · Файлы</span>
      <span>→</span>
      <span className={step === 2 ? "font-medium text-accent" : undefined}>2 · Пресет и выход</span>
    </div>
  );
}

function PresetCard({
  preset,
  selected,
  onSelect,
}: {
  preset: Preset;
  selected: boolean;
  onSelect: () => void;
}) {
  const hints = [
    { icon: Captions, on: preset.subtitles.enabled, label: "Субтитры" },
    { icon: ArrowRightLeft, on: preset.transition.type !== "none", label: "Переходы" },
    { icon: Volume2, on: preset.audio.normalize, label: "Громкость" },
  ];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-40 shrink-0 flex-col gap-2 rounded-lg border p-3 text-left transition-colors duration-[var(--vc-dur-fast)] ${
        selected ? "border-accent bg-accent-soft/40" : "border-border bg-surface-2 hover:border-faint"
      }`}
    >
      <span className="truncate text-[12.5px] font-medium">{preset.name}</span>
      <span className="flex items-center gap-2">
        {hints.map(({ icon: Icon, on, label }) => (
          <Icon
            key={label}
            size={14}
            strokeWidth={1.5}
            aria-label={`${label}: ${on ? "вкл" : "выкл"}`}
            className={on ? "text-accent" : "text-faint opacity-50"}
          />
        ))}
      </span>
    </button>
  );
}

/** Живой расчёт тайминга секции (ключевая обратная связь типа B). */
function sectionTiming(section: WSection): { text: string; warn: string | null } | null {
  const audioDur = section.audio?.durationSec;
  if (!audioDur || section.visuals.length === 0) return null;
  const n = section.visuals.length;

  if (section.kind === "images") {
    const per = audioDur / n;
    return {
      text: `${n} картин${n === 1 ? "ка" : n < 5 ? "ки" : "ок"} → по ${per.toFixed(1)} сек · итого ${formatDuration(audioDur)}`,
      warn: per < 0.3 ? "меньше 0.3 сек на картинку — будет мельтешить" : null,
    };
  }

  if (section.visuals.some((v) => v.durationSec === null)) {
    return { text: "считаем длительности…", warn: null };
  }
  const total = section.visuals.reduce((sum, v) => sum + (v.durationSec ?? 0), 0);
  const speed = total / audioDur;
  const action = speed >= 1 ? "ускорение" : "замедление";
  return {
    text: `${n} клип${n === 1 ? "" : n < 5 ? "а" : "ов"} · ${formatDuration(total)} → ${action} ×${speed.toFixed(2)}, чтобы уложиться в ${formatDuration(audioDur)}`,
    warn:
      speed > 2
        ? `ускорение ×${speed.toFixed(1)} — клипы будут заметно быстрее`
        : speed < 0.5
          ? `замедление ×${speed.toFixed(1)} — клипы будут заметно медленнее`
          : null,
  };
}

export function NewJobWizard({
  initialFiles,
  initialStep = 1,
  onClose,
  onSubmit,
}: {
  initialFiles: string[];
  initialStep?: 1 | 2;
  onClose: () => void;
  onSubmit: (payload: {
    spec: JobSpec;
    output: string;
    presetName: string;
    title: string;
    overrides: Partial<OutputParamsValue>;
  }) => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<1 | 2>(initialStep);
  const [jobType, setJobType] = useState<JobType>("stitch");
  const [clips, setClips] = useState<WFile[]>([]);
  const [sections, setSections] = useState<WSection[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState<string>("youtube");
  const [params, setParams] = useState<OutputParamsValue | null>(null);
  const [overridden, setOverridden] = useState<Set<OutputField>>(new Set());
  const [outputDir, setOutputDir] = useState(() => dirname(initialFiles[0] ?? ""));
  const [outputName, setOutputName] = useState(() =>
    initialFiles[0] ? `${stripExtension(basename(initialFiles[0]))} — vicut` : "vicut",
  );
  const dragIndex = useRef<number | null>(null);
  const [maxSourceHeight, setMaxSourceHeight] = useState<number | null>(null);
  /** Подсвеченная под drag&drop цель: "clips" | "<sectionId>:audio" | "<sectionId>:visuals". */
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  /** Длительность файла подтягивается асинхронно и во все места сразу. */
  const probeDuration = (filePath: string): void => {
    void window.vicut
      .probeFile(filePath)
      .then((info) => {
        const height = info.video?.height;
        if (height) setMaxSourceHeight((prev) => Math.max(prev ?? 0, height));
        const patch = (f: WFile): WFile =>
          f.path === filePath ? { ...f, durationSec: info.durationSec } : f;
        setClips((prev) => prev.map(patch));
        setSections((prev) =>
          prev.map((s) => ({
            ...s,
            audio: s.audio ? patch(s.audio) : null,
            visuals: s.visuals.map(patch),
          })),
        );
      })
      .catch(() => undefined);
  };

  const makeFiles = (paths: string[], probe: boolean): WFile[] =>
    paths.map((p) => {
      if (probe) probeDuration(p);
      return { path: p, durationSec: null };
    });

  // Разбор брошенных файлов: аудио есть → тип B с черновой раскладкой секций.
  useEffect(() => {
    void window.vicut.media.classify(initialFiles).then(({ audios, clips: vids, images }) => {
      setClips(makeFiles(vids, true));
      if (audios.length > 0) {
        const drafts: WSection[] = audios.map((audio) => ({
          id: nextSectionId++,
          audio: makeFiles([audio], true)[0]!,
          kind: null,
          visuals: [],
        }));
        if (drafts.length >= 2 && vids.length > 0 && images.length > 0) {
          drafts[0]! = { ...drafts[0]!, kind: "clips", visuals: makeFiles(vids, true) };
          drafts[1]! = { ...drafts[1]!, kind: "images", visuals: makeFiles(images, false) };
        } else if (vids.length > 0) {
          drafts[0]! = { ...drafts[0]!, kind: "clips", visuals: makeFiles(vids, true) };
        } else if (images.length > 0) {
          drafts[0]! = { ...drafts[0]!, kind: "images", visuals: makeFiles(images, false) };
        }
        setSections(drafts);
        setJobType("audio");
      } else {
        setSections([{ id: nextSectionId++, audio: null, kind: null, visuals: [] }]);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiles]);

  // Папка вывода по умолчанию из настроек (если задана).
  useEffect(() => {
    void window.vicut.config.get().then((config) => {
      if (config.defaultOutputDir) setOutputDir(config.defaultOutputDir);
    });
  }, []);

  useEffect(() => {
    void window.vicut.presets.list().then(({ builtins, user }) => {
      const all = [...user, ...builtins];
      setPresets(all);
      const initial = all.find((p) => p.name === "youtube") ?? all[0];
      if (initial) {
        setPresetName(initial.name);
        setParams(paramsFromPreset(initial));
      }
    });
  }, []);

  const selectedPreset = presets.find((p) => p.name === presetName) ?? null;

  const selectPreset = (preset: Preset): void => {
    setPresetName(preset.name);
    setParams((prev) => {
      const base = paramsFromPreset(preset);
      if (!prev) return base;
      const next = { ...base };
      for (const field of overridden) {
        (next as Record<OutputField, unknown>)[field] = prev[field];
      }
      return next;
    });
  };

  const changeParam = (field: OutputField, value: OutputParamsValue[OutputField]): void => {
    setParams((prev) => (prev ? { ...prev, [field]: value } : prev));
    setOverridden((prev) => {
      const base = selectedPreset ? paramsFromPreset(selectedPreset) : null;
      const next = new Set(prev);
      if (base && base[field] === value) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const resetParam = (field: OutputField): void => {
    if (!selectedPreset) return;
    const base = paramsFromPreset(selectedPreset);
    setParams((prev) => (prev ? { ...prev, [field]: base[field] } : prev));
    setOverridden((prev) => {
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  };

  /* ── Тип A ── */
  const totalClipsDuration = clips.reduce((sum, f) => sum + (f.durationSec ?? 0), 0);
  const probedAll = clips.every((f) => f.durationSec !== null);
  const reorderClips = (from: number, to: number): void => {
    if (from === to) return;
    setClips((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  };

  /* ── Тип B ── */
  const patchSection = (id: number, patch: Partial<WSection>): void => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const addSectionAudio = (id: number): void => {
    void window.vicut.dialog.pickAudio().then((audio) => {
      if (audio) patchSection(id, { audio: makeFiles([audio], true)[0]! });
    });
  };

  const addVisualPaths = async (section: WSection, paths: string[]): Promise<void> => {
    if (paths.length === 0) return;
    const { clips: vids, images } = await window.vicut.media.classify(paths);
    if (vids.length === 0 && images.length === 0) {
      toast("Нет подходящих клипов или картинок");
      return;
    }
    const incomingKind = vids.length >= images.length ? "clips" : "images";
    const incoming = incomingKind === "clips" ? vids : images;
    if (vids.length > 0 && images.length > 0) {
      toast("В одной секции — либо клипы, либо картинки");
      return;
    }
    if (section.kind && section.kind !== incomingKind && section.visuals.length > 0) {
      toast(`В этой секции уже ${section.kind === "clips" ? "клипы" : "картинки"}`);
      return;
    }
    patchSection(section.id, {
      kind: incomingKind,
      visuals: [...section.visuals, ...makeFiles(incoming, incomingKind === "clips")],
    });
  };

  const addSectionVisuals = (section: WSection, viaFolder: boolean): void => {
    const pick = viaFolder
      ? window.vicut.dialog.pickFolder().then((dir) => (dir ? [dir] : []))
      : window.vicut.dialog.pickVisuals();
    void pick.then((paths) => addVisualPaths(section, paths));
  };

  const dropSectionAudio = async (id: number, paths: string[]): Promise<void> => {
    const { audios } = await window.vicut.media.classify(paths);
    if (audios.length === 0) {
      toast("Сюда нужен аудиофайл");
      return;
    }
    patchSection(id, { audio: makeFiles([audios[0]!], true)[0]! });
    if (audios.length > 1) toast("Аудио несколько — взят первый файл");
  };

  const dropStitchClips = async (paths: string[]): Promise<void> => {
    const { clips: vids } = await window.vicut.media.classify(paths);
    if (vids.length === 0) {
      toast("Сюда нужны видеоклипы");
      return;
    }
    setClips((prev) => {
      const known = new Set(prev.map((f) => f.path));
      return [...prev, ...makeFiles(vids.filter((p) => !known.has(p)), true)];
    });
  };

  /** Пропсы drag&drop для слота: подсветка цели + обработка брошенных путей. */
  const slotDropProps = (key: string, handle: (paths: string[]) => void) => ({
    onDragOver: (event: React.DragEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(key);
    },
    onDragLeave: (): void => setDropTarget((prev) => (prev === key ? null : prev)),
    onDrop: (event: React.DragEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(null);
      handle(pathsFromDrop(event));
    },
  });

  const slotClass = (key: string): string =>
    `-mx-1.5 rounded-md border border-dashed px-1.5 py-1 transition-colors duration-[var(--vc-dur-fast)] ${
      dropTarget === key ? "border-accent bg-accent-soft/40" : "border-transparent"
    }`;

  const sectionsReady =
    sections.length > 0 &&
    sections.every((s) => s.audio?.durationSec != null && s.visuals.length > 0);

  const canProceed = jobType === "stitch" ? clips.length > 0 : sectionsReady;

  const submit = (): void => {
    if (!params || !selectedPreset) return;
    const overrides: Partial<OutputParamsValue> = {};
    for (const field of overridden) {
      (overrides as Record<OutputField, unknown>)[field] = params[field];
    }
    const spec: JobSpec =
      jobType === "stitch"
        ? { kind: "stitch", inputs: clips.map((f) => f.path) }
        : {
            kind: "audio-driven",
            sections: sections.map((s) => ({
              audio: s.audio!.path,
              visuals: { kind: s.kind ?? "clips", files: s.visuals.map((f) => f.path) },
            })),
          };
    onSubmit({
      spec,
      output: `${outputDir}\\${outputName}.mp4`,
      presetName: selectedPreset.name,
      title: outputName,
      overrides,
    });
  };

  return (
    <Modal title="Новая задача" header={<StepIndicator step={step} />} onClose={onClose}
      footer={
        step === 1 ? (
          <Button variant="primary" disabled={!canProceed} onClick={() => setStep(2)}>
            Далее
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep(1)}>
              Назад
            </Button>
            <Button variant="primary" disabled={!params || !outputName.trim()} onClick={submit}>
              В очередь
            </Button>
          </>
        )
      }
    >
      {step === 1 ? (
        <div className="flex flex-col gap-3">
          <Segmented
            options={[
              { value: "stitch" as const, label: "Склейка клипов" },
              { value: "audio" as const, label: "Сборка под аудио" },
            ]}
            value={jobType}
            onChange={setJobType}
          />

          {jobType === "stitch" ? (
            <div {...slotDropProps("clips", (paths) => void dropStitchClips(paths))} className={slotClass("clips")}>
              <div className="flex flex-col gap-1.5">
                {clips.length === 0 && (
                  <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] text-faint">
                    Перетащи клипы сюда
                  </div>
                )}
                {clips.map((file, index) => (
                  <div
                    key={file.path}
                    draggable
                    onDragStart={() => (dragIndex.current = index)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (dragIndex.current !== null && dragIndex.current !== index) {
                        reorderClips(dragIndex.current, index);
                        dragIndex.current = index;
                      }
                    }}
                    onDragEnd={() => (dragIndex.current = null)}
                    className="flex cursor-grab items-center gap-2.5 rounded-md border border-border bg-surface-2 px-2.5 py-2 active:cursor-grabbing"
                  >
                    <GripVertical size={14} strokeWidth={1.5} className="shrink-0 text-faint" />
                    <span className="tnum w-5 shrink-0 text-[11.5px] text-faint">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">{basename(file.path)}</span>
                    <span className="tnum shrink-0 text-[11.5px] text-muted">
                      {file.durationSec !== null ? formatDuration(file.durationSec) : "…"}
                    </span>
                    <button
                      type="button"
                      aria-label="Убрать клип"
                      onClick={() => setClips((prev) => prev.filter((_, i) => i !== index))}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint hover:text-danger"
                    >
                      <X size={13} strokeWidth={1.5} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 text-[12px] text-muted">
                {clips.length} клип{clips.length === 1 ? "" : clips.length < 5 ? "а" : "ов"}
                {probedAll && clips.length > 0 ? ` · ${formatDuration(totalClipsDuration)}` : ""}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {sections.map((section, index) => {
                const timing = sectionTiming(section);
                const missingAudio = !section.audio;
                const missingVisuals = section.visuals.length === 0;
                return (
                  <div
                    key={section.id}
                    className={`flex flex-col gap-2.5 rounded-lg border p-3 ${
                      missingAudio || missingVisuals ? "border-warning/40" : "border-border"
                    } bg-surface-2`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium">Секция {index + 1}</span>
                      {section.kind && (
                        <span className="rounded-pill bg-surface px-2 py-0.5 text-[11px] text-muted">
                          {section.kind === "clips" ? "клипы" : "картинки"}
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label="Удалить секцию"
                        onClick={() =>
                          setSections((prev) => prev.filter((s) => s.id !== section.id))
                        }
                        className="ml-auto flex h-5 w-5 items-center justify-center rounded text-faint hover:text-danger"
                      >
                        <Trash2 size={13} strokeWidth={1.5} />
                      </button>
                    </div>

                    {/* Слот аудио — «хозяин» длительности секции */}
                    <div
                      {...slotDropProps(`${section.id}:audio`, (paths) =>
                        void dropSectionAudio(section.id, paths),
                      )}
                      className={`flex items-center gap-2 ${slotClass(`${section.id}:audio`)}`}
                    >
                      <Music size={14} strokeWidth={1.5} className="shrink-0 text-faint" />
                      {section.audio ? (
                        <>
                          <span className="min-w-0 flex-1 truncate text-[12.5px]">
                            {basename(section.audio.path)}
                          </span>
                          <span className="tnum shrink-0 text-[11.5px] text-accent">
                            {section.audio.durationSec !== null
                              ? formatDuration(section.audio.durationSec)
                              : "…"}
                          </span>
                          <button
                            type="button"
                            aria-label="Убрать аудио"
                            onClick={() => patchSection(section.id, { audio: null })}
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint hover:text-danger"
                          >
                            <X size={13} strokeWidth={1.5} />
                          </button>
                        </>
                      ) : (
                        <>
                          <Button variant="ghost" onClick={() => addSectionAudio(section.id)}>
                            <Plus size={13} strokeWidth={1.5} /> Аудио
                          </Button>
                          <span className="text-[11.5px] text-warning">
                            аудио задаёт длительность секции
                          </span>
                        </>
                      )}
                    </div>

                    {/* Слот визуала */}
                    <div
                      {...slotDropProps(`${section.id}:visuals`, (paths) =>
                        void addVisualPaths(section, paths),
                      )}
                      className={`flex items-center gap-2 ${slotClass(`${section.id}:visuals`)}`}
                    >
                      <Images size={14} strokeWidth={1.5} className="shrink-0 text-faint" />
                      {section.visuals.length > 0 ? (
                        <>
                          <span className="min-w-0 flex-1 truncate text-[12.5px]">
                            {section.visuals.length}{" "}
                            {section.kind === "images" ? "картинок" : "клипов"}
                            <span className="text-faint">
                              {" "}
                              · {basename(section.visuals[0]!.path)}
                              {section.visuals.length > 1 ? " …" : ""}
                            </span>
                          </span>
                          <Button variant="ghost" onClick={() => addSectionVisuals(section, false)}>
                            <Plus size={13} strokeWidth={1.5} />
                          </Button>
                          <button
                            type="button"
                            aria-label="Очистить визуал"
                            onClick={() => patchSection(section.id, { visuals: [], kind: null })}
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint hover:text-danger"
                          >
                            <X size={13} strokeWidth={1.5} />
                          </button>
                        </>
                      ) : (
                        <>
                          <Button variant="ghost" onClick={() => addSectionVisuals(section, false)}>
                            <Plus size={13} strokeWidth={1.5} /> Клипы или картинки
                          </Button>
                          <Button variant="ghost" onClick={() => addSectionVisuals(section, true)}>
                            <FolderOpen size={13} strokeWidth={1.5} /> Папка
                          </Button>
                          <span className="text-[11.5px] text-faint">или перетащи сюда</span>
                        </>
                      )}
                    </div>

                    {timing && (
                      <div className="text-[11.5px]">
                        <span className="text-muted">{timing.text}</span>
                        {timing.warn && (
                          <span className="ml-2 rounded-pill bg-warning/15 px-2 py-0.5 text-[10.5px] font-medium text-warning">
                            {timing.warn}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <Button
                variant="ghost"
                className="self-start"
                onClick={() =>
                  setSections((prev) => [
                    ...prev,
                    { id: nextSectionId++, audio: null, kind: null, visuals: [] },
                  ])
                }
              >
                <Plus size={13} strokeWidth={1.5} /> Добавить секцию
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <div className="mb-2 text-[11.5px] text-muted">Пресет</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {presets.map((preset) => (
                <PresetCard
                  key={preset.name}
                  preset={preset}
                  selected={preset.name === presetName}
                  onSelect={() => selectPreset(preset)}
                />
              ))}
            </div>
          </div>

          {params && (
            <div>
              <div className="mb-2 text-[11.5px] text-muted">Параметры вывода</div>
              <OutputParams
                value={params}
                overridden={overridden}
                onChange={changeParam}
                onReset={resetParam}
                maxSourceHeight={maxSourceHeight}
              />
            </div>
          )}

          <div>
            <div className="mb-2 text-[11.5px] text-muted">Куда сохранить</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                title={outputDir}
                onClick={() =>
                  void window.vicut.dialog.pickFolder().then((dir) => dir && setOutputDir(dir))
                }
                className="flex h-8 min-w-0 max-w-[220px] items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 text-[12px] text-muted hover:text-text"
              >
                <FolderOpen size={14} strokeWidth={1.5} className="shrink-0" />
                <span className="truncate">{basename(outputDir)}</span>
              </button>
              <input
                value={outputName}
                onChange={(event) => setOutputName(event.target.value)}
                spellCheck={false}
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2.5 text-[12.5px] text-text outline-none focus:border-accent"
              />
              <span className="text-[12px] text-faint">.mp4</span>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
