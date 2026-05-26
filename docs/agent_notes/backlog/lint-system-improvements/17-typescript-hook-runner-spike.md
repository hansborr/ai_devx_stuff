# TypeScript Hook Runner Spike

Status: Parked spike
Order: 17

## Context

The shell layer under `scripts/ai-hooks/` and agent-specific hook wrappers
handles JSON payloads, output filtering, caches, lock files, commit summaries,
and stop policies. It works, but parts are at the edge of what Bash is good at.

The source review recommends a small spike rather than a wholesale rewrite.

## Scope

- Pick one pure hook path to port first, likely lint coverage or stop-policy
  parsing.
- Keep the existing shell wrapper as a thin adapter that invokes Bun.
- Preserve or improve tests for payload parsing, cache markers, fingerprinting,
  output filtering, lock behavior, and emitted hook JSON.
- Compare startup time, reliability, and implementation clarity.
- Do not migrate all hooks in this task.

## Definition Of Done

One hook path has a measured TypeScript-runner spike, and the repo has a clear
adopt, iterate, or reject decision for further migration.

## Verification

- `bash scripts/ai-hooks/test.sh` or `bash scripts/test-ai-hooks.sh`
- Focused tests for the ported path
- Startup-time comparison notes
- `bun run verify:changed`
