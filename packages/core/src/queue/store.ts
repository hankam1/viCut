import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDir } from "../platform/paths.js";
import { presetSchema, type Preset } from "../preset/schema.js";
import { specInputs, type JobSpec } from "../render/spec.js";

export type JobStatus = "pending" | "running" | "done" | "failed" | "canceled";

export interface QueueJob {
  id: number;
  title: string;
  spec: JobSpec;
  /** Все файлы задачи одним списком (для отображения). */
  inputs: string[];
  output: string;
  preset: Preset;
  status: JobStatus;
  stage: string | null;
  /** 0-100 within the current stage. */
  progress: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AddJobInput {
  title?: string;
  spec: JobSpec;
  output: string;
  preset: Preset;
}

interface JobRow {
  id: number;
  title: string;
  inputs: string;
  output: string;
  preset: string;
  status: string;
  stage: string | null;
  progress: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function rowToJob(row: JobRow): QueueJob {
  // Обратная совместимость: массив в колонке = склейка клипов (тип A).
  const parsed = JSON.parse(row.inputs) as string[] | JobSpec;
  const spec: JobSpec = Array.isArray(parsed) ? { kind: "stitch", inputs: parsed } : parsed;
  return {
    id: row.id,
    title: row.title,
    spec,
    inputs: specInputs(spec),
    output: row.output,
    preset: presetSchema.parse(JSON.parse(row.preset)),
    status: row.status as JobStatus,
    stage: row.stage,
    progress: row.progress,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/**
 * Persistent render queue — jobs survive restarts and crashes.
 * Uses node:sqlite (built into Node 22.5+ and Electron), so the same code
 * runs in the CLI and in the Electron main process without native rebuilds.
 */
export class QueueStore {
  private readonly db: DatabaseSync;

  constructor(dbPath?: string) {
    const file = dbPath ?? path.join(dataDir(), "queue.db");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        inputs TEXT NOT NULL,
        output TEXT NOT NULL,
        preset TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        stage TEXT,
        progress REAL NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        started_at TEXT,
        finished_at TEXT
      )
    `);
  }

  add(input: AddJobInput): QueueJob {
    const title = input.title ?? path.parse(input.output).name;
    const serialized =
      input.spec.kind === "stitch" ? JSON.stringify(input.spec.inputs) : JSON.stringify(input.spec);
    const result = this.db
      .prepare(`INSERT INTO jobs (title, inputs, output, preset) VALUES (?, ?, ?, ?)`)
      .run(title, serialized, input.output, JSON.stringify(input.preset));
    return this.get(Number(result.lastInsertRowid))!;
  }

  get(id: number): QueueJob | null {
    const row = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as unknown as
      | JobRow
      | undefined;
    return row ? rowToJob(row) : null;
  }

  list(): QueueJob[] {
    const rows = this.db.prepare(`SELECT * FROM jobs ORDER BY id`).all() as unknown as JobRow[];
    return rows.map(rowToJob);
  }

  nextPending(): QueueJob | null {
    const row = this.db
      .prepare(`SELECT * FROM jobs WHERE status = 'pending' ORDER BY id LIMIT 1`)
      .get() as unknown as JobRow | undefined;
    return row ? rowToJob(row) : null;
  }

  markRunning(id: number): void {
    this.db
      .prepare(
        `UPDATE jobs SET status = 'running', stage = NULL, progress = 0, error = NULL,
         started_at = datetime('now', 'localtime') WHERE id = ?`,
      )
      .run(id);
  }

  updateProgress(id: number, stage: string, progress: number): void {
    this.db.prepare(`UPDATE jobs SET stage = ?, progress = ? WHERE id = ?`).run(stage, progress, id);
  }

  markDone(id: number): void {
    this.db
      .prepare(
        `UPDATE jobs SET status = 'done', progress = 100,
         finished_at = datetime('now', 'localtime') WHERE id = ?`,
      )
      .run(id);
  }

  markFailed(id: number, error: string): void {
    this.db
      .prepare(
        `UPDATE jobs SET status = 'failed', error = ?,
         finished_at = datetime('now', 'localtime') WHERE id = ?`,
      )
      .run(error, id);
  }

  /** Requeue a failed job. */
  retry(id: number): boolean {
    const result = this.db
      .prepare(
        `UPDATE jobs SET status = 'pending', stage = NULL, progress = 0, error = NULL,
         finished_at = NULL WHERE id = ? AND status = 'failed'`,
      )
      .run(id);
    return Number(result.changes) > 0;
  }

  /** Cancel a job that has not started yet. */
  cancel(id: number): boolean {
    const result = this.db
      .prepare(`UPDATE jobs SET status = 'canceled' WHERE id = ? AND status = 'pending'`)
      .run(id);
    return Number(result.changes) > 0;
  }

  /** Remove a job unless it is currently running. */
  remove(id: number): boolean {
    const result = this.db
      .prepare(`DELETE FROM jobs WHERE id = ? AND status != 'running'`)
      .run(id);
    return Number(result.changes) > 0;
  }

  /** Remove finished (done/failed/canceled) jobs; returns how many. */
  clearFinished(): number {
    const result = this.db
      .prepare(`DELETE FROM jobs WHERE status IN ('done', 'failed', 'canceled')`)
      .run();
    return Number(result.changes);
  }

  /** Jobs left "running" by a crash get requeued. Call on startup. */
  resetInterrupted(): number {
    const result = this.db
      .prepare(`UPDATE jobs SET status = 'pending', stage = NULL, progress = 0 WHERE status = 'running'`)
      .run();
    return Number(result.changes);
  }

  close(): void {
    this.db.close();
  }
}
