# 47a - sibling naming classifier calibration

Status: Parked
Track: P
Size: small-medium
Depends on: 40b
Blocks: 47

## Goal

Build and calibrate the sibling implementation naming classifier before attaching
it to any advisory rows.

## Background

The original sibling implementation task asked for detection, correlation, and
overlay output in one slice. The risky part is the classifier: names like
`old`, `legacy`, `v2`, `copy`, and `backup` can be useful evidence or harmless
API vocabulary. This task isolates token/pair classification and FP-trap corpus
calibration.

## Seams to touch

- `scripts/drift-ai/ghost-files-buckets.ts`
- `scripts/drift-ai/ghost-files-tokens.ts`
- new focused sibling-naming helper modules under `scripts/drift-ai/`
- dead-code FP-trap corpus from task 40b
- focused tests under `scripts/drift-ai/`

## What to do

1. Detect sibling implementation naming patterns such as `v2`, `old`, `legacy`,
   `new`, `copy`, `backup`, and near-token variants.
2. Keep this library/test-only. Do not emit `DriftFinding` warnings or prototype
   advisory rows in this task.
3. Make the seed suffix/prefix set configurable at the helper level so task 47
   can expose config only if needed.
4. Calibrate against the dead-code FP-trap corpus and label public API,
   test-only, dynamic-use, and framework-entry cases as risky contexts rather
   than deletion candidates.
5. Return raw classifier evidence: sibling paths, shared tokens, matched naming
   pattern, and caveat labels.

## Testing

- Token/naming tests for versioned, legacy, backup, copy, and benign sibling
  names.
- Corpus tests proving trap labels are preserved.
- Deterministic ordering tests.

## Out of scope

- User-facing output.
- Deletion advice.
- Proving one sibling replaces another.
