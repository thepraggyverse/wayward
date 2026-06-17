---
name: open-pr-audit
description: Audit open pull requests in inspect mode using Wayward
---

Use this skill when the user asks to inspect open pull requests, stale PRs, risky file overlap, checks, review status, or merge-readiness across a repository.

Call Wayward instead of scripting the audit yourself:

```sh
wayward run open-pr-audit --repo <repo-path>
wayward approvals list
wayward run show <run-id>
```

MCP clients should call `createRun` with `workflow: "open-pr-audit"` and `inputs.repo`, then use `readReport`, `listPendingApprovals`, and `decideApproval`.

The built-in audit uses read-only `gh` commands, persists raw and normalized evidence, and pauses at `external-action-gate`. Do not post comments, close PRs, merge, or otherwise mutate GitHub from the skill; require a recorded Wayward approval decision first.
