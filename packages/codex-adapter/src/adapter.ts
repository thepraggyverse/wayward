import type { FileRunStore, JobState } from "@thepraggyverse/core";
import { ProcessCliRunner, type CliRunner } from "./cli-runner.js";

export class CodexAdapter {
  constructor(private readonly store: FileRunStore, private readonly runner: CliRunner = new ProcessCliRunner()) {}

  async startExecJob(input: { runId: string; jobId: string; cwd: string; prompt: string; timeoutMs?: number; sandbox?: "read-only" | "workspace-write" | "danger-full-access" }): Promise<JobState> {
    const rawLines: string[] = [];
    await this.store.upsertJob(input.runId, {
      id: input.jobId,
      adapter: "codex",
      state: "running",
      startedAt: new Date().toISOString()
    });
    try {
      const args = ["exec", "--json", ...(input.sandbox ? ["--sandbox", input.sandbox] : []), input.prompt];
      const result = await this.runner.run("codex", args, {
        cwd: input.cwd,
        timeoutMs: input.timeoutMs,
        onStdout: (line) => rawLines.push(line),
        onStderr: (line) => rawLines.push(JSON.stringify({ stream: "stderr", line }))
      });
      await this.store.writeArtifact(input.runId, { id: `${input.jobId}-raw`, kind: "codex-jsonl", sourceJobId: input.jobId }, `${rawLines.join("\n")}\n`);
      const state: JobState = result.code === 0 ? "completed" : result.timedOut || result.code === 124 ? "timed_out" : "failed";
      await this.store.setJobState(input.runId, input.jobId, state, state === "failed" ? result.stderr : undefined);
      return state;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rawLines.push(JSON.stringify({ stream: "adapter", error: message }));
      await this.store.writeArtifact(input.runId, { id: `${input.jobId}-raw`, kind: "codex-jsonl", sourceJobId: input.jobId }, `${rawLines.join("\n")}\n`);
      await this.store.setJobState(input.runId, input.jobId, "failed", message);
      return "failed";
    }
  }
}
