import { useEffect, useState } from "react";
import { Check, Download, FolderOpen, RefreshCw } from "lucide-react";
import type { Config } from "@vicut/core";
import type { ToolsStatus } from "../../../preload/index.js";
import { Button } from "../components/Button.js";
import { Section } from "../components/Section.js";
import { Segmented } from "../components/Segmented.js";
import { useToast } from "../components/toast.js";
import { basename } from "../lib/format.js";
import { applyTheme, getTheme, type Theme } from "../lib/theme.js";

const MODELS = [
  { value: "large-v3-turbo", label: "large-v3-turbo · 1.6 ГБ · рекомендуется" },
  { value: "large-v3", label: "large-v3 · 3.1 ГБ · максимум качества" },
  { value: "medium", label: "medium · 1.5 ГБ" },
  { value: "small", label: "small · 490 МБ" },
  { value: "base", label: "base · 150 МБ" },
];

function StatusRow({
  label,
  ok,
  detail,
  action,
}: {
  label: string;
  ok: boolean;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-[12px] text-muted">{label}</span>
      <span
        className={`flex min-w-0 flex-1 items-center gap-1.5 text-[12px] ${ok ? "" : "text-warning"}`}
      >
        {ok && <Check size={13} strokeWidth={2} className="shrink-0 text-success" />}
        <span className="truncate">{detail}</span>
      </span>
      {action}
    </div>
  );
}

export function SettingsView() {
  const toast = useToast();
  const [config, setConfig] = useState<Config>({});
  const [tools, setTools] = useState<ToolsStatus | null>(null);
  const [theme, setTheme] = useState<Theme>(getTheme());
  const [model, setModel] = useState("large-v3-turbo");
  const [busy, setBusy] = useState<string | null>(null);
  const [downloadNote, setDownloadNote] = useState<string | null>(null);

  const refreshTools = (): void => {
    void window.vicut.tools.status().then(setTools);
  };

  useEffect(() => {
    void window.vicut.config.get().then(setConfig);
    refreshTools();
    return window.vicut.on("setup:progress", (payload) => {
      const p = payload as { kind: string; file: string; receivedBytes: number; totalBytes: number | null };
      const percent = p.totalBytes ? ` ${Math.floor((p.receivedBytes / p.totalBytes) * 100)}%` : "";
      setDownloadNote(`${p.file}${percent}`);
    });
  }, []);

  const saveConfig = (patch: Partial<Config>): void => {
    const next = { ...config, ...patch };
    setConfig(next);
    void window.vicut.config.set(next).then(() => toast("Сохранено"));
  };

  const downloadWhisper = (): void => {
    setBusy("whisper");
    setDownloadNote(null);
    void window.vicut.setup
      .whisper(model)
      .then(() => {
        toast("Whisper готов");
        refreshTools();
      })
      .catch(() => toast("Не получилось — попробуй ещё раз"))
      .finally(() => {
        setBusy(null);
        setDownloadNote(null);
      });
  };

  const redownloadFfmpeg = (): void => {
    setBusy("ffmpeg");
    setDownloadNote(null);
    void window.vicut.setup
      .ffmpeg(true)
      .then(() => {
        toast("FFmpeg обновлён");
        refreshTools();
      })
      .catch(() => toast("Не получилось — попробуй ещё раз"))
      .finally(() => {
        setBusy(null);
        setDownloadNote(null);
      });
  };

  return (
    <div className="flex h-full flex-col px-6 pb-6">
      <div className="flex h-14 shrink-0 items-center">
        <h1 className="text-[18px] font-semibold">Настройки</h1>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pb-2 pr-1">
        <Section title="Транскрипция">
          <div className="flex flex-col gap-3.5">
            <StatusRow
              label="Whisper"
              ok={tools?.whisper != null}
              detail={
                tools?.whisper
                  ? `${tools.whisper}${tools.models.length ? ` · модели: ${tools.models.join(", ")}` : ""}`
                  : "не установлен — субтитры локально работать не будут"
              }
            />
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-[12px] text-muted">Модель</span>
              <select
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className="h-7 min-w-0 rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text outline-none"
              >
                {MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <Button disabled={busy !== null} onClick={downloadWhisper}>
                <Download size={13} strokeWidth={1.5} />
                {busy === "whisper" ? "Скачивание…" : "Скачать"}
              </Button>
              {busy === "whisper" && downloadNote && (
                <span className="tnum truncate text-[11.5px] text-muted">{downloadNote}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-[12px] text-muted">Groq API</span>
              <input
                type="password"
                placeholder="gsk_…  · самый быстрый способ, ~$0.04 за час видео"
                defaultValue={config.groqApiKey ?? ""}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value !== (config.groqApiKey ?? "")) {
                    saveConfig({ groqApiKey: value || undefined });
                  }
                }}
                spellCheck={false}
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text outline-none placeholder:text-faint focus:border-accent"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-[12px] text-muted">OpenAI API</span>
              <input
                type="password"
                placeholder="sk-…"
                defaultValue={config.openaiApiKey ?? ""}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value !== (config.openaiApiKey ?? "")) {
                    saveConfig({ openaiApiKey: value || undefined });
                  }
                }}
                spellCheck={false}
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text outline-none placeholder:text-faint focus:border-accent"
              />
            </div>
            <div className="pl-[124px] text-[11.5px] text-faint">
              Если ключ задан, пресеты с провайдером «Авто» используют облако вместо локального
              Whisper.
            </div>
          </div>
        </Section>

        <Section title="Инструменты">
          <div className="flex flex-col gap-3.5">
            <StatusRow
              label="FFmpeg"
              ok={tools?.ffmpeg != null}
              detail={tools?.ffmpeg ? tools.ffmpeg.version : "не найден"}
              action={
                <Button disabled={busy !== null} onClick={redownloadFfmpeg}>
                  <RefreshCw size={13} strokeWidth={1.5} />
                  {busy === "ffmpeg" ? "Скачивание…" : "Перекачать"}
                </Button>
              }
            />
            {busy === "ffmpeg" && downloadNote && (
              <div className="tnum pl-[124px] text-[11.5px] text-muted">{downloadNote}</div>
            )}
          </div>
        </Section>

        <Section title="Общее">
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-[12px] text-muted">Тема</span>
              <Segmented
                options={[
                  { value: "dark" as const, label: "Тёмная" },
                  { value: "light" as const, label: "Светлая" },
                  { value: "system" as const, label: "Системная" },
                ]}
                value={theme}
                onChange={(next) => {
                  setTheme(next);
                  applyTheme(next);
                }}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-[12px] text-muted">Папка вывода</span>
              <button
                type="button"
                title={config.defaultOutputDir ?? ""}
                onClick={() =>
                  void window.vicut.dialog.pickFolder().then((dir) => {
                    if (dir) saveConfig({ defaultOutputDir: dir });
                  })
                }
                className="flex h-7 min-w-0 max-w-[320px] items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 text-[12px] text-muted hover:text-text"
              >
                <FolderOpen size={14} strokeWidth={1.5} className="shrink-0" />
                <span className="truncate">
                  {config.defaultOutputDir ? basename(config.defaultOutputDir) : "рядом с исходником"}
                </span>
              </button>
              {config.defaultOutputDir && (
                <Button variant="ghost" onClick={() => saveConfig({ defaultOutputDir: undefined })}>
                  Сбросить
                </Button>
              )}
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
