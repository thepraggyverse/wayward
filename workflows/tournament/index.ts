import type { FileRunStore, JobState } from "@thepraggyverse/core";
import { CodexAdapter } from "@thepraggyverse/codex-adapter";
import { RunWorktreeService, type WorktreeMetadata } from "@thepraggyverse/git-worktrees";
import type { WorkflowDefinition } from "@thepraggyverse/workflow-runtime";
import { objectSchema } from "@thepraggyverse/workflow-runtime";
import { reportSchema } from "../shared/review-schemas.js";

interface TournamentInput {
  repo: string;
  attempts?: number;
  baseRef?: string;
  prompt?: string;
  mode?: string;
}

interface AttemptResult {
  attempt: number;
  jobId: string;
  state: JobState;
  rank?: number;
  worktreePath?: string;
  branch?: string;
  baseRef: string;
  artifactIds: string[];
  error?: string;
}

interface TournamentAttemptOutput {
  repo: string;
  prompt: string;
  baseRef: string;
  attempts: AttemptResult[];
}

interface TournamentAdapter {
  startExecJob(input: { runId: string; jobId: string; cwd: string; prompt: string; timeoutMs?: number; sandbox?: "read-only" | "workspace-write" | "danger-full-access" }): Promise<JobState>;
}

interface TournamentWorktrees {
  createForRun(repoPath: string, input: { runId: string; jobId: string; baseRef?: string }): Promise<WorktreeMetadata>;
}

export interface TournamentWorkflowDependencies {
  adapterFactory?: (store: FileRunStore) => TournamentAdapter;
  worktreeFactory?: (store: FileRunStore) => TournamentWorktrees;
}

export function createTournamentWorkflow(dependencies: TournamentWorkflowDependencies = {}): WorkflowDefinition {
  return {
    name: "tournament",
    defaultMode: "worktree-write",
    requiredMode: "worktree-write",
    phases: [
      {
        id: "attempts",
        kind: "fanout",
        inputSchema: objectSchema<TournamentInput>("TournamentInput", ["repo"], {
          repo: (value): value is string => typeof value === "string" && value.length > 0,
          attempts: (value): value is number => value === undefined || (typeof value === "number" && Number.isInteger(value) && value > 0),
          baseRef: (value): value is string => value === undefined || (typeof value === "string" && value.length > 0),
          prompt: (value): value is string => value === undefined || (typeof value === "string" && value.length > 0),
          mode: (value): value is string => value === undefined || typeof value === "string"
        }),
        async run(input: TournamentInput, context) {
          const count = input.attempts ?? 3;
          const baseRef = input.baseRef ?? "HEAD";
          const prompt = input.prompt ?? "Implement the requested task in this isolated Wayward tournament attempt.";
          const worktrees = dependencies.worktreeFactory?.(context.store) ?? new RunWorktreeService(context.store);
          const adapter = dependencies.adapterFactory?.(context.store) ?? new CodexAdapter(context.store);
          const attempts: AttemptResult[] = [];

          for (let attempt = 1; attempt <= count; attempt++) {
            const jobId = `attempt-${attempt}`;
            attempts.push(await runAttempt({ adapter, attempt, baseRef, context, jobId, prompt, repo: input.repo, worktrees }));
          }

          return { repo: input.repo, prompt, baseRef, attempts };
        }
      },
      {
        id: "rank-candidates",
        kind: "synthesize",
        outputSchema: reportSchema,
        async run(input: TournamentAttemptOutput, context) {
          const ranked = rankAttempts(input.attempts);
          await context.store.writeArtifact(context.runId, { id: "tournament-ranking", kind: "tournament-ranking-json" }, `${JSON.stringify({ ...input, attempts: ranked }, null, 2)}\n`);
          const best = ranked.find((attempt) => attempt.state === "completed");
          return {
            summary: best
              ? `Ranked ${ranked.length} candidates. Best candidate: attempt ${best.attempt} (${best.branch}) with status ${best.state}.`
              : `Ranked ${ranked.length} candidates. No completed candidate was produced.`,
            findings: ranked.map((attempt) => ({
              title: `#${attempt.rank}: attempt ${attempt.attempt} ${attempt.state}`,
              severity: attempt.state === "completed" ? "low" : "medium",
              evidence: [
                attempt.worktreePath ? `worktree=${attempt.worktreePath}` : "worktree=unavailable",
                attempt.branch ? `branch=${attempt.branch}` : "branch=unavailable",
                `baseRef=${attempt.baseRef}`,
                `artifacts=${attempt.artifactIds.join(",") || "none"}`,
                attempt.error ? `error=${attempt.error}` : undefined
              ].filter(Boolean).join(" ")
            }))
          };
        }
      }
    ]
  };
}

async function runAttempt(input: {
  adapter: TournamentAdapter;
  attempt: number;
  baseRef: string;
  context: { runId: string; store: FileRunStore };
  jobId: string;
  prompt: string;
  repo: string;
  worktrees: TournamentWorktrees;
}): Promise<AttemptResult> {
  let worktree: WorktreeMetadata | undefined;
  let state: JobState = "failed";
  let error: string | undefined;

  try {
    worktree = await input.worktrees.createForRun(input.repo, { runId: input.context.runId, jobId: input.jobId, baseRef: input.baseRef });
    await input.context.store.addWorktreePath(input.context.runId, worktree.path);
    state = await input.adapter.startExecJob({ runId: input.context.runId, jobId: input.jobId, cwd: worktree.path, prompt: input.prompt, sandbox: "workspace-write" });
    const job = (await input.context.store.getRun(input.context.runId)).jobs.find((candidate) => candidate.id === input.jobId);
    error = job?.error;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    await input.context.store.upsertJob(input.context.runId, {
      id: input.jobId,
      adapter: "codex",
      state: "failed",
      error,
      finishedAt: new Date().toISOString()
    });
  }

  const artifactIds = (await input.context.store.getRun(input.context.runId)).artifacts
    .filter((artifact) => artifact.sourceJobId === input.jobId)
    .map((artifact) => artifact.id);
  const attemptResult: AttemptResult = {
    attempt: input.attempt,
    jobId: input.jobId,
    state,
    worktreePath: worktree?.path,
    branch: worktree?.branch,
    baseRef: worktree?.baseRef ?? input.baseRef,
    artifactIds,
    error
  };
  const attemptArtifact = await input.context.store.writeArtifact(
    input.context.runId,
    { id: `${input.jobId}-state`, kind: "tournament-attempt-json", sourceJobId: input.jobId },
    `${JSON.stringify(attemptResult, null, 2)}\n`
  );
  return { ...attemptResult, artifactIds: [...artifactIds, attemptArtifact.id] };
}

function rankAttempts(attempts: AttemptResult[]): AttemptResult[] {
  const stateScore: Record<JobState, number> = {
    completed: 0,
    running: 1,
    queued: 2,
    timed_out: 3,
    failed: 4,
    cancelled: 5
  };
  return [...attempts]
    .sort((left, right) => stateScore[left.state] - stateScore[right.state] || left.attempt - right.attempt)
    .map((attempt, index) => ({ ...attempt, rank: index + 1 }));
}
