import { spawn } from "node:child_process";
import { CancelError } from "../proc/cancel.js";
import { killOnAbort, trackChild } from "../proc/children.js";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOptions {
  /** Called for every complete line ffmpeg/whisper prints to stderr. */
  onStderrLine?: (line: string) => void;
  /** Отмена: процесс убивается, промис падает с CancelError. */
  signal?: AbortSignal;
}

export class ProcessError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number,
    readonly stderr: string,
  ) {
    super(`${command} exited with code ${exitCode}:\n${stderr.slice(-2000)}`);
    this.name = "ProcessError";
  }
}

/** Run a binary and collect its output. Rejects with ProcessError on non-zero exit. */
export function run(binary: string, args: string[], options?: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(new CancelError());
      return;
    }
    const child = spawn(binary, args, { windowsHide: true });
    trackChild(child);
    const stopAbort = killOnAbort(child, options?.signal);
    let stdout = "";
    let stderr = "";
    let stderrTail = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (options?.onStderrLine) {
        stderrTail += text;
        let newlineIndex: number;
        while ((newlineIndex = stderrTail.search(/[\r\n]/)) >= 0) {
          const line = stderrTail.slice(0, newlineIndex).trim();
          stderrTail = stderrTail.slice(newlineIndex + 1);
          if (line) options.onStderrLine(line);
        }
      }
    });
    child.on("error", (error) => {
      stopAbort();
      reject(options?.signal?.aborted ? new CancelError() : error);
    });
    child.on("close", (code) => {
      stopAbort();
      // Ненулевой код после kill — это отмена, а не сбой инструмента.
      if (options?.signal?.aborted) {
        reject(new CancelError());
        return;
      }
      const exitCode = code ?? -1;
      if (exitCode === 0) resolve({ stdout, stderr, exitCode });
      else reject(new ProcessError(binary, exitCode, stderr));
    });
  });
}
