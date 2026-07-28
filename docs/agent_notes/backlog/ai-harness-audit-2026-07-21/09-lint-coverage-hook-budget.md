# Batch the Lint-Coverage Edit Hook

Status: Proposed — revise to batching plus timeout; omit protocol expansion
Date: 2026-07-21
Priority: P2

## Problem

`lint-coverage-check.sh` runs a serial `eslint --print-config` process per
edited lintable path. `AI_LINT_COVERAGE_MAX_PATHS` caps only displayed bullets,
not work. Timings vary with machine load, and even one slow or hung child can
exhaust the shared 15-second hook timeout before any advisory is emitted.

Measured follow-up: separate processes took about 0.96 seconds for one path,
4.1 seconds for five, and 16.9 seconds for twenty. One shared ESLint API instance
resolved twenty paths in about one second. The batching fix is justified; a new
progress protocol is not.

## Scope

- Prefer one ESLint API process per target worktree that resolves every target
  path in that worktree.
- Batch the `lint-ratchet.ts --edit-ratchet-coverage` query once per target
  worktree as well; replacing only the ESLint fan-out leaves a second serial
  process-per-path loop.
- Wrap the single batched helper in a simple timeout below the provider budget.
  Add a hard path cap only if batching still approaches that budget in fixtures.
- Do not add streaming partial-progress state or a new uncapped follow-up CLI
  unless the batched implementation demonstrably omits paths.
- Preserve target-worktree behavior from leaf 05 and current throttling.

## Acceptance

- A fixture with at least 20 edited lintable files completes inside the hook
  budget through one ESLint process and one ratchet query.
- A deliberately hung batched helper is terminated below the provider timeout
  with one actionable advisory.
- Tests distinguish analyzed, truncated, unrelated, and no-lint-config paths.
  All adapters get classification-parity coverage; the greater-than-20-path
  payload is exercised through Codex/direct shared-body fixtures because the
  other adapters normally provide one edited path at a time.

This records a previously unpromoted concern from the lint-messaging pack; live
timing demonstrates lost-advisory risk, while the adversarial review narrows the
solution to batching plus a simple timeout.
