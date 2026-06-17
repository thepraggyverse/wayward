import { FileRunStore } from "@thepraggyverse/core";
import { RealGitClient } from "@thepraggyverse/git-worktrees";
import { RewindService } from "@thepraggyverse/checkpoints";

export async function rewindCommand(args: string[], store = new FileRunStore()): Promise<string> {
  const [runId, checkpointId] = args;
  if (!runId || !checkpointId) throw new Error("Usage: wayward rewind <run-id> <checkpoint-id>");
  await new RewindService(new RealGitClient(), store).rewind(process.cwd(), runId, checkpointId);
  return `Rewound ${runId} to ${checkpointId}`;
}
