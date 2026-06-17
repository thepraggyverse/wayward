# Security Policy

Wayward is early, local-first software for coordinating coding-agent workflows. Security reports are welcome, especially where they affect local file safety, command execution, repository integrity, approval gates, or external service boundaries.

## Supported Versions

Wayward has not published stable releases yet. Security fixes target the active development branch and the next public release.

## Reporting A Vulnerability

Please do not open a public issue with exploit details, secrets, tokens, private repository data, or reproduction steps that could harm users.

Preferred path:

1. Use GitHub's private vulnerability reporting or private security advisory feature if it is enabled for the repository.
2. If private reporting is not available, open a minimal public issue asking maintainers to provide a private contact path. Do not include sensitive details in that issue.

Helpful report contents:

- Affected package, command, workflow, MCP tool, or skill.
- Impact and likely affected users.
- Reproduction steps using a minimal local repository when possible.
- Whether external services such as GitHub or Codex are involved.
- Whether secrets, untracked files, worktrees, checkpoints, or approval gates are affected.

## Security-Relevant Areas

Reports are especially useful for:

- Unintended external mutations.
- Approval gate bypasses.
- Unsafe rewind or checkpoint behavior that can lose local work.
- Path traversal or writes outside expected `.wayward/` or worktree paths.
- Command injection through CLI, workflow, adapter, or MCP inputs.
- Leaking secrets into artifacts, reports, logs, or MCP responses.
- Confusing docs that tell users to run unsafe commands.

## Current Boundaries

- MCP is local stdio only.
- There is no remote dashboard or hosted run service.
- Built-in workflows do not automatically perform post-approval external mutations.
- `open-pr-audit` uses read-only `gh` commands.
- `security-review` currently routes through `ultrareview`; it is not a separate workflow implementation.
