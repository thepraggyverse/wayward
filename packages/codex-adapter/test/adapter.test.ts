import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FileRunStore } from "@thepraggyverse/core";
import { CodexAdapter, detectCodexCapabilities, type CliRunner } from "../src/index.js";

class FakeRunner implements CliRunner {
  constructor(private readonly result = { code: 0, stdout: "{\"type\":\"done\"}\n", stderr: "", timedOut: false }, private readonly failure?: Error) {}
  async run(_command: string, _args: string[], options: { onStdout?: (line: string) => void; onStderr?: (line: string) => void }) {
    if (this.failure) throw this.failure;
    for (const line of this.result.stdout.split("\n").filter(Boolean)) options.onStdout?.(line);
    for (const line of this.result.stderr.split("\n").filter(Boolean)) options.onStderr?.(line);
    return this.result;
  }
}

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe("CodexAdapter", () => {
  it("streams raw JSONL into artifacts and maps success", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-codex-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const run = await store.createRun({ workflowName: "review" });

    const state = await new CodexAdapter(store, new FakeRunner()).startExecJob({ runId: run.id, jobId: "job-1", cwd: dir, prompt: "review" });

    const reloaded = await store.getRun(run.id);
    expect(state).toBe("completed");
    expect(reloaded.jobs[0]?.state).toBe("completed");
    expect(reloaded.artifacts[0]?.kind).toBe("codex-jsonl");
  });

  it("represents review and fork as detected capabilities", async () => {
    const caps = await detectCodexCapabilities(new FakeRunner({ code: 0, stdout: "exec review fork app-server\n", stderr: "", timedOut: false }), ".");
    expect(caps).toEqual({ execJson: true, review: true, fork: true, appServer: true });
  });

  it.each([
    [{ code: 124, stdout: "", stderr: "slow", timedOut: true }, "timed_out"],
    [{ code: 2, stdout: "", stderr: "boom", timedOut: false }, "failed"]
  ] as const)("maps non-success result %# into persisted job state", async (runnerResult, expectedState) => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-codex-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const run = await store.createRun({ workflowName: "review" });

    const state = await new CodexAdapter(store, new FakeRunner(runnerResult)).startExecJob({ runId: run.id, jobId: "job-1", cwd: dir, prompt: "review" });
    const reloaded = await store.getRun(run.id);

    expect(state).toBe(expectedState);
    expect(reloaded.jobs[0]?.state).toBe(expectedState);
  });

  it("marks jobs failed when the runner rejects before output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-codex-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const run = await store.createRun({ workflowName: "review" });

    const state = await new CodexAdapter(store, new FakeRunner(undefined, new Error("codex missing"))).startExecJob({ runId: run.id, jobId: "job-1", cwd: dir, prompt: "review" });
    const reloaded = await store.getRun(run.id);

    expect(state).toBe("failed");
    expect(reloaded.jobs[0]?.error).toBe("codex missing");
  });
});
