# Parallel Runner Unification

Status: Parked
Order: 8

## Context

The repo has both `parallel-runner.sh` and `parallel-step.sh`. They solve
similar process orchestration problems through different APIs. The source
review recommends inventorying differences before unifying anything.

## Scope

- Re-audit all callers of `parallel-runner.sh` and `parallel-step.sh`.
- Compare logging, metadata, failure aggregation, signal propagation, timeout
  behavior, output shape, and shell API ergonomics.
- Pick one implementation, extract a shared core, or document why both should
  remain separate.
- Keep wrapper-specific output formatting outside the process runner.
- Preserve existing pre-commit and verify diagnostics.

## Definition Of Done

Parallel runner ownership is explicit: one shared implementation or a documented
reason for separate abstractions, with tests covering the retained behavior.

## Verification

- `bash scripts/test-parallel-runner.sh`
- `bash scripts/test-verify.sh` for `parallel-step.sh` behavior
- Equivalence fixture comparing the same synthetic command graph through the
  old and retained runner API if the implementations are unified
- `bash scripts/test-test-scripts.sh` if changed-selection ownership changes
- `bun run lint:shell`
- `bun run verify:changed`
