import { mkdir, readFile, readdir, writeFile, appendFile, rename } from "node:fs/promises";
import { hostname as osHostname } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createEvent, type WaywardEvent } from "./events.js";
import { createId } from "./ids.js";
import type { AgentJob, ApprovalDecision, ArtifactRef, CheckpointRecord, CreateRunInput, JobState, ReportRecord, RunRecoveryMetadata, RunRuntimeMetadata, RunState, RunSummary } from "./types.js";

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
export const DEFAULT_STALE_RUN_AFTER_MS = 60 * 60 * 1000;

export interface RecoverStaleRunsOptions {
  staleAfterMs?: number;
  now?: Date;
  runId?: string;
  includeForeignHosts?: boolean;
  hostname?: string;
  recoveredByPid?: number;
  isProcessAlive?: (pid: number) => boolean;
}

export interface RecoveredStaleRun {
  runId: string;
  workflowName: string;
  previousState: "running";
  state: "interrupted";
  reason: string;
  staleMs: number;
  lastActivityAt: string;
  lastHeartbeatAt?: string;
  runtime?: RunRuntimeMetadata;
}

export interface SkippedStaleRun {
  runId: string;
  state: RunState;
  reason: string;
}

export interface RecoverStaleRunsResult {
  recovered: RecoveredStaleRun[];
  skipped: SkippedStaleRun[];
  staleAfterMs: number;
  now: string;
}

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

  runDirectory(runId: string): string {
    return this.runPath(runId);
  }

  containsRunPath(runId: string, candidatePath: string): boolean {
    const runDirectory = resolve(this.runDirectory(runId));
    const candidate = resolve(candidatePath);
    const pathFromRun = relative(runDirectory, candidate);
    return pathFromRun === "" || (!!pathFromRun && !pathFromRun.startsWith("..") && !isAbsolute(pathFromRun));
  }

  async setRunState(runId: string, state: RunState, payload: Record<string, unknown> = {}): Promise<RunSummary> {
    return this.withRunLock(runId, async () => {
      const run = await this.getRun(runId);
      run.state = state;
      if (state !== "running") delete run.runtime;
      run.updatedAt = new Date().toISOString();
      await this.writeSummary(run);
      await this.appendEvent(runId, createEvent(runId, "run.state_changed", { state, ...payload }));
      return run;
    });
  }

  async recordRunRuntime(runId: string, runtime: RunRuntimeMetadata = createRunRuntimeMetadata()): Promise<RunSummary> {
    return this.withRunLock(runId, async () => {
      const run = await this.getRun(runId);
      run.runtime = runtime;
      run.updatedAt = new Date().toISOString();
      await this.writeSummary(run);
      await this.appendEvent(runId, createEvent(runId, "run.runtime_started", {
        pid: runtime.pid,
        hostname: runtime.hostname,
        startedAt: runtime.startedAt,
        heartbeatAt: runtime.heartbeatAt,
        heartbeatIntervalMs: runtime.heartbeatIntervalMs
      }));
      return run;
    });
  }

  async recordRunHeartbeat(runId: string, heartbeatAt = new Date()): Promise<RunSummary> {
    return this.withRunLock(runId, async () => {
      const run = await this.getRun(runId);
      if (run.state !== "running" || !run.runtime) return run;
      run.runtime = { ...run.runtime, heartbeatAt: heartbeatAt.toISOString() };
      await this.writeSummary(run);
      return run;
    });
  }

  async recoverStaleRunningRuns(options: RecoverStaleRunsOptions = {}): Promise<RecoverStaleRunsResult> {
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_RUN_AFTER_MS;
    if (!Number.isInteger(staleAfterMs) || staleAfterMs < 1) {
      throw new Error("staleAfterMs must be a positive integer.");
    }
    const now = options.now ?? new Date();
    const hostname = options.hostname ?? osHostname();
    const recoveredByPid = options.recoveredByPid ?? process.pid;
    const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
    const candidates = options.runId ? [await this.getRun(options.runId)] : await this.listRuns();
    const recovered: RecoveredStaleRun[] = [];
    const skipped: SkippedStaleRun[] = [];

    for (const candidate of candidates) {
      await this.withRunLock(candidate.id, async () => {
        const run = await this.getRun(candidate.id);
        const assessment = assessStaleRun(run, {
          now,
          staleAfterMs,
          hostname,
          includeForeignHosts: options.includeForeignHosts ?? false,
          isProcessAlive
        });
        if (!assessment.recover) {
          skipped.push({ runId: run.id, state: run.state, reason: assessment.reason });
          return;
        }

        const previousRuntime = run.runtime;
        const recoveredAt = now.toISOString();
        const reason = `Recovered stale running run after ${assessment.staleMs}ms without activity.`;
        const recovery: RunRecoveryMetadata = {
          previousState: "running",
          recoveredAt,
          reason,
          staleAfterMs,
          lastActivityAt: assessment.lastActivityAt,
          ...(previousRuntime?.heartbeatAt ? { lastHeartbeatAt: previousRuntime.heartbeatAt } : {}),
          ...(previousRuntime ? { runtime: previousRuntime } : {}),
          recoveredBy: {
            pid: recoveredByPid,
            hostname
          }
        };

        run.state = "interrupted";
        run.recovery = recovery;
        run.updatedAt = recoveredAt;
        delete run.runtime;
        for (const job of run.jobs) {
          if (job.state === "running" || job.state === "queued") {
            job.state = "failed";
            job.error = job.error ?? reason;
            job.finishedAt = recoveredAt;
          }
        }
        await this.writeSummary(run);
        await this.appendEvent(run.id, createEvent(run.id, "run.state_changed", {
          state: "interrupted",
          previousState: "running",
          reason,
          error: reason
        }));
        await this.appendEvent(run.id, createEvent(run.id, "run.recovered", {
          state: "interrupted",
          previousState: "running",
          reason,
          error: reason,
          staleAfterMs,
          staleMs: assessment.staleMs,
          lastActivityAt: assessment.lastActivityAt,
          ...(previousRuntime?.heartbeatAt ? { lastHeartbeatAt: previousRuntime.heartbeatAt } : {}),
          ...(previousRuntime ? { runtime: previousRuntime } : {}),
          recoveredBy: recovery.recoveredBy
        }));
        recovered.push({
          runId: run.id,
          workflowName: run.workflowName,
          previousState: "running",
          state: "interrupted",
          reason,
          staleMs: assessment.staleMs,
          lastActivityAt: assessment.lastActivityAt,
          ...(previousRuntime?.heartbeatAt ? { lastHeartbeatAt: previousRuntime.heartbeatAt } : {}),
          ...(previousRuntime ? { runtime: previousRuntime } : {})
        });
      });
    }

    return { recovered, skipped, staleAfterMs, now: now.toISOString() };
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
    assertSafeId(artifact.id, "artifact id");
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
      delete run.runtime;
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
    assertSafeId(runId, "run id");
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

function assertSafeId(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`Unsafe ${label}: ${value}`);
}

function createRunRuntimeMetadata(now = new Date()): RunRuntimeMetadata {
  const timestamp = now.toISOString();
  return {
    pid: process.pid,
    hostname: osHostname(),
    startedAt: timestamp,
    heartbeatAt: timestamp,
    heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS
  };
}

interface StaleRunAssessmentInput {
  now: Date;
  staleAfterMs: number;
  hostname: string;
  includeForeignHosts: boolean;
  isProcessAlive: (pid: number) => boolean;
}

type StaleRunAssessment =
  | { recover: true; staleMs: number; lastActivityAt: string }
  | { recover: false; reason: string };

function assessStaleRun(run: RunSummary, input: StaleRunAssessmentInput): StaleRunAssessment {
  if (run.state !== "running") return { recover: false, reason: `state is ${run.state}` };
  const lastActivityAt = run.runtime?.heartbeatAt ?? run.updatedAt;
  const lastActivityTime = Date.parse(lastActivityAt);
  if (!Number.isFinite(lastActivityTime)) return { recover: false, reason: `last activity timestamp is invalid: ${lastActivityAt}` };
  const staleMs = input.now.getTime() - lastActivityTime;
  if (staleMs < input.staleAfterMs) {
    return { recover: false, reason: `last activity is ${Math.max(0, staleMs)}ms old, below stale threshold ${input.staleAfterMs}ms` };
  }
  if (run.runtime?.hostname && run.runtime.hostname !== input.hostname && !input.includeForeignHosts) {
    return { recover: false, reason: `runtime belongs to host ${run.runtime.hostname}; pass includeForeignHosts to recover from ${input.hostname}` };
  }
  if (run.runtime?.hostname === input.hostname && Number.isInteger(run.runtime.pid) && run.runtime.pid > 0 && input.isProcessAlive(run.runtime.pid)) {
    return { recover: false, reason: `runtime pid ${run.runtime.pid} is still alive on ${input.hostname}` };
  }
  return { recover: true, staleMs, lastActivityAt };
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
