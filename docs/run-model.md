# Run Model

The run store is Wayward's source of truth. CLI views and MCP tools read persisted records instead of reconstructing state from live worker processes.

## Files

Run summaries live at:

```text
.wayward/runs/<run-id>/summary.json
```

Event history is append-only JSONL:

```text
.wayward/runs/<run-id>/events.jsonl
```

Artifacts and reports are stored under run-local directories and linked from the summary. The exact artifact names are workflow-owned, but the run summary records the ids, types, paths, and evidence relationships that the board and `run show` render.

## Durable Records

A run can include:

- Inputs and permission mode.
- Jobs and job state transitions.
- Events with timestamps and messages.
- Artifacts such as raw worker output, normalized summaries, audit JSON, or candidate metadata.
- Reports with Markdown paths.
- Approval gates and decisions.
- Checkpoints.
- Worktrees created for tournament attempts or checkpoint branches.
- Runtime heartbeat metadata for active runs.
- Recovery metadata when stale running state is marked interrupted.

## States

Run states are first-class:

- `created`
- `running`
- `needs_approval`
- `completed`
- `failed`
- `timed_out`
- `cancelled`
- `rewound`
- `interrupted`

`needs_approval` means a local approval gate is pending. `rewound` means a checkpoint restore was recorded. `interrupted` means a run that was still marked `running` was recovered after its heartbeat or last update became stale and Wayward did not consider the recorded process active. Historical events and artifacts remain inspectable after any of these state transitions.

## Stale Running Recovery

New runs record process metadata and heartbeat timestamps in `summary.json`. `wayward run recover-stale` checks only `running` runs, skips same-host runs whose recorded PID is still alive, and skips other-host runs unless explicitly allowed. Runs that pass the stale threshold are moved to `interrupted`, with recovery details stored on the summary and a `run.recovered` event appended to the event log.
