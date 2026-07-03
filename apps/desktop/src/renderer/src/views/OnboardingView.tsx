import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "../components/Button.js";
import { Mark } from "../components/Mark.js";

type StepState = "waiting" | "downloading" | "ready" | "skipped" | "error";

function StepLine({ state, label, note }: { state: StepState; label: string; note?: string }) {
  return (
    <div className="flex items-center gap-2.5 text-[12.5px]">
      {state === "ready" ? (
        <Check size={14} strokeWidth={2} className="shrink-0 text-success" />
      ) : state === "downloading" ? (
        <span className="h-3 w-3 shrink-0 animate-spin rounded-pill border-[1.5px] border-border border-t-accent" />
      ) : (
        <span className="h-1.5 w-1.5 shrink-0 rounded-pill bg-faint" />
      )}
      <span className={state === "skipped" ? "text-faint line-through" : ""}>{label}</span>
      {note && <span className="tnum truncate text-[11.5px] text-muted">{note}</span>}
    </div>
  );
}

/** Первый запуск: скачиваем инструменты, потом «Начать». */
export function OnboardingView({ onDone }: { onDone: () => void }) {
  const [ffmpegState, setFfmpegState] = useState<StepState>("downloading");
  const [whisperState, setWhisperState] = useState<StepState>("waiting");
  const [note, setNote] = useState<Record<string, string>>({});
  const started = useRef(false);

  useEffect(() => {
    const off = window.vicut.on("setup:progress", (payload) => {
      const p = payload as { kind: string; file: string; receivedBytes: number; totalBytes: number | null };
      const mb = Math.round(p.receivedBytes / 1048576);
      const total = p.totalBytes ? ` из ${Math.round(p.totalBytes / 1048576)}` : "";
      setNote((prev) => ({
        ...prev,
        [p.kind === "ffmpeg" ? "ffmpeg" : "whisper"]: `${mb}${total} МБ`,
      }));
    });
    if (!started.current) {
      started.current = true;
      void window.vicut.setup
        .ffmpeg()
        .then(() => setFfmpegState("ready"))
        .catch(() => setFfmpegState("error"));
    }
    return off;
  }, []);

  const downloadWhisper = (): void => {
    setWhisperState("downloading");
    void window.vicut.setup
      .whisper("large-v3-turbo")
      .then(() => setWhisperState("ready"))
      .catch(() => setWhisperState("error"));
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-bg">
      <Mark size={64} />
      <div className="text-center">
        <div className="font-wordmark text-[22px] font-medium">viCut</div>
        <div className="mt-1 text-[13px] text-muted">
          Монтаж по пресетам. Кидаешь видео — получаешь готовое.
        </div>
      </div>

      <div className="flex w-80 flex-col gap-2.5 rounded-lg border border-border bg-surface p-4">
        <StepLine
          state={ffmpegState}
          label={ffmpegState === "ready" ? "FFmpeg готов" : "Скачиваем FFmpeg"}
          note={ffmpegState === "downloading" ? note["ffmpeg"] : undefined}
        />
        <StepLine
          state={whisperState}
          label={
            whisperState === "ready"
              ? "Whisper готов"
              : whisperState === "skipped"
                ? "Whisper — позже, в настройках"
                : "Whisper для субтитров (≈2 ГБ)"
          }
          note={whisperState === "downloading" ? note["whisper"] : undefined}
        />
        {whisperState === "waiting" && (
          <div className="mt-1 flex gap-2">
            <Button variant="primary" onClick={downloadWhisper}>
              Скачать Whisper
            </Button>
            <Button variant="ghost" onClick={() => setWhisperState("skipped")}>
              Пропустить
            </Button>
          </div>
        )}
        {(ffmpegState === "error" || whisperState === "error") && (
          <div className="text-[12px] text-danger">
            Не получилось скачать. Проверь интернет и попробуй ещё раз в настройках.
          </div>
        )}
      </div>

      <Button
        variant="primary"
        disabled={
          ffmpegState !== "ready" ||
          whisperState === "downloading" ||
          whisperState === "waiting"
        }
        onClick={onDone}
        className="h-8 px-5"
      >
        Начать
      </Button>
    </div>
  );
}
