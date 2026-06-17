---
name: checkpoint-rewind-branch
description: Use Wayward checkpoints, rewind, and checkpoint branches
---

Use this skill when the user wants to mark a safe point, inspect checkpoints, rewind local code state, or branch from a prior Wayward checkpoint.

Call the existing Wayward controls:

```sh
wayward checkpoints create <run-id> [label]
wayward checkpoints list <run-id>
wayward rewind <run-id> <checkpoint-id>
wayward branch <run-id> --checkpoint <checkpoint-id> --name <name>
```

MCP clients should use `listCheckpoints`, `createCheckpoint`, `rewind`, and `branchFromCheckpoint`.

Checkpoints and rewinds are local git operations. Rewind creates a pre-rewind safety checkpoint when local tracked changes exist and quarantines untracked files under `.wayward/rewind-quarantine/`. Do not recreate checkpoint refs, worktree paths, or rewind safety logic in the skill; those belong to Wayward services.
