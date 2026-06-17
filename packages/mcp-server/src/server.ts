import { readFile } from "node:fs/promises";
import { createId, FileRunStore, type PermissionMode, type RunState } from "@thepraggyverse/core";
import { CheckpointManager, RewindService } from "@thepraggyverse/checkpoints";
import { RealGitClient, RunBranchService, type GitClient } from "@thepraggyverse/git-worktrees";
import { WorkflowRuntime, type WorkflowDefinition } from "@thepraggyverse/workflow-runtime";
import { getWorkflow } from "@thepraggyverse/workflows";

type JsonSchema = Record<string, unknown>;
type ToolHandler = (input?: unknown) => Promise<unknown>;

export interface WaywardMcpToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export const WAYWARD_MCP_TOOL_DEFINITIONS = [
  {
    name: "createRun",
    description: "Create and execute a Wayward workflow run through the shared runtime.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["workflow"],
      properties: {
        workflow: { type: "string", description: "Built-in or injected workflow name, such as ultrareview, open-pr-audit, or tournament." },
        inputs: { type: "object", additionalProperties: true, description: "Workflow-specific input object. Most built-in workflows require repo." },
        mode: { type: "string", enum: ["inspect", "worktree-write", "autopilot"], description: "Run permission mode." },
        adapter: { type: "string", description: "Adapter label recorded on the run." }
      }
    }
  },
  {
    name: "listRuns",
    description: "List persisted Wayward runs, optionally filtered by state or workflow.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        workflow: { type: "string" },
        state: { type: "string", enum: ["created", "running", "needs_approval", "completed", "failed", "timed_out", "cancelled", "rewound", "interrupted"] },
        limit: { type: "integer", minimum: 1 }
      }
    }
  },
  {
    name: "readRun",
    description: "Read one Wayward run summary, optionally including its recent event log.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["runId"],
      properties: {
        runId: { type: "string" },
        includeEvents: { type: "boolean", default: false }
      }
    }
  },
  {
    name: "readReport",
    description: "Read a run report record and its Markdown content. Defaults to the latest report.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["runId"],
      properties: {
        runId: { type: "string" },
        reportId: { type: "string" }
      }
    }
  },
  {
    name: "listPendingApprovals",
    description: "List pending approval gates across all persisted runs.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: "decideApproval",
    description: "Approve or reject a pending local Wayward approval gate.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["runId", "approvalId", "decision"],
      properties: {
        runId: { type: "string" },
        approvalId: { type: "string" },
        decision: { type: "string", enum: ["approved", "rejected"] },
        actor: { type: "string" }
      }
    }
  },
  {
    name: "listCheckpoints",
    description: "List checkpoints recorded for a Wayward run.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["runId"],
      properties: {
        runId: { type: "string" }
      }
    }
  },
  {
    name: "createCheckpoint",
    description: "Create a git-backed Wayward checkpoint for a run.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["runId", "label"],
      properties: {
        runId: { type: "string" },
        label: { type: "string" },
        repoPath: { type: "string", description: "Repository path. Defaults to the MCP server working directory." },
        metadata: { type: "object", additionalProperties: true }
      }
    }
  },
  {
    name: "rewind",
    description: "Restore a run checkpoint through Wayward rewind safety handling.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["runId", "checkpointId"],
      properties: {
        runId: { type: "string" },
        checkpointId: { type: "string" },
        repoPath: { type: "string", description: "Repository path. Defaults to the MCP server working directory." }
      }
    }
  },
  {
    name: "branchFromCheckpoint",
    description: "Create and record an isolated worktree branch from a Wayward checkpoint.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["runId", "checkpointId"],
      properties: {
        runId: { type: "string" },
        checkpointId: { type: "string" },
        repoPath: { type: "string", description: "Repository path. Defaults to the MCP server working directory." },
        name: { type: "string", description: "Human-friendly branch suffix." }
      }
    }
  },
  {
    name: "requestApproval",
    description: "Create a pending local approval gate for integration tests or custom workflow bridges.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["runId", "requestedAction"],
      properties: {
        runId: { type: "string" },
        requestedAction: { type: "string" },
        evidence: { type: "array", items: { type: "string" } }
      }
    }
  }
] as const satisfies readonly WaywardMcpToolSpec[];

export type WaywardMcpToolName = typeof WAYWARD_MCP_TOOL_DEFINITIONS[number]["name"];
export type WaywardMcpTools = Record<WaywardMcpToolName, ToolHandler>;

export interface WaywardMcpDependencies {
  getWorkflow?: (name: string) => WorkflowDefinition;
  git?: GitClient;
  cwd?: string;
}

export class WaywardMcpUserError extends Error {
  constructor(message: string, readonly code = -32602) {
    super(message);
    this.name = "WaywardMcpUserError";
  }
}

export function getWaywardMcpToolDefinitions(): WaywardMcpToolSpec[] {
  return WAYWARD_MCP_TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }));
}

export function createWaywardMcpTools(store = new FileRunStore(), dependencies: WaywardMcpDependencies = {}): WaywardMcpTools {
  const resolveWorkflow = dependencies.getWorkflow ?? getWorkflow;
  const git = dependencies.git ?? new RealGitClient();
  const cwd = dependencies.cwd ?? process.env.INIT_CWD ?? process.cwd();

  return {
    async createRun(input) {
      const args = parseCreateRunInput(input);
      return new WorkflowRuntime(store).run(resolveWorkflow(args.workflow), args.inputs ?? {}, {
        adapter: args.adapter,
        mode: args.mode
      });
    },
    async listRuns(input) {
      const args = parseListRunsInput(input);
      const runs = (await store.listRuns())
        .filter((run) => !args.workflow || run.workflowName === args.workflow)
        .filter((run) => !args.state || run.state === args.state);
      return args.limit ? runs.slice(0, args.limit) : runs;
    },
    async readRun(input) {
      const args = parseReadRunInput(input);
      const run = await store.getRun(args.runId);
      if (!args.includeEvents) return { run };
      return { run, events: await store.readEvents(args.runId) };
    },
    async readReport(input) {
      const args = parseReadReportInput(input);
      const run = await store.getRun(args.runId);
      const report = args.reportId ? run.reports.find((candidate) => candidate.id === args.reportId) : run.reports.at(-1);
      if (!report) {
        const qualifier = args.reportId ? `report ${args.reportId}` : "a report";
        throw new WaywardMcpUserError(`Run ${args.runId} does not have ${qualifier}.`);
      }
      if (!store.containsRunPath(args.runId, report.path)) {
        throw new WaywardMcpUserError(`Run ${args.runId} report ${report.id} points outside its run directory.`);
      }
      return {
        runId: args.runId,
        report,
        markdown: await readFile(report.path, "utf8")
      };
    },
    async listPendingApprovals(input) {
      assertNoArguments(input, "listPendingApprovals");
      const runs = await store.listRuns();
      return runs.flatMap((run) =>
        run.approvals
          .filter((approval) => approval.state === "pending")
          .map((approval) => ({
            runId: run.id,
            workflow: run.workflowName,
            runState: run.state,
            approvalId: approval.id,
            requestedAction: approval.requestedAction,
            evidence: approval.evidence,
            updatedAt: run.updatedAt
          }))
      );
    },
    async decideApproval(input) {
      const args = parseDecideApprovalInput(input);
      const approval = await store.decideApproval(args.runId, args.approvalId, args.decision, args.actor ?? "mcp-user");
      const run = await store.getRun(args.runId);
      return { runId: args.runId, runState: run.state, approval };
    },
    async listCheckpoints(input) {
      const args = parseRunIdInput(input, "listCheckpoints");
      const run = await store.getRun(args.runId);
      return run.checkpoints;
    },
    async createCheckpoint(input) {
      const args = parseCreateCheckpointInput(input);
      return new CheckpointManager(git, store).createCheckpoint(args.repoPath ?? cwd, args.runId, args.label, args.metadata ?? { source: "mcp" });
    },
    async rewind(input) {
      const args = parseCheckpointActionInput(input, "rewind");
      const result = await new RewindService(git, store).rewind(args.repoPath ?? cwd, args.runId, args.checkpointId);
      return {
        runId: args.runId,
        checkpointId: args.checkpointId,
        state: "rewound",
        safetyCheckpointId: result.safetyCheckpoint?.id,
        quarantinedFiles: result.quarantinedFiles
      };
    },
    async branchFromCheckpoint(input) {
      const args = parseBranchFromCheckpointInput(input);
      return new RunBranchService(store, git).branch(args.repoPath ?? cwd, {
        runId: args.runId,
        checkpointId: args.checkpointId,
        name: args.name
      });
    },
    async requestApproval(input) {
      const args = parseRequestApprovalInput(input);
      const approval = {
        id: createId("approval"),
        requestedAction: args.requestedAction,
        evidence: args.evidence ?? [],
        state: "pending" as const
      };
      await store.addApproval(args.runId, approval);
      return approval;
    }
  };
}

export async function callWaywardMcpTool(tools: WaywardMcpTools, name: string, input?: unknown): Promise<unknown> {
  if (!isToolName(name)) throw new WaywardMcpUserError(`Unknown Wayward MCP tool ${name}.`, -32602);
  return tools[name](input);
}

export function toMcpError(error: unknown, fallbackCode = -32000): { code: number; message: string } {
  if (error instanceof WaywardMcpUserError) return { code: error.code, message: error.message };
  return { code: fallbackCode, message: sanitizeErrorMessage(error) };
}

function isToolName(value: string): value is WaywardMcpToolName {
  return WAYWARD_MCP_TOOL_DEFINITIONS.some((tool) => tool.name === value);
}

function parseCreateRunInput(input: unknown): { workflow: string; inputs?: Record<string, unknown>; mode?: PermissionMode; adapter?: string } {
  const record = asRecord(input, "createRun");
  return {
    workflow: requiredString(record, "workflow", "createRun"),
    inputs: optionalRecord(record, "inputs", "createRun"),
    mode: optionalPermissionMode(record, "mode", "createRun"),
    adapter: optionalString(record, "adapter", "createRun")
  };
}

function parseListRunsInput(input: unknown): { workflow?: string; state?: RunState; limit?: number } {
  const record = asOptionalRecord(input, "listRuns");
  return {
    workflow: optionalString(record, "workflow", "listRuns"),
    state: optionalRunState(record, "state", "listRuns"),
    limit: optionalPositiveInteger(record, "limit", "listRuns")
  };
}

function parseReadRunInput(input: unknown): { runId: string; includeEvents: boolean } {
  const record = asRecord(input, "readRun");
  return {
    runId: requiredString(record, "runId", "readRun"),
    includeEvents: optionalBoolean(record, "includeEvents", "readRun") ?? false
  };
}

function parseReadReportInput(input: unknown): { runId: string; reportId?: string } {
  const record = asRecord(input, "readReport");
  return {
    runId: requiredString(record, "runId", "readReport"),
    reportId: optionalString(record, "reportId", "readReport")
  };
}

function parseDecideApprovalInput(input: unknown): { runId: string; approvalId: string; decision: "approved" | "rejected"; actor?: string } {
  const record = asRecord(input, "decideApproval");
  const decision = requiredString(record, "decision", "decideApproval");
  if (decision !== "approved" && decision !== "rejected") {
    throw new WaywardMcpUserError("decideApproval.decision must be approved or rejected.");
  }
  return {
    runId: requiredString(record, "runId", "decideApproval"),
    approvalId: requiredString(record, "approvalId", "decideApproval"),
    decision,
    actor: optionalString(record, "actor", "decideApproval")
  };
}

function parseRunIdInput(input: unknown, toolName: string): { runId: string } {
  const record = asRecord(input, toolName);
  return { runId: requiredString(record, "runId", toolName) };
}

function parseCreateCheckpointInput(input: unknown): { runId: string; label: string; repoPath?: string; metadata?: Record<string, unknown> } {
  const record = asRecord(input, "createCheckpoint");
  return {
    runId: requiredString(record, "runId", "createCheckpoint"),
    label: requiredString(record, "label", "createCheckpoint"),
    repoPath: optionalString(record, "repoPath", "createCheckpoint"),
    metadata: optionalRecord(record, "metadata", "createCheckpoint")
  };
}

function parseCheckpointActionInput(input: unknown, toolName: string): { runId: string; checkpointId: string; repoPath?: string } {
  const record = asRecord(input, toolName);
  return {
    runId: requiredString(record, "runId", toolName),
    checkpointId: requiredString(record, "checkpointId", toolName),
    repoPath: optionalString(record, "repoPath", toolName)
  };
}

function parseBranchFromCheckpointInput(input: unknown): { runId: string; checkpointId: string; repoPath?: string; name?: string } {
  const record = asRecord(input, "branchFromCheckpoint");
  return {
    runId: requiredString(record, "runId", "branchFromCheckpoint"),
    checkpointId: requiredString(record, "checkpointId", "branchFromCheckpoint"),
    repoPath: optionalString(record, "repoPath", "branchFromCheckpoint"),
    name: optionalString(record, "name", "branchFromCheckpoint")
  };
}

function parseRequestApprovalInput(input: unknown): { runId: string; requestedAction: string; evidence?: string[] } {
  const record = asRecord(input, "requestApproval");
  return {
    runId: requiredString(record, "runId", "requestApproval"),
    requestedAction: requiredString(record, "requestedAction", "requestApproval"),
    evidence: optionalStringArray(record, "evidence", "requestApproval")
  };
}

function assertNoArguments(input: unknown, toolName: string): void {
  const record = asOptionalRecord(input, toolName);
  if (Object.keys(record).length) throw new WaywardMcpUserError(`${toolName} does not accept arguments.`);
}

function asRecord(input: unknown, toolName: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new WaywardMcpUserError(`${toolName} arguments must be an object.`);
  return input as Record<string, unknown>;
}

function asOptionalRecord(input: unknown, toolName: string): Record<string, unknown> {
  if (input === undefined) return {};
  return asRecord(input, toolName);
}

function requiredString(record: Record<string, unknown>, field: string, toolName: string): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) throw new WaywardMcpUserError(`${toolName}.${field} must be a non-empty string.`);
  return value;
}

function optionalString(record: Record<string, unknown>, field: string, toolName: string): string | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new WaywardMcpUserError(`${toolName}.${field} must be a non-empty string when provided.`);
  return value;
}

function optionalBoolean(record: Record<string, unknown>, field: string, toolName: string): boolean | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new WaywardMcpUserError(`${toolName}.${field} must be a boolean when provided.`);
  return value;
}

function optionalRecord(record: Record<string, unknown>, field: string, toolName: string): Record<string, unknown> | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WaywardMcpUserError(`${toolName}.${field} must be an object when provided.`);
  return value as Record<string, unknown>;
}

function optionalStringArray(record: Record<string, unknown>, field: string, toolName: string): string[] | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new WaywardMcpUserError(`${toolName}.${field} must be an array of strings when provided.`);
  }
  return value;
}

function optionalPositiveInteger(record: Record<string, unknown>, field: string, toolName: string): number | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 1) throw new WaywardMcpUserError(`${toolName}.${field} must be a positive integer when provided.`);
  return Number(value);
}

function optionalPermissionMode(record: Record<string, unknown>, field: string, toolName: string): PermissionMode | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (value === "inspect" || value === "worktree-write" || value === "autopilot") return value;
  throw new WaywardMcpUserError(`${toolName}.${field} must be inspect, worktree-write, or autopilot when provided.`);
}

function optionalRunState(record: Record<string, unknown>, field: string, toolName: string): RunState | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (value === "created" || value === "running" || value === "needs_approval" || value === "completed" || value === "failed" || value === "timed_out" || value === "cancelled" || value === "rewound" || value === "interrupted") return value;
  throw new WaywardMcpUserError(`${toolName}.${field} must be a known Wayward run state when provided.`);
}

function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("at "))
    .join("\n")
    .trim() || "Wayward MCP tool failed.";
}
