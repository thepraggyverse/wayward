import { FileRunStore } from "@thepraggyverse/core";

export async function approvalsCommand(args: string[], store = new FileRunStore()): Promise<string> {
  const [action, runId, approvalId] = args;
  if (!runId || !approvalId || !["approve", "reject"].includes(action ?? "")) {
    throw new Error("Usage: wayward approvals approve|reject <run-id> <approval-id>");
  }
  const decision = await store.decideApproval(runId, approvalId, action === "approve" ? "approved" : "rejected");
  return JSON.stringify(decision, null, 2);
}
