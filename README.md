# Wayward

Let agents wander. Keep the work under control.

Wayward is an open-source, CLI-first workflow runtime for coding agents. It gives agent work a durable control plane: isolated git worktrees, checkpointed rewind, structured workflow phases, evidence-linked reports, and local approval gates before risky actions.

The current implementation is source-first and local-first. It is built as a TypeScript monorepo, uses Codex as the first adapter, and exposes both a terminal CLI and a local stdio MCP server. There is no hosted dashboard yet, and built-in workflows do not automatically mutate external systems after an approval gate.

## Why Wayward Exists

Agentic coding is powerful when agents can explore, compare options, and inspect broad code surfaces. It also gets messy quickly if every experiment lands in the same working tree, every review is transient chat text, or every external action depends on a prompt remembering the safety rules.

Wayward focuses on a few control primitives:

- Worktrees isolate implementation attempts so candidates can be reviewed before anything is applied to the main checkout.
- Checkpoints make local progress rewindable and create safety points before destructive restore operations.
- Approval gates turn "ask before acting" into persisted run state that a CLI or MCP client can inspect and decide.
- Reports and artifacts keep raw evidence next to synthesized conclusions so later readers can audit the path.

## Quick Start

Requirements for local development:

- Git
- Node.js and `pnpm`
- Codex CLI for workflows that run Codex-backed reviewers or attempts
- GitHub CLI (`gh`) only for `open-pr-audit`

From a checkout of this repository:

```bash
corepack enable
pnpm install
pnpm build
pnpm test
pnpm --filter @thepraggyverse/cli wayward run ultrareview --repo .
```

Wayward writes durable run state under the target repository's `.wayward/runs/` directory. Tournament and branch workflows create worktrees under `.wayward/worktrees/`.

## Core Workflows

`ultrareview` runs a structured, multi-specialist repository review in inspect mode and writes raw reviewer artifacts plus a synthesized report.

```bash
pnpm --filter @thepraggyverse/cli wayward run ultrareview --repo .
```

`open-pr-audit` uses read-only `gh` commands to inspect open pull requests, persists raw and normalized evidence, writes a report, and pauses at a local approval gate.

```bash
pnpm --filter @thepraggyverse/cli wayward run open-pr-audit --repo .
pnpm --filter @thepraggyverse/cli wayward approvals list
```

`tournament` creates isolated worktree attempts, asks Codex-backed workers to solve the same task, validates the candidates, and writes a ranked report.

```bash
pnpm --filter @thepraggyverse/cli wayward run tournament --repo . --attempts 2 --prompt "Add focused tests for the parser"
pnpm --filter @thepraggyverse/cli wayward run show <run-id>
```

Checkpoint, rewind, and branch commands give a run explicit recovery points:

```bash
pnpm --filter @thepraggyverse/cli wayward checkpoints create <run-id> before-risky-change
pnpm --filter @thepraggyverse/cli wayward checkpoints list <run-id>
pnpm --filter @thepraggyverse/cli wayward rewind <run-id> <checkpoint-id>
pnpm --filter @thepraggyverse/cli wayward branch <run-id> --checkpoint <checkpoint-id> --name retry-from-checkpoint
```

Use the board and run detail views to inspect persisted state:

```bash
pnpm --filter @thepraggyverse/cli wayward board
pnpm --filter @thepraggyverse/cli wayward board --state needs_approval
pnpm --filter @thepraggyverse/cli wayward run show <run-id>
```

More examples are in [docs/examples.md](docs/examples.md).

## CLI Surface

The public command shape is:

```bash
wayward run <workflow> --repo <repo-path>
wayward board [--state <state>] [--workflow <name>] [--limit <count>]
wayward run show <run-id>
wayward approvals list
wayward approvals approve|reject <run-id> <approval-id>
wayward checkpoints create|list <run-id>
wayward rewind <run-id> <checkpoint-id>
wayward branch <run-id> [--checkpoint <checkpoint-id>] [--name <name>]
```

See [docs/cli.md](docs/cli.md) for the full reference.

## Codex Plugin And MCP

The Codex plugin descriptor lives at [plugins/codex/plugin.json](plugins/codex/plugin.json). It references thin local skills for:

- `ultrareview`
- `open-pr-audit`
- `tournament`
- `checkpoint-rewind-branch`
- `run-inspection`
- `security-review`, which currently routes to `ultrareview`

The plugin starts the local stdio MCP server with:

```bash
pnpm --filter @thepraggyverse/mcp-server start
```

MCP clients can call `createRun`, `listRuns`, `readRun`, `readReport`, `listPendingApprovals`, `decideApproval`, `listCheckpoints`, `createCheckpoint`, `rewind`, `branchFromCheckpoint`, and `requestApproval`.

MCP is local stdio only. It does not provide remote auth, a remote dashboard, hosted scheduling, network isolation, or process supervision. See [docs/mcp.md](docs/mcp.md) and [docs/codex-integration.md](docs/codex-integration.md).

## Safety Model

Wayward is designed around local, inspectable state:

- Runs, reports, artifacts, approvals, and checkpoints stay in `.wayward/runs/`.
- Worktree-writing workflows use `.wayward/worktrees/` instead of the primary checkout.
- Rewind creates a safety checkpoint for tracked changes and quarantines untracked files before restoring a checkpoint.
- Approval gates are persisted local records. Built-in workflows do not post comments, merge PRs, push branches, or perform other external mutations automatically.
- `open-pr-audit` reads from GitHub through `gh`; it does not mutate GitHub.
- `security-review` is a skill route to `ultrareview`, not a separate security workflow.

## Packages

- `@thepraggyverse/core`: run records, events, artifacts, approvals, and reports.
- `@thepraggyverse/git-worktrees`: isolated git worktree lifecycle helpers.
- `@thepraggyverse/checkpoints`: checkpoint creation and rewind helpers.
- `@thepraggyverse/codex-adapter`: Codex CLI adapter and capability detection.
- `@thepraggyverse/workflow-runtime`: phase graphs, fanout, gates, schema validation, and concurrency.
- `@thepraggyverse/cli`: `wayward` command entrypoint and terminal board.
- `@thepraggyverse/mcp-server`: local stdio MCP bridge.
- `@thepraggyverse/workflows`: built-in ultrareview, open PR audit, and tournament workflows.

The workspace is currently source-first. Package publication and stable third-party API guarantees are still settling.

## Documentation

- [Architecture](docs/architecture.md)
- [Workflow guide](docs/workflows.md)
- [CLI reference](docs/cli.md)
- [MCP tools](docs/mcp.md)
- [Codex plugin and skills](docs/codex-integration.md)
- [Checkpoint, rewind, and branch behavior](docs/checkpoints.md)
- [Run model](docs/run-model.md)
- [Workflow runtime](docs/workflow-runtime.md)
- [Codex adapter](docs/adapters/codex.md)
- [Examples](docs/examples.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Current Limitations

- Codex is the first supported adapter. Other agents are not first-class yet.
- MCP is local stdio only.
- There is no remote dashboard or hosted run service.
- Built-in workflows do not automatically execute post-approval external mutations.
- `security-review` is currently routed through `ultrareview`.
- `open-pr-audit` requires an authenticated `gh` CLI with repository read access.
- Workflows depend on local tool availability and may fail if Codex, `gh`, or Git are unavailable.

## Roadmap

Likely next areas:

- Stabilize the public package/API contracts.
- Add more adapter implementations beyond Codex.
- Expand validation and report quality for built-in workflows.
- Add an optional UI or dashboard over the persisted run store.
- Add explicit, auditable post-approval executors for external actions.
- Improve install and distribution paths once the monorepo package boundaries settle.

## Contributing

Wayward uses the MIT license. Contributions are welcome while the project is still early, but please keep changes narrow, evidence-linked, and aligned with the local-first safety model. Start with [CONTRIBUTING.md](CONTRIBUTING.md).
