# 14. Shared TS script substrate — first-adopter slices only

Status: Pending
Size: M (per slice) · Severity: med · Risk: per-tool regression risk, low blast
radius per slice
Source: 00-report.md T6 / B2

## Problem

Git plumbing is spawned independently in 19 TS files — drift-ai has a real
injectable `GitRunner` (`scripts/drift-ai/git-changed-scope.ts:54-64`) that
stops at the drift-ai boundary; lint-ratchet, logs-audit, sensor-blob-size,
lint-coverage-map each re-implement merge-base/name-status/tracked-files.
Three full arg-parser frameworks exist above one shared value-reader
(`scripts/cli-option-values.ts`).

## Scope — explicitly incremental

This is **not** a "migrate 19 callers" mission; dispatch one slice at a time:

1. Promote `GitRunner` to `scripts/lib/git.ts` (superset API — each caller
   has subtly different name-status/rename handling) with drift-ai as the
   first consumer, unchanged behavior.
2. Migrate one non-drift-ai caller (suggest lint-coverage-map or logs-audit)
   as the proof slice, with per-tool regression tests.
3. Add `scripts/lib/cli.ts` (arg loop + `--format` + `HarnessDiagnostics`
   envelope output) and adopt in the three simple tools (code-intel,
   logs-audit, harness-audit) first; leave drift-ai's internal arg matrix
   alone initially.

Further callers migrate opportunistically, one per slice, each with its own
verification.

## Verification

- Per-slice: the migrated tool's focused tests green plus one manual
  invocation diffed against pre-migration output.
