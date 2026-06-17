import { createId, FileRunStore } from "@thepraggyverse/core";
import { RewindService } from "@thepraggyverse/checkpoints";
import { RealGitClient } from "@thepraggyverse/git-worktrees";
import { WorkflowRuntime, type WorkflowDefinition } from "@thepraggyverse/workflow-runtime";
import { getWorkflow } from "@thepraggyverse/workflows";

export function createWaywardMcpTools(store = new FileRunStore(), dependencies: { getWorkflow?: (name: string) => WorkflowDefinition } = {}) {
  const resolveWorkflow = dependencies.getWorkflow ?? getWorkflow;
  return {
    async createRun(input: { workflow: string; inputs?: Record<string, unknown> }) {
      return new WorkflowRuntime(store).run(resolveWorkflow(input.workflow), input.inputs ?? {});
    },
    async listRuns() {
      return store.listRuns();
    },
    async readReport(input: { runId: string; reportId?: string }) {
      const run = await store.getRun(input.runId);
      return input.reportId ? run.reports.find((report) => report.id === input.reportId) : run.reports.at(-1);
    },
    async createCheckpoint(input: { runId: string; label: string; gitRef?: string; metadata?: Record<string, unknown> }) {
      const checkpoint = {
        id: createId("cp"),
        label: input.label,
        gitRef: input.gitRef ?? "HEAD",
        createdAt: new Date().toISOString(),
        metadata: input.metadata
      };
      await store.addCheckpoint(input.runId, checkpoint);
      return checkpoint;
    },
    async requestApproval(input: { runId: string; requestedAction: string; evidence?: string[] }) {
      const approval = { id: createId("approval"), requestedAction: input.requestedAction, evidence: input.evidence ?? [], state: "pending" as const };
      await store.addApproval(input.runId, approval);
      return approval;
    },
    async listPendingApprovals() {
      const runs = await store.listRuns();
      return runs.flatMap((run) =>
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
    },
    async decideApproval(input: { runId: string; approvalId: string; decision: "approved" | "rejected"; actor?: string }) {
      const approval = await store.decideApproval(input.runId, input.approvalId, input.decision, input.actor ?? "mcp-user");
      const run = await store.getRun(input.runId);
      return { runId: input.runId, runState: run.state, approval };
    },
    async rewind(input: { repoPath: string; runId: string; checkpointId: string }) {
      await new RewindService(new RealGitClient(), store).rewind(input.repoPath, input.runId, input.checkpointId);
      return { runId: input.runId, checkpointId: input.checkpointId, state: "rewound" };
    }
  };
}
