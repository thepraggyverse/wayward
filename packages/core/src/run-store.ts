import { mkdir, readFile, readdir, writeFile, appendFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { createEvent, type WaywardEvent } from "./events.js";
import { createId } from "./ids.js";
import type { AgentJob, ApprovalDecision, ArtifactRef, CheckpointRecord, CreateRunInput, JobState, ReportRecord, RunState, RunSummary } from "./types.js";

export class FileRunStore {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly rootDir = defaultRunRoot()) {}

  async createRun(input: CreateRunInput): Promise<RunSummary> {
    const now = new Date().toISOString();
    const run: RunSummary = {
      id: createId("run"),
      workflowName: input.workflowName,
      adapter: input.adapter ?? "codex",
      mode: input.mode ?? "inspect",
      state: "created",
      inputs: input.inputs ?? {},
      createdAt: now,
      updatedAt: now,
      worktreePaths: [],
      jobs: [],
      artifacts: [],
      approvals: [],
      checkpoints: [],
      reports: [],
      skipped: []
    };
    await mkdir(this.runPath(run.id, "artifacts"), { recursive: true });
    await mkdir(this.runPath(run.id, "reports"), { recursive: true });
    await this.writeSummary(run);
    await this.appendEvent(run.id, createEvent(run.id, "run.created", { workflowName: run.workflowName, mode: run.mode }));
    return run;
  }

  async listRuns(): Promise<RunSummary[]> {
    await mkdir(this.rootDir, { recursive: true });
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const runs = await Promise.all(
      entries.filter((entry) => entry.isDirectory()).map((entry) => this.getRun(entry.name))
    );
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getRun(runId: string): Promise<RunSummary> {
    return JSON.parse(await readFile(this.runPath(runId, "summary.json"), "utf8")) as RunSummary;
  }

  async setRunState(runId: string, state: RunState, payload: Record<string, unknown> = {}): Promise<RunSummary> {
    return this.withRunLock(runId, async () => {
      const run = await this.getRun(runId);
      run.state = state;
      run.updatedAt = new Date().toISOString();
      await this.writeSummary(run);
      await this.appendEvent(runId, createEvent(runId, "run.state_changed", { state, ...payload }));
      return run;
    });
  }

  async upsertJob(runId: string, job: Omit<AgentJob, "artifacts"> & { artifacts?: ArtifactRef[] }): Promise<AgentJob> {
    return this.withRunLock(runId, async () => {
      const run = await this.getRun(runId);
      const existing = run.jobs.findIndex((candidate) => candidate.id === job.id);
      const next: AgentJob = { ...job, artifacts: job.artifacts ?? run.jobs[existing]?.artifacts ?? [] };
      if (existing >= 0) run.jobs[existing] = next;
      else run.jobs.push(next);
      run.updatedAt = new Date().toISOString();
      await this.writeSummary(run);
      await this.appendEvent(runId, createEvent(runId, "job.event", { jobId: job.id, state: job.state }));
      return next;
    });
  }

  async setJobState(runId: string, jobId: string, state: JobState, error?: string): Promise<AgentJob> {
    return this.withRunLock(runId, async () => {
      const run = await this.getRun(runId);
      const job = run.jobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error(`Unknown job ${jobId} for run ${runId}`);
      job.state = state;
      job.error = error;
      job.finishedAt = ["completed", "failed", "timed_out", "cancelled"].includes(state) ? new Date().toISOString() : job.finishedAt;
      await this.writeSummary({ ...run, updatedAt: new Date().toISOString() });
      await this.appendEvent(runId, createEvent(runId, "job.event", { jobId, state, error }));
      return job;
    });
  }

  async writeArtifact(runId: string, artifact: Omit<ArtifactRef, "path">, content: string): Promise<ArtifactRef> {
    return this.withRunLock(runId, async () => {
      const fileName = `${artifact.id}.jsonl`;
      const path = this.runPath(runId, "artifacts", fileName);
      await mkdir(this.runPath(runId, "artifacts"), { recursive: true });
      await writeFile(path, content);
      const ref: ArtifactRef = { ...artifact, path };
      const run = await this.getRun(runId);
      run.artifacts.push(ref);
      if (ref.sourceJobId) {
        const job = run.jobs.find((candidate) => candidate.id === ref.sourceJobId);
        job?.artifacts.push(ref);
      }
      run.updatedAt = new Date().toISOString();
      await this.writeSummary(run);
      await this.appendEvent(runId, createEvent(runId, "artifact.written", { artifactId: ref.id, kind: ref.kind }));
      return ref;
    });
  }

  async writeReport(runId: string, title: string, markdown: string, sourceArtifactIds: string[] = []): Promise<ReportRecord> {
    return this.withRunLock(runId, async () => {
      const id = createId("report");
      const path = this.runPath(runId, "reports", `${id}.md`);
      await writeFile(path, markdown);
      const report = { id, title, path, sourceArtifactIds, createdAt: new Date().toISOString() };
      const run = await this.getRun(runId);
      run.reports.push(report);
      run.updatedAt = new Date().toISOString();
      await this.writeSummary(run);
      await this.appendEvent(runId, createEvent(runId, "report.written", { reportId: id, title }));
      return report;
    });
  }

  async addApproval(runId: string, approval: ApprovalDecision): Promise<void> {
    await this.withRunLock(runId, async () => {
      const run = await this.getRun(runId);
      run.approvals.push(approval);
      run.state = "needs_approval";
      run.updatedAt = new Date().toISOString();
      await this.writeSummary(run);
      await this.appendEvent(runId, createEvent(runId, "approval.requested", { approvalId: approval.id, action: approval.requestedAction, evidence: approval.evidence }));
      await this.appendEvent(runId, createEvent(runId, "run.state_changed", { state: "needs_approval", approvalId: approval.id }));
    });
  }

  async decideApproval(runId: string, approvalId: string, state: "approved" | "rejected", actor = "local-user"): Promise<ApprovalDecision> {
    return this.withRunLock(runId, async () => {
      const run = await this.getRun(runId);
      const approval = run.approvals.find((candidate) => candidate.id === approvalId);
      if (!approval) throw new Error(`Unknown approval ${approvalId}`);
      if (approval.state !== "pending") throw new Error(`Approval ${approvalId} has already been ${approval.state}`);
      approval.state = state;
      approval.actor = actor;
      approval.decidedAt = new Date().toISOString();
      run.state = state === "approved" ? "completed" : "cancelled";
      run.updatedAt = new Date().toISOString();
      await this.writeSummary(run);
      await this.appendEvent(runId, createEvent(runId, "approval.decided", { approvalId, state, actor, evidence: approval.evidence }));
      await this.appendEvent(runId, createEvent(runId, "run.state_changed", { state: run.state, approvalId, decision: state }));
      return approval;
    });
  }

  async addCheckpoint(runId: string, checkpoint: CheckpointRecord): Promise<void> {
    await this.withRunLock(runId, async () => {
      const run = await this.getRun(runId);
      run.checkpoints.push(checkpoint);
      run.updatedAt = new Date().toISOString();
      await this.writeSummary(run);
      await this.appendEvent(runId, createEvent(runId, "checkpoint.created", { checkpointId: checkpoint.id, gitRef: checkpoint.gitRef }));
    });
  }

  async addWorktreePath(runId: string, worktreePath: string): Promise<void> {
    await this.withRunLock(runId, async () => {
      const run = await this.getRun(runId);
      if (!run.worktreePaths.includes(worktreePath)) run.worktreePaths.push(worktreePath);
      run.updatedAt = new Date().toISOString();
      await this.writeSummary(run);
      await this.appendEvent(runId, createEvent(runId, "artifact.written", { kind: "worktree", path: worktreePath }));
    });
  }

  async readEvents(runId: string): Promise<WaywardEvent[]> {
    const text = await readFile(this.runPath(runId, "events.jsonl"), "utf8");
    return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as WaywardEvent);
  }

  private async appendEvent(runId: string, event: WaywardEvent): Promise<void> {
    await appendFile(this.runPath(runId, "events.jsonl"), `${JSON.stringify(event)}\n`);
  }

  private async writeSummary(run: RunSummary): Promise<void> {
    await mkdir(this.runPath(run.id), { recursive: true });
    const target = this.runPath(run.id, "summary.json");
    const temporary = this.runPath(run.id, `${createId("summary")}.tmp`);
    await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`);
    await rename(temporary, target);
  }

  private runPath(runId: string, ...parts: string[]): string {
    return join(this.rootDir, runId, ...parts);
  }

  private async withRunLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(runId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.locks.set(runId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(runId) === tail) this.locks.delete(runId);
    }
  }
}

function defaultRunRoot(): string {
  return process.env.WAYWARD_RUNS_DIR ?? join(process.env.INIT_CWD ?? process.cwd(), ".wayward", "runs");
}
