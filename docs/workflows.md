# Built-In Workflows

- `ultrareview`: everyday multi-specialist review with evidence-linked synthesis.
- `open-pr-audit`: inspect-mode PR audit with audit, rule, verify, synthesize, and gated external actions.
- `tournament`: multiple isolated implementation attempts with validation-backed winner selection.

Optional live Codex smoke for ultrareview:

```sh
pnpm --filter @thepraggyverse/cli wayward ultrareview --repo .
```

The smoke writes raw reviewer JSONL, normalized reviewer summaries, and the synthesized report under `.wayward/runs/<run-id>/`.

Optional live GitHub smoke for open-pr-audit:

```sh
pnpm --filter @thepraggyverse/cli wayward open-pr-audit --repo .
```

The smoke requires an authenticated `gh` CLI with repository read access. It runs `gh pr list`, `gh pr view`, and `gh pr diff --name-only`, writes raw and normalized PR audit artifacts under `.wayward/runs/<run-id>/`, writes a Markdown report, and pauses at the external-action approval gate without mutating GitHub.
