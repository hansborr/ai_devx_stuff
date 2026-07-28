# Fail Closed During Changed Script-Smoke Selection

Status: Accepted after adversarial review — not promoted; owner selected the
full-suite fallback (2026-07-21)
Date: 2026-07-21
Priority: P2

## Problem

`scripts/test-scripts.sh --changed` masks both `git diff` failures with
`|| true`, then consumes readers through process substitution, which cannot
propagate producer status. A broken index can exit 0 with "no script smoke tests
selected."

Normal `verify:changed` and pre-commit runs usually inject an already-classified
file set, and the shared changed-base helper catches common missing/disjoint-base
failures. The remaining direct-command/fallback defect is real but not P1.

## Scope

- Capture changed/deleted enumeration output and status explicitly; merely
  removing `|| true` is insufficient while process substitution remains.
- On any diff/base enumeration error, explain the fallback and run the full
  smoke set (owner decision 2026-07-21: full suite with the reason stated, not
  hard fail); never turn discovery failure into no-op success.

## Acceptance

- Independently forced range and worktree diff failures select the full suite
  and emit the reason.
- Genuine empty change sets still no-op.

Parallel green-output cleanup is intentionally separate in leaf 17 so this
correctness fix can land without changing transcript behavior.
