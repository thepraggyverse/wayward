import type { WorkflowDefinition } from "@thepraggyverse/workflow-runtime";
import { reportSchema } from "../shared/review-schemas.js";

export function createOpenPrAuditWorkflow(): WorkflowDefinition {
  return {
    name: "open-pr-audit",
    phases: [
      {
        id: "audit",
        kind: "fanout",
        async run(input) {
          return { clusters: [{ id: "cluster-1", prs: (input as { prs?: number[] }).prs ?? [], risk: "unknown" }] };
        }
      },
      {
        id: "rule",
        kind: "reduce",
        async run(input: { clusters: Array<{ id: string }> }) {
          return { dispositions: input.clusters.map((cluster) => ({ clusterId: cluster.id, action: "inspect-only" })) };
        }
      },
      {
        id: "verify",
        kind: "verify",
        async run(input: object) {
          return { verified: true, ...input };
        }
      },
      {
        id: "synthesize",
        kind: "synthesize",
        outputSchema: reportSchema,
        async run(input) {
          return {
            summary: "Open PR audit completed in inspect mode. External mutations require a gate.",
            findings: [{ title: "No external action taken", severity: "low", evidence: JSON.stringify(input) }]
          };
        }
      },
      {
        id: "external-action-gate",
        kind: "gate",
        async run(input) {
          return input;
        }
      }
    ]
  };
}
