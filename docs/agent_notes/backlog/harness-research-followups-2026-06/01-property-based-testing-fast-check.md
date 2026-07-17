# PB-1 - Property-based tests for the rules engine (fast-check)

Status: Done (drain-leaf scope) — fast-check infra + `character-rules` (`3c302f89`) and spellcasting/armor-class/dice property suites (`d10d67b9`, 22 tests, drain leaf 5.1) landed. The two lower-priority candidate modules in the table below (`attack-damage.ts`, `xp.ts`) remain uncovered but were outside the seed set leaf 5.1 targeted.

> Done for the seeded scope — the fast-check infrastructure plus the
> `character-rules` (`3c302f89`) and spellcasting/armor-class/dice
> (`d10d67b9`, 22 tests) property suites landed: `fast-check` is a
> `packages/shared` dev dependency and the reusable arbitrary/pattern is
> established. **Remaining (not part of drain leaf 5.1's seed set):** the two
> lower-priority "Candidate Modules" below — weapon/spell attack
> (`attack-damage.ts`) and XP/CR (`xp.ts`) — are still example-test only.
> Re-verify module paths before promotion, as the rules surface moves while
> 5.5E content lands.

## Problem

The harness research (`05-test-suite-architecture.md`) makes two points that
land directly on this repo:

1. Example-based tests written by an agent tend to cover the happy path and the
   one or two edge cases the author thought of. Property-based tests
   (invariants over *generated* inputs) catch the boundary cases nobody
   enumerated.
2. A high line-coverage suite can still assert almost nothing. Properties force
   you to state what must always be true, which is a stronger assertion than a
   single hardcoded expectation.

Musi has an unusually good fit for this: the D&D 5.5E rules engine is a large
body of **pure, deterministic functions** with well-defined mathematical
invariants. When this finding was written there was **zero** property-based
testing anywhere; since then the reference pattern landed (`fast-check` is now
in `packages/shared/package.json` and `character-rules` has a property suite —
see the Status note above). The remaining rules modules are still covered only
by example-based Vitest tests colocated beside the code.

## Candidate Modules

All pure (no I/O, no DB); randomness, where present, is injected so it is
testable. Re-confirm before writing tests.

| Module | Path | Example invariants |
| --- | --- | --- |
| Ability/derived stats | `packages/shared/src/rules/character-rules.ts` | `abilityModifier` is monotonic in score; `proficiencyBonus` non-decreasing in level 1-20; `passivePerception = 10 + skillModifier` |
| Spellcasting tables | `packages/shared/src/rules/spellcasting.ts` | slot array always length 9; multiclass caster level never exceeds raw class-level sum; half-caster slots track `ceil(level/2)` |
| Armor class | `packages/shared/src/rules/armor-class.ts` | light armor applies full DEX; medium caps DEX at +2; heavy ignores DEX; shield adds exactly 2 |
| Weapon/spell attack | `packages/shared/src/rules/attack-damage.ts` | attack bonus = ability mod + proficiency (+ enchantment); finesse picks the better of STR/DEX |
| XP / CR | `packages/shared/src/rules/xp.ts` | `crToXp` total; `parseCr`/`formatCr` round-trip |
| Dice | `packages/shared/src/dice/dice-notation.ts`, `dice-roller.ts` | every roll within `[count, count*sides]`; parse→format round-trips; advantage ≥ disadvantage for the same seed |

Best 3-4 to seed the suite: `character-rules.ts`, `spellcasting.ts`,
`armor-class.ts`, and the dice pair — they are the highest-leverage invariants
and the ones an agent is most likely to subtly break while editing adjacent
content.

## Proposed Implementation

1. Add `fast-check` as a dev dependency in the package that owns the tests
   (`packages/shared`). Respect the `bunfig.toml` `minimumReleaseAge` cooldown.
2. Co-locate property tests with the code, matching the existing convention
   (e.g. `character-rules.property.test.ts` beside `character-rules.test.ts`),
   so `test-file-location` and changed-file test selection still work. Keep the
   example-based tests — properties complement, not replace, them.
3. Start with one module end-to-end as the reference pattern (suggest
   `character-rules.ts`): a small set of `fc.assert(fc.property(...))` cases
   with explicit arbitraries bounded to legal D&D ranges (scores 1-30, levels
   1-20). Document the arbitraries so later modules reuse them.
4. Prefer deriving arbitraries from the existing Zod schemas where a generated
   value must be a valid domain object, so the contract stays single-sourced.
5. Expand module-by-module. Treat any property failure as a real finding: it is
   either a bug or an under-specified invariant — fix the code or tighten the
   property, do not loosen the bound to make it pass.

## TDD / Verification

- For a known-good module, a new property should pass immediately; if it fails,
  that is the red state and points at a real edge case.
- When adding a property exposes a bug, write the minimal failing example
  (fast-check's shrinker gives it to you) as a regression case in the
  example-based test, then fix the code.
- Run `bun run test -- <file>` while iterating; stage and run
  `bun run verify:changed` before commit. Pin a seed in CI only if flake
  appears (property tests should be deterministic given a seed).

## Acceptance Criteria

- `fast-check` is a dev dependency and at least one rules module has a committed
  property test suite establishing the reusable arbitrary/pattern.
- Properties are bounded to legal domain ranges and assert invariants, not
  single values.
- Existing example-based tests remain; `bun run verify:changed` is green.

## Risks

- Over-broad arbitraries produce inputs the function was never meant to handle,
  yielding noise. Bound them to legal ranges and derive from schemas.
- Property runtime can grow; keep `numRuns` modest for the per-commit tier and
  reserve any heavy fuzzing for the slow lane if it ever justifies one.
- A flaky property (unseeded randomness leaking in) erodes trust fast — keep the
  functions pure and inject any RNG.
