import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, Captions, FolderOpen, GripVertical, Volume2, X } from "lucide-react";
import type { Preset } from "@vicut/core";
import { basename, dirname, formatDuration, stripExtension } from "../../lib/format.js";
import { Button } from "../Button.js";
import { Modal } from "../Modal.js";
import { Segmented } from "../Segmented.js";
import {
  OutputParams,
  paramsFromPreset,
  type OutputField,
  type OutputParamsValue,
} from "../OutputParams.js";

interface WizardFile {
  path: string;
  durationSec: number | null;
  height: number | null;
}

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
    inputs: string[];
    output: string;
    presetName: string;
    title: string;
    overrides: Partial<OutputParamsValue>;
  }) => void;
}) {
  const [step, setStep] = useState<1 | 2>(initialStep);
  const [files, setFiles] = useState<WizardFile[]>(
    initialFiles.map((path) => ({ path, durationSec: null, height: null })),
  );
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState<string>("youtube");
  const [params, setParams] = useState<OutputParamsValue | null>(null);
  const [overridden, setOverridden] = useState<Set<OutputField>>(new Set());
  const [outputDir, setOutputDir] = useState(() => dirname(initialFiles[0] ?? ""));
  const [outputName, setOutputName] = useState(() =>
    initialFiles[0] ? `${stripExtension(basename(initialFiles[0]))} — vicut` : "vicut",
  );
  const dragIndex = useRef<number | null>(null);

  // Метаданные клипов — длительность и высота кадра (для апскейл-подсказки).
  useEffect(() => {
    for (const file of initialFiles) {
      void window.vicut
        .probeFile(file)
        .then((info) => {
          setFiles((prev) =>
            prev.map((f) =>
              f.path === file
                ? { ...f, durationSec: info.durationSec, height: info.video?.height ?? null }
                : f,
            ),
          );
        })
        .catch(() => undefined);
    }
  }, [initialFiles]);

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
    // Непереопределённые поля следуют за пресетом, переопределённые остаются.
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

  const totalDuration = files.reduce((sum, f) => sum + (f.durationSec ?? 0), 0);
  const probedAll = files.every((f) => f.durationSec !== null);
  const maxSourceHeight = files.reduce<number | null>(
    (max, f) => (f.height !== null ? Math.max(max ?? 0, f.height) : max),
    null,
  );

  const reorder = (from: number, to: number): void => {
    if (from === to) return;
    setFiles((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  };

  const submit = (): void => {
    if (!params || !selectedPreset) return;
    const overrides: Partial<OutputParamsValue> = {};
    for (const field of overridden) {
      (overrides as Record<OutputField, unknown>)[field] = params[field];
    }
    onSubmit({
      inputs: files.map((f) => f.path),
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
          <Button variant="primary" disabled={files.length === 0} onClick={() => setStep(2)}>
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
              { value: "audio" as const, label: "Сборка под аудио · скоро" },
            ]}
            value={"stitch" as "stitch" | "audio"}
            onChange={() => undefined}
          />
          <div className="flex flex-col gap-1.5">
            {files.map((file, index) => (
              <div
                key={file.path}
                draggable
                onDragStart={() => (dragIndex.current = index)}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (dragIndex.current !== null && dragIndex.current !== index) {
                    reorder(dragIndex.current, index);
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
                  onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint hover:text-danger"
                >
                  <X size={13} strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
          <div className="text-[12px] text-muted">
            {files.length} клип{files.length === 1 ? "" : files.length < 5 ? "а" : "ов"}
            {probedAll && files.length > 0 ? ` · ${formatDuration(totalDuration)}` : ""}
          </div>
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
