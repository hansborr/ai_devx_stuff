# 29. saving-throw "half damage (floored)" test uses an even total — the floor() is never actually exercised

Status: Proposed — read-only finding from the test-suite audit; NOT implemented. Re-verify file:line before acting.
Lens: defect-catching · Area: shared · Severity: low · Size: XS · Confidence: high
Theme: rules-rounding-mutation-gap · Source: Musi test-suite audit 2026-06-13 (multi-agent, adversarially verified)

## Problem
`resolveSavingThrow` halves damage on a successful save with `Math.floor(fullDamage / HALF_DIVISOR)` (`saving-throw.ts:66`, `HALF_DIVISOR = 2` at `:12`). The 5.5e rule it encodes is "round down" — a save-for-half spell whose dice sum to an odd number must drop the half. That flooring is the one piece of arithmetic in this function that a round-up or round-to-nearest mutant would change, and it is exactly the piece no test pins.

The dedicated `"deals half damage (floored)"` test scripts eight dice of `3` (total `24`) and asserts `12`. But `24` is even, so `floor(24/2)`, `round(24/2)`, and `ceil(24/2)` are all `12`. A mutant that swaps `Math.floor` for `Math.round` or `Math.ceil` survives untouched — the test name promises to protect flooring, yet the assertion cannot distinguish it. The only other half-damage path in this file (the description test at `:173-187`) uses an even total too (`8×4 = 32 → 16`) and asserts only that the description string contains `"half"`, never the numeric floored value.

The gap is suite-wide, not local to `saving-throw.test.ts`. The server consumers of `resolveSavingThrow` in `resolve-spell.test.ts` assert their save-for-half cases with `toBeGreaterThan(0)` (`:400`, `:418`, `:526`), and the lone exact hardcode in that file (`toBe(14)` at `:212`) is a `mapToSpellAttackResult` attack pass-through, not a flooring case. So nowhere in the codebase does a test feed an odd full-damage total through the saved branch and assert the floored result. The rounding behavior that this function exists to get right is, in effect, untested.

## Evidence
- `packages/shared/src/rules/saving-throw.ts:66` — `totalDamage = saved ? Math.floor(fullDamage / HALF_DIVISOR) : fullDamage;` (`HALF_DIVISOR = 2` at `:12`); this `floor` is the only rounding operation in the function.
- `packages/shared/src/rules/saving-throw.test.ts:62-76` — `"deals half damage (floored)"` scripts `[20, 3, 3, 3, 3, 3, 3, 3, 3]` (save roll 20, then `8×3 = 24` full damage) and asserts `EXPECTED_HALF = 12`; `24` is even, so `floor`/`round`/`ceil` are indistinguishable.
- `packages/shared/src/rules/saving-throw.test.ts:173-187` — the other half-damage case scripts `8×4 = 32 → 16` (also even) and asserts only `description` contains `"half"`, never the floored number.
- `packages/server/src/services/spell-casting/resolve-spell.test.ts:400,418,526` (plus `:328` and `:467`, 5 such sites total) — the server save-for-half assertions use `toBeGreaterThan(0)` (e.g. comment `:417` "Half damage should be > 0"); these are additional save/damage cases, not counterexamples. The one exact `toBe(14)` at `:212` is a non-save attack pass-through.

## Proposed direction
Make the scripted full-damage total **odd** so `floor(total/2)` diverges from `round`/`ceil`, then assert the floored value. The cleanest realization keeps the existing `8×3 = 24` dice and adds an odd `damageBonus` of `1` via `makeInput({ ... damageBonus: 1 })`, giving `fullDamage = 25` and an expected floored half of `12` (`floor(25/2) = 12`, where `round`/`ceil` would yield `13`). This kills the `floor → round` / `floor → ceil` mutant while keeping the same dice and the same expected magnitude already in the file. Optionally retain the current even-total case alongside it as a second `it` so coverage is strictly added, not swapped.

Avoid the candidate's "one die rolling `4` among the `3`s" framing (`3×7 + 4 = 25`): it lands on the same `12` as the existing even case but for a different reason and reads confusingly next to it. An explicit odd `damageBonus` makes the intent — "force an odd full total so flooring is observable" — self-documenting. No source change; this is a one-test-file edit that strengthens existing coverage.

Estimated impact: closes a half-damage rounding mutation gap that bites real play — any save-for-half spell whose dice sum is odd (a common case) relies on this `floor`, and today nothing would catch a regression to round-up. The fix is a few lines in one test, no flakiness, no runtime cost.

## Scope / caveats
Touch only `packages/shared/src/rules/saving-throw.test.ts`; do not modify `saving-throw.ts`, `HALF_DIVISOR`, or any server test. Pure deterministic unit test (fixed RNG), so no flakiness is introduced. Coverage is preserved-or-strengthened by construction: either replace the even total with an odd one (same assertion shape, now load-bearing) or add a sibling `it`, never delete an existing case. This finding is distinct from the saving-throw colocation finding (`docs/agent_notes/backlog/codebase-audit/34-saving-throw-tests-misplaced.md`, already Done — which is why these cases now live in `saving-throw.test.ts` rather than `combat.test.ts`) and from any dice-notation `toThrow` finding (different file and concern). It pairs naturally with, but does not depend on, broader mutation-testing work on the rules layer.
