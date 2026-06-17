import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FileRunStore } from "@thepraggyverse/core";
import type { GitClient } from "@thepraggyverse/git-worktrees";

export class RewindService {
  constructor(private readonly git: GitClient, private readonly store: FileRunStore) {}

  async rewind(repoPath: string, runId: string, checkpointId: string): Promise<void> {
    const run = await this.store.getRun(runId);
    const checkpoint = run.checkpoints.find((candidate) => candidate.id === checkpointId);
    if (!checkpoint) throw new Error(`Unknown checkpoint ${checkpointId} for run ${runId}`);
    const untracked = (await this.git.exec(["ls-files", "--others", "--exclude-standard"], { cwd: repoPath })).stdout
      .split("\n")
      .filter(Boolean);
    for (const file of untracked) {
      const destination = join(repoPath, ".wayward", "rewind-quarantine", runId, checkpointId, file);
      await mkdir(dirname(destination), { recursive: true });
      await rename(join(repoPath, file), destination);
    }
    await this.git.exec(["restore", "--source", checkpoint.gitRef, "--worktree", "--staged", "."], { cwd: repoPath });
    await this.store.setRunState(runId, "rewound", { checkpointId });
  }
}
