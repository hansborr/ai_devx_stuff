# 65. Fifteen server service suites re-wipe a database the global test lifecycle already cleans before every test

Status: Landed on fix/cq-065
Theme: test lifecycle ownership · Area: tests · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The server test project has exactly one owner of database isolation: the
Vitest-wired `packages/server/src/test/setup.ts`, whose global `beforeEach`
calls `cleanDb()` before **every** test in every suite. The contract is even
written down — `clean-db.ts`'s `CleanDatabaseOption` doc says the global hook
"already cleans before every test", so per-test helpers should skip the
redundant second clean, and the router suites obey it by passing
`cleanDatabase: false` to their `setupXTestContext` helpers.

Fifteen service suites ignore the contract. Each adds its own pre-test
`cleanDb()` — a suite `beforeEach`, a `setup()` helper that opens with a clean,
or a trailing `afterEach`/`afterAll` whose work the next test's global clean
redoes anyway. Those files contain 119 test declarations, so a service-suite
run performs roughly 119 redundant `cleanDb` executions at 22 `deleteMany`
statements each — on the order of 2,600 unnecessary deletes — purely as
duplicate lifecycle work that adds zero isolation.

The runtime tax is seconds, but the structural cost is worse: a contributor
reading these suites cannot tell which lifecycle owns isolation, so the local
hooks get cargo-culted into each new suite, and the handful of `cleanDb` calls
that ARE load-bearing (mid-test phase resets inside multi-phase tests) are
indistinguishable from the noise. The general pattern worth copying is the
opposite: a global lifecycle that owns isolation, a documented "don't
re-clean" contract beside the helper, and annotated exceptions only where a
single test needs a mid-test reset.

## Evidence

- `packages/server/src/test/setup.ts:44-53` — the global `beforeEach` calls
  `cleanDb()` before every server test in every suite; the comment above it
  spells out the ordering (global hook fires before any suite hook).
- `packages/server/src/test/clean-db.ts:8-14` — `CleanDatabaseOption`'s doc:
  "The global `setup.ts` `beforeEach` already cleans before every test, so
  callers invoked from a per-test `beforeEach` pass `false` to skip the
  redundant second clean." The contract exists; the service suites just don't
  follow it.
- `packages/server/src/test/clean-db.ts:51-82` — `cleanupDeletes()` returns
  exactly 22 `deleteMany` operations per invocation (counted at the pin).
- 26 static `await cleanDb()` sites across 15 test files under
  `packages/server/src/services`, by
  `grep -rn 'await cleanDb()' packages/server/src/services --include='*.test.ts'`
  (re-counted at the pin). Those 15 files contain exactly 119 test
  declarations, so the baseline redundant hook executions per run is ~119 —
  mid-test, loop, and `afterEach` cleans push actual invocations higher.
- Hook-position openers (redundant): `character-create.test.ts:25`,
  `level-up/level-up.test.ts:14`, `notification-service.test.ts:15`,
  `presence-multi-tab.test.ts:84` (file-level `beforeEach`),
  `invite-service.test.ts:64` and `:206`, `weapon-mastery-service.test.ts:65`,
  `starting-equipment-service.test.ts:12`, `character-create-spells.test.ts:63`,
  `character-create-transaction.test.ts:44`,
  `homebrew-import-service.test.ts:73`, `level-up/level-up-asi-feats.test.ts:15`,
  `level-up/level-up-subclass.test.ts:15`,
  `level-up/level-up-multiclass-sorcerer.test.ts:13` and `:53`,
  `level-up/level-up-concurrency.test.ts:20` and `:68` (all verified
  `beforeEach` position at the pin).
- `packages/server/src/services/inventory-service.test.ts:100` — the leading
  `await cleanDb()` inside the `setup()` helper, which is invoked only from
  `beforeEach` hooks (`:117`, `:226`); trailing `afterEach` cleans at `:120`
  and `:229` whose work the next test's global clean redoes.
- `packages/server/src/services/homebrew-import-service.test.ts:79` — trailing
  `afterAll` clean, same redundancy.
- The intentional exceptions, easily mistaken for the redundant kind:
  `invite-service.test.ts:91`, `:97`, `:111`, `:275` are mid-test phase resets
  between error-path phases of a single multi-phase test, and
  `level-up/level-up-concurrency.test.ts:75` is a per-iteration reset inside a
  loop. The global `beforeEach` only cleans at test start, so these carry real
  isolation.
- The correctly-behaving contrast: router suites pass `cleanDatabase: false`
  to the context helpers per the contract — e.g.
  `packages/server/src/routers/encounter.test.ts:25`,
  `packages/server/src/routers/homebrew-collection.test.ts:25`.

## Proposed direction

Delete every `cleanDb` call that runs in hook position at test start across
the 15 service test files, keep the five intentional mid-test resets, and
annotate the keepers so they are never re-classified as redundant:

1. **Delete the hook-position openers** — every suite `beforeEach` clean
   listed in Evidence, plus the leading `await cleanDb()` inside
   `inventory-service.test.ts`'s `setup()` helper (`:100` — it is only invoked
   from `beforeEach` hooks). The global `setup.ts` `beforeEach` (`:50-53`)
   already guarantees a clean DB before any suite hook fires, per the contract
   at `clean-db.ts:8-14`. In `character-create-transaction.test.ts:43-44`,
   remove only the `cleanDb()` line — `removeInventoryFailureTrigger()` stays
   in the `beforeEach` (cleanDb deletes rows only; the DB trigger is non-row
   state).
2. **Delete the trailing cleans** whose work the next test's global clean
   redoes: `inventory-service.test.ts` `afterEach` at `:120` and `:229`,
   `homebrew-import-service.test.ts` `afterAll` at `:79`. Drop each
   then-unused `clean-db.js` import (most of the 15 files will lose it;
   `invite-service.test.ts` and `level-up-concurrency.test.ts` keep theirs).
3. **Keep the intentional mid-test phase resets** — `invite-service.test.ts`
   `:91`/`:97`/`:111`/`:275` and `level-up-concurrency.test.ts:75` — and
   annotate each retained call with a one-line comment such as "mid-test phase
   reset; the global beforeEach only cleans at test start", mirroring the
   sharp-edge doc idiom already used in `clean-db.ts`. Decide each keep by
   reading the surrounding test body, not by pattern-matching hook names.
4. **Verify**: run the 15 files (`bun run test -- <file>`), then grep to
   assert no hook-position `await cleanDb()` remains under
   `packages/server/src/services` test files
   (`grep -rn 'await cleanDb()' packages/server/src/services --include='*.test.ts'`
   should return only the five annotated keepers). Run the full suite once
   (`bun run test`) before landing, per the flake risk below.

Do not touch `setup.ts` or `clean-db.ts` behavior, and do not change the
`setupXTestContext` suites — they already pass `cleanDatabase: false`
correctly, and the `CleanDatabaseOption` plumbing in `clean-db.ts` stays
as-is.

## Scope / caveats

- **Out of scope:** `cleanDb` usage outside `packages/server/src/services`
  (routers, utils); any behavior change to `setup.ts` or `clean-db.ts`; the
  `setupXTestContext` helper surface.
- **Main regression risk is misclassification**: treating an intentional
  mid-test reset as a redundant hook clean leaks rows between phases of a
  multi-phase test. The keep-list above was verified per call site at the pin;
  re-read the surrounding test body for any site this leaf did not enumerate.
- **Trailing-clean removal changes only post-last-test residue** in an
  ephemeral per-worker DB — but if any latent cross-file order dependence
  exists, it would surface as new flake attributed to this change. Run the
  full server suite once before landing, not just the 15 files.
- `cleanDb` only deletes rows, so non-row state is unaffected: the DB failure
  trigger managed by `character-create-transaction.test.ts` must keep its
  `removeInventoryFailureTrigger()` call in `beforeEach`.
- **Metric framing**: 119 is the count of test declarations across the 15
  files — i.e. redundant hook *executions* per run, each doing 22 `deleteMany`
  ops — not the count of static call sites, which is 26. Explicit in-test,
  loop, and `afterEach` cleanups make total runtime invocations higher than
  the 119 baseline.
- **Prior pack**: the 2026-07-25 pack's
  [39-server-test-lifecycle.md](../code-quality-2026-07-25/39-server-test-lifecycle.md)
  covered app-lifecycle preambles, helper signatures, and re-rolled fixtures
  in `packages/server/src/test/` — not redundant global-versus-local database
  cleaning. No overlap; nothing there rules this out.
- Cross-reference:
  [004-character-creation-large-pseudo-module-loose.md](./004-character-creation-large-pseudo-module-loose.md)
  moves the character-creation suites named here. No hard ordering, but do not
  work the leaves concurrently: if 004 lands first, remove the redundant cleans
  at the post-move suite paths; if 065 lands first, 004 must move the cleaned
  suites without reintroducing the deleted hooks or imports.

## Disposition

Landed as written; all 26 `await cleanDb()` sites re-resolved at the audited
lines. Twenty-one calls were deleted: the suite-`beforeEach` openers in
fourteen files (including `presence-multi-tab.test.ts`'s file-level hook and
both `describe` blocks in `invite-service.test.ts`,
`level-up-multiclass-sorcerer.test.ts`, and `level-up-concurrency.test.ts`),
the leading clean inside `inventory-service.test.ts`'s `setup()` helper, its
two `afterEach` trailers, and `homebrew-import-service.test.ts`'s `afterAll`.
Emptied hooks and now-unused `clean-db.js`/hook imports were removed.
`removeInventoryFailureTrigger()` stays in
`character-create-transaction.test.ts`'s `beforeEach`, and
`level-up-subclass.test.ts`'s SRD-row `afterEach` (not a `cleanDb` call) is
untouched. The five mid-test resets — `invite-service.test.ts` ×4 and the
per-iteration reset in `level-up-concurrency.test.ts`'s race loop — are kept,
each annotated with what its reset actually buys that the global `beforeEach`
cannot. The four invite resets are load-bearing: `setupInvite()` re-seeds
users at fixed emails between phases of a single test. The race-loop reset is
not required by any assertion in the loop (each iteration seeds its own
`asi-race-${i}` email and every read is keyed by that iteration's
`characterId`); its comment says so and names what it does buy — bounding row
accumulation so every iteration races against the same DB state a fresh test
would see. The 15 files run green focused (119 tests); the leaf's "run the
full suite once" step is covered by `land.sh`'s full verify rather than a
lane-side run.
