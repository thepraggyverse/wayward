export type PermissionMode = "inspect" | "worktree-write" | "autopilot";
export type RunState = "created" | "running" | "needs_approval" | "completed" | "failed" | "timed_out" | "cancelled" | "rewound";
export type JobState = "queued" | "running" | "completed" | "failed" | "timed_out" | "cancelled";
export type ApprovalState = "pending" | "approved" | "rejected";

export interface ArtifactRef {
  id: string;
  kind: string;
  path: string;
  sourceJobId?: string;
}

export interface AgentJob {
  id: string;
  phaseId?: string;
  adapter: string;
  state: JobState;
  worktreePath?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  artifacts: ArtifactRef[];
}

export interface ApprovalDecision {
  id: string;
  actor?: string;
  requestedAction: string;
  evidence: string[];
  state: ApprovalState;
  decidedAt?: string;
}

export interface CheckpointRecord {
  id: string;
  label: string;
  gitRef: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ReportRecord {
  id: string;
  title: string;
  path: string;
  sourceArtifactIds: string[];
  createdAt: string;
}

export interface RunSummary {
  id: string;
  workflowName: string;
  adapter: string;
  mode: PermissionMode;
  state: RunState;
  inputs: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  worktreePaths: string[];
  jobs: AgentJob[];
  artifacts: ArtifactRef[];
  approvals: ApprovalDecision[];
  checkpoints: CheckpointRecord[];
  reports: ReportRecord[];
  skipped: string[];
}

export interface CreateRunInput {
  workflowName: string;
  adapter?: string;
  mode?: PermissionMode;
  inputs?: Record<string, unknown>;
}
