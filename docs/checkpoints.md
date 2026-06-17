# Checkpoints, Rewind, And Branches

Wayward checkpoints are local git-backed recovery points linked to a run. They are meant to make agent exploration reversible without hiding what happened.

## Create And List

```sh
wayward checkpoints create <run-id> before-risky-change
wayward checkpoints list <run-id>
```

Checkpoint creation snapshots repository files while excluding Wayward's local `.wayward` control-plane data. The checkpoint record is stored in the run summary, and later checkpoints do not delete earlier records.

Use checkpoints before a risky manual operation, before rewinding, or before comparing a tournament candidate with the primary checkout.

## Rewind

```sh
wayward rewind <run-id> <checkpoint-id>
```

Rewind restores the selected checkpoint and keeps checkpoint records listable for later inspection.

Safety behavior:

- If tracked files have changes, Wayward creates a safety checkpoint named `pre-rewind to <checkpoint-id>` before restoring.
- Untracked files are moved to `.wayward/rewind-quarantine/<run-id>/<checkpoint-id>/`.
- The run state is recorded as `rewound`.
- The rewind result reports the safety checkpoint id, if one was created, and the quarantined files.

Rewind is a local repository operation. It does not push, pull, merge, or mutate remote services.

## Branch From A Checkpoint

```sh
wayward branch <run-id> --checkpoint <checkpoint-id> --name retry-from-safe-point
```

Branching creates a git worktree under `.wayward/worktrees/<run-id>/` and records the path in the run. This lets readers find candidate branches through `wayward board` and `wayward run show` instead of manually searching git worktree output.

If `--checkpoint` is omitted, Wayward branches from the current repository state.

## MCP Tools

MCP clients should use the shared tools for the same behavior:

- `listCheckpoints`
- `createCheckpoint`
- `rewind`
- `branchFromCheckpoint`

Clients should not construct checkpoint refs, reset trees, quarantine files, or create Wayward worktree paths themselves. That logic belongs to the shared checkpoint and worktree services.

## Practical Flow

```sh
wayward run ultrareview --repo .
wayward checkpoints create <run-id> before-fix
# Make local edits.
wayward checkpoints create <run-id> after-first-fix
wayward rewind <run-id> <before-fix-checkpoint-id>
wayward branch <run-id> --checkpoint <after-first-fix-checkpoint-id> --name compare-first-fix
wayward run show <run-id>
```

This flow leaves a visible record of the safe point, the attempted change, the rewind, and the branch created for later comparison.
