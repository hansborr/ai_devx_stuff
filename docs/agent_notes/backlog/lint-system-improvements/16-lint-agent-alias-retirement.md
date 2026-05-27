# Lint Agent Alias Retirement

Status: Done
Order: 16

## Context

`lint:agent` and `lint:agent:changed` are compatibility aliases for the more
explicit `lint:agent:local-rules` and `lint:agent:local-rules:changed`
commands. The source review recommends removing or time-boxing the aliases once
callers and docs use the preferred names.

Overlap:
`docs/agent_notes/backlog/lint-reference-readiness/22-lint-agent-changed-semantics.md`
records the rename leaf that introduced the preferred names.

## Scope

- Re-audit `package.json`, harness controls, generated docs, hook adapters,
  scripts, and agent notes for legacy alias usage.
- Decide whether the aliases are still needed for compatibility.
- If keeping them, document a sunset condition.
- If removing them, update all callers and generated docs in the same leaf.
- Preserve the machine-readable envelope tool name if downstream consumers
  still rely on it.

## Definition Of Done

The legacy `lint:agent` aliases are either removed safely or have an explicit
compatibility sunset plan.

## Resolution

The live audit found no hook, harness-control, or package-script callers of the
legacy package aliases. `package.json` now exposes only
`lint:agent:local-rules` and `lint:agent:local-rules:changed`; the stable
machine-readable envelope tool id remains `lint:agent`.

## Verification

- `bun run harness:check` if harness controls change
- `bash scripts/test-lint-agent.sh`
- `bash scripts/test-lint-agent-changed.sh`
- `bun run verify:changed`
