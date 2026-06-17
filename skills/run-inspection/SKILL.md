---
name: run-inspection
description: Inspect Wayward boards, runs, reports, approvals, artifacts, and checkpoints
---

Use this skill when the user asks what Wayward has run, what is blocked, where reports live, whether approvals are pending, or what artifacts/worktrees/checkpoints belong to a run.

Call the persisted run surfaces:

```sh
wayward board
wayward board --state needs_approval
wayward board --workflow <workflow>
wayward run show <run-id>
wayward approvals list
```

MCP clients should use `listRuns`, `readRun`, `readReport`, and `listPendingApprovals`.

Treat `.wayward/runs/` as the source of truth. Do not infer status from live processes or re-summarize raw artifacts when `wayward run show` or `readReport` can read the persisted run record.
