# 254. Route current inventory through the canonical ignore predicate

Status: Landed on fix/cq-254
Theme: Route current inventory through the canonical ignore predicate · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Drift-ai declares one core predicate for deciding whether a repository path is
ignored, but current-inventory independently repeats its complete decision
sequence. A new ignored segment, prefix, glob, filename, extension, or path
normalization correction can therefore reach the canonical consumers without
reaching current inventory.

That divergence would be silent: current analysis and changed-scope analysis
could inspect different file sets while both appear to honor the same ignore
configuration. Current inventory has one legitimate specialization—explicit
roots ignore their own prefix—but that suffix selection does not require a
second copy of the predicate.

## Evidence

- `scripts/drift-ai/config-match.ts:8-22` — the module identifies
  `isPathIgnored` as the core ignore predicate and applies segment, prefix,
  glob, default-filename, and default-extension policy.
- `scripts/drift-ai/current-inventory.ts:5-10` — current inventory imports the
  canonical predicate's individual helpers and default lists rather than
  importing `isPathIgnored`.
- `scripts/drift-ai/current-inventory.ts:84-90` —
  `isIgnoredCurrentPath` independently repeats the complete canonical
  decision sequence.
- `scripts/drift-ai/current-inventory.ts:130-149` — explicit-root handling
  selects either the complete repository path or the suffix beneath the
  matched root, then sends that value through the copied predicate.
- `scripts/drift-ai/current-inventory.test.ts:134-145` and `:234-239` —
  current inventory has characterization for configured ignore rules and
  default ignored files and extensions.
- `scripts/drift-ai/current-inventory.test.ts:179-215` — focused cases already
  distinguish whole-repository ignore behavior from the rule that an explicit
  ignored root remains eligible while ignored segments nested beneath it are
  dropped.

## Proposed direction

Replace the body of `isIgnoredCurrentPath` with delegation to
`isPathIgnored`, retaining only the local normalization needed by current
inventory. Remove its imports of `pathHasAnySegment`, `pathHasAnyPrefix`,
`matchesAnyGlob`, `DEFAULT_IGNORE_FILES`, and
`DEFAULT_IGNORE_EXTENSIONS`.

Keep explicit-root selection local. `isIgnoredCurrentPathForRoots` should
first choose the value whose ignore policy is being evaluated:

1. Use the full repository-relative path for whole-repository roots.
2. For a matched explicit root other than `.`, compute the existing
   root-relative suffix.
3. Pass that selected path and the unchanged ignore configuration to the
   canonical predicate.

Retain focused tests for the entire canonical rule set through current
inventory, not just configured segments. Keep separate characterization for a
whole-repository scan, an explicit root whose own prefix is ignored, and an
ignored segment nested beneath an explicit root so delegation cannot erase
the suffix exception.

## Scope / caveats

- Preserve the exact explicit-root suffix semantics at
  `scripts/drift-ai/current-inventory.ts:130-149`; only the final ignore
  decision moves behind the canonical predicate.
- Do not broaden, narrow, or reorder the configured or default ignore rules in
  this leaf. Any intentional policy change should be reviewed separately from
  the deduplication.
- [134-analyzer-families-maintain-divergent-source.md](./134-analyzer-families-maintain-divergent-source.md)
  owns shared source-extension and test-location taxonomy. Do not mix ignore
  configuration or ignore matching into that module.
- Keep `config-match.ts` a leaf module without registry or configuration
  loading, preserving the load-order boundary documented at
  `scripts/drift-ai/config-match.ts:8-13`.
- No prior-pack residual applies to this predicate delegation.
