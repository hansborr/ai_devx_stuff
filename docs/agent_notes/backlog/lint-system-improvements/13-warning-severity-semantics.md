# Warning Severity Semantics

Status: Parked
Order: 13

## Context

Normal ESLint uses `--max-warnings=0`, so warnings fail the gate. The
agent-facing local-rule envelope maps warnings to non-blocking harness warnings
and exits nonzero only for blocking findings.

Both behaviors can be valid, but the convention needs to be explicit.

## Scope

- Re-audit lint docs, harness docs, `scripts/lint-agent.ts`, and package
  scripts for warning behavior.
- Document that in normal ESLint, `warn` means an editor-advisory severity that
  still fails gates because commands use `--max-warnings=0`.
- Document that `error` means editor error and gate-enforced.
- Document that agent-envelope warnings are non-blocking unless a separate gate
  mode is introduced.
- If `lint-agent` is ever treated as a gate, add a mode that mirrors normal
  lint and fails warnings too.

## Definition Of Done

Contributors and agents can tell why normal ESLint warnings fail CI while
agent-envelope warnings remain advisory.

## Verification

- `bun run format:changed:check`
- `bun run docs:harness-controls:check` if generated harness docs change
- `bash scripts/test-lint-agent.sh` if `lint-agent` behavior changes
- `bash scripts/test-lint-agent-changed.sh` if changed-mode envelope behavior
  changes
- `bun run verify:changed`
