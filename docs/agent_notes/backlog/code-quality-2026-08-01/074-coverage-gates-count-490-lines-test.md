# 74. Coverage gates count 490 lines of test scaffolding as production code

Status: Landed on fix/cq-074
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

## Disposition

Landed, with the mechanism corrected against the live tree. The audit's
conclusion held — scaffolding was in the denominator — but its located cause did
not: in projects mode Vitest resolves coverage from the root config alone
(`this.config.coverage` in the runner), so the per-project `coverage`
include/exclude blocks the leaf's steps 1-3 name are inert for
`bun run test:coverage` and apply only to standalone
`vitest --config packages/<pkg>/vitest.config.ts` runs. A micro coverage run
proved it both ways: on the old configs a single `scripts/drift-ai` test
reported `git-runner.test-helper.ts` and `tmp-repo.test-helper.ts` despite
neither matching the scripts project's coverage `include`.

The working exclude therefore lives in root `vitest.config.ts`. Review round 1
corrected it twice more (fixed in 9152fa995 and 106ac576b).

First, all three `## Scope / caveats` carve-outs rested on the per-project
blocks working — the same premise this Disposition disproves. Two were reopened
in round 1 (`packages/server/src/test/**`, "already excludes `src/test/**`", and
`packages/client/src/test/**`); round 2 reopened the third,
`tools/lint-ratchet/vitest.config.ts` ("its helpers live under `test/`, outside
the `src/**` include"). With no root `coverage.include` that last phrase governs
nothing: every module a run loads is in the global denominator unless a root
exclude pattern hits it. Two modules survived by that route.
`tools/lint-ratchet/test/boundary/check-package-boundary.ts` was 151 executable
lines at 148 covered — larger than any module in the audit's own 490-line
inventory, and exercised by its own dedicated suite — beside the smaller
`tools/lint-ratchet/test/fixture-workflow-vocabulary.ts`. Once the mechanism was
corrected the carve-outs lost their basis, so covering them from the root is
this leaf's stated intent (a production-only denominator), not scope creep.

Round 2 then swept for every other non-`packages/*` test-support module the
patterns could still miss, since a fourth or fifth spelling is what reopens
rounds. `eslint-rules` has three — `rule-tester.js`, `repo-config-harness.js`,
and `eslint-config-resolution-timeout.js` — each imported only by `*.test.js`
suites in that directory. They carry production-looking filenames with no
convention to glob, so they are named by literal path rather than by pattern.
`tools/harness-diagnostics` and `scripts/test-support` need nothing: the first
has no scaffolding at all, the second's only helper already matches
`*.test-helper.*`. After the sweep the coverage report contains no test-support
module.

The exclude now reads `["**/*.test-helper.*", "**/*-test-helper.*",
"packages/*/src/test/**", "tools/lint-ratchet/test/**",
"eslint-rules/rule-tester.js", "eslint-rules/repo-config-harness.js",
"eslint-rules/eslint-config-resolution-timeout.js"]`: the repo spells
scaffolding with both a `.` and a `-` before `test-helper`, and neither spelling
can be dropped. Repo-wide the dot form is ahead, 15 to 12 (dot: client 3,
scripts 10, tools/lint-ratchet 2). Under `packages/**` the split reverses to 12
hyphen against 3 dot — 11 modules in `packages/server/src/test/` plus
`packages/server/src/services/level-up/level-up-test-helper.ts`, none of which
the original `*.test-helper.*` glob matched.

99 scaffolding modules are now out, against 16 before. Both figures apply one
rule — tracked `.ts`/`.tsx` files that are not themselves
`*.test.ts`/`*.test.tsx` — to the 96 files the naming conventions reach, plus
the three `eslint-rules` modules named by path. The earlier "17" mixed rules,
reaching that number only by also counting the `parse-helpers.test.ts` meta-test
under `packages/shared/src/test/`, which this rule excludes.

Second, `coverage.exclude` alone was not enough. `@musi/shared/test/*.js`
resolves through the package's `dist/` build, so a client suite importing
`parse-helpers.js` records coverage against `packages/shared/dist/test/` and
only the source map turns that back into a `src/test/` path — after the
exclude has already been applied. `excludeAfterRemap: true` re-applies the
list to the remapped source paths and closes that route. A single client test
file reproduces it: without the flag `packages/shared/src/test/parse-helpers.ts`
is reported; with it, no scaffolding is.

An earlier version of this Disposition said the exclude spreads
`coverageConfigDefaults.exclude` because "the key replaces rather than merges
them, and they are what keeps test files and dist output out". That is false on
the installed Vitest 4.1.7, where `coverageConfigDefaults.exclude` is `[]`
(`node_modules/vitest/dist/chunks/defaults.9aQKnqFk.js`). Vitest 4 instead
appends a hard-coded, explicitly non-overridable list (setup files, the test
`include` globs, config files, `**/virtual:*`, `**/__x00__*`,
`**/node_modules/**`) after the user list
(`dist/chunks/coverage.DM_a_rWm.js`). Nothing keeps `dist/` out. The spread
contributed no patterns and has been deleted along with the smoke assertion
that filtered the empty array against the root exclude — a subset check over
`[]` that could never fail. Steps 1-3 were still applied so the standalone path
agrees, and the root comment records that they are not the load-bearing copy.

The audit's "490 physical lines" is stale twice over. Physical lines are not
the denominator: v8 counts executable lines. And the scaffolding set is far
larger than the nine modules the audit listed — 99 modules, once both
`test-helper` spellings, every package's `src/test/`, `tools/lint-ratchet/test/`
and the three named `eslint-rules` helpers are counted.

Re-baselined from a full `bun run test:coverage` (2026-08-30, 1343 files
reported after the round-2 sweep). The "before" column is the pre-change
measurement recorded by this lane's first baseline run; the "after" column is
the round-2 re-measurement and supersedes both the narrower figures this
Disposition first carried and the round-1 ones.

| area | lines | statements | functions | branches |
| --- | --- | --- | --- | --- |
| shared | 99.85 -> 99.85 | 99.70 -> 99.70 | 91.79 -> 91.91 | 98.44 -> 98.55 |
| server | 93.87 -> 94.90 | 92.96 -> 94.09 | 94.32 -> 95.25 | 86.58 -> 87.71 |
| client | 88.43 -> 88.42 | 86.77 -> 86.76 | 82.01 -> 82.51 | 81.88 -> 82.22 |
| scripts | 90.91 -> 90.85 | 88.49 -> 88.45 | 94.20 -> 94.14 | 80.37 -> 80.43 |
| global | 89.99 -> 89.99 | 88.09 -> 88.08 | 89.72 -> 90.01 | 79.75 -> 79.81 |

No group dropped below its floor. Server rises about 1pp because its `src/test/`
fixtures and DB helpers were themselves poorly covered, and client
functions/branches rise for the same reason; the small scripts and client
line/statement dips are the easily covered helper lines leaving the numerator.
The global figures land a shade under the round-1 ones because round 2 took
another 172 lines out of the denominator, 169 of them already covered. Every
measured figure still stays above its floor, so no threshold number moved —
holding them is the honest outcome here, not inertia. The measured baseline and
its date are recorded in the comment above `thresholds` in `vitest.config.ts`,
which now also names the two areas that sit *below* their floors rather than
claiming all of them clear, and which column of `tools/lint-ratchet/src/**`
actually clears.

Guard: `scripts/tests/test-test-slow.sh` (already the registered smoke for every
Vitest config) enumerates the scaffolding on disk by naming convention
(`*test-helper.ts`/`.tsx`, `packages/*/src/test/`, `tools/lint-ratchet/test/`)
plus the three `eslint-rules` modules by literal path, and asserts the root
`coverage.exclude` covers each one and that `excludeAfterRemap === true`. It
also asserts those three named modules still exist, so a rename fails loudly
rather than silently orphaning an exclude pattern. The enumerator mirrors the
exclude's own conventions, so the regression it actually catches is a pattern
dropped from the root exclude; a scaffolding family that outgrew those
conventions entirely (a `src/testing/` directory, a `*.mock-helper.ts` spelling)
would be invisible to the selector too. An earlier version of this paragraph and
of the guard's own comment claimed it caught that second case as well; both now
say what the guard can see. Round 1
removed the per-project loop it originally carried: it guarded the standalone
`vitest --config packages/<pkg>/vitest.config.ts` route that no script in this
repo runs, and it globbed candidate files with the same patterns it then
checked them against, so it could only fail if a config pattern was deleted —
which the root loop already catches, for the list that decides the real
denominator.

Out of scope, observed and reported to the conductor rather than fixed: the
round-2 baseline run showed `eslint-rules/**` (lines 70.57 vs floor 79,
statements 67.22 vs 74, functions 68.58 vs 74, branches 53.43 vs 69) and
`tools/lint-ratchet/src/**` (lines 87.51 vs 90, statements 85.99 vs 90, branches
78.69 vs 80; its functions figure, 93.50, clears the 90 floor) already below
their floors before this change. `tools/lint-ratchet/src/**` loses nothing to
this leaf's exclude, which only touches its sibling `test/` tree.
`eslint-rules/**` does lose the three named test-support modules — 17 fully
covered lines, worth 0.1-0.7pp of the gap; counting them the group measured
70.84/67.49/69.19/53.52, short on all four columns either way. The shortfall is
pre-existing and wants its own leaf per the cadence guide.
