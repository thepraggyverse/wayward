import { join } from "node:path";
import { FileRunStore } from "@thepraggyverse/core";
import type { PermissionMode } from "@thepraggyverse/core";
import { WorkflowRuntime } from "@thepraggyverse/workflow-runtime";
import type { WorkflowDefinition } from "@thepraggyverse/workflow-runtime";
import { getWorkflow } from "@thepraggyverse/workflows";
import { invocationCwd, resolveFromInvocationCwd } from "./paths.js";
import { renderRunDetail } from "./run-rendering.js";

interface RunOptions {
  repo: string;
  attempts?: number;
  baseRef?: string;
  prompt?: string;
  mode?: PermissionMode;
  timeoutMs?: number;
}

interface RunCommandDependencies {
  getWorkflow?: (name: string) => WorkflowDefinition;
}

export async function runCommand(args: string[], store?: FileRunStore, dependencies: RunCommandDependencies = {}): Promise<string> {
  if (args[0] === "show") return runShowCommand(args.slice(1), store ?? new FileRunStore());
  const workflowName = args[0] ?? "ultrareview";
  const options = parseRunOptions(args.slice(1));
  const workflow = (dependencies.getWorkflow ?? getWorkflow)(workflowName);
  const runtime = new WorkflowRuntime(store ?? new FileRunStore(runStoreRootForRepo(options.repo)));
  const input = {
    repo: options.repo,
    ...(options.attempts === undefined ? {} : { attempts: options.attempts }),
    ...(options.baseRef === undefined ? {} : { baseRef: options.baseRef }),
    ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
  };
  const mode = options.mode ?? workflow.defaultMode;
  const result = await runtime.run(workflow, input, { mode });
  return JSON.stringify({ runId: result.runId, workflow: workflow.name, phases: result.results.length }, null, 2);
}

export async function runShowCommand(args: string[], store = new FileRunStore()): Promise<string> {
  const [runId, ...extra] = args;
  if (!runId || extra.length) throw new Error("Usage: wayward run show <run-id>");
  const run = await store.getRun(runId);
  const events = await store.readEvents(runId);
  return renderRunDetail(run, events);
}

export function runStoreRootForRepo(repo: string): string {
  return process.env.WAYWARD_RUNS_DIR ?? join(repo, ".wayward", "runs");
}

function parseRunOptions(args: string[]): RunOptions {
  let repo = invocationCwd();
  let attempts: number | undefined;
  let baseRef: string | undefined;
  let prompt: string | undefined;
  let mode: PermissionMode | undefined;
  let timeoutMs: number | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--repo") {
      const value = args[++index];
      if (!value) throw new Error("Usage: wayward run <workflow> --repo <path>");
      repo = resolveFromInvocationCwd(value);
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
    if (arg === "--timeout-ms") {
      const value = args[++index];
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error("Usage: wayward run <workflow> --timeout-ms <positive-integer>");
      timeoutMs = parsed;
      continue;
    }
    throw new Error(`Unknown run option ${arg}`);
  }
  return { repo, attempts, baseRef, prompt, mode, timeoutMs };
}
