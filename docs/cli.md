# CLI

The CLI package is `@thepraggyverse/cli`, and its binary name is `wayward`. From this monorepo, run it through the package script:

```sh
pnpm --filter @thepraggyverse/cli wayward <command>
```

After package publication or local linking, the shorter form is:

```sh
wayward <command>
```

## Commands

### `wayward run <workflow>`

Starts a workflow and writes run state.

```sh
wayward run ultrareview --repo .
wayward run open-pr-audit --repo .
wayward run tournament --repo . --attempts 2 --prompt "Try the refactor"
```

Options:

- `--repo <path>`: target repository. Defaults to the invocation working directory.
- `--attempts <count>` or `--attempt-count <count>`: tournament attempt count.
- `--base-ref <ref>`, `--base <ref>`, or `--base-branch <ref>`: tournament base ref.
- `--prompt <task>` or `--task <task>`: tournament worker task.
- `--mode inspect|worktree-write|autopilot`: permission mode recorded on the run. Tournament defaults to `worktree-write`.

Supported built-in workflows are `ultrareview`, `open-pr-audit`, and `tournament`.

### `wayward board`

Renders persisted runs as a terminal-friendly control surface. It shows run id, workflow, state label, mode, created and updated time, runtime/recovery metadata, job counts by state, report count, pending approval count, checkpoint count, worktree count, and the latest failure or error summary.

```sh
wayward board
wayward board --state needs_approval
wayward board --workflow tournament
wayward board --limit 5
```

Options:

- `--state <state>`: one of `created`, `running`, `needs_approval`, `completed`, `failed`, `timed_out`, `cancelled`, `rewound`, or `interrupted`.
- `--workflow <name>`: filter by workflow name.
- `--limit <count>`: limit rendered runs after filtering.

### `wayward run show <run-id>`

Renders one run in detail, including metadata, jobs, reports, approvals with evidence, artifacts grouped by type, checkpoints, worktrees, and recent events.

```sh
wayward run show run_123
```

Use this before acting on an approval gate, choosing a tournament winner, or rewinding from a checkpoint.

### `wayward run recover-stale`

Recovers persisted `running` runs whose recorded heartbeat or last update is older than a conservative stale threshold. Recovery marks the run `interrupted`, records recovery metadata, clears runtime metadata, and marks still-running or queued jobs as failed with an interruption reason.

```sh
wayward run recover-stale
wayward run recover-stale --repo .
wayward run recover-stale --stale-after-ms 3600000
wayward run recover-stale --run-id run_123
```

Options:

- `--repo <path>`: target repository whose `.wayward/runs/` store should be inspected. Defaults to the invocation working directory.
- `--stale-after-ms <ms>`: age threshold for the latest heartbeat or update. Defaults to one hour.
- `--run-id <run-id>`: inspect only one run.
- `--include-foreign-hosts`: allow recovery of runs recorded from another hostname. By default, those are skipped because Wayward cannot prove their process is dead.

### `wayward approvals`

Lists or decides local approval gates.

```sh
wayward approvals list
wayward approvals pending
wayward approvals approve <run-id> <approval-id>
wayward approvals reject <run-id> <approval-id>
```

`list` and `pending` both show pending gates with run id, workflow, run state, approval id, requested action, evidence ids, and updated time.

`approve` records an `approved` decision and moves the paused run to `completed`. `reject` records a `rejected` decision and moves the paused run to `cancelled`.

Approval decisions are local Wayward state. Built-in workflows currently do not automatically mutate external services after approval.

### `wayward checkpoints`

Creates and lists checkpoints for an existing run.

```sh
wayward checkpoints create <run-id> before-refactor
wayward checkpoints list <run-id>
```

Checkpoint creation snapshots repository files while excluding Wayward control-plane data. Checkpoints are linked from the run summary.

### `wayward rewind`

Restores a checkpoint.

```sh
wayward rewind <run-id> <checkpoint-id>
```

If the working tree has tracked code changes, Wayward creates a pre-rewind safety checkpoint first. Untracked files are quarantined under `.wayward/rewind-quarantine/` before the checkpoint tree is restored.

### `wayward branch`

Creates an isolated git worktree from the current repository state or from a selected checkpoint, then records the worktree path in the run.

```sh
wayward branch <run-id>
wayward branch <run-id> --checkpoint <checkpoint-id> --name retry-from-safe-point
```

Options:

- `--checkpoint <checkpoint-id>`: branch from a stored checkpoint instead of the current repository state.
- `--name <name>`: human-friendly branch suffix.

## Run States

Runs can be `created`, `running`, `needs_approval`, `completed`, `failed`, `timed_out`, `cancelled`, `rewound`, or `interrupted`.

`needs_approval` means the workflow reached a local approval gate and is waiting for a decision. `rewound` means a checkpoint restore was recorded for the run. `interrupted` means a previously running summary was recovered after its process stopped heartbeating and was no longer considered active.

## Source-First Invocation

Most docs use the local monorepo form:

```sh
pnpm --filter @thepraggyverse/cli wayward run ultrareview --repo .
```

That invokes the `wayward` package script from `packages/cli/package.json`. It is the safest command form until package publication and installation instructions are finalized.
