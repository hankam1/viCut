import { useCallback, useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "../components/Button.js";
import { JobCard } from "../components/JobCard.js";
import { Mark } from "../components/Mark.js";
import { NewJobWizard } from "../components/wizard/NewJobWizard.js";
import { useQueue } from "../hooks/useQueue.js";

const VIDEO_EXT = new Set(["mp4", "mov", "mkv", "avi", "webm", "m4v", "mts", "ts"]);

function videoPathsFromDrop(files: FileList): string[] {
  return Array.from(files)
    .map((file) => window.vicut.getPathForFile(file))
    .filter((p) => VIDEO_EXT.has(p.split(".").pop()?.toLowerCase() ?? ""));
}

export function QueueView() {
  const queue = useQueue();
  const [dragOver, setDragOver] = useState(false);
  const [wizardFiles, setWizardFiles] = useState<string[] | null>(null);
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);

  const addInputs = useCallback((inputs: string[]) => {
    if (inputs.length > 0) {
      setWizardStep(1);
      setWizardFiles(inputs);
    }
  }, []);

  useEffect(
    () =>
      window.vicut.on("debug:open-wizard", (payload) => {
        const paths = payload as string[];
        setWizardStep(paths[0] === "--step2" ? 2 : 1);
        setWizardFiles(paths.filter((p) => p !== "--step2"));
      }),
    [],
  );

  const pickFiles = useCallback(() => {
    void window.vicut.dialog.pickVideos().then(addInputs);
  }, [addInputs]);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragOver(false);
      addInputs(videoPathsFromDrop(event.dataTransfer.files));
    },
    [addInputs],
  );

  const dragProps = {
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      setDragOver(true);
    },
    onDragLeave: () => setDragOver(false),
    onDrop,
  };

  const activeJob = queue.jobs.find((job) => job.status === "running");
  const pendingCount = queue.jobs.filter((job) => job.status === "pending").length;
  const isEmpty = queue.jobs.length === 0;

  const dropBorder = dragOver
    ? "border-accent bg-accent-soft/30"
    : "border-border hover:border-accent hover:bg-accent-soft/20";

  return (
    <div className="flex h-full flex-col px-6 pb-6">
      <div className="flex h-14 shrink-0 items-center gap-3">
        <h1 className="text-[18px] font-semibold">Очередь</h1>
        <span className="tnum text-[12px] text-muted">
          {queue.jobs.length} задач{activeJob ? ` · выполняется #${activeJob.id}` : ""}
        </span>
        {(pendingCount > 0 || queue.running) && (
          <div className="ml-auto">
            {queue.running ? (
              <Button onClick={queue.pause}>
                <Pause size={13} strokeWidth={1.5} /> Пауза
              </Button>
            ) : (
              <Button variant="primary" onClick={queue.start}>
                <Play size={13} strokeWidth={1.5} /> Запустить
              </Button>
            )}
          </div>
        )}
      </div>

      {isEmpty ? (
        <button
          type="button"
          onClick={pickFiles}
          {...dragProps}
          className={`group flex flex-1 cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border border-dashed bg-transparent transition-colors duration-[var(--vc-dur-base)] ${dropBorder}`}
        >
          <span className="text-faint opacity-80 transition-opacity group-hover:opacity-100">
            <Mark size={56} mono />
          </span>
          <div className="text-center">
            <div className="text-[14px] font-medium">Очередь пуста</div>
            <div className="mt-1 text-[12px] text-muted">
              Перетащи видео сюда или нажми, чтобы выбрать
            </div>
          </div>
        </button>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pb-2">
          <button
            type="button"
            onClick={pickFiles}
            {...dragProps}
            className={`flex h-[84px] shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed text-[12px] text-muted transition-colors duration-[var(--vc-dur-base)] ${dropBorder}`}
          >
            Перетащи видео сюда или нажми, чтобы выбрать
          </button>
          {queue.jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              live={queue.progress.get(job.id)}
              onCancel={queue.cancel}
              onRetry={queue.retry}
              onRemove={queue.remove}
            />
          ))}
        </div>
      )}

      {wizardFiles && (
        <NewJobWizard
          initialFiles={wizardFiles}
          initialStep={wizardStep}
          onClose={() => setWizardFiles(null)}
          onSubmit={(payload) => {
            setWizardFiles(null);
            void window.vicut.queue.add({
              inputs: payload.inputs,
              output: payload.output,
              presetName: payload.presetName,
              title: payload.title,
              overrides: {
                resolution: payload.overrides.resolution,
                fps: payload.overrides.fps,
                videoCodec: payload.overrides.codec,
              },
            });
          }}
        />
      )}
    </div>
  );
}
