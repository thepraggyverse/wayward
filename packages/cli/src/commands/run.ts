import { FileRunStore } from "@thepraggyverse/core";
import type { PermissionMode } from "@thepraggyverse/core";
import { WorkflowRuntime } from "@thepraggyverse/workflow-runtime";
import { getWorkflow } from "@thepraggyverse/workflows";
import { resolve } from "node:path";

export async function runCommand(args: string[], store = new FileRunStore()): Promise<string> {
  const workflowName = args[0] ?? "ultrareview";
  const options = parseRunOptions(args.slice(1));
  const workflow = getWorkflow(workflowName);
  const runtime = new WorkflowRuntime(store);
  const input = {
    repo: options.repo,
    ...(options.attempts === undefined ? {} : { attempts: options.attempts }),
    ...(options.baseRef === undefined ? {} : { baseRef: options.baseRef }),
    ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
    ...(options.mode === undefined ? {} : { mode: options.mode })
  };
  const mode = options.mode ?? (workflowName === "tournament" ? "worktree-write" : undefined);
  const result = await runtime.run(workflow, input, { mode });
  return JSON.stringify({ runId: result.runId, workflow: workflow.name, phases: result.results.length }, null, 2);
}

function parseRunOptions(args: string[]): { repo: string; attempts?: number; baseRef?: string; prompt?: string; mode?: PermissionMode } {
  let repo = process.cwd();
  let attempts: number | undefined;
  let baseRef: string | undefined;
  let prompt: string | undefined;
  let mode: PermissionMode | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--repo") {
      const value = args[++index];
      if (!value) throw new Error("Usage: wayward run <workflow> --repo <path>");
      repo = resolve(value);
      continue;
    }
    if (arg === "--attempts" || arg === "--attempt-count") {
      const value = args[++index];
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error("Usage: wayward tournament --attempts <positive-integer>");
      attempts = parsed;
      continue;
    }
    if (arg === "--base-ref" || arg === "--base" || arg === "--base-branch") {
      const value = args[++index];
      if (!value) throw new Error("Usage: wayward tournament --base-ref <ref>");
      baseRef = value;
      continue;
    }
    if (arg === "--prompt" || arg === "--task") {
      const value = args[++index];
      if (!value) throw new Error("Usage: wayward tournament --prompt <task>");
      prompt = value;
      continue;
    }
    if (arg === "--mode") {
      const value = args[++index];
      if (value !== "inspect" && value !== "worktree-write" && value !== "autopilot") throw new Error("Usage: wayward run <workflow> --mode inspect|worktree-write|autopilot");
      mode = value;
      continue;
    }
    throw new Error(`Unknown run option ${arg}`);
  }
  return { repo, attempts, baseRef, prompt, mode };
}
