import { CheckpointManager } from "@thepraggyverse/checkpoints";
import { FileRunStore } from "@thepraggyverse/core";
import { RealGitClient, type GitClient } from "@thepraggyverse/git-worktrees";
import { invocationCwd } from "./paths.js";

export async function checkpointsCommand(args: string[], store = new FileRunStore(), options: { repoPath?: string; git?: GitClient } = {}): Promise<string> {
  const [action, runId, ...rest] = args;
  if (action === "list" && runId) {
    const run = await store.getRun(runId);
    return JSON.stringify(run.checkpoints, null, 2);
  }
  if (action === "create" && runId) {
    const label = rest.join(" ").trim() || "manual";
    const checkpoint = await new CheckpointManager(options.git ?? new RealGitClient(), store).createCheckpoint(options.repoPath ?? invocationCwd(), runId, label, {
      type: "manual"
    });
    return JSON.stringify(checkpoint, null, 2);
  }
  throw new Error("Usage: wayward checkpoints list <run-id> | create <run-id> [label]");
}
