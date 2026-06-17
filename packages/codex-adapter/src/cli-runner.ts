import { spawn } from "node:child_process";

export interface CliRunner {
  run(command: string, args: string[], options: { cwd: string; timeoutMs?: number; onStdout?: (line: string) => void; onStderr?: (line: string) => void }): Promise<{ code: number; stdout: string; stderr: string; timedOut?: boolean }>;
}

export class ProcessCliRunner implements CliRunner {
  async run(command: string, args: string[], options: { cwd: string; timeoutMs?: number; onStdout?: (line: string) => void; onStderr?: (line: string) => void }) {
    return new Promise<{ code: number; stdout: string; stderr: string; timedOut?: boolean }>((resolve, reject) => {
      const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let didTimeout = false;
      let killTimer: NodeJS.Timeout | undefined;
      const timer = options.timeoutMs
        ? setTimeout(() => {
            didTimeout = true;
            child.kill("SIGTERM");
            killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
          }, options.timeoutMs)
        : undefined;
      let stdoutLineBuffer = "";
      let stderrLineBuffer = "";
      const emitLines = (buffer: string, chunk: unknown, emit?: (line: string) => void) => {
        buffer += String(chunk);
        const lines = buffer.split("\n");
        const nextBuffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) emit?.(line);
        return nextBuffer;
      };
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        stdoutLineBuffer = emitLines(stdoutLineBuffer, chunk, options.onStdout);
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        stderrLineBuffer = emitLines(stderrLineBuffer, chunk, options.onStderr);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (stdoutLineBuffer) options.onStdout?.(stdoutLineBuffer);
        if (stderrLineBuffer) options.onStderr?.(stderrLineBuffer);
        resolve({ code: didTimeout ? 124 : code ?? 1, stdout, stderr, timedOut: didTimeout });
      });
    });
  }
}
