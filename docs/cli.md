# CLI

`wayward run <workflow>` starts a workflow and writes run state.

`wayward board` renders persisted runs.

`wayward checkpoints create <run-id> [label]` stores the current repository state as a checkpoint.

`wayward checkpoints list <run-id>` prints checkpoint records for a run.

`wayward rewind <run-id> <checkpoint-id>` restores a checkpoint. If the working tree has code changes, Wayward creates a pre-rewind safety checkpoint first and quarantines untracked files under `.wayward/rewind-quarantine/`.

`wayward branch <run-id> [--checkpoint <checkpoint-id>] [--name <name>]` creates an isolated git worktree from the current repository state or from the selected checkpoint, then records the worktree path in the run.

`wayward approvals list` shows pending gates with their run id, approval id, requested action, and report evidence.

`wayward approvals approve|reject <run-id> <approval-id>` records gate decisions and moves the paused run to `completed` or `cancelled`.
