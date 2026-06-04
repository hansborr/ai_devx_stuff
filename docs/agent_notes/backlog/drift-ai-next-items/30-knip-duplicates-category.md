# 30 - knip duplicates category

Status: Parked
Track: C
Size: small-medium
Depends on: none
Blocks: none

## Goal

Surface knip's `duplicates` category through the existing knip pass-through
adapter, with target-config provenance and opt-in behavior.

## Background

`unused-exports` now parses knip's symbol-level categories
`exports`, `types`, `enumMembers`, and `namespaceMembers`. The code explicitly
defers knip `duplicates`, which is conceptually a duplication signal and can be
added without building a new detector.

## Seams to touch

- `scripts/drift-ai/knip-runner.ts`
- `scripts/drift-ai/knip-unused-exports.ts`, or a new `knip-duplicates.ts`
- `scripts/drift-ai/knip-pass-through-check.ts`
- new or existing knip tests and fixtures
- `scripts/drift-ai/types.ts`
- `scripts/drift-ai/check-metadata.ts`
- `scripts/drift-ai/check-registry.ts`
- `scripts/drift-ai/README.md`

## What to do

1. Inspect current knip JSON shape for the `duplicates` category using a tiny
   controlled fixture project or captured fixture.
2. Decide whether to:
   - add a new check id such as `knip-duplicates`; or
   - include the category under an existing duplication check only if the summary
     and provenance stay clear.
3. Extend `--include` category selection so selecting the new check requests
   `duplicates`.
4. Reuse the memoized single-spawn knip runner where possible.
5. Build findings with `[target-config]` provenance and category details.
6. Keep it opt-in; knip can be slow on this monorepo.

## Testing

- Fixture parse tests for clean, populated, malformed, and missing category rows.
- Runner tests proving category selection and memoization still work.
- Check tests proving target-install/config skips remain skips, not findings.

## Out of scope

- Reimplementing knip reachability.
- Making knip checks default-on.
- Solving knip runtime performance broadly.
