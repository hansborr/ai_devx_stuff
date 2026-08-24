# 169. Suppression allowlists preserve stale grants instead of ratcheting downward

Status: Landed on fix/cq-169
Theme: downward suppression ratchet · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The suppression registers reject live directives that lack permission, but they
never perform the reverse check: whether every permission still corresponds to
a live directive. Retiring a suppression therefore leaves a dormant grant that
can later authorize its reintroduction without a new policy decision.

This has already happened to the `@ts-nocheck` inventory. Both permitted files
still exist, but neither contains a real directive; the two rows now describe
standing permission rather than current debt.

## Evidence

- `scripts/data/eslint-disable-broad-allowlist.txt:3-13` contains 11 active
  `path glob|rule` permissions.
- `scripts/eslint-disable-register.sh:220-231` returns success when an observed
  path/rule matches any row, but neither records the matched row nor inspects
  unused rows after scanning.
- Re-derived at the pin, all 11 ESLint permission rows have at least one live
  matching broad directive; representative matches include
  `packages/shared/src/rules/xp.ts:19`,
  `packages/server/src/seed/generate-subclasses.ts:2`, and
  `packages/server/src/utils/__type-tests__/encounter-restrictions.ts:6`.
- `scripts/data/ts-nocheck-allowlist.txt:3-4` grants permission to
  `scripts/drift-ai/suppressions.ts` and its test.
- `scripts/suppression-register.sh:229-237` likewise checks only whether an
  observed directive matches a permitted path.
- Re-derived at the pin, neither permitted file contains a real
  `@ts-nocheck`; the occurrences at
  `scripts/drift-ai/suppressions.test.ts:179-193` are fixture strings describing
  a diff, so 0 of the 2 permission rows are live.

## Proposed direction

In full-scan mode, make both suppression registers record which allowlist rows
matched at least one live directive and fail on unmatched rows. Changed-file
scans must not infer repository-wide absence. Preserve the existing independent
source scanners and the current path-glob and `path glob|rule` data formats,
then delete the two stale rows from
`scripts/data/ts-nocheck-allowlist.txt`.

Use the existing `SCAN_SCOPE` distinction
(`scripts/eslint-disable-register.sh:86-125` and
`scripts/suppression-register.sh:88-127`) as the gate for the reverse check.
Extend `scripts/tests/test-eslint-disable-register.sh` and
`scripts/tests/test-suppression-register.sh` with full-scan stale-row failures,
live-row successes, and changed-scope cases that prove unmatched global rows
are ignored. Their temporary repositories should own narrowly seeded
allowlists so unrelated production rows do not make focused fixtures stale.

## Scope / caveats

Do not merge the Bash scanners with the TypeScript suppression ledger or change
what counts as a directive. This leaf adds expiry to the existing permission
inventories; broader scanner/ledger architecture remains separate.

The reverse check is binding only when `SCAN_SCOPE=full`. A changed-file scan
cannot prove that an unmatched permission has no live directive elsewhere.

The completed 2026-07-25 work in
[65-vacuous-scanning-guards.md](../code-quality-2026-07-25/65-vacuous-scanning-guards.md)
establishes that discovery-based checks must not pass over an empty or vanished
subject. This leaf applies that principle to unused permission rows without
reopening that work.
