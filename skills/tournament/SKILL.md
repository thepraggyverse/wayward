---
name: tournament
description: Run multiple isolated implementation attempts and select a validated winner
---

Use this skill when the user wants multiple independent implementation attempts, a ranked comparison, or a validated candidate selected from isolated worktrees.

Call Wayward instead of hand-rolling parallel attempts:

```sh
wayward run tournament --repo <repo-path> --attempts <count> --prompt "<task>"
wayward board --workflow tournament
wayward run show <run-id>
```

MCP clients should call `createRun` with `workflow: "tournament"` and `inputs.repo`; pass `inputs.attempts`, `inputs.baseRef`, and `inputs.prompt` when needed.

Tournament uses Wayward worktree services for candidate isolation and records worktree paths, artifacts, ranking evidence, and reports under the run. Do not manually create extra branches, pick winners without reading the persisted report, or collapse candidate evidence into skill prose.
