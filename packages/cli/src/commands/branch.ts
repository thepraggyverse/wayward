import { FileRunStore } from "@thepraggyverse/core";
import { RealGitClient, RunBranchService, type GitClient } from "@thepraggyverse/git-worktrees";
import { invocationCwd } from "./paths.js";

interface BranchOptions {
  checkpointId?: string;
  name?: string;
}

export async function branchCommand(args: string[], store = new FileRunStore(), dependencies: { repoPath?: string; git?: GitClient } = {}): Promise<string> {
  const [runId, ...optionArgs] = args;
  if (!runId) throw new Error("Usage: wayward branch <run-id> [--checkpoint <checkpoint-id>] [--name <name>]");
  const branchOptions = parseBranchOptions(optionArgs);
  const branched = await new RunBranchService(store, dependencies.git ?? new RealGitClient()).branch(dependencies.repoPath ?? invocationCwd(), {
    runId,
    checkpointId: branchOptions.checkpointId,
    name: branchOptions.name
  });

  return JSON.stringify(
    branched,
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
