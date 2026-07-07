# 22. Zero-baseline audit re-resolves normal ESLint config per file per ratchet — memoize per path

Status: Done — implemented on 2026-07-04 with per-run normal ESLint `isPathIgnored` and `calculateConfigForFile` memoization.
Lens: ratchet · Area: zero-baseline lifecycle · Severity: low-med · Size: S-M · Confidence: high
Theme: performance · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
`lint:ratchet:zero-baseline` (runs in every pre-commit) expands each
zero-finding ratchet's globs and calls `isPathIgnored` +
`calculateConfigForFile` per matched file, with no per-path memoization
across ratchets. Zero ratchets are the *success* state of the lifecycle, so
this cost grows precisely as the ratchet program succeeds; overlapping
scopes (e.g. multiple strict-boolean ratchets over the same package) pay the
resolution repeatedly.

## Evidence
- `scripts/lint-ratchet/lint-ratchet-zero-baseline.ts:152-159,261-300` — per-file resolution inside the per-ratchet loop; no cross-ratchet Map. Verified 2026-07-04.

## Proposed direction
One `Map<path, resolvedConfig>` (and one for `isPathIgnored`) per run, shared
across ratchets; the per-(rule,options) classification then reads from the
memo. Measure before/after on the current registry (14 entries) and note the
result in the commit body — if today's cost is already trivial, land the memo
anyway as O(1) insurance and close the leaf with the measurement.

## Scope / caveats
- Same ESLint instance must be reused for the memo to be coherent; check the
  current instantiation pattern first.
- One commit: memo + measurement.

## Implementation notes
- `createNormalLintStatusForFile` now owns one per-run cache for
  `isPathIgnored(path)` and one for `calculateConfigForFile(path)`, while still
  applying each ratchet's rule id/options after reading the cached config.
- The zero-baseline CLI path and retire-promotion proof both create one ESLint
  instance and one memoizing resolver for their run.
- Focused coverage:
  `bun run test -- scripts/lint-ratchet/lint-ratchet-zero-baseline.test.ts`
  includes overlapping-ratchet coverage proving each path is resolved once.
- Measurement after the memo on the current 7 zero-baseline ratchets:
  `bun run lint:ratchet:zero-baseline` was 2.39s wall / 3.37 CPU. The measured
  benefit is noise-level today; the memo lands as O(1) insurance as the
  zero-baseline registry grows.
