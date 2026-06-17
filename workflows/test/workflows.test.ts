import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FileRunStore, type JobState } from "@thepraggyverse/core";
import { CodexAdapter, type CliRunner } from "@thepraggyverse/codex-adapter";
import type { WorktreeMetadata } from "@thepraggyverse/git-worktrees";
import { WorkflowRuntime } from "@thepraggyverse/workflow-runtime";
import { createOpenPrAuditWorkflow, createTournamentWorkflow, createUltrareviewWorkflow, type GhRunner, type TournamentWorkflowDependencies, type UltrareviewWorkflowDependencies } from "../index.js";
import { reportSchema } from "../shared/review-schemas.js";

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

class FakeTournamentWorktrees {
  readonly created: WorktreeMetadata[] = [];
  constructor(private readonly root: string) {}
  async createForRun(repoPath: string, input: { runId: string; jobId: string; baseRef?: string }): Promise<WorktreeMetadata> {
    const path = join(repoPath, ".wayward", "worktrees", input.runId, input.jobId);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "attempt.txt"), input.jobId);
    const worktree = {
      runId: input.runId,
      jobId: input.jobId,
      path,
      branch: `wayward/${input.runId}/${input.jobId}`,
      baseRef: input.baseRef ?? "HEAD"
    };
    this.created.push(worktree);
    return worktree;
  }
}

class FakeTournamentAdapter {
  readonly cwdByJob = new Map<string, string>();
  readonly sandboxByJob = new Map<string, string | undefined>();
  constructor(private readonly store: FileRunStore, private readonly states: Record<string, JobState> = {}) {}
  async startExecJob(input: { runId: string; jobId: string; cwd: string; sandbox?: string }): Promise<JobState> {
    this.cwdByJob.set(input.jobId, input.cwd);
    this.sandboxByJob.set(input.jobId, input.sandbox);
    const state = this.states[input.jobId] ?? "completed";
    await this.store.upsertJob(input.runId, { id: input.jobId, adapter: "codex", state: "running" });
    await this.store.writeArtifact(input.runId, { id: `${input.jobId}-raw`, kind: "codex-jsonl", sourceJobId: input.jobId }, `{"jobId":"${input.jobId}"}\n`);
    await this.store.setJobState(input.runId, input.jobId, state, state === "failed" ? `${input.jobId} failed` : undefined);
    return state;
  }
}

class FakeCodexRunner implements CliRunner {
  readonly calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  constructor(private readonly failures: Record<string, { code: number; stderr: string; timedOut?: boolean }> = {}) {}
  async run(command: string, args: string[], options: { cwd: string; onStdout?: (line: string) => void; onStderr?: (line: string) => void }) {
    this.calls.push({ command, args, cwd: options.cwd });
    const prompt = args.at(-1) ?? "";
    const reviewer = prompt.match(/Wayward ([^.]+)\./)?.[1] ?? "Unknown reviewer";
    const failure = Object.entries(this.failures).find(([name]) => reviewer.includes(name))?.[1];
    if (failure) {
      options.onStderr?.(failure.stderr);
      return { code: failure.code, stdout: "", stderr: failure.stderr, timedOut: failure.timedOut ?? false };
    }
    const payload = {
      summary: `${reviewer} completed.`,
      findings: [
        {
          title: `${reviewer} finding`,
          severity: "medium",
          evidence: `evidence from ${reviewer}`
        }
      ]
    };
    const line = JSON.stringify({ type: "assistant_message", message: { content: [{ type: "output_text", text: JSON.stringify(payload) }] } });
    options.onStdout?.(line);
    return { code: 0, stdout: `${line}\n`, stderr: "", timedOut: false };
  }
}

class FakeGhRunner implements GhRunner {
  readonly calls: Array<{ args: string[]; cwd: string }> = [];
  async run(args: string[], options: { cwd: string }) {
    this.calls.push({ args, cwd: options.cwd });
    if (args.join(" ").startsWith("pr list ")) {
      return {
        code: 0,
        stdout: JSON.stringify([
          { number: 7, title: "Touch runtime", author: { login: "alice" }, headRefName: "alice/runtime", baseRefName: "main", isDraft: false, updatedAt: "2026-04-01T00:00:00Z" },
          { number: 8, title: "Touch docs and runtime", author: { login: "bob" }, headRefName: "bob/docs", baseRefName: "main", isDraft: true, updatedAt: "2026-06-17T00:00:00Z" }
        ]),
        stderr: ""
      };
    }
    if (args.join(" ") === "pr view 7 --json number,title,author,headRefName,baseRefName,isDraft,mergeStateStatus,updatedAt,reviewDecision,latestReviews,statusCheckRollup") {
      return {
        code: 0,
        stdout: JSON.stringify({
          number: 7,
          title: "Touch runtime",
          author: { login: "alice" },
          headRefName: "alice/runtime",
          baseRefName: "main",
          isDraft: false,
          mergeStateStatus: "DIRTY",
          updatedAt: "2026-04-01T00:00:00Z",
          reviewDecision: "CHANGES_REQUESTED",
          latestReviews: [{ author: { login: "reviewer" }, state: "CHANGES_REQUESTED", submittedAt: "2026-04-02T00:00:00Z" }],
          statusCheckRollup: [{ name: "test", status: "COMPLETED", conclusion: "FAILURE" }]
        }),
        stderr: ""
      };
    }
    if (args.join(" ") === "pr view 8 --json number,title,author,headRefName,baseRefName,isDraft,mergeStateStatus,updatedAt,reviewDecision,latestReviews,statusCheckRollup") {
      return {
        code: 0,
        stdout: JSON.stringify({
          number: 8,
          title: "Touch docs and runtime",
          author: { login: "bob" },
          headRefName: "bob/docs",
          baseRefName: "main",
          isDraft: true,
          mergeStateStatus: "CLEAN",
          updatedAt: "2026-06-17T00:00:00Z",
          reviewDecision: "APPROVED",
          latestReviews: [{ author: { login: "reviewer" }, state: "APPROVED", submittedAt: "2026-06-17T01:00:00Z" }],
          statusCheckRollup: []
        }),
        stderr: ""
      };
    }
    if (args.join(" ") === "pr diff 7 --name-only") {
      return { code: 0, stdout: "packages/core/src/run-store.ts\npackage.json\n", stderr: "" };
    }
    if (args.join(" ") === "pr diff 8 --name-only") {
      return { code: 0, stdout: "packages/core/src/run-store.ts\ndocs/workflows.md\n", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: `unexpected gh call: ${args.join(" ")}` };
  }
}

function tournamentFakes(root: string, states: Record<string, JobState> = {}) {
  const worktrees = new FakeTournamentWorktrees(root);
  let adapter: FakeTournamentAdapter | undefined;
  const dependencies: TournamentWorkflowDependencies = {
    worktreeFactory: () => worktrees,
    adapterFactory: (store) => {
      adapter = new FakeTournamentAdapter(store, states);
      return adapter;
    }
  };
  return { dependencies, worktrees, get adapter() {
    if (!adapter) throw new Error("adapter was not created");
    return adapter;
  } };
}

function ultrareviewFakes(failures: Record<string, { code: number; stderr: string; timedOut?: boolean }> = {}) {
  const runner = new FakeCodexRunner(failures);
  const dependencies: UltrareviewWorkflowDependencies = {
    adapterFactory: (store) => new CodexAdapter(store, runner)
  };
  return { dependencies, runner };
}

describe("built-in workflows", () => {
  it("ultrareview runs Codex specialist reviewers and synthesizes artifact-backed findings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-packs-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const fakes = ultrareviewFakes();
    const result = await new WorkflowRuntime(store).run(createUltrareviewWorkflow(fakes.dependencies), { repo: dir });
    const run = await store.getRun(result.runId);
    const report = await readFile(run.reports[0]!.path, "utf8");

    expect(run.state).toBe("completed");
    expect(run.mode).toBe("inspect");
    expect(run.reports).toHaveLength(1);
    expect(fakes.runner.calls).toHaveLength(5);
    expect(fakes.runner.calls.every((call) => call.command === "codex" && call.cwd === dir)).toBe(true);
    expect(fakes.runner.calls.every((call) => call.args.slice(0, 4).join(" ") === "exec --json --sandbox read-only")).toBe(true);
    expect(run.jobs.map((job) => [job.id, job.state])).toEqual([
      ["reviewer-correctness", "completed"],
      ["reviewer-security", "completed"],
      ["reviewer-tests", "completed"],
      ["reviewer-maintainability", "completed"],
      ["reviewer-adversarial-verifier", "completed"]
    ]);
    expect(run.artifacts.map((artifact) => artifact.id)).toEqual(expect.arrayContaining([
      "reviewer-correctness-raw",
      "reviewer-correctness-summary",
      "reviewer-security-raw",
      "reviewer-security-summary",
      "reviewer-tests-raw",
      "reviewer-tests-summary",
      "reviewer-maintainability-raw",
      "reviewer-maintainability-summary",
      "reviewer-adversarial-verifier-raw",
      "reviewer-adversarial-verifier-summary",
      "ultrareview-synthesis"
    ]));
    expect(JSON.stringify(result.results.at(-1)?.output)).toContain("artifact:reviewer-correctness-raw");
    expect(report).toContain("## Summary");
    expect(report).toContain("[Correctness reviewer]");
    expect(report).toContain("artifact:reviewer-correctness-summary");
  });

  it("ultrareview records failed reviewers and still completes synthesis", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-packs-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const fakes = ultrareviewFakes({ "Security reviewer": { code: 124, stderr: "review timed out", timedOut: true } });
    const result = await new WorkflowRuntime(store).run(createUltrareviewWorkflow(fakes.dependencies), { repo: dir });
    const run = await store.getRun(result.runId);
    const output = result.results.at(-1)?.output as { summary: string; findings: Array<{ title: string; evidence: string }> };

    expect(run.state).toBe("completed");
    expect(run.jobs.find((job) => job.id === "reviewer-security")?.state).toBe("timed_out");
    expect(run.artifacts.map((artifact) => artifact.id)).toEqual(expect.arrayContaining(["reviewer-security-raw", "reviewer-security-summary", "ultrareview-synthesis"]));
    expect(output.summary).toContain("4 completed; 1 failed or timed out");
    const timeoutEvidence = output.findings.find((finding) => finding.title.includes("Security reviewer"))?.evidence;
    expect(timeoutEvidence).toContain("Job ended with state timed_out.");
    expect(timeoutEvidence).toContain("artifact:reviewer-security-summary");
    expect(timeoutEvidence).not.toContain("{\"stream\"");
  });

  it("open-pr-audit stops at its external-action gate with a pending approval", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-packs-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const ghRunner = new FakeGhRunner();
    const result = await new WorkflowRuntime(store).run(createOpenPrAuditWorkflow({
      ghRunner,
      now: () => new Date("2026-06-18T00:00:00Z")
    }), { repo: dir, staleDays: 30 });
    const run = await store.getRun(result.runId);
    const report = await readFile(run.reports[0]!.path, "utf8");

    expect(result.results.map((phase) => phase.phaseId)).toEqual(["audit", "rule", "verify", "synthesize", "external-action-gate"]);
    expect(run.state).toBe("needs_approval");
    expect(run.reports).toHaveLength(1);
    expect(run.approvals[0]?.requestedAction).toBe("external-action-gate");
    expect(run.approvals[0]?.evidence).toEqual([run.reports[0]?.id]);
    expect(ghRunner.calls.map((call) => call.args.slice(0, 3).join(" "))).toEqual([
      "pr list --state",
      "pr view 7",
      "pr view 8",
      "pr diff 7",
      "pr diff 8"
    ]);
    expect(ghRunner.calls.every((call) => call.cwd === dir)).toBe(true);
    expect(run.artifacts.map((artifact) => artifact.id)).toEqual(expect.arrayContaining([
      "gh-pr-list-raw",
      "gh-pr-7-view-raw",
      "gh-pr-7-diff-name-only-raw",
      "gh-pr-8-view-raw",
      "gh-pr-8-diff-name-only-raw",
      "pr-7-audit",
      "pr-8-audit",
      "open-pr-audit-normalized",
      "open-pr-audit-synthesis"
    ]));
    expect(report).toContain("PR #7 changes risky files");
    expect(report).toContain("PR #7 is stale");
    expect(report).toContain("PR #7 has failing checks");
    expect(report).toContain("PR #7 has changes requested");
    expect(report).toContain("PR #7 mergeability is DIRTY");
    expect(report).toContain("PR #8 has no checks reported");
    expect(report).toContain("PR #8 is still draft");

    const events = await store.readEvents(result.runId);
    expect(events.find((event) => event.type === "approval.requested")?.payload).toMatchObject({
      approvalId: run.approvals[0]?.id,
      evidence: [run.reports[0]?.id]
    });
  });

  it("tournament creates the requested number of isolated worktrees and records them in the run summary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-packs-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const fakes = tournamentFakes(dir);
    const result = await new WorkflowRuntime(store).run(createTournamentWorkflow(fakes.dependencies), { repo: dir, attempts: 2, baseRef: "main", prompt: "try it" });
    const run = await store.getRun(result.runId);

    expect(run.state).toBe("completed");
    expect(run.mode).toBe("worktree-write");
    expect(fakes.worktrees.created).toHaveLength(2);
    expect(fakes.worktrees.created.map((worktree) => worktree.jobId)).toEqual(["attempt-1", "attempt-2"]);
    expect(fakes.worktrees.created.map((worktree) => worktree.branch)).toEqual([
      `wayward/${result.runId}/attempt-1`,
      `wayward/${result.runId}/attempt-2`
    ]);
    expect(new Set(fakes.worktrees.created.map((worktree) => worktree.path)).size).toBe(2);
    expect(run.worktreePaths).toEqual(fakes.worktrees.created.map((worktree) => worktree.path));
    expect(fakes.adapter.cwdByJob.get("attempt-1")).toBe(fakes.worktrees.created[0]?.path);
    expect(fakes.adapter.sandboxByJob.get("attempt-1")).toBe("workspace-write");
    expect(await readFile(join(fakes.worktrees.created[0]!.path, "attempt.txt"), "utf8")).toBe("attempt-1");
    expect(await readFile(join(fakes.worktrees.created[1]!.path, "attempt.txt"), "utf8")).toBe("attempt-2");
  });

  it("persists raw and per-attempt artifacts for every tournament attempt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-packs-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const fakes = tournamentFakes(dir);
    const result = await new WorkflowRuntime(store).run(createTournamentWorkflow(fakes.dependencies), { repo: dir, attempts: 2 });
    const run = await store.getRun(result.runId);

    expect(run.artifacts.map((artifact) => artifact.id)).toEqual(expect.arrayContaining([
      "attempt-1-raw",
      "attempt-1-state",
      "attempt-2-raw",
      "attempt-2-state",
      "tournament-ranking"
    ]));
    expect(run.jobs.find((job) => job.id === "attempt-1")?.artifacts.map((artifact) => artifact.id)).toEqual(expect.arrayContaining(["attempt-1-raw", "attempt-1-state"]));
  });

  it("does not create tournament worktrees when inspect mode is requested explicitly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-packs-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const fakes = tournamentFakes(dir);
    const result = await new WorkflowRuntime(store).run(createTournamentWorkflow(fakes.dependencies), { repo: dir, attempts: 2 }, { mode: "inspect" });
    const run = await store.getRun(result.runId);

    expect(run.state).toBe("failed");
    expect(result.results[0]).toEqual(expect.objectContaining({ phaseId: "permission-check", state: "failed" }));
    expect(fakes.worktrees.created).toHaveLength(0);
  });

  it("records failed tournament attempts and continues ranking later candidates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-packs-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const fakes = tournamentFakes(dir, { "attempt-1": "failed", "attempt-2": "completed" });
    const result = await new WorkflowRuntime(store).run(createTournamentWorkflow(fakes.dependencies), { repo: dir, attempts: 2 });
    const run = await store.getRun(result.runId);
    const output = result.results.at(-1)?.output as { summary: string; findings: Array<{ title: string; evidence: string }> };

    expect(run.state).toBe("completed");
    expect(run.jobs.map((job) => [job.id, job.state])).toEqual([["attempt-1", "failed"], ["attempt-2", "completed"]]);
    expect(output.summary).toContain("Best candidate: attempt 2");
    expect(output.findings[0]?.title).toBe("#1: attempt 2 completed");
    expect(output.findings[1]?.evidence).toContain("error=attempt-1 failed");
  });

  it("writes a synthesis report that identifies candidate rankings and status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wayward-packs-"));
    tempDirs.push(dir);
    const store = new FileRunStore(join(dir, "runs"));
    const fakes = tournamentFakes(dir, { "attempt-1": "timed_out", "attempt-2": "completed", "attempt-3": "failed" });
    const result = await new WorkflowRuntime(store).run(createTournamentWorkflow(fakes.dependencies), { repo: dir, attempts: 3 });
    const run = await store.getRun(result.runId);
    const report = await readFile(run.reports[0]!.path, "utf8");

    expect(report).toContain("Best candidate: attempt 2");
    expect(report).toContain("#1: attempt 2 completed");
    expect(report).toContain("#2: attempt 1 timed_out");
    expect(report).toContain("#3: attempt 3 failed");
  });

  it("rejects malformed report outputs", () => {
    expect(() => reportSchema.parse({ summary: 1, findings: "nope" })).toThrow("WorkflowReport.summary is invalid");
    expect(() => reportSchema.parse({ summary: "ok", findings: [{ title: "Bad", severity: "urgent", evidence: "x" }] })).toThrow("WorkflowReport.findings is invalid");
  });
});
