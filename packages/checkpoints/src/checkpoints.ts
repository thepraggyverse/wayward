import { rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { createId, type FileRunStore, type CheckpointRecord } from "@thepraggyverse/core";
import type { GitClient } from "@thepraggyverse/git-worktrees";

export class CheckpointManager {
  constructor(private readonly git: GitClient, private readonly store: FileRunStore) {}

  async createCheckpoint(repoPath: string, runId: string, label: string, metadata: Record<string, unknown> = {}): Promise<CheckpointRecord> {
    const id = createId("cp");
    const gitRef = `refs/wayward/${runId}/${id}`;
    const gitDir = (await this.git.exec(["rev-parse", "--git-dir"], { cwd: repoPath })).stdout.trim();
    const gitDirPath = isAbsolute(gitDir) ? gitDir : join(repoPath, gitDir);
    const indexPath = join(gitDirPath, `${createId("wayward-index")}.tmp`);
    const env = { GIT_INDEX_FILE: indexPath };
    try {
      await this.git.exec(["read-tree", "HEAD"], { cwd: repoPath, env });
      await this.git.exec(["add", "-A", "--", ".", ":(exclude).wayward"], { cwd: repoPath, env });
      const tree = (await this.git.exec(["write-tree"], { cwd: repoPath, env })).stdout.trim();
      const commit = (await this.git.exec(["commit-tree", tree, "-p", "HEAD", "-m", `wayward checkpoint: ${label}`], { cwd: repoPath })).stdout.trim();
      await this.git.exec(["update-ref", gitRef, commit], { cwd: repoPath });
    } finally {
      await rm(indexPath, { force: true });
    }
    const checkpoint = { id, label, gitRef, createdAt: new Date().toISOString(), metadata };
    await this.store.addCheckpoint(runId, checkpoint);
    return checkpoint;
  }
}
