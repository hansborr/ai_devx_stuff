# Observed Flaky Tests

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

### Problem
`bun run test:scripts:changed` failed once during pre-commit on 2026-05-03:
`FAIL: summary should show fresh verify --changed wrapper marker age`.

### Observed Behavior
- The pre-commit run had already passed lint, typecheck, and Vitest.
- `bash scripts/test-verify-logs.sh` passed immediately afterward in isolation.
- `bun run test:scripts:changed` then passed with the same changed file set.
- A retry of the same commit passed.

### Files
- `scripts/test-verify-logs.sh`
- `scripts/verify-logs.sh`

### Root Cause Hypothesis
Likely a timing-sensitive assertion around wrapper marker freshness in the
script smoke sandbox. The test expects a fresh marker age string; under the
pre-commit run timing, the marker may have aged across a display threshold.

### Priority
Low unless it repeats. If seen again, make the assertion compare state/path
semantics instead of an exact freshness string.
