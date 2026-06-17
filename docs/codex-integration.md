# Codex Integration

Wayward exposes Codex-facing skills and MCP tools as thin entrypoints over the same CLI/runtime services. Skills should tell Codex when to use Wayward and which command or MCP tool to call; workflow fanout, evidence collection, gates, checkpoints, rewinds, branches, and reports belong in packages.

## Install And Use

From this repository:

```sh
pnpm install
pnpm build
pnpm --filter @thepraggyverse/cli wayward run ultrareview --repo .
```

The Codex plugin descriptor is `plugins/codex/plugin.json`. It references the local skills under `skills/` and starts the MCP server with:

```sh
pnpm --filter @thepraggyverse/mcp-server start
```

Use the plugin descriptor from a Codex plugin manager, or run the MCP server directly as a stdio server. The server advertises explicit JSON schemas through `tools/list`.

## Skills

- `ultrareview`: broad multi-specialist repository review.
- `open-pr-audit`: read-only GitHub PR audit with a local approval gate before external action.
- `tournament`: isolated worktree attempts and ranked candidate report.
- `checkpoint-rewind-branch`: checkpoint creation, rewind, and branching from a checkpoint.
- `run-inspection`: board, run detail, report, approval, artifact, checkpoint, and worktree inspection.
- `security-review`: security-focused use of the built-in `ultrareview` workflow.

Skills must not duplicate workflow logic. Prefer these surfaces:

```sh
wayward run <workflow> --repo <repo-path>
wayward board
wayward run show <run-id>
wayward approvals list
wayward checkpoints list <run-id>
```

## MCP Tools

The MCP package is `@thepraggyverse/mcp-server`. It hardens the current runtime package boundary rather than introducing a separate implementation.

Available tools:

- `createRun`: execute a workflow through `WorkflowRuntime`.
- `listRuns`: list persisted runs with optional `workflow`, `state`, and `limit` filters.
- `readRun`: read one run summary, optionally with events.
- `readReport`: read the latest or selected report plus Markdown content.
- `listPendingApprovals`: list pending gates across runs.
- `decideApproval`: approve or reject a local gate.
- `listCheckpoints`: list run checkpoints.
- `createCheckpoint`: create a git-backed checkpoint through `CheckpointManager`.
- `rewind`: restore a checkpoint through `RewindService`.
- `branchFromCheckpoint`: create an isolated worktree through `RunBranchService`.
- `requestApproval`: create a local pending gate for tests or custom workflow bridges.

## Approval Gates

Built-in gate behavior is local and explicit. `open-pr-audit` runs read-only `gh` commands, writes raw and normalized evidence, writes a report, then pauses at `external-action-gate`. Agents should inspect `readReport` or `wayward run show <run-id>`, list gates with `listPendingApprovals` or `wayward approvals list`, and record decisions with `decideApproval` or `wayward approvals approve|reject`.

Do not post comments, merge, close, push, or otherwise mutate external systems from skills before a Wayward approval decision is recorded.

## Local Safety Boundaries

Wayward persists local state under `.wayward/runs/`. Tournament and branch workflows create local git worktrees under `.wayward/worktrees/`. Rewind may quarantine untracked files under `.wayward/rewind-quarantine/`.

Inspect-mode workflows may write Wayward control-plane artifacts and reports, but should not edit repository source files. Worktree-write workflows should write only in Wayward-created worktrees. External services are treated as read-only unless a workflow reaches a gate and the user records approval.

## Current Limitations

- Codex is the first adapter; other adapters are not first-class yet.
- `security-review` is a skill route to `ultrareview`, not a standalone workflow.
- `open-pr-audit` requires an authenticated `gh` CLI with repository read access.
- MCP is a local stdio bridge and does not provide remote auth, network isolation, or process supervision.
- Built-in gated workflows currently persist the gate and decision locally; they do not automatically perform a post-approval external mutation.
