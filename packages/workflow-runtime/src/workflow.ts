import { createId, type FileRunStore } from "@thepraggyverse/core";
import type { PhaseDefinition, PhaseResult } from "./phases.js";

export interface WorkflowDefinition {
  name: string;
  phases: PhaseDefinition[];
}

export class WorkflowRuntime {
  constructor(private readonly store: FileRunStore) {}

  async run(workflow: WorkflowDefinition, input: Record<string, unknown> = {}): Promise<{ runId: string; results: PhaseResult[] }> {
    const run = await this.store.createRun({ workflowName: workflow.name, inputs: input });
    await this.store.setRunState(run.id, "running");
    const results: PhaseResult[] = [];
    let current: unknown = input;
    for (const phase of workflow.phases) {
      try {
        const parsedInput = phase.inputSchema ? phase.inputSchema.parse(current) : current;
        const output = await phase.run(parsedInput, {
          runId: run.id,
          emitArtifact: async (kind, content) => {
            const artifact = await this.store.writeArtifact(run.id, { id: createId(phase.id), kind }, content);
            return artifact.id;
          }
        });
        const parsedOutput = phase.outputSchema ? phase.outputSchema.parse(output) : output;
        results.push({ phaseId: phase.id, kind: phase.kind, state: "completed", output: parsedOutput });
        current = parsedOutput;
        if (phase.kind === "gate") {
          await this.store.addApproval(run.id, {
            id: createId("approval"),
            requestedAction: phase.id,
            evidence: [],
            state: "pending"
          });
          return { runId: run.id, results };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ phaseId: phase.id, kind: phase.kind, state: phase.policy === "optional" ? "skipped" : "failed", error: message });
        if (phase.policy !== "optional") {
          await this.store.setRunState(run.id, "failed", { phaseId: phase.id, error: message });
          return { runId: run.id, results };
        }
      }
    }
    await this.store.writeReport(run.id, `${workflow.name} report`, renderReport(workflow.name, results));
    await this.store.setRunState(run.id, "completed");
    return { runId: run.id, results };
  }
}

function renderReport(workflowName: string, results: PhaseResult[]): string {
  const lastOutput = [...results].reverse().find((result) => result.output)?.output;
  const body = typeof lastOutput === "object" && lastOutput ? `\n\n\`\`\`json\n${JSON.stringify(lastOutput, null, 2)}\n\`\`\`\n` : "";
  return `# ${workflowName}\n\nCompleted ${results.length} phases.${body}`;
}
