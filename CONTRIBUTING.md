# Contributing To Wayward

Thanks for helping make agent work easier to inspect, rewind, and control.

Wayward is early and source-first. Please keep changes narrow, explicit, and aligned with the local-first safety model.

## Development Setup

```sh
corepack enable
pnpm install
pnpm build
pnpm test
```

Run the CLI from the monorepo with:

```sh
pnpm --filter @thepraggyverse/cli wayward <command>
```

## Before Opening A PR

Run:

```sh
pnpm test
pnpm build
git diff --check
```

If you changed docs, manually inspect the README and relevant files in `docs/` for stale command names, stale package names, and overclaims.

## Project Boundaries

- Keep runtime behavior in packages, not in skill prose or plugin metadata.
- Keep skills thin: they should route to CLI or MCP surfaces.
- Preserve raw artifacts when a synthesized report depends on them.
- Use schemas at workflow phase boundaries when downstream phases consume structured data.
- Do not add external mutations without an explicit local approval gate and review discussion.
- Do not imply a remote dashboard, remote MCP transport, or automatic post-approval executor unless one exists.

## Good First Contributions

Good early contributions include:

- Documentation fixes.
- Focused CLI examples.
- Tests around existing run-store, checkpoint, rewind, board, or MCP behavior.
- Small workflow report quality improvements that preserve raw evidence.
- Adapter capability detection improvements.

Larger runtime features are welcome, but please open an issue first so the safety and package-boundary implications can be discussed.

## Pull Request Expectations

In your PR description, include:

- What changed.
- Why it changed.
- How you tested it.
- Any safety or compatibility notes.

Keep PRs focused. If a change touches runtime behavior and public docs, update both in the same PR so readers are not left with stale instructions.

## Commit Style

Use clear, conventional-enough messages such as:

```text
docs: expand workflow examples
feat(cli): add run inspection flag
fix(checkpoints): preserve rewind metadata
test(mcp): cover approval decisions
```

The exact prefix is less important than making the scope and intent obvious.

## Code Of Conduct

All contributors are expected to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security

Please do not file public issues for sensitive vulnerabilities. Follow [SECURITY.md](SECURITY.md).
