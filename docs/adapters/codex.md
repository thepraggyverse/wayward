# Codex Adapter

The Codex adapter wraps stable local Codex behavior first. It is the first supported Wayward adapter, but workflow definitions are written against runtime primitives rather than Codex-only glue.

## Responsibilities

The adapter should:

- Start local Codex-backed workers when a workflow phase asks for one.
- Record raw worker output as artifacts.
- Report capability availability instead of assuming every Codex surface exists.
- Keep workflow prompts and reducers out of the adapter.

## Capability Detection

Public CLI behavior is preferred. Richer or experimental app-server behavior should remain behind capability detection and must not be required for baseline workflow runs.

## Safety Expectations

Inspect-mode workers should not edit source files, create branches, commit, push, install dependencies, or perform external actions. Worktree-write workers should stay inside Wayward-managed worktrees.

Security-focused requests currently use the `security-review` skill, which routes to the built-in `ultrareview` workflow. There is not yet a separate `security-review` workflow implementation.
