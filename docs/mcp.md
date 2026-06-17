# MCP Tools

Wayward exposes a local stdio MCP server in `@thepraggyverse/mcp-server`. The server delegates to the same runtime, run store, checkpoint, approval, and worktree services used by the CLI.

Start it from this monorepo with:

```sh
pnpm --filter @thepraggyverse/mcp-server start
```

The Codex plugin descriptor at `plugins/codex/plugin.json` uses that command for its `wayward` MCP server.

## Scope

The MCP server is local stdio only.

It does not provide:

- Remote transport.
- Remote authentication.
- A hosted dashboard.
- Network isolation.
- Process supervision.
- Automatic post-approval external mutations.

MCP clients should treat Wayward as a local control plane for the repository they are operating in.

## Tool List

### `createRun`

Creates and executes a Wayward workflow run through `WorkflowRuntime`.

Required input:

- `workflow`: built-in workflow name, such as `ultrareview`, `open-pr-audit`, or `tournament`.

Optional input:

- `inputs`: workflow-specific input object. Built-in workflows usually need `repo`.
- `mode`: `inspect`, `worktree-write`, or `autopilot`.
- `adapter`: adapter label recorded on the run.

Example arguments:

```json
{
  "workflow": "ultrareview",
  "inputs": {
    "repo": "/path/to/repo"
  },
  "mode": "inspect"
}
```

### `listRuns`

Lists persisted runs.

Optional input:

- `workflow`: filter by workflow name.
- `state`: `created`, `running`, `needs_approval`, `completed`, `failed`, `timed_out`, `cancelled`, or `rewound`.
- `limit`: positive integer.

### `readRun`

Reads one run summary.

Required input:

- `runId`

Optional input:

- `includeEvents`: include recent event log entries.

### `readReport`

Reads a run report record and its Markdown content.

Required input:

- `runId`

Optional input:

- `reportId`: if omitted, reads the latest report.

### `listPendingApprovals`

Lists pending approval gates across persisted runs. Takes no arguments.

### `decideApproval`

Approves or rejects a local pending gate.

Required input:

- `runId`
- `approvalId`
- `decision`: `approved` or `rejected`

Optional input:

- `actor`: decision actor label.

The decision changes local Wayward run state. Built-in workflows currently do not automatically mutate GitHub or other external systems after approval.

### `listCheckpoints`

Lists checkpoints recorded for a run.

Required input:

- `runId`

### `createCheckpoint`

Creates a git-backed Wayward checkpoint for a run.

Required input:

- `runId`
- `label`

Optional input:

- `repoPath`: defaults to the MCP server working directory.
- `metadata`: arbitrary JSON metadata.

### `rewind`

Restores a run checkpoint through Wayward rewind safety handling.

Required input:

- `runId`
- `checkpointId`

Optional input:

- `repoPath`: defaults to the MCP server working directory.

The result includes the run id, checkpoint id, `rewound` state, safety checkpoint id when created, and quarantined file paths.

### `branchFromCheckpoint`

Creates and records an isolated worktree branch from a Wayward checkpoint.

Required input:

- `runId`
- `checkpointId`

Optional input:

- `repoPath`: defaults to the MCP server working directory.
- `name`: human-friendly branch suffix.

### `requestApproval`

Creates a pending local approval gate for integration tests or custom workflow bridges.

Required input:

- `runId`
- `requestedAction`

Optional input:

- `evidence`: artifact or report ids.

Built-in workflows create their own gates where needed. Most users should inspect existing gates with `listPendingApprovals` rather than manually creating them.

## JSON-RPC Shape

MCP clients call tools through `tools/call`. A raw JSON-RPC message looks like:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "listRuns",
    "arguments": {
      "limit": 5
    }
  }
}
```

The server returns tool output as JSON-formatted text content.

## Client Guidance

- Prefer `readRun` and `readReport` over scraping `.wayward/runs/`.
- Use checkpoint tools instead of constructing git refs or reset commands.
- Use approval tools for gate decisions, and do not mutate external systems from client prompts before a local approval decision is recorded.
- Keep skill/plugin prose thin; workflow behavior belongs in packages.
