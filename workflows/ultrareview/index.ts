import type { WorkflowDefinition } from "@thepraggyverse/workflow-runtime";
import { runWithConcurrency } from "@thepraggyverse/workflow-runtime";
import { reportSchema } from "../shared/review-schemas.js";

export function createUltrareviewWorkflow(): WorkflowDefinition {
  const specialists = ["correctness", "security", "tests", "maintainability"];
  return {
    name: "ultrareview",
    phases: [
      {
        id: "specialist-review",
        kind: "fanout",
        async run(_input, context) {
          const findings = await runWithConcurrency(specialists, 2, async (specialist) => {
            await context.emitArtifact("review-note", JSON.stringify({ specialist, note: `Fake adapter ${specialist} review completed.` }));
            return { title: `${specialist} review`, severity: "low" as const, evidence: `artifact:${specialist}` };
          });
          return { findings };
        }
      },
      {
        id: "synthesize",
        kind: "synthesize",
        outputSchema: reportSchema,
        async run(input: { findings: unknown[] }) {
          return { summary: `Synthesized ${input.findings.length} specialist findings.`, findings: input.findings };
        }
      }
    ]
  };
}
