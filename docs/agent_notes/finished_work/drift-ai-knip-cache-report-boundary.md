# Drift:ai knip cache report boundary

Landed 2026-05-31. Completed drift-ai review task 32.

## What changed

- `buildReport` now clears the module-level knip memo at the start of each report
  build, so direct library callers do not inherit stale knip JSON from a prior
  report.
- `runDriftAi` no longer owns the knip cache clear; it reaches the same boundary
  through `buildReport`.
- Direct `buildReport` coverage uses a fake target `node_modules/.bin/knip` to
  prove `orphan-files` and `unused-exports` still share one spawn within one
  report, while separate report builds re-spawn after the fake report changes.

## Validation

- `FORCE_VERIFY=1 bun run test -- scripts/drift-ai.test.ts`
- `FORCE_VERIFY=1 bun run test -- scripts/drift-ai.test.ts scripts/drift-ai/knip-runner.test.ts scripts/drift-ai/knip-unused-exports.test.ts`
