# Observed Flaky Tests

## 7. Server SRD getAll — subclass count drift in broad changed-test run

Closed 2026-07-03 by `packages/server/src/services/level-up/level-up-subclass.test.ts`,
which now deletes its seeded `subclass-test-spellblade` row in `afterEach`.

### Problem
`bun run test:changed --reporter=dot` failed on 2026-06-22 while landing an
ESLint-rule-only change. The broad server Vitest batch reported:
- `packages/server/src/routers/srd.test.ts:428` expected `subclasses` to have
  length 12, but the `srd.getAll` response had length 13.

### Observed Behavior
- The same broad run had 419 passing test files and only this server assertion
  failure before the client split lanes both passed.
- The focused SRD router suite passed immediately afterward:
  `bun run test -- packages/server/src/routers/srd.test.ts` -> 20 passed.
- The changed source did not touch server code, seed data, Prisma, or SRD
  router behavior.

### Files
- `packages/server/src/routers/srd.test.ts`
- `packages/server/src/services/level-up/level-up-subclass.test.ts`

### Root Cause
`level-up-subclass.test.ts` seeded an SRD-reference `Subclass` row for a
spell-slot case. `cleanDb()` intentionally does not wipe canonical SRD
reference tables, so that extra row could leak into later test files running on
the same worker database; `srd.getAll` then returned 13 subclasses instead of
the seeded 12.

### Resolution
The level-up subclass suite now removes `subclass-test-spellblade` in
`afterEach`, with an inline comment noting that `srd.getAll` locks the seeded
subclass count. If this resurfaces, first check for other tests inserting into
SRD reference tables without matching cleanup.

## 6. Changed-test pre-commit load — ESLint config and client no-isolate timeouts

### Problem
`git commit` pre-commit failed on 2026-06-20 while landing a scripts-only
Vitest mock-cleanup change. The broad `test:changed` run reported:
- `eslint-rules/eslint-config-plugin-declarations.test.js:52` timed out in
  the representative-file ESLint smoke.
- `packages/client/src/lib/trpc.test.ts:10` timed out in `beforeAll` while
  importing the real tRPC module.
- `packages/client/src/pages/character-sheet/sheet-dialogs.test.tsx:51`
  failed to find "Level Up" in the no-isolate client batch.

### Observed Behavior
- The focused changed file test passed:
  `bun run test:scripts:file -- scripts/lint-ratchet/edit-check.test.ts` ->
  15 passed.
- The ESLint config smoke passed immediately in isolation:
  `bun run test -- eslint-rules/eslint-config-plugin-declarations.test.js` ->
  2 passed.
- The two client files passed immediately in isolation:
  `bun run test -- packages/client/src/lib/trpc.test.ts packages/client/src/pages/character-sheet/sheet-dialogs.test.tsx`
  -> 10 passed.
- A retry with `NODE_OPTIONS=--max-old-space-size=8192` made the earlier
  `lint:changed` OOM disappear, but the broad `test:changed` client lane still
  failed under load.

### Files
- `eslint-rules/eslint-config-plugin-declarations.test.js`
- `packages/client/src/lib/trpc.test.ts`
- `packages/client/src/pages/character-sheet/sheet-dialogs.test.tsx`

### Root Cause Hypothesis
The failures are load-sensitive pre-commit symptoms. The ESLint config smoke
already documents that its 30s timeout is a hang guard and can trip under CPU
oversubscription. The client failures occurred only in the large no-isolate
changed-test batch and passed standalone without code changes.

### Priority
Low unless it repeats. If it does, consider raising the ESLint config smoke
timeout again and either isolating or hardening the two client files against
shared no-isolate batch state.

## 5. Server high-iteration concurrency suites — 5s test timeout under parallel load

### Problem
`bun run test:changed` (verify:changed and pre-commit) failed twice on
2026-06-13 while landing ux-audit P0-3, with the same four tests each
hitting their per-test timeout:
- `routers/sorcery-point.test.ts:321` — 100-iteration cross-router
  `spellSlot.use ∥ convertSlotToPoints` race (5s timeout).
- `routers/rest-long.test.ts:407` — 30-iteration concurrent level-up race
  (5s timeout).
- `routers/encounter-combat-concurrency.test.ts:527` — DM clear-condition
  racing `advanceTurn` (5s timeout).
- `eslint-rules/max-lines-policy.test.js` — resolved-cap snapshot (15s
  timeout). On one run `lint:config-sensors`' actionlint also timed out
  (10s) on `ci.yml`.

### Observed Behavior
- Both failing runs were the full parallel step set (test wall ~235-270s,
  "import" phase 334-404s), with 4003 passing and only these timing out.
- Each of the four files passed immediately in isolation:
  `bun run test -- packages/server/src/routers/sorcery-point.test.ts
  packages/server/src/routers/rest-long.test.ts` → 27 passed;
  `... encounter-combat-concurrency.test.ts` → 55 passed (with the P0-3
  files); `bun run test -- eslint-rules/max-lines-policy.test.js` → 4
  passed. The P0-3 change touches no concurrency machinery for these
  tables (it only adds an append-only CombatLog write on the HP path).

### Files
- `packages/server/src/routers/sorcery-point.test.ts`
- `packages/server/src/routers/rest-long.test.ts`
- `packages/server/src/routers/encounter-combat-concurrency.test.ts`
- `eslint-rules/max-lines-policy.test.js`

### Root Cause Hypothesis
The hardcoded 5s/15s per-test timeouts expire when these 30-100-iteration
Promise.all races (and the cap snapshot) are starved of CPU/DB connections
during the parallel pre-commit run, not a product or test-logic regression.

### Priority
Low unless it repeats. If seen again, raise the per-test timeout on the
high-iteration race cases (they sequentially issue N HTTP+DB round trips),
or lower their iteration counts; consider bumping the actionlint
config-sensor timeout above 10s.

## 4. Client monster tab — `waitFor` search-results timeout under load

### Problem
`bun run test:changed` failed once during pre-commit on 2026-06-11:
`monster-tab.test.tsx:77` timed out in `waitFor` waiting for "Goblin" /
"Goblin Boss" search results after typing into the monster search input.

**Recurred 2026-07-07** during a full sequential `bun run verify` (test
slot): `MonsterTab filters results by search text` failed with "Unable to
find an element with the text: Goblin" — the sole failure among 10017
passing tests (709/710 files).

### Observed Behavior
- The pre-commit run was executing the full parallel step set; the suite
  reported 8643 passing tests with only this one failure.
- `bun run vitest run packages/client/src/components/campaign/npcs/monster-tab.test.tsx`
  passed immediately afterward in isolation (1.8s).
- 2026-07-07 recurrence: passed 4/4 consecutive isolated runs immediately
  afterward; the tree under verify contained only scripts/, docs/, and
  shell-hook changes (no `packages/` diff), ruling out a product
  regression.

### Files
- `packages/client/src/components/campaign/npcs/monster-tab.test.tsx`

### Root Cause Hypothesis
Default `waitFor` timeout expiring under parallel pre-commit load (debounced
search + fake query round-trip), not a product or test-logic regression.

### Priority
Has now repeated (2026-06-11, 2026-07-07) — actionable per the original
guidance: raise the `waitFor`/`findBy` timeout on the search-result
assertions or await the debounce explicitly, next time this file (or a
flake-hardening pass) is picked up.

## 3. Server encounter combat spell attack — high-bonus hit assertion

Closed 2026-05-19 in `encounter-combat-spell.test.ts:143` by adding
`{ retry: 3 }` to the `reduces target HP on hit` case.

### Root Cause
The test set `attackBonus: 50` expecting that to guarantee a hit, but 5e rules
treat a natural 1 as a critical miss regardless of bonus
(`packages/shared/src/rules/attack-roll.ts:58`). With the production
`cryptoRng` plumbed through the tRPC + DB path, ~5% of runs roll natural 1 and
the assertion fails. Earlier-cited symptoms (broad changed-test run, "random
state leaks across concurrent tests") were red herrings — the same probability
applies in isolation, but the focused rerun's narrower retry window made it
look like a flake of the broader suite.

### Fix
Vitest `retry: 3` re-runs the test on natural 1, dropping residual flake to
~(0.05)^4 ≈ 1e-5. The other tests in the same file either use modest bonuses
without a hit assertion or assert against save mechanics, so they were not
affected.

### If It Resurfaces
The first thing to check is whether the test still asserts `hit === true`
without rolling a deterministic d20. Either widen retry, inject a deterministic
RNG via a test seam on `castCombatSpell`, or accept `hit || criticalMiss` in
the assertion and skip the HP check on a crit miss.

## 1. E2E campaign-lifecycle / campaign-collab — undefined `context` in `afterAll`

Closed 2026-04-15 in `85d951f6`. Both `e2e/campaign-lifecycle.spec.ts:27` and
`e2e/campaign-collab.spec.ts:91-94` use `await context?.close()` (and the
matching `playerContext?.close()`), so a `beforeAll` throw no longer cascades
into a misleading `Cannot read properties of undefined (reading 'close')` from
`afterAll`. If the underlying `beforeAll` readiness race resurfaces, the
hypothesis to investigate is server/client warmup before `registerAndLogin`,
not the close call.

## 2. Script smoke `test-verify-logs` — wrapper marker age assertion

Closed 2026-07-03 by pinning marker file mtimes in the smoke fixture and
asserting wrapper-marker label/path semantics instead of seconds-formatted age
text.

### Problem
`bun run test:scripts:changed` failed once during pre-commit on 2026-05-03:
`FAIL: summary should show fresh verify --changed wrapper marker age`.

### Observed Behavior
- The pre-commit run had already passed lint, typecheck, and Vitest.
- `bash scripts/test-verify-logs.sh` passed immediately afterward in isolation.
- `bun run test:scripts:changed` then passed with the same changed file set.
- A retry of the same commit passed.

### Files
- `scripts/tests/test-verify-logs.sh`
- `scripts/verify-logs.sh`

### Root Cause Hypothesis
Likely a timing-sensitive assertion around wrapper marker freshness in the
script smoke sandbox. The test expects a fresh marker age string; under the
pre-commit run timing, the marker may have aged across a display threshold.

### Resolution
`scripts/tests/test-verify-logs.sh` now writes explicit mtimes for marker
fixtures with `touch -d`, removes the real sleeps that used to establish
ordering, and checks that the wrapper-marker block names the expected marker
rather than depending on a seconds-only age rendering.
