# Examples

These examples use the source-first monorepo command form:

```sh
pnpm --filter @thepraggyverse/cli wayward <command>
```

If you are running Wayward from outside this repository, use `pnpm --dir /path/to/wayward --filter @thepraggyverse/cli wayward <command>` or a locally linked `wayward` binary.

## Safe Local Demo Repository

This creates a throwaway git repository and runs Wayward against it. `ultrareview` requires a local Codex surface, but it does not edit files or mutate external services.

```sh
WAYWARD=/path/to/wayward
DEMO_REPO="$(mktemp -d)"
cd "$DEMO_REPO"

git init
printf '# Demo repo\n\nA tiny repository for Wayward docs examples.\n' > README.md
git add README.md
git -c user.name=Wayward -c user.email=wayward@example.invalid commit -m "Initial demo"

pnpm --dir "$WAYWARD" --filter @thepraggyverse/cli wayward run ultrareview --repo "$DEMO_REPO"
pnpm --dir "$WAYWARD" --filter @thepraggyverse/cli wayward board
```

The run output includes a `runId`. Use it in later commands:

```sh
pnpm --dir "$WAYWARD" --filter @thepraggyverse/cli wayward run show <run-id>
```

## Ultrareview

Use `ultrareview` for a broad inspect-mode review.

```sh
pnpm --filter @thepraggyverse/cli wayward run ultrareview --repo .
pnpm --filter @thepraggyverse/cli wayward board --workflow ultrareview
pnpm --filter @thepraggyverse/cli wayward run show <run-id>
```

Expected behavior:

- Codex-backed reviewers inspect the repository.
- Raw reviewer output and normalized summaries are saved as artifacts.
- A synthesized Markdown report is linked from the run.
- Source files are not edited by the workflow.

## Open PR Audit

Use `open-pr-audit` for read-only GitHub pull request inspection.

```sh
gh auth status
pnpm --filter @thepraggyverse/cli wayward run open-pr-audit --repo .
pnpm --filter @thepraggyverse/cli wayward approvals list
pnpm --filter @thepraggyverse/cli wayward run show <run-id>
```

Expected behavior:

- The workflow runs read-only `gh pr list`, `gh pr view`, and `gh pr diff --name-only` calls.
- Raw `gh` output and normalized audit artifacts are persisted.
- If the first 100 open PRs fill the current audit window, the normalized artifact and report include a warning that more open PRs may exist.
- A Markdown report is generated.
- The run pauses at `external-action-gate`.
- No comments, merges, closes, pushes, or other GitHub mutations are performed automatically.

To record a local decision:

```sh
pnpm --filter @thepraggyverse/cli wayward approvals approve <run-id> <approval-id>
```

or:

```sh
pnpm --filter @thepraggyverse/cli wayward approvals reject <run-id> <approval-id>
```

## Tournament

Use `tournament` when you want multiple isolated implementation attempts.

```sh
pnpm --filter @thepraggyverse/cli wayward run tournament --repo . --attempts 3 --prompt "Add tests for checkpoint rewind behavior"
pnpm --filter @thepraggyverse/cli wayward board --workflow tournament
pnpm --filter @thepraggyverse/cli wayward run show <run-id>
```

Expected behavior:

- Wayward creates candidate worktrees under `.wayward/worktrees/<run-id>/`.
- Workers attempt the same task in isolated worktrees.
- Validation and ranking artifacts are persisted.
- The primary checkout is not updated with the winning candidate automatically.

Review the report and candidate worktree paths before applying any changes.

## Checkpoint, Rewind, And Branch

Use checkpoints to make local progress recoverable.

```sh
pnpm --filter @thepraggyverse/cli wayward checkpoints create <run-id> before-risky-edit
pnpm --filter @thepraggyverse/cli wayward checkpoints list <run-id>
```

After local edits, create another checkpoint:

```sh
pnpm --filter @thepraggyverse/cli wayward checkpoints create <run-id> after-first-edit
```

Rewind to an earlier checkpoint:

```sh
pnpm --filter @thepraggyverse/cli wayward rewind <run-id> <checkpoint-id>
```

Branch from a checkpoint for comparison:

```sh
pnpm --filter @thepraggyverse/cli wayward branch <run-id> --checkpoint <checkpoint-id> --name compare-attempt
pnpm --filter @thepraggyverse/cli wayward run show <run-id>
```

Expected behavior:

- Rewind creates a safety checkpoint for tracked changes when needed.
- Untracked files are quarantined under `.wayward/rewind-quarantine/`.
- Branch creates a local git worktree under `.wayward/worktrees/<run-id>/`.
- Remote branches and external services are not touched.

## MCP Smoke

Start the local stdio MCP server:

```sh
pnpm --filter @thepraggyverse/mcp-server start
```

In an MCP client, call `tools/list` and then `tools/call` with a tool such as:

```json
{
  "name": "createRun",
  "arguments": {
    "workflow": "ultrareview",
    "inputs": {
      "repo": "/path/to/repo"
    }
  }
}
```

Use `readRun`, `readReport`, and `listPendingApprovals` to inspect the result.
