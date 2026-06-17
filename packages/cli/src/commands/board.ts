import { FileRunStore } from "@thepraggyverse/core";

export async function boardCommand(store = new FileRunStore()): Promise<string> {
  const runs = await store.listRuns();
  if (runs.length === 0) return "No Wayward runs found.";
  return runs.map((run) => `${run.id}\t${run.state}\t${run.workflowName}\t${run.mode}\t${run.updatedAt}\t${formatApprovals(run.approvals)}\t${formatCheckpoints(run.checkpoints)}\t${formatWorktrees(run.worktreePaths)}`).join("\n");
}

function formatApprovals(approvals: Array<{ id: string; requestedAction: string; state: string; evidence: string[] }>): string {
  if (approvals.length === 0) return "approvals:none";
  return approvals.map((approval) => {
    const evidence = approval.evidence.length > 0 ? ` evidence=${approval.evidence.join(",")}` : "";
    return `${approval.state}:${approval.id}:${approval.requestedAction}${evidence}`;
  }).join(";");
}

function formatCheckpoints(checkpoints: Array<{ id: string; label: string; gitRef: string }>): string {
  if (checkpoints.length === 0) return "checkpoints:none";
  return `checkpoints:${checkpoints.map((checkpoint) => `${checkpoint.id}:${checkpoint.label}:${checkpoint.gitRef}`).join(";")}`;
}

function formatWorktrees(worktreePaths: string[]): string {
  if (worktreePaths.length === 0) return "worktrees:none";
  return `worktrees:${worktreePaths.join(";")}`;
}
