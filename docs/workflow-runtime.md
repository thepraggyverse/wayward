# Workflow Runtime

Workflows are phase graphs executed by `@thepraggyverse/workflow-runtime`.

A phase may:

- Run one worker.
- Fan out to multiple workers with bounded concurrency.
- Reduce worker results into normalized evidence.
- Verify evidence before synthesis.
- Write artifacts and reports.
- Request a persisted approval gate.

Phase inputs and outputs can declare schemas so downstream phases consume validated objects rather than freeform text. Failed validation becomes runtime state instead of an invisible prompt mismatch.

## Permission Modes

Runs record a permission mode:

- `inspect`: read, analyze, and write Wayward artifacts/reports without editing source files.
- `worktree-write`: write inside Wayward-created worktrees.
- `autopilot`: reserved as a runtime mode value, but built-in docs should not imply automatic external mutation.

Built-in defaults are conservative. `ultrareview` and `open-pr-audit` are inspect-oriented; `tournament` defaults to `worktree-write` because candidate attempts live in isolated worktrees.

## Approval Gates

Approval gates are phase outputs that pause the run in `needs_approval`. A gate records a requested action and evidence ids. The CLI and MCP tools can approve or reject the gate, but built-in workflows currently do not automatically perform a post-approval external action.

## Workflow Authoring Guidance

Keep workflow-specific behavior in workflow packages:

- Put prompts, reducers, report generation, and verification in the workflow.
- Preserve raw worker artifacts when a synthesized report depends on them.
- Use schemas for phase boundaries that other phases consume.
- Request approval gates before any future external mutation step.
- Keep skills and plugin metadata as thin routing layers over CLI or MCP calls.
