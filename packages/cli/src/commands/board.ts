import { FileRunStore } from "@thepraggyverse/core";
import type { RunState } from "@thepraggyverse/core";
import { latestFailureSummary, renderBoard } from "./run-rendering.js";

const RUN_STATES: RunState[] = ["created", "running", "needs_approval", "completed", "failed", "timed_out", "cancelled", "rewound"];

export async function boardCommand(args: string[] = [], store = new FileRunStore()): Promise<string> {
  const options = parseBoardOptions(args);
  const runs = (await store.listRuns())
    .filter((run) => !options.state || run.state === options.state)
    .filter((run) => !options.workflow || run.workflowName === options.workflow)
    .slice(0, options.limit);

  if (runs.length === 0 && !options.state && !options.workflow) return "No Wayward runs found.";
  const boardRuns = await Promise.all(runs.map(async (run) => {
    const events = await store.readEvents(run.id).catch(() => []);
    return { run, latestFailure: latestFailureSummary(run, events) };
  }));
  return renderBoard(boardRuns, options);
}

function parseBoardOptions(args: string[]): { state?: RunState; workflow?: string; limit?: number } {
  const options: { state?: RunState; workflow?: string; limit?: number } = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--state") {
      const value = args[++index];
      if (!isRunState(value)) throw new Error(`Usage: wayward board --state ${RUN_STATES.join("|")}`);
      options.state = value;
      continue;
    }
    if (arg === "--workflow") {
      const value = args[++index];
      if (!value) throw new Error("Usage: wayward board --workflow <name>");
      options.workflow = value;
      continue;
    }
    if (arg === "--limit") {
      const value = args[++index];
      const limit = Number(value);
      if (!Number.isInteger(limit) || limit < 1) throw new Error("Usage: wayward board --limit <positive-integer>");
      options.limit = limit;
      continue;
    }
    throw new Error(`Unknown board option ${arg}`);
  }
  return options;
}

function isRunState(value: string | undefined): value is RunState {
  return RUN_STATES.includes(value as RunState);
}
