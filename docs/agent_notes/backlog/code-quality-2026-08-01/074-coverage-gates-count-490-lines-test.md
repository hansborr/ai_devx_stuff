# 74. Coverage gates count 490 lines of test scaffolding as production code

Status: Not started
Theme: coverage denominator integrity · Area: tests · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The root vitest config advertises per-area coverage floors, but in three of the
projects the include/exclude globs let test-support modules — assertion
helpers, fixture runners, and UI test harnesses — into the covered set. Nine
such modules totaling 490 physical lines (shared 53, client 126, scripts 311)
sit in both the denominator and an easily exercised numerator: helper lines are
executed by the very suites that import them, so coverage can rise or hold
steady without any additional production behavior being covered. That makes the
advertised thresholds hard to interpret for anyone tuning them or copying this
harness. The repo also disagrees with itself: `stryker.config.mjs` already
classifies `packages/shared/src/test/` as test-only scaffolding with no
behavior worth mutating, and the server project already excludes `src/test/**`
from coverage — the shared, client, and scripts coverage configs just never got
the same treatment.

## Evidence

- `vitest.config.ts:43-83` — root per-area coverage thresholds presented as
  floors for `packages/shared/src/**`, `packages/client/src/**`, `scripts/**`,
  and the other project globs.
- `packages/shared/vitest.config.ts:18-19` — coverage includes `src/**/*.ts`
  and excludes only `src/**/*.test.ts`, so `src/test/parse-helpers.ts`
  (53 lines) counts as product code.
- `packages/client/vitest.config.ts:26-27` — coverage excludes `src/test/**`
  but not colocated `*.test-helper.*` files; three slip through (126 lines):
  `src/hooks/canvas-input/use-canvas-input.test-helper.ts` (63),
  `src/components/campaign/combat/initiative-tracker.test-helper.tsx` (43),
  `src/hooks/character-sheet/use-character-stats.test-helper.tsx` (20).
- `scripts/vitest.config.ts:21-37` — covered script families exclude
  `**/*.test.ts` and fixture directories but not `*.test-helper.ts`; five slip
  through (311 lines): `codemods/lib/fixture-runner.test-helper.ts` (166),
  `drift-ai/git-log-fixture.test-helper.ts` (83),
  `drift-ai/git-runner.test-helper.ts` (39),
  `drift-ai/matcher.test-helper.ts` (9),
  `lint-ratchet/lint-ratchet.test-helper.ts` (14).
- Re-derived total by statically applying the pinned globs: 9 modules,
  53 + 126 + 311 = 490 lines.
- `stryker.config.mjs:20-21` — `!packages/shared/src/test/**` with the comment
  "Test-only scaffolding under src/test/ has no behavior worth mutating"; the
  mutation config classifies exactly what the shared coverage config counts.
- `packages/server/vitest.config.ts:37` — the server project already excludes
  `src/test/**` from coverage, so the fix is applying an existing in-repo
  convention, not inventing one.

## Proposed direction

Add `*.test-helper.*` and `packages/shared/src/test` to the coverage excludes
in the root, shared, client, and scripts vitest configs (matching stryker's
scaffolding classification), then re-baseline the thresholds from a
production-only coverage run. Mechanics, one config-only commit:

1. `packages/shared/vitest.config.ts:19` — extend the coverage exclude with
   `src/test/**` (mirroring `packages/server/vitest.config.ts:37`) and
   `src/**/*.test-helper.*` for future-proofing.
2. `packages/client/vitest.config.ts:27` — add `src/**/*.test-helper.*`.
3. `scripts/vitest.config.ts:31-37` — add `**/*.test-helper.ts`.
4. Root `vitest.config.ts:39-85` — add a matching `coverage.exclude` (e.g.
   `**/*.test-helper.*`, `packages/shared/src/test/**`) so the root coverage
   block agrees with the projects rather than silently depending on them.
5. Run `bun run test:coverage` on the result and adjust the threshold numbers
   at `vitest.config.ts:43-83` to the new production-only baseline. Expect the
   shared, client, and scripts figures to drop slightly — easily covered
   helper lines leave the numerator; record the honest numbers rather than
   holding the old ones.

## Scope / caveats

- Config-only: no source, test, or helper files change, and no test starts or
  stops running — only what coverage counts.
- Out of scope: `packages/server/vitest.config.ts` (already excludes
  `src/test/**`; no `*.test-helper.*` files under `src/`),
  `tools/lint-ratchet/vitest.config.ts` (its helpers live under `test/`,
  outside the `src/**` include), and `eslint-rules` (no coverage-included
  helpers). Verify with a `find`/`rg` sweep for `*.test-helper.*` before
  landing in case new helpers appeared.
- Threshold re-baselining is part of the change, not optional follow-up:
  excluding files without re-deriving the floors leaves thresholds calibrated
  against the padded denominator.
- Keep the vitest excludes and stryker's `!packages/shared/src/test/**`
  (`stryker.config.mjs:20-21`) agreeing; this leaf aligns coverage to the
  mutation config's classification, not the other way around.
- No prior-pack overlap: the 2026-07-25 pack's coverage rulings concern
  project routing and behavioral coverage, not denominator contamination.
