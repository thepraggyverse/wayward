# Run Model

Run summaries live at `.wayward/runs/<run-id>/summary.json`. Event history is append-only JSONL at `.wayward/runs/<run-id>/events.jsonl`. Artifacts and reports are stored under run-local directories and linked from the summary.

Run states are first-class: `created`, `running`, `needs_approval`, `completed`, `failed`, `timed_out`, `cancelled`, and `rewound`.
