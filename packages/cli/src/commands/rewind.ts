import { FileRunStore } from "@thepraggyverse/core";
import { RealGitClient, type GitClient } from "@thepraggyverse/git-worktrees";
import { RewindService } from "@thepraggyverse/checkpoints";

export async function rewindCommand(args: string[], store = new FileRunStore(), options: { repoPath?: string; git?: GitClient } = {}): Promise<string> {
  const [runId, checkpointId] = args;
  if (!runId || !checkpointId) throw new Error("Usage: wayward rewind <run-id> <checkpoint-id>");
  const result = await new RewindService(options.git ?? new RealGitClient(), store).rewind(options.repoPath ?? process.cwd(), runId, checkpointId);
  return JSON.stringify(
    {
      runId,
      checkpointId,
      state: "rewound",
      safetyCheckpointId: result.safetyCheckpoint?.id,
      quarantinedFiles: result.quarantinedFiles
    },
    null,
    2
  );
}
