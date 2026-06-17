import type { FileRunStore } from "@thepraggyverse/core";
import { createId } from "@thepraggyverse/core";
import { WorktreeManager, type GitClient, type WorktreeMetadata } from "./manager.js";

export class RunWorktreeService {
  private readonly manager: WorktreeManager;

  constructor(private readonly store: FileRunStore, git?: GitClient) {
    this.manager = new WorktreeManager(git);
  }

  async createForRun(repoPath: string, input: { runId: string; jobId: string; baseRef?: string }): Promise<WorktreeMetadata> {
    const worktree = await this.manager.createWorktree(repoPath, input);
    await this.store.addWorktreePath(input.runId, worktree.path);
    return worktree;
  }
}

export interface BranchFromRunResult {
  runId: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  checkpointId?: string;
}

export class RunBranchService {
  private readonly worktrees: RunWorktreeService;

  constructor(private readonly store: FileRunStore, git?: GitClient) {
    this.worktrees = new RunWorktreeService(store, git);
  }

  async branch(repoPath: string, input: { runId: string; checkpointId?: string; name?: string }): Promise<BranchFromRunResult> {
    const run = await this.store.getRun(input.runId);
    const checkpoint = input.checkpointId
      ? run.checkpoints.find((candidate) => candidate.id === input.checkpointId)
      : undefined;
    if (input.checkpointId && !checkpoint) throw new Error(`Unknown checkpoint ${input.checkpointId} for run ${input.runId}`);

    const jobId = sanitizeBranchPart(input.name ?? `branch-${createId("job").slice(4, 12)}`);
    const baseRef = checkpoint?.gitRef ?? "HEAD";
    const worktree = await this.worktrees.createForRun(repoPath, {
      runId: input.runId,
      jobId,
      baseRef
    });

    return {
      runId: input.runId,
      worktreePath: worktree.path,
      branch: worktree.branch,
      baseRef,
      checkpointId: checkpoint?.id
    };
  }
}

function sanitizeBranchPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "branch";
}
