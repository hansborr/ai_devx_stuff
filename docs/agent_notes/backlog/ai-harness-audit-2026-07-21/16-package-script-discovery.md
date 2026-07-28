# Package-Script Discovery Decision

Status: Rejected after adversarial review — use Bun's built-in query
Date: 2026-07-21

## Finding

Bare `bun run` emits about 517 lines in the current Bun version, including a CLI
help preamble before the 140 root scripts. The existing discovery instruction is
needlessly noisy.

## Decision

Do not add a repository-owned `scripts:list` command or its test suite. Bun
already exposes the package scripts without the help preamble:

```bash
bun --cwd="$(git rev-parse --show-toplevel)" pm pkg get scripts
```

An exact lookup is also available, for example:

```bash
bun --cwd="$(git rev-parse --show-toplevel)" pm pkg get 'scripts[test:scripts]'
```

`AGENTS.md` and `README.md` now use the built-in query. Continue to use
`bun run <name>` for execution. Reopen a custom command only if Bun removes or
destabilizes this query contract.
