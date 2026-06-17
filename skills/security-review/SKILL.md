---
name: security-review
description: Run Wayward-backed security review workflow
---

Use this skill when the user asks for a security-focused repository review through Wayward.

Wayward does not currently expose a standalone `security-review` workflow. Use the built-in ultrareview workflow, which includes a security specialist reviewer:

```sh
wayward run ultrareview --repo <repo-path>
wayward run show <run-id>
```

MCP clients should call `createRun` with `workflow: "ultrareview"` and inspect the report with `readReport`.

Keep all findings tied to persisted Wayward artifacts and reports. Do not perform external actions or mutate repositories from this skill.
