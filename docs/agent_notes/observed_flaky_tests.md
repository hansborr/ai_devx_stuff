# Observed Flaky Tests

## 3. Server encounter combat spell attack — high-bonus hit assertion

### Problem
`bun run test:changed` failed once during pre-commit on 2026-05-16:
`packages/server/src/routers/encounter-combat-spell.test.ts` >
`encounterCombat.castCombatSpell` > `custom spell attack` >
`reduces target HP on hit`, with `spellResult.hit` unexpectedly `false`.

### Observed Behavior
- The pre-commit run had already passed lint, typecheck, and script checks.
- The focused rerun passed immediately afterward:
  `bun run test:server -- packages/server/src/routers/encounter-combat-spell.test.ts -t "reduces target HP on hit"`.
- Repeated during Leaf 22 pre-commit on 2026-05-16 after the required
  `eslint-rules` Vitest, lint, and typecheck gates passed; the leaf did not
  rerun server Vitest because its verification scope is local ESLint rules.

### Root Cause Hypothesis
Likely a nondeterministic combat roll/test isolation issue under the broad
changed-test run. The test intends `attackBonus: 50` to guarantee a hit.

### Priority
Low unless it repeats. If seen again, inspect the spell attack roll path and
whether any mocked/random state leaks across concurrent server tests.

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
