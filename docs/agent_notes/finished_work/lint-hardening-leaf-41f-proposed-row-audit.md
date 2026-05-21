# Leaf 41f: Proposed Row Audit

Date: 2026-05-21

## Summary

Audited every remaining lint coverage map row whose status contained
`proposed`, `ratcheted + proposed`, or `pending-leaf` so stale proposal markers
do not keep reading as broad-shallow blockers.

Total rows audited: 25.

Bucket counts:

- B, broad-shallow still needed: 4.
- D, deeper than broad-shallow: 21.
- X, intentionally deferred/excluded: 0.

No `pending-leaf` rows remain in the current map.

## Broad-Shallow Verdict

Broad-shallow is not complete yet. The exact remaining blockers are:

- `scripts/code-intel.test.ts` — needs script-test bug-class ratchets:
  `vitest/expect-expect`, `vitest/valid-expect`,
  `@typescript-eslint/no-misused-promises`, and
  `@typescript-eslint/only-throw-error`.
- `scripts/lint-ratchet-baseline.test.ts` — same script-test bug-class floor.
- `scripts/lint-coverage-map-check.test.ts` — same script-test bug-class floor.
- `scripts/lint-coverage-map-check.ts` — needs a singleton `local/max-lines`
  source floor.

## Notable Promotions

The drift-ai production/report/inventory rows moved from `ratcheted + proposed`
to `ratcheted` because drift-ai production now has max-lines and
complexity-severity floors, and the drift-ai tests have the bug-class ratchets
from Leaf 41. The remaining `simple-import-sort`, `regexp/*`,
explicit-return-type, `restrict-template-expressions`, and related rules are
deeper follow-up work.

The codemod production rows moved to `ratcheted` because codemods now have
max-lines and complexity-severity floors. `max-params` remains a valid deeper
follow-up, but not a broad-shallow blocker.

The singleton production/runtime rows with max-lines or complexity coverage
also moved to `ratcheted`. `consistent-type-imports`, strict-tier normal-lint
adoption, import-sort, and similar rules remain adoption/drain work unless a
future inventory promotes a specific bug-class risk.

## Source

This audit was prompted by review feedback from another agent during the
Leaf 41 follow-up cycle: prevent `proposed` from becoming stale noise, and make
NEXT.md state either that broad-shallow is complete enough or name the exact
remaining rows that still need floors before drains begin.
