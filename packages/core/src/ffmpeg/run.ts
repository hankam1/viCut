import { spawn } from "node:child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
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
export function run(binary: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const exitCode = code ?? -1;
      if (exitCode === 0) resolve({ stdout, stderr, exitCode });
      else reject(new ProcessError(binary, exitCode, stderr));
    });
  });
}
