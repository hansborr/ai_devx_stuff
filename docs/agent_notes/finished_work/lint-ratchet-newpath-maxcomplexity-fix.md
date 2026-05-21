# Lint Ratchet New-Path Max Complexity Fix

Date: 2026-05-21

## Summary

Fixed the codex review P2 from commit `45c47264`: live
`complexity-severity` new-path regressions now derive `currentComplexity` and
`line` from the highest-complexity entry in `perFunction`. This matches the
runtime shape from `collectCurrentById`, which carries `perFunction` but does
not populate `maxComplexity`.

The `maxComplexity` fallback remains for structural/generated paths that have
no `perFunction` vector.

## Coverage

Added focused Vitest coverage for:

- a live new-path current item with three complexity diagnostics in source
  order, asserting the regression reports complexity `25` at line `200`; and
- a `maxComplexity`-only new-path item, asserting the fallback still reports
  complexity `33`.

## Verification

- `bash scripts/vitest.sh run scripts/lint-ratchet-baseline.test.ts`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run docs:lint-coverage-map:check`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
