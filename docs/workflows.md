# Built-In Workflows

- `ultrareview`: everyday multi-specialist review with evidence-linked synthesis.
- `open-pr-audit`: inspect-mode PR audit with audit, rule, verify, synthesize, and gated external actions.
- `tournament`: multiple isolated implementation attempts with validation-backed winner selection.

Optional live Codex smoke for ultrareview:

```sh
pnpm --filter @thepraggyverse/cli wayward ultrareview --repo .
```

The smoke writes raw reviewer JSONL, normalized reviewer summaries, and the synthesized report under `.wayward/runs/<run-id>/`.
