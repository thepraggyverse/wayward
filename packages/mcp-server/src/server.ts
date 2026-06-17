import { createId, FileRunStore } from "@thepraggyverse/core";
import { RewindService } from "@thepraggyverse/checkpoints";
import { RealGitClient } from "@thepraggyverse/git-worktrees";
import { WorkflowRuntime } from "@thepraggyverse/workflow-runtime";
import { getWorkflow } from "@thepraggyverse/workflows";

export function createWaywardMcpTools(store = new FileRunStore()) {
  return {
    async createRun(input: { workflow: string; inputs?: Record<string, unknown> }) {
      return new WorkflowRuntime(store).run(getWorkflow(input.workflow), input.inputs ?? {});
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
    async rewind(input: { repoPath: string; runId: string; checkpointId: string }) {
      await new RewindService(new RealGitClient(), store).rewind(input.repoPath, input.runId, input.checkpointId);
      return { runId: input.runId, checkpointId: input.checkpointId, state: "rewound" };
    }
  };
}
