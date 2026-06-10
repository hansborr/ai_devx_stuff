# 47a - sibling naming classifier calibration

Status: Done
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

## Implementation notes (done 2026-06-04)

What landed:

- `scripts/drift-ai/sibling-naming.ts` is the library/test-only classifier. No
  `DriftCheckId`, subcommand, or advisory output — task 47 owns user-facing rows.
- `tokenizeSiblingName` keeps a `v`-number version run intact (`v2`, `V2`) where
  the ghost-files tokenizer splits `v` from `2`, so version markers survive.
  `classifySiblingMarker` labels a token `version` (`/^v\d+$/`), `lifecycle`
  (`old`/`legacy`/`new`/`deprecated`/`obsolete`/`previous`/`prev`), or
  `copy-backup` (`copy`/`backup`/`bak`/`orig`/`original`/`tmp`/`temp`/`draft`/`wip`).
  The seed sets are configurable via `resolveSiblingNamingConfig`
  (`lifecycle`/`copyBackup`/`versionPattern`) so task 47 can expose overrides only
  if a field run needs it (point 3).
- `classifySiblingPair` / `findSiblingVariantPairs` emit a pair only when the two
  basenames share at least one **non-marker** base token and every differing token
  is a marker. This rejects `foo.ts` vs `foo-helper.ts` (a genuine ghost signal,
  not a variant) and `old.ts` vs `old-config.ts` (no real base to fork from).
  Output is `{ leftPath, rightPath, sharedTokens, leftMarkers, rightMarkers,
  relation, caveats }`, where `relation` is `plain-vs-marked` or `marked-vs-marked`
  and each marker carries a `prefix`/`infix`/`suffix` position (point 5). Pairs are
  canonically ordered and deterministically sorted.
- Caveat labeling (point 4): every pair carries `SIBLING_NAMING_STANDING_CAVEAT`
  (a marker filename is a fork lead, never a deletion verdict). `siblingPathCaveats`
  adds `test-only` / `public-api` / `framework-entrypoint` labels derivable from
  path conventions; an injectable `caveatLabeler` carries evidence a path cannot
  show (dynamic-import-only, reflection). The `public API`, `test-only`,
  `dynamic-use`, and `framework-entry` trap families are exactly the task-40b
  corpus families.
- `scripts/drift-ai/sibling-naming.test.ts` covers tokenization, marker
  classification (incl. the configurable seed set and bare-number/`version2`
  rejections), each relation/position, the non-marker and all-marker-base guards,
  benign API vocabulary still surfacing with the standing caveat, path caveats,
  deterministic ordering, and corpus calibration: a `-legacy` variant beside each
  true-trap fixture preserves the injected `true-trap:` label (it can never read as
  "delete the dead sibling"), and a barrel trap keeps both its path-convention and
  injected trap caveats.

Validation:

- `FORCE_VERIFY=1 bun run test -- scripts/drift-ai/sibling-naming.test.ts` (20 passed)
- `bun run verify:changed`

Follow-up for task 47: bucket by directory like ghost-files before calling
`findSiblingVariantPairs` (the library stays O(n^2) and caller-bounded), render the
evidence through the task-39 prototype advisory contract, and keep the standing
caveat and risky-context labels on every row.
