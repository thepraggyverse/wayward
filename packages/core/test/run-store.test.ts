import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach } from "vitest";
import { FileRunStore } from "../src/index.js";

const tempDirs: string[] = [];

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), "wayward-core-"));
  tempDirs.push(dir);
  return new FileRunStore(join(dir, "runs"));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("FileRunStore", () => {
  it("creates reloadable summaries, event logs, and artifact directories", async () => {
    const store = await tempStore();
    const run = await store.createRun({ workflowName: "ultrareview" });
    await store.upsertJob(run.id, { id: "job-1", adapter: "codex", state: "running" });
    await store.writeArtifact(run.id, { id: "job-1-raw", kind: "codex-jsonl", sourceJobId: "job-1" }, "{\"type\":\"started\"}\n");
    await store.writeReport(run.id, "Report", "# Report\n", ["job-1-raw"]);

    const reloaded = await store.getRun(run.id);
    const events = await store.readEvents(run.id);

    expect(reloaded.jobs[0]?.artifacts[0]?.id).toBe("job-1-raw");
    expect(reloaded.reports[0]?.sourceArtifactIds).toContain("job-1-raw");
    expect(events.map((event) => event.type)).toContain("run.created");
    expect(await store.listRuns()).toHaveLength(1);
  });

  it("persists failed, timed out, and cancelled job states", async () => {
    const store = await tempStore();
    const run = await store.createRun({ workflowName: "audit" });
    for (const state of ["failed", "timed_out", "cancelled"] as const) {
      await store.upsertJob(run.id, { id: state, adapter: "codex", state: "running" });
      await store.setJobState(run.id, state, state);
    }

    const reloaded = await store.getRun(run.id);
    expect(reloaded.jobs.map((job) => job.state)).toEqual(["failed", "timed_out", "cancelled"]);
  });

  it("does not recover a running run while its recorded process is still alive", async () => {
    const store = await tempStore();
    const run = await store.createRun({ workflowName: "ultrareview" });
    await store.setRunState(run.id, "running");
    await store.recordRunRuntime(run.id, {
      pid: 4242,
      hostname: "local-host",
      startedAt: "2026-06-18T00:00:00.000Z",
      heartbeatAt: "2026-06-18T00:00:00.000Z",
      heartbeatIntervalMs: 15_000
    });

    const result = await store.recoverStaleRunningRuns({
      staleAfterMs: 1_000,
      now: new Date("2026-06-18T01:00:00.000Z"),
      hostname: "local-host",
      isProcessAlive: (pid) => pid === 4242
    });
    const reloaded = await store.getRun(run.id);

    expect(result.recovered).toEqual([]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ runId: run.id, state: "running", reason: "runtime pid 4242 is still alive on local-host" })
    ]);
    expect(reloaded.state).toBe("running");
    expect(reloaded.runtime?.pid).toBe(4242);
  });

  it("marks stale running runs as interrupted and records recovery metadata", async () => {
    const store = await tempStore();
    const run = await store.createRun({ workflowName: "ultrareview" });
    await store.setRunState(run.id, "running");
    await store.upsertJob(run.id, { id: "reviewer-correctness", adapter: "codex", state: "running" });
    await store.recordRunRuntime(run.id, {
      pid: 4242,
      hostname: "local-host",
      startedAt: "2026-06-18T00:00:00.000Z",
      heartbeatAt: "2026-06-18T00:00:00.000Z",
      heartbeatIntervalMs: 15_000
    });

    const result = await store.recoverStaleRunningRuns({
      staleAfterMs: 1_000,
      now: new Date("2026-06-18T01:00:00.000Z"),
      hostname: "local-host",
      recoveredByPid: 77,
      isProcessAlive: () => false
    });
    const reloaded = await store.getRun(run.id);
    const events = await store.readEvents(run.id);

    expect(result.recovered).toEqual([
      expect.objectContaining({
        runId: run.id,
        state: "interrupted",
        lastActivityAt: "2026-06-18T00:00:00.000Z",
        staleMs: 3_600_000
      })
    ]);
    expect(reloaded.state).toBe("interrupted");
    expect(reloaded.runtime).toBeUndefined();
    expect(reloaded.recovery).toMatchObject({
      previousState: "running",
      recoveredAt: "2026-06-18T01:00:00.000Z",
      staleAfterMs: 1_000,
      lastHeartbeatAt: "2026-06-18T00:00:00.000Z",
      recoveredBy: { pid: 77, hostname: "local-host" }
    });
    expect(reloaded.jobs[0]).toMatchObject({
      id: "reviewer-correctness",
      state: "failed",
      finishedAt: "2026-06-18T01:00:00.000Z"
    });
    expect(reloaded.jobs[0]?.error).toContain("Recovered stale running run");
    expect(events.map((event) => event.type)).toContain("run.recovered");
    expect(events.at(-1)?.payload).toMatchObject({ state: "interrupted", previousState: "running" });
  });

  it("serializes concurrent summary mutations for the same run", async () => {
    const store = await tempStore();
    const run = await store.createRun({ workflowName: "fanout" });

    await Promise.all([
      store.upsertJob(run.id, { id: "job-a", adapter: "codex", state: "running" }),
      store.upsertJob(run.id, { id: "job-b", adapter: "codex", state: "running" }),
      store.writeReport(run.id, "Report", "# Report\n"),
      store.addCheckpoint(run.id, { id: "cp-1", label: "before", gitRef: "refs/wayward/run/cp-1", createdAt: new Date().toISOString() }),
      store.addApproval(run.id, { id: "approval-1", requestedAction: "comment", evidence: [], state: "pending" })
    ]);

    const reloaded = await store.getRun(run.id);
    expect(reloaded.jobs.map((job) => job.id).sort()).toEqual(["job-a", "job-b"]);
    expect(reloaded.reports).toHaveLength(1);
    expect(reloaded.checkpoints).toHaveLength(1);
    expect(reloaded.approvals).toHaveLength(1);
  });

  it("keeps run and artifact paths inside the run store", async () => {
    const store = await tempStore();
    const run = await store.createRun({ workflowName: "ultrareview" });

    expect(store.runDirectory(run.id)).toContain(run.id);
    expect(store.containsRunPath(run.id, join(store.runDirectory(run.id), "reports", "report.md"))).toBe(true);
    expect(store.containsRunPath(run.id, join(store.runDirectory(run.id), "..", "other-run", "summary.json"))).toBe(false);
    await expect(store.getRun("../outside")).rejects.toThrow("Unsafe run id");
    await expect(store.writeArtifact(run.id, { id: "../outside", kind: "bad" }, "{}\n")).rejects.toThrow("Unsafe artifact id");
  });

  it("approving a pending gate records the decision and completes the run", async () => {
    const store = await tempStore();
    const run = await store.createRun({ workflowName: "open-pr-audit" });
    await store.addApproval(run.id, { id: "approval-1", requestedAction: "external-action-gate", evidence: ["report-1"], state: "pending" });

    const approval = await store.decideApproval(run.id, "approval-1", "approved", "tester");
    const reloaded = await store.getRun(run.id);
    const events = await store.readEvents(run.id);

    expect(approval.state).toBe("approved");
    expect(approval.evidence).toEqual(["report-1"]);
    expect(reloaded.state).toBe("completed");
    expect(reloaded.approvals[0]?.actor).toBe("tester");
    expect(events.map((event) => event.type)).toEqual([
      "run.created",
      "approval.requested",
      "run.state_changed",
      "approval.decided",
      "run.state_changed"
    ]);
    expect(events.at(-1)?.payload).toMatchObject({ state: "completed", decision: "approved" });
  });

  it("rejecting a pending gate records the decision and cancels the run", async () => {
    const store = await tempStore();
    const run = await store.createRun({ workflowName: "open-pr-audit" });
    await store.addApproval(run.id, { id: "approval-1", requestedAction: "external-action-gate", evidence: ["report-1"], state: "pending" });

    await store.decideApproval(run.id, "approval-1", "rejected", "tester");
    const reloaded = await store.getRun(run.id);

    expect(reloaded.state).toBe("cancelled");
    expect(reloaded.approvals[0]).toMatchObject({ state: "rejected", actor: "tester", evidence: ["report-1"] });
  });
});
