import { createId, type FileRunStore, type PermissionMode } from "@thepraggyverse/core";
import type { PhaseDefinition, PhaseResult } from "./phases.js";

export interface WorkflowDefinition {
  name: string;
  defaultMode?: PermissionMode;
  requiredMode?: PermissionMode;
  phases: PhaseDefinition[];
}

export class WorkflowRuntime {
  constructor(private readonly store: FileRunStore) {}

  async run(
    workflow: WorkflowDefinition,
    input: Record<string, unknown> = {},
    options: { adapter?: string; mode?: PermissionMode } = {}
  ): Promise<{ runId: string; results: PhaseResult[] }> {
    const mode = options.mode ?? workflow.defaultMode ?? "inspect";
    const run = await this.store.createRun({ workflowName: workflow.name, inputs: input, adapter: options.adapter, mode });
    const requiredMode = workflow.requiredMode ?? "inspect";
    if (!allowsPermissionMode(mode, requiredMode)) {
      const error = `${workflow.name} requires ${requiredMode} mode; received ${mode}.`;
      const result: PhaseResult = { phaseId: "permission-check", kind: "verify", state: "failed", error };
      await this.store.setRunState(run.id, "failed", { phaseId: result.phaseId, error });
      return { runId: run.id, results: [result] };
    }
    await this.store.setRunState(run.id, "running");
    const results: PhaseResult[] = [];
    let current: unknown = input;
    for (const phase of workflow.phases) {
      try {
        const parsedInput = phase.inputSchema ? phase.inputSchema.parse(current) : current;
        const output = await phase.run(parsedInput, {
          runId: run.id,
          store: this.store,
          emitArtifact: async (kind, content) => {
            const artifact = await this.store.writeArtifact(run.id, { id: createId(phase.id), kind }, content);
            return artifact.id;
          }
        });
        const parsedOutput = phase.outputSchema ? phase.outputSchema.parse(output) : output;
        results.push({ phaseId: phase.id, kind: phase.kind, state: "completed", output: parsedOutput });
        current = parsedOutput;
        if (phase.kind === "gate") {
          const report = await this.store.writeReport(run.id, `${workflow.name} report`, renderReport(workflow.name, results));
          await this.store.addApproval(run.id, {
            id: createId("approval"),
            requestedAction: phase.id,
            evidence: [report.id],
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

function allowsPermissionMode(actual: PermissionMode, required: PermissionMode): boolean {
  const rank: Record<PermissionMode, number> = {
    inspect: 0,
    "worktree-write": 1,
    autopilot: 2
  };
  return rank[actual] >= rank[required];
}

function renderReport(workflowName: string, results: PhaseResult[]): string {
  const lastOutput = [...results].reverse().find((result) => result.output)?.output;
  if (isReviewReport(lastOutput)) {
    const findings = lastOutput.findings.length
      ? lastOutput.findings.map((finding, index) => [
          `### ${index + 1}. ${finding.title}`,
          "",
          `- Severity: ${finding.severity}`,
          `- Evidence: ${finding.evidence}`
        ].join("\n")).join("\n\n")
      : "No findings were reported.";
    return `# ${workflowName}\n\nCompleted ${results.length} phases.\n\n## Summary\n\n${lastOutput.summary}\n\n## Findings\n\n${findings}\n`;
  }
  const body = typeof lastOutput === "object" && lastOutput ? `\n\n\`\`\`json\n${JSON.stringify(lastOutput, null, 2)}\n\`\`\`\n` : "";
  return `# ${workflowName}\n\nCompleted ${results.length} phases.${body}`;
}

function isReviewReport(value: unknown): value is { summary: string; findings: Array<{ title: string; severity: string; evidence: string }> } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.summary === "string" && Array.isArray(record.findings) && record.findings.every((finding) => {
    if (!finding || typeof finding !== "object") return false;
    const candidate = finding as Record<string, unknown>;
    return typeof candidate.title === "string" && typeof candidate.severity === "string" && typeof candidate.evidence === "string";
  });
}
