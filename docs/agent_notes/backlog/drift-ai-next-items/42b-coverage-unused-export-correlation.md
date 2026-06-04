# 42b - coverage and unused-export correlation

Status: Parked
Track: P
Size: medium
Depends on: 39, 40b, 42a, 42c
Blocks: none

## Goal

Overlay parsed coverage evidence onto static `unused-exports` reachability rows
without running tests by default.

## Background

Static reachability and runtime coverage answer different questions. A symbol can
be statically referenced but unexecuted in a run, or statically unreferenced but
covered through dynamic behavior. This task adds the correlation only after task
42a has a parser and labeled artifact evidence, and task 42c has proven the
standalone advisory rendering route.

## Seams to touch

- coverage parser output from task 42a
- coverage advisory rendering precedent from task 42c
- dead-code FP-trap corpus from task 40b
- `scripts/drift-ai/knip-unused-exports.ts`
- `scripts/drift-ai/knip-unused-exports-check.ts`
- prototype advisory output from task 39
- `scripts/drift-ai/README.md`

## What to do

1. Match coverage file/range/function evidence to `unused-exports` rows where
   location data is available.
2. Emit static category, static provenance, artifact label/path, hit count, and
   whether coverage was absent, present, or unavailable for that symbol/range.
3. Keep "uncovered" and "unused" separate in the text. The row is stronger
   evidence when both agree, not a deletion verdict.
4. Preserve per-artifact distinctions. Do not silently union unit/e2e/prod
   coverage into one bitmap.
5. Disclose unmatched symbols, missing locations, source-map mismatch, and parser
   limitations.
6. Calibrate against the dead-code FP-trap corpus so barrel, dynamic-import,
   test-only, framework-entry, and reflection cases stay visibly caveated.

## Testing

- Overlay tests with reachable/unreachable and covered/uncovered combinations.
- Fixture tests for multiple artifact labels and missing location metadata.
- Regression tests that covered dynamic usage does not get called dead.

## Out of scope

- Running tests or coverage commands.
- Coverage gates or score thresholds.
- Reimplementing static reachability beyond the live `unused-exports` adapter.
