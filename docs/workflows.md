# Built-In Workflows

Built-in workflows are started with:

```sh
wayward run <workflow> --repo <repo-path>
```

MCP clients should call `createRun` with the same workflow name and an `inputs` object. Use `listRuns`, `readRun`, and `readReport` for persisted inspection instead of re-deriving workflow state from raw files.

## `ultrareview`

`ultrareview` is an inspect-mode repository review. It fans out to multiple reviewer roles, keeps raw reviewer output, normalizes reviewer summaries, and writes an evidence-linked Markdown report.

```sh
pnpm --filter @thepraggyverse/cli wayward run ultrareview --repo .
pnpm --filter @thepraggyverse/cli wayward run show <run-id>
```

Use this when you want broad review coverage, regression risk discovery, maintainability notes, test-risk notes, or a security-informed pass without source edits.

Current boundaries:

- Requires a local Codex surface that the adapter can call.
- Runs in inspect mode.
- Writes local artifacts and reports under `.wayward/runs/<run-id>/`.
- Does not edit files, create branches, commit, push, or call external mutation APIs.

## `open-pr-audit`

`open-pr-audit` inspects open GitHub pull requests with read-only `gh` commands. It collects list, view, and diff evidence, normalizes PR risk signals, writes a report, and pauses at the `external-action-gate` approval.

```sh
pnpm --filter @thepraggyverse/cli wayward run open-pr-audit --repo .
pnpm --filter @thepraggyverse/cli wayward approvals list
pnpm --filter @thepraggyverse/cli wayward run show <run-id>
```

Use this when you want merge-readiness, stale-PR, overlapping-file, draft-status, review-status, or check-status visibility across a repository.

Current boundaries:

- Requires an authenticated `gh` CLI with repository read access.
- Uses read-only GitHub commands.
- Lists up to the first 100 open PRs and emits a report warning when that limit is reached, because more open PRs may exist beyond the audit window.
- Writes raw and normalized PR audit artifacts under `.wayward/runs/<run-id>/`.
- Does not post comments, close PRs, merge, push, or mutate GitHub automatically.
- Records the approval decision locally. There is not yet an automatic post-approval external action executor.

## `tournament`

`tournament` creates multiple isolated implementation attempts in Wayward-managed git worktrees, asks workers to attempt the same task, validates the candidates, and writes a ranked report.

```sh
pnpm --filter @thepraggyverse/cli wayward run tournament --repo . --attempts 2 --prompt "Make the requested change"
pnpm --filter @thepraggyverse/cli wayward board --workflow tournament
pnpm --filter @thepraggyverse/cli wayward run show <run-id>
```

Use this when you want independent candidate implementations before choosing a path. Review the resulting report and worktree paths before copying, cherry-picking, or merging any candidate work.

Current boundaries:

- Uses `worktree-write` mode by default.
- Creates worktrees under `.wayward/worktrees/<run-id>/`.
- Records candidate worktree paths and ranking evidence in the run.
- Does not apply the winner to the primary checkout automatically.

## Approvals

Approval gates are local persisted records. Use the CLI or MCP to inspect and decide them:

```sh
wayward approvals list
wayward approvals approve <run-id> <approval-id>
wayward approvals reject <run-id> <approval-id>
```

The MCP equivalents are `listPendingApprovals` and `decideApproval`.

Approvals are deliberately separate from external side effects. A recorded decision changes Wayward run state; built-in workflows currently do not use that decision to automatically mutate GitHub or another external system.

## Inspection

The run store is the source of truth:

```sh
wayward board
wayward board --state needs_approval
wayward board --workflow ultrareview
wayward run show <run-id>
```

Use these views instead of scraping raw artifact directories. Raw files are preserved for auditability, but the run summary records which artifacts, reports, approvals, checkpoints, and worktrees belong together.
