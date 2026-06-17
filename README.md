# Let agents wander. Keep the work under control.

Wayward is an open-source workflow runtime for coding agents: a CLI-first control plane for worktree-isolated runs, checkpointed rewind, structured reviews, schema-validated workflow phases, and human approval gates.

The runtime is adapter-driven. Codex is the first supported adapter, but workflows are defined against portable runtime primitives rather than Codex-only glue.

## Packages

- `@thepraggyverse/core`: run records, events, artifacts, approvals, and reports.
- `@thepraggyverse/git-worktrees`: isolated git worktree lifecycle helpers.
- `@thepraggyverse/checkpoints`: checkpoint creation and rewind helpers.
- `@thepraggyverse/codex-adapter`: Codex CLI adapter and capability detection.
- `@thepraggyverse/workflow-runtime`: phase graphs, fanout, gates, schema validation, and concurrency.
- `@thepraggyverse/cli`: `wayward` command entrypoint and terminal board.
- `@thepraggyverse/mcp-server`: host-callable control bridge.
- `@thepraggyverse/workflows`: built-in ultrareview, open PR audit, and tournament workflows.

## Quick Start

```bash
pnpm install
pnpm test
pnpm --filter @thepraggyverse/cli wayward run ultrareview --repo .
```

Wayward writes durable run state under `.wayward/runs/` and worktrees under `.wayward/worktrees/`.

## Codex Plugin And MCP

The Codex plugin descriptor lives at `plugins/codex/plugin.json`. It exposes thin skills for:

- `ultrareview`
- `open-pr-audit`
- `tournament`
- `checkpoint-rewind-branch`
- `run-inspection`
- `security-review` as a security-focused route to `ultrareview`

The plugin starts the local MCP server with:

```bash
pnpm --filter @thepraggyverse/mcp-server start
```

MCP clients can call `createRun`, `listRuns`, `readRun`, `readReport`, `listPendingApprovals`, `decideApproval`, `listCheckpoints`, `createCheckpoint`, `rewind`, and `branchFromCheckpoint`.

Wayward is local-first: run records, reports, artifacts, checkpoints, and worktrees stay under the local repository's `.wayward/` directory. Built-in workflows do not perform external mutations without a recorded approval gate decision. See `docs/codex-integration.md` for the full install and safety notes.

## Contributing

This repository is intentionally monorepo-first while public contracts settle. Keep package boundaries narrow, keep workflow outputs structured, and preserve raw worker artifacts whenever a synthesized report depends on them.
