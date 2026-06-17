export * from "./open-pr-audit/index.js";
export * from "./tournament/index.js";
export * from "./ultrareview/index.js";

import type { WorkflowDefinition } from "@thepraggyverse/workflow-runtime";
import { createOpenPrAuditWorkflow } from "./open-pr-audit/index.js";
import { createTournamentWorkflow } from "./tournament/index.js";
import { createUltrareviewWorkflow } from "./ultrareview/index.js";

export function getWorkflow(name: string): WorkflowDefinition {
  if (name === "ultrareview") return createUltrareviewWorkflow();
  if (name === "open-pr-audit" || name === "pr-audit") return createOpenPrAuditWorkflow();
  if (name === "tournament") return createTournamentWorkflow();
  throw new Error(`Unknown workflow ${name}`);
}
