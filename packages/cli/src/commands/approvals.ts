import { FileRunStore } from "@thepraggyverse/core";

export async function approvalsCommand(args: string[], store = new FileRunStore()): Promise<string> {
  const [action, runId, approvalId] = args;
  if (action === "list" || action === "pending") {
    const runs = await store.listRuns();
    const approvals = runs.flatMap((run) =>
      run.approvals
        .filter((approval) => approval.state === "pending")
        .map((approval) => ({
          runId: run.id,
          workflow: run.workflowName,
          runState: run.state,
          approvalId: approval.id,
          requestedAction: approval.requestedAction,
          evidence: approval.evidence,
          updatedAt: run.updatedAt
        }))
    );
    return JSON.stringify(approvals, null, 2);
  }
  if (!runId || !approvalId || !["approve", "reject"].includes(action ?? "")) {
    throw new Error("Usage: wayward approvals list|pending|approve|reject <run-id> <approval-id>");
  }
  const decision = await store.decideApproval(runId, approvalId, action === "approve" ? "approved" : "rejected");
  const run = await store.getRun(runId);
  return JSON.stringify({ runId, runState: run.state, approval: decision }, null, 2);
}
