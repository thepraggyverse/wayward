---
name: ultrareview
description: Run Wayward's structured multi-specialist repository review
---

Use this skill when the user asks for a broad repository review, regression hunt, test-risk pass, or multi-specialist critique.

Call Wayward instead of manually orchestrating reviewers:

```sh
wayward run ultrareview --repo <repo-path>
wayward board --workflow ultrareview
wayward run show <run-id>
```

MCP clients should call `createRun` with `workflow: "ultrareview"` and `inputs.repo`, then inspect results with `readRun`, `readReport`, and `listRuns`.

Keep this skill thin. Do not recreate fanout prompts, reviewer roles, report synthesis, artifact parsing, or persistence in skill prose; those belong to the Wayward workflow runtime. Ultrareview runs reviewers in inspect/read-only mode and writes local artifacts and reports under `.wayward/runs/`.
