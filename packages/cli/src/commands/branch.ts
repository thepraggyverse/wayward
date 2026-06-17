import { FileRunStore, createId } from "@thepraggyverse/core";
import { RealGitClient, RunWorktreeService, type GitClient } from "@thepraggyverse/git-worktrees";

interface BranchOptions {
  checkpointId?: string;
  name?: string;
}

export async function branchCommand(args: string[], store = new FileRunStore(), dependencies: { repoPath?: string; git?: GitClient } = {}): Promise<string> {
  const [runId, ...optionArgs] = args;
  if (!runId) throw new Error("Usage: wayward branch <run-id> [--checkpoint <checkpoint-id>] [--name <name>]");
  const branchOptions = parseBranchOptions(optionArgs);
  const run = await store.getRun(runId);
  const checkpoint = branchOptions.checkpointId
    ? run.checkpoints.find((candidate) => candidate.id === branchOptions.checkpointId)
    : undefined;
  if (branchOptions.checkpointId && !checkpoint) throw new Error(`Unknown checkpoint ${branchOptions.checkpointId} for run ${runId}`);

  const jobId = sanitizeBranchPart(branchOptions.name ?? `branch-${createId("job").slice(4, 12)}`);
  const baseRef = checkpoint?.gitRef ?? "HEAD";
  const worktree = await new RunWorktreeService(store, dependencies.git ?? new RealGitClient()).createForRun(dependencies.repoPath ?? process.cwd(), {
    runId,
    jobId,
    baseRef
  });

  return JSON.stringify(
    {
      runId,
      worktreePath: worktree.path,
      branch: worktree.branch,
      baseRef,
      checkpointId: checkpoint?.id
    },
    null,
    2
  );
}

function parseBranchOptions(args: string[]): BranchOptions {
  const options: BranchOptions = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--checkpoint") {
      const value = args[++index];
      if (!value) throw new Error("Usage: wayward branch <run-id> --checkpoint <checkpoint-id>");
      options.checkpointId = value;
      continue;
    }
    if (arg === "--name") {
      const value = args[++index];
      if (!value) throw new Error("Usage: wayward branch <run-id> --name <name>");
      options.name = value;
      continue;
    }
    throw new Error(`Unknown branch option ${arg}`);
  }
  return options;
}

function sanitizeBranchPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "branch";
}
