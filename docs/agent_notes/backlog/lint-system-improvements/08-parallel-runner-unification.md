# Parallel Runner Unification

Status: Parked (decision recorded)
Order: 8
Decision: Document separation, do not unify

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

## Decision (2026-05-26)

Document separation, do not unify. The names look redundant but the contracts
are different:

- `parallel-runner.sh` is a live-output fanout runner. It owns FIFOs, prefixes
  stdout/stderr, traps signals, waits all children, and computes
  `MUSI_PARALLEL_EXIT`. Callers: `scripts/lint.sh`, `scripts/lint-changed.sh`.
- `parallel-step.sh` is a verify/pre-commit step launcher. It writes
  `$LOG_DIR/<step>.log`, emits per-step metadata, scrubs Git hook env, exposes
  `STEP_PID`, and leaves waiting, summaries, process-tree cleanup, and wrapper
  metadata to the caller. Callers: `scripts/verify.sh`, `.husky/pre-commit`.

Unifying them would create a configurable "do everything" shell abstraction with
knobs for live streaming vs log capture, metadata vs no metadata, direct-child
cleanup vs process-tree cleanup, internal aggregation vs caller aggregation.
That is worse for maintainability than two small helpers with explicit ownership.

Implementation: add crisp ownership comments/docs, keep both helpers, and
tighten tests only around those documented contracts. A better later cleanup
target is `scripts/typecheck.sh`, which has a similar live-prefix FIFO pattern
and could potentially reuse `parallel-runner.sh` without dragging verify
metadata into lint-style runners.

## Definition Of Done

Parallel runner ownership is explicit: a documented reason for separate
abstractions, with tests covering the retained behavior.

## Verification

- `bash scripts/test-parallel-runner.sh`
- `bash scripts/test-verify.sh` for `parallel-step.sh` behavior
- Equivalence fixture comparing the same synthetic command graph through the
  old and retained runner API if the implementations are unified
- `bash scripts/test-test-scripts.sh` if changed-selection ownership changes
- `bun run lint:shell`
- `bun run verify:changed`
