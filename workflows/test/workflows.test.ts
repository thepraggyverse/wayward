import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FileRunStore } from "@thepraggyverse/core";
import { WorkflowRuntime } from "@thepraggyverse/workflow-runtime";
import { createOpenPrAuditWorkflow, createTournamentWorkflow, createUltrareviewWorkflow } from "../index.js";
import { reportSchema } from "../shared/review-schemas.js";

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe("built-in workflows", () => {
  it("ultrareview emits specialist evidence artifacts and a synthesized report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-packs-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const result = await new WorkflowRuntime(store).run(createUltrareviewWorkflow(), {});
    const run = await store.getRun(result.runId);

    expect(run.state).toBe("completed");
    expect(run.reports).toHaveLength(1);
    expect(run.artifacts).toHaveLength(4);
    expect(JSON.stringify(result.results.at(-1)?.output)).toContain("artifact:correctness");
  });

  it("open-pr-audit stops at its external-action gate with a pending approval", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-packs-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const result = await new WorkflowRuntime(store).run(createOpenPrAuditWorkflow(), { prs: [1, 2] });
    const run = await store.getRun(result.runId);

    expect(result.results.map((phase) => phase.phaseId)).toEqual(["audit", "rule", "verify", "synthesize", "external-action-gate"]);
    expect(run.state).toBe("needs_approval");
    expect(run.reports).toHaveLength(1);
    expect(run.approvals[0]?.requestedAction).toBe("external-action-gate");
    expect(run.approvals[0]?.evidence).toEqual([run.reports[0]?.id]);
  });

  it("tournament reports a winner with validation evidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-packs-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const result = await new WorkflowRuntime(store).run(createTournamentWorkflow(), { attempts: 2 });
    const run = await store.getRun(result.runId);

    expect(run.state).toBe("completed");
    expect(JSON.stringify(result.results.at(-1)?.output)).toContain("attempt-1-validation");
  });

  it("rejects malformed report outputs", () => {
    expect(() => reportSchema.parse({ summary: 1, findings: "nope" })).toThrow("WorkflowReport.summary is invalid");
    expect(() => reportSchema.parse({ summary: "ok", findings: [{ title: "Bad", severity: "urgent", evidence: "x" }] })).toThrow("WorkflowReport.findings is invalid");
  });
});
