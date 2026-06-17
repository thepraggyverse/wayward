import type { FileRunStore } from "@thepraggyverse/core";
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
