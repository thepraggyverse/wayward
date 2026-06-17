import { FileRunStore } from "@thepraggyverse/core";
import { WorkflowRuntime } from "@thepraggyverse/workflow-runtime";
import { getWorkflow } from "@thepraggyverse/workflows";
import { resolve } from "node:path";

export async function runCommand(args: string[], store = new FileRunStore()): Promise<string> {
  const workflowName = args[0] ?? "ultrareview";
  const options = parseRunOptions(args.slice(1));
  const workflow = getWorkflow(workflowName);
  const runtime = new WorkflowRuntime(store);
  const result = await runtime.run(workflow, { repo: options.repo });
  return JSON.stringify({ runId: result.runId, workflow: workflow.name, phases: result.results.length }, null, 2);
}

function parseRunOptions(args: string[]): { repo: string } {
  let repo = process.cwd();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--repo") {
      const value = args[++index];
      if (!value) throw new Error("Usage: wayward run <workflow> --repo <path>");
      repo = resolve(value);
      continue;
    }
    throw new Error(`Unknown run option ${arg}`);
  }
  return { repo };
}
