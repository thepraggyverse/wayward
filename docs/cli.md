# CLI

`wayward run <workflow>` starts a workflow and writes run state.

`wayward board` renders persisted runs as a terminal-friendly control surface. It shows run id, workflow, state label, mode, created/updated time, job counts by state, report count, pending approval count, checkpoint count, worktree count, and the latest failure or error summary.

`wayward board --state <state>` filters runs by state. Supported states are `created`, `running`, `needs_approval`, `completed`, `failed`, `timed_out`, `cancelled`, and `rewound`.

`wayward board --workflow <name>` filters runs by workflow name.

`wayward board --limit <count>` limits the number of rendered runs after filtering.

`wayward run show <run-id>` renders one run in detail, including metadata, jobs, reports, approvals with evidence, artifacts grouped by type, checkpoints, worktrees, and recent events.

`wayward checkpoints create <run-id> [label]` stores the current repository state as a checkpoint.

`wayward checkpoints list <run-id>` prints checkpoint records for a run.

`wayward rewind <run-id> <checkpoint-id>` restores a checkpoint. If the working tree has code changes, Wayward creates a pre-rewind safety checkpoint first and quarantines untracked files under `.wayward/rewind-quarantine/`.

`wayward branch <run-id> [--checkpoint <checkpoint-id>] [--name <name>]` creates an isolated git worktree from the current repository state or from the selected checkpoint, then records the worktree path in the run.

`wayward approvals list` shows pending gates with their run id, approval id, requested action, and report evidence.

`wayward approvals approve|reject <run-id> <approval-id>` records gate decisions and moves the paused run to `completed` or `cancelled`.
