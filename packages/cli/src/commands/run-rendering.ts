import type { AgentJob, ArtifactRef, JobState, RunState, RunSummary, WaywardEvent } from "@thepraggyverse/core";

export interface BoardRun {
  run: RunSummary;
  latestFailure?: string;
}

export interface BoardRenderOptions {
  state?: RunState;
  workflow?: string;
  limit?: number;
}

const JOB_STATE_ORDER: JobState[] = ["queued", "running", "completed", "failed", "timed_out", "cancelled"];

const RUN_STATE_LABELS: Record<RunState, string> = {
  created: "CREATED",
  running: "RUNNING",
  needs_approval: "ACTION REQUIRED",
  completed: "COMPLETED",
  failed: "FAILED",
  timed_out: "TIMED OUT",
  cancelled: "CANCELLED",
  rewound: "REWOUND"
};

export function renderBoard(runs: BoardRun[], options: BoardRenderOptions = {}): string {
  if (runs.length === 0) return "No Wayward runs match the requested filters.";
  return [
    "Wayward Board",
    `runs: ${runs.length}`,
    `filters: state=${options.state ?? "-"} workflow=${options.workflow ?? "-"} limit=${options.limit ?? "-"}`,
    "",
    runs.map(({ run, latestFailure }) => [
      `run: ${run.id}`,
      `workflow: ${run.workflowName}`,
      `state: ${formatRunState(run.state)}`,
      `mode: ${run.mode}`,
      `created: ${run.createdAt}`,
      `updated: ${run.updatedAt}`,
      `jobs: ${formatJobCounts(run.jobs)}`,
      `reports: ${run.reports.length}`,
      `pending approvals: ${pendingApprovalCount(run)}`,
      `checkpoints: ${run.checkpoints.length}`,
      `worktrees: ${run.worktreePaths.length}`,
      `latest failure: ${latestFailure ?? "-"}`
    ].join("\n")).join("\n\n")
  ].join("\n");
}

export function renderRunDetail(run: RunSummary, events: WaywardEvent[]): string {
  return [
    `Run ${run.id}`,
    "",
    "metadata:",
    `workflow: ${run.workflowName}`,
    `state: ${formatRunState(run.state)}`,
    `mode: ${run.mode}`,
    `adapter: ${run.adapter}`,
    `created: ${run.createdAt}`,
    `updated: ${run.updatedAt}`,
    `inputs: ${stableJson(run.inputs)}`,
    `skipped: ${run.skipped.length ? run.skipped.join(",") : "-"}`,
    "",
    section("jobs", formatJobs(run.jobs)),
    section("reports", run.reports.map((report) => `id=${report.id} title=${quote(report.title)} created=${report.createdAt} path=${report.path} sources=${formatList(report.sourceArtifactIds)}`)),
    section("approvals", run.approvals.map((approval) => [
      `id=${approval.id}`,
      `state=${approval.state}`,
      `action=${approval.requestedAction}`,
      `actor=${approval.actor ?? "-"}`,
      `decided=${approval.decidedAt ?? "-"}`,
      `evidence=${formatList(approval.evidence)}`
    ].join(" "))),
    section("artifacts by type", formatArtifactsByType(run.artifacts)),
    section("checkpoints", run.checkpoints.map((checkpoint) => [
      `id=${checkpoint.id}`,
      `label=${quote(checkpoint.label)}`,
      `git_ref=${checkpoint.gitRef}`,
      `created=${checkpoint.createdAt}`,
      `metadata=${checkpoint.metadata ? stableJson(checkpoint.metadata) : "-"}`
    ].join(" "))),
    section("worktrees", run.worktreePaths),
    section("recent events", events.slice(-10).map((event) => `${event.timestamp} ${event.type} id=${event.id} payload=${stableJson(event.payload)}`))
  ].join("\n\n");
}

export function latestFailureSummary(run: RunSummary, events: WaywardEvent[]): string | undefined {
  for (const event of [...events].reverse()) {
    const payload = event.payload;
    const error = typeof payload.error === "string" && payload.error.trim() ? singleLine(payload.error) : undefined;
    const state = typeof payload.state === "string" ? payload.state : undefined;
    if (error) return withEventContext(event, error);
    if ((event.type === "job.event" || event.type === "run.state_changed") && isTerminalProblemState(state)) {
      return withEventContext(event, state);
    }
  }

  const failedJob = [...run.jobs].reverse().find((job) => isTerminalProblemState(job.state) || Boolean(job.error));
  if (failedJob) {
    const error = failedJob.error ? `: ${singleLine(failedJob.error)}` : "";
    return `job ${failedJob.id}: ${failedJob.state}${error}`;
  }
  if (isTerminalProblemState(run.state)) return `run ${run.state}`;
  return undefined;
}

function formatRunState(state: RunState): string {
  return `${state} [${RUN_STATE_LABELS[state]}]`;
}

function pendingApprovalCount(run: RunSummary): number {
  return run.approvals.filter((approval) => approval.state === "pending").length;
}

function formatJobCounts(jobs: AgentJob[]): string {
  const counts = new Map<JobState, number>(JOB_STATE_ORDER.map((state) => [state, 0]));
  for (const job of jobs) counts.set(job.state, (counts.get(job.state) ?? 0) + 1);
  return JOB_STATE_ORDER.map((state) => `${state}=${counts.get(state) ?? 0}`).join(" ");
}

function formatJobs(jobs: AgentJob[]): string[] {
  return jobs.map((job) => [
    `id=${job.id}`,
    `state=${job.state}`,
    `adapter=${job.adapter}`,
    `phase=${job.phaseId ?? "-"}`,
    `started=${job.startedAt ?? "-"}`,
    `finished=${job.finishedAt ?? "-"}`,
    `worktree=${job.worktreePath ?? "-"}`,
    `error=${job.error ? quote(singleLine(job.error)) : "-"}`,
    `artifacts=${formatList(job.artifacts.map((artifact) => artifact.id))}`
  ].join(" "));
}

function formatArtifactsByType(artifacts: ArtifactRef[]): string[] {
  const groups = new Map<string, ArtifactRef[]>();
  for (const artifact of artifacts) {
    groups.set(artifact.kind, [...(groups.get(artifact.kind) ?? []), artifact]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([kind, grouped]) => [
      `${kind} (${grouped.length})`,
      ...grouped
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((artifact) => `  id=${artifact.id} source_job=${artifact.sourceJobId ?? "-"} path=${artifact.path}`)
    ]);
}

function section(title: string, lines: string[]): string {
  return [`${title}:`, ...(lines.length ? lines.map((line) => line.startsWith("  ") ? line : `- ${line}`) : ["- none"])].join("\n");
}

function formatList(values: string[]): string {
  return values.length ? values.join(",") : "-";
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function withEventContext(event: WaywardEvent, summary: string): string {
  const parts: string[] = [event.type];
  if (typeof event.payload.phaseId === "string") parts.push(`phase ${event.payload.phaseId}`);
  if (typeof event.payload.jobId === "string") parts.push(`job ${event.payload.jobId}`);
  return `${parts.join(": ")}: ${summary}`;
}

function isTerminalProblemState(state: unknown): state is "failed" | "timed_out" | "cancelled" {
  return state === "failed" || state === "timed_out" || state === "cancelled";
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)])
  );
}
