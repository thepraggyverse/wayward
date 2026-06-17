# Codex Integration

Wayward exposes Codex-facing skills and MCP tools as thin entrypoints over the same CLI/runtime services. Skills should tell Codex when to use Wayward and which command or MCP tool to call; workflow fanout, evidence collection, gates, checkpoints, rewinds, branches, and reports belong in packages.

## Install And Use

From this repository:

```sh
pnpm install
pnpm build
pnpm --filter @thepraggyverse/cli wayward run ultrareview --repo .
```

The Codex plugin descriptor is `plugins/codex/plugin.json`. It references the local skills under `skills/` and starts the local stdio MCP server with:

```sh
pnpm --filter @thepraggyverse/mcp-server start
```

Use the plugin descriptor from a Codex plugin manager, or run the MCP server directly as a stdio server. The server advertises explicit JSON schemas through `tools/list`.

## Plugin Metadata

`plugins/codex/plugin.json` currently declares:

- Plugin name: `wayward`
- Plugin description: Codex skills and MCP tools for local Wayward workflow runs.
- Skills: `ultrareview`, `security-review`, `open-pr-audit`, `tournament`, `checkpoint-rewind-branch`, and `run-inspection`.
- MCP server: `wayward`, launched by `pnpm --filter @thepraggyverse/mcp-server start`.

The descriptor is intentionally small. It should route hosts to Wayward, not duplicate workflow implementation details.

## Skills

- `ultrareview`: broad multi-specialist repository review.
- `open-pr-audit`: read-only GitHub PR audit with a local approval gate before external action.
- `tournament`: isolated worktree attempts and ranked candidate report.
- `checkpoint-rewind-branch`: checkpoint creation, rewind, and branching from a checkpoint.
- `run-inspection`: board, run detail, report, approval, artifact, checkpoint, and worktree inspection.
- `security-review`: security-focused route to the built-in `ultrareview` workflow. There is not yet a standalone `security-review` workflow.

Skills must not duplicate workflow logic. Prefer these surfaces:

```sh
wayward run <workflow> --repo <repo-path>
wayward board
wayward run show <run-id>
wayward approvals list
wayward checkpoints list <run-id>
```

MCP clients should prefer:

- `createRun`
- `listRuns`
- `readRun`
- `readReport`
- `listPendingApprovals`
- `decideApproval`
- `listCheckpoints`
- `createCheckpoint`
- `rewind`
- `branchFromCheckpoint`

See [MCP tools](mcp.md) for schemas and tool-specific guidance.

## Approval Gates

Built-in gate behavior is local and explicit. `open-pr-audit` runs read-only `gh` commands, writes raw and normalized evidence, writes a report, then pauses at `external-action-gate`.

Agents should inspect `readReport` or `wayward run show <run-id>`, list gates with `listPendingApprovals` or `wayward approvals list`, and record decisions with `decideApproval` or `wayward approvals approve|reject`.

Do not post comments, merge, close, push, or otherwise mutate external systems from skills before a Wayward approval decision is recorded. Built-in workflows currently persist the gate and decision locally; they do not automatically perform a post-approval external mutation.

## Local Safety Boundaries

Wayward persists local state under `.wayward/runs/`. Tournament and branch workflows create local git worktrees under `.wayward/worktrees/`. Rewind may quarantine untracked files under `.wayward/rewind-quarantine/`.

Inspect-mode workflows may write Wayward control-plane artifacts and reports, but should not edit repository source files. Worktree-write workflows should write only in Wayward-created worktrees. External services are treated as read-only unless a workflow reaches a gate and the user records approval.

## Current Limitations

- Codex is the first adapter; other adapters are not first-class yet.
- `security-review` is a skill route to `ultrareview`, not a standalone workflow.
- `open-pr-audit` requires an authenticated `gh` CLI with repository read access.
- MCP is a local stdio bridge and does not provide remote auth, remote dashboards, network isolation, or process supervision.
- Built-in gated workflows currently persist the gate and decision locally; they do not automatically perform a post-approval external mutation.
