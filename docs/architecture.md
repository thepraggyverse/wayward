# Architecture

Wayward coordinates coding agents through a runtime, not through one-off shell choreography.

The CLI creates a run, the workflow runtime executes typed phase definitions, adapters start workers, and the core run store persists every durable fact: inputs, modes, jobs, events, artifacts, approvals, checkpoints, and reports. The board reads the run store instead of attaching to live processes, so completed, failed, cancelled, and rewound runs remain inspectable.

Codex is the first adapter. Its public CLI surfaces are used first, while richer app-server behavior is represented as optional capabilities.
