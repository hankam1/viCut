/** Секция задачи «сборка под аудио»: аудио задаёт длительность, визуал подгоняется. */
export interface SectionSpec {
  audio: string;
  visuals: {
    kind: "clips" | "images";
    files: string[];
  };
}

/** Что рендерим: склейка клипов (тип A) или сборка под аудио (тип B). */
export type JobSpec =
  | { kind: "stitch"; inputs: string[] }
  | { kind: "audio-driven"; sections: SectionSpec[] };

/** Все файлы задачи одним списком (для отображения и валидации). */
export function specInputs(spec: JobSpec): string[] {
  return spec.kind === "stitch"
    ? spec.inputs
    : spec.sections.flatMap((section) => [section.audio, ...section.visuals.files]);
}

/** Числовая (natural) сортировка имён файлов: img_2 раньше img_10. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
