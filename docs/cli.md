# CLI

`wayward run <workflow>` starts a workflow and writes run state.

`wayward board` renders persisted runs.

`wayward rewind <run-id> <checkpoint-id>` restores a checkpoint.

`wayward approvals list` shows pending gates with their run id, approval id, requested action, and report evidence.

`wayward approvals approve|reject <run-id> <approval-id>` records gate decisions and moves the paused run to `completed` or `cancelled`.
