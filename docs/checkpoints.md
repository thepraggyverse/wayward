# Checkpoints

Checkpoints store git references and metadata without deleting later states. Rewind restores the selected checkpoint while keeping all checkpoint records listable for later inspection.

Checkpoint creation snapshots repository files while excluding Wayward's local `.wayward` control-plane data.

Before rewinding dirty code state, Wayward creates a safety checkpoint named `pre-rewind to <checkpoint-id>`. Untracked files are moved to `.wayward/rewind-quarantine/<run-id>/<checkpoint-id>/` before the checkpoint tree is restored.

Branching from a checkpoint creates a git worktree under `.wayward/worktrees/<run-id>/` and records the path in the run so `wayward board` can show it.
