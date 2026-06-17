# Built-In Workflows

- `ultrareview`: everyday multi-specialist review with evidence-linked synthesis.
- `open-pr-audit`: inspect-mode PR audit with audit, rule, verify, synthesize, and gated external actions.
- `tournament`: multiple isolated implementation attempts with validation-backed winner selection.

All built-in workflows can be started through the CLI:

```sh
wayward run <workflow> --repo <repo-path>
```

MCP clients should call `createRun` with the same workflow name and an `inputs` object. Use `listRuns`, `readRun`, and `readReport` for persisted inspection instead of re-deriving workflow state from raw files.

Optional live Codex smoke for ultrareview:

```sh
pnpm --filter @thepraggyverse/cli wayward ultrareview --repo .
```

The smoke writes raw reviewer JSONL, normalized reviewer summaries, and the synthesized report under `.wayward/runs/<run-id>/`.

Optional live GitHub smoke for open-pr-audit:

```sh
pnpm --filter @thepraggyverse/cli wayward open-pr-audit --repo .
```

The smoke requires an authenticated `gh` CLI with repository read access. It runs `gh pr list`, `gh pr view`, and `gh pr diff --name-only`, writes raw and normalized PR audit artifacts under `.wayward/runs/<run-id>/`, writes a Markdown report, and pauses at the external-action approval gate without mutating GitHub.

Tournament smoke:

```sh
pnpm --filter @thepraggyverse/cli wayward tournament --repo . --attempts 2 --prompt "Make the requested change"
```

Tournament uses git worktrees under `.wayward/worktrees/<run-id>/`. Review the resulting ranking with `wayward run show <run-id>` before applying or merging any candidate work.

Approval gates are local persisted records. Use `wayward approvals list` or MCP `listPendingApprovals` to inspect them, then `wayward approvals approve|reject <run-id> <approval-id>` or MCP `decideApproval` to record the decision.
