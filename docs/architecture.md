# Architecture

Wayward coordinates coding agents through a runtime, not through one-off shell choreography. The same local services back the CLI, the terminal board, and the MCP tools.

## Main Components

- CLI: `packages/cli` exposes `wayward run`, `wayward board`, `wayward run show`, approval commands, checkpoint commands, rewind, and branch.
- Workflow runtime: `packages/workflow-runtime` executes typed phase graphs, validates phase inputs and outputs, records jobs, and handles approval gates.
- Core run store: `packages/core` persists runs, events, artifacts, reports, approvals, checkpoints, and worktree records under `.wayward/runs/`.
- Worktree services: `packages/git-worktrees` create isolated git worktrees for tournament attempts and checkpoint branches.
- Checkpoint services: `packages/checkpoints` create git-backed checkpoints and restore them with rewind safety handling.
- Adapter packages: `packages/codex-adapter` is the first adapter. It wraps stable local Codex CLI behavior and advertises optional capabilities separately.
- Built-in workflows: `workflows` contains `ultrareview`, `open-pr-audit`, and `tournament`.
- MCP server: `packages/mcp-server` exposes local stdio tools over the same runtime, checkpoint, approval, and worktree services.
- Codex plugin: `plugins/codex/plugin.json` points Codex-compatible hosts at local skills and the MCP stdio server.

## Data Flow

1. A user or MCP client starts a workflow with `wayward run <workflow>` or `createRun`.
2. The workflow runtime creates a run record and executes phase definitions in order.
3. Phases may fan out to adapter-backed workers, write artifacts, reduce evidence, synthesize reports, create checkpoints, or request approval gates.
4. Every durable fact is written to the local run store.
5. `wayward board`, `wayward run show`, `readRun`, and `readReport` inspect the persisted store instead of relying on live process memory.

This lets completed, failed, cancelled, interrupted, approval-blocked, and rewound runs remain inspectable after the original worker process exits.

## Local State Layout

Wayward writes into the target repository:

```text
.wayward/
  runs/
    <run-id>/
      summary.json
      events.jsonl
      artifacts/
      reports/
  worktrees/
    <run-id>/
  rewind-quarantine/
```

The exact artifact filenames are workflow-owned, but the run summary links reports, artifacts, approvals, checkpoints, and worktrees so readers do not need to scrape directory names.

## Package Boundaries

Runtime behavior should live in packages, not in skill prose or plugin metadata.

- Skills explain when to call Wayward and which CLI or MCP surface to use.
- MCP tools validate input and delegate to shared services.
- Built-in workflows own workflow-specific prompts, reducers, reports, and gate placement.
- Checkpoint, rewind, and branch safety behavior belongs in the checkpoint and worktree packages.

This keeps the public integration surface thin and helps contributors avoid parallel implementations of the same safety logic.

## Adapters

Codex is currently the first supported adapter. The adapter layer is intentionally narrow: workflows ask for worker behavior through runtime primitives, and adapter capabilities describe which local Codex surfaces are available.

Future adapters should preserve the same run-store contract: write raw artifacts, normalize evidence, and let the runtime persist jobs, reports, approvals, and failures.

## MCP Boundary

The MCP server is a local stdio bridge, not a remote service and not a separate workflow engine. `createRun` delegates to `WorkflowRuntime`; approval tools delegate to `FileRunStore`; checkpoint tools delegate to `CheckpointManager` and `RewindService`; branch tools delegate to `RunBranchService`.

Tool schemas are explicit at the MCP boundary so clients can discover stable inputs without copying Wayward workflow logic into prompts or plugin descriptors.

## Current Non-Goals

- No remote dashboard or hosted run service yet.
- No automatic post-approval external mutation executor yet.
- No remote MCP transport, auth layer, or process supervisor yet.
- No standalone `security-review` workflow yet. The Codex skill routes security review requests through `ultrareview`.
