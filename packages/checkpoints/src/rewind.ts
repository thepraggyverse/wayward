import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CheckpointRecord, FileRunStore } from "@thepraggyverse/core";
import type { GitClient } from "@thepraggyverse/git-worktrees";
import { CheckpointManager } from "./checkpoints.js";

export interface RewindResult {
  checkpoint: CheckpointRecord;
  safetyCheckpoint?: CheckpointRecord;
  quarantinedFiles: string[];
}

export class RewindService {
  constructor(private readonly git: GitClient, private readonly store: FileRunStore) {}

  async rewind(repoPath: string, runId: string, checkpointId: string): Promise<RewindResult> {
    const run = await this.store.getRun(runId);
    const checkpoint = run.checkpoints.find((candidate) => candidate.id === checkpointId);
    if (!checkpoint) throw new Error(`Unknown checkpoint ${checkpointId} for run ${runId}`);
    const status = (await this.git.exec(["status", "--porcelain", "--", ".", ":(exclude).wayward"], { cwd: repoPath })).stdout.trim();
    const safetyCheckpoint = status
      ? await new CheckpointManager(this.git, this.store).createCheckpoint(repoPath, runId, `pre-rewind to ${checkpointId}`, {
          type: "pre-rewind",
          targetCheckpointId: checkpointId
        })
      : undefined;
    const untracked = (await this.git.exec(["ls-files", "--others", "--exclude-standard", "--", ".", ":(exclude).wayward"], { cwd: repoPath })).stdout
      .split("\n")
      .filter(Boolean);
    for (const file of untracked) {
      const destination = join(repoPath, ".wayward", "rewind-quarantine", runId, checkpointId, file);
      await mkdir(dirname(destination), { recursive: true });
      await rename(join(repoPath, file), destination);
    }
    await this.git.exec(["read-tree", "--reset", "-u", checkpoint.gitRef], { cwd: repoPath });
    await this.store.setRunState(runId, "rewound", { checkpointId });
    return { checkpoint, safetyCheckpoint, quarantinedFiles: untracked };
  }
}
