import type { WorkflowDefinition } from "@thepraggyverse/workflow-runtime";
import { runWithConcurrency } from "@thepraggyverse/workflow-runtime";
import { reportSchema } from "../shared/review-schemas.js";

export function createTournamentWorkflow(): WorkflowDefinition {
  return {
    name: "tournament",
    phases: [
      {
        id: "attempts",
        kind: "fanout",
        async run(input: { attempts?: number }) {
          const count = input.attempts ?? 3;
          const attempts = await runWithConcurrency(Array.from({ length: count }, (_, index) => index + 1), 2, async (attempt) => ({
            attempt,
            passed: true,
            evidence: `attempt-${attempt}-validation`
          }));
          return { attempts };
        }
      },
      {
        id: "select-winner",
        kind: "verify",
        outputSchema: reportSchema,
        async run(input: { attempts: Array<{ attempt: number; passed: boolean; evidence: string }> }) {
          const winner = input.attempts.find((attempt) => attempt.passed);
          return {
            summary: `Selected attempt ${winner?.attempt ?? "none"} after validation.`,
            findings: winner ? [{ title: "Winner selected", severity: "low", evidence: winner.evidence }] : []
          };
        }
      }
    ]
  };
}
