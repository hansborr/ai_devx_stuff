# 45. Character-creation ability rules — point-buy table, standard array, metadata, modifier math, boost aggregation — are re-declared across four wizard surfaces with no type-level link

Status: Not started
Theme: Single source for ability rules · Area: client · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The character-creation wizard touches ability scores on four surfaces — editing
(the ability-scores step and its card component), step validation, the review
step, and the submission projection — and each surface carries its own private
copy of the underlying rules. The exact 5E point-buy cost table and 27-point
budget are written out verbatim twice. The standard array exists in two
different representations: an unsorted display tuple in the card and a
separately hand-sorted comparison array in the validator, with nothing relating
them. The ability order and display names are typed out twice. The score→modifier
formula is implemented twice with different return types (a number in the card, a
pre-formatted `"+N"` string in the review step) even though `packages/shared`
already exports the canonical `abilityModifier`. Background boost aggregation is
implemented twice with different shapes (a zero-filled full score map in the
card vs. a partial string-keyed record with `?? 0` fallbacks in the submission
builder).

None of these copies has a compile-time relationship to any other. If someone
adjusts one copy of the point-buy table or the standard array, the UI and the
step gate silently disagree — a user could build scores the editor accepts and
the Next button rejects, or vice versa — and nothing fails until a player hits
it. The duplication also puts game rules in a presentation component:
`ability-score-card.tsx` is nominally a card, but it is the de-facto rules
module that `ability-scores-step.tsx` imports nine symbols from.

## Evidence

- `packages/client/src/components/character-create/steps/ability-score-card.tsx:17-76`
  — the presentation component declares and exports the whole rules surface:
  `ABILITIES` order (:17), `ABILITY_NAMES` (:19-26), `STANDARD_ARRAY`
  `[15, 14, 13, 12, 10, 8]` (:28), `POINT_BUY_BUDGET`/`MIN`/`MAX`/`COSTS`
  (:29-41), `DEFAULT_SCORES`/`NULL_ASSIGNMENTS` (:47-55), `calcModifier`
  returning a number (:57-59), `formatModifier` (:61-63), and `computeBoosts`
  returning a zero-filled full `ScoreMap` (:65-76).
- `packages/client/src/components/character-create/wizard-validation.ts:9-20` —
  `POINT_BUY_COSTS` and `POINT_BUY_BUDGET` repeated verbatim; `:30` —
  `STANDARD_ARRAY_VALUES = [8, 10, 12, 13, 14, 15]`, a second, sorted
  representation of the standard array with no link to the card's unsorted
  tuple; `:25` treats off-table scores as `Infinity` cost; `:34` allows manual
  scores 1–30.
- `packages/client/src/components/character-create/steps/review-step.tsx:15-30`
  — second copies of `ABILITIES` and `ABILITY_NAMES`, plus a second
  `calcModifier` that inlines the same `Math.floor((score - 10) / 2)` but
  returns a formatted `"+N"` string.
- `packages/client/src/components/character-create/create-character-input.ts:5-11`
  — `buildBoostMap`, a second boost aggregation shaped as a partial
  `Record<string, number>`; `:34-50` — `buildBoostedScores` applies it with
  `?? 0` fallbacks in a six-field projection onto the mutation input.
- `packages/client/src/components/character-create/steps/ability-scores-step.tsx:8-20`
  — the step imports nine rule symbols (`ABILITIES`, `computeBoosts`,
  `POINT_BUY_COSTS`, `STANDARD_ARRAY`, …) from the card component, making the
  card the accidental rules module.
- The canonical implementations already exist in shared:
  `packages/shared/src/rules/character-rules.ts:135` exports `abilityModifier`
  (same formula as both client copies), and
  `packages/shared/src/schemas/srd.ts:26` defines `abilityAbbreviationSchema`,
  whose enum options are the canonical ability order both `ABILITIES` tuples
  re-type by hand.
- `review-step.tsx:1` already imports from `@musi/shared/rules/starting-languages.js`
  — the shared-rules import path is established practice in this exact file.
- Measured scope check: outside tests, the duplicated names
  (`POINT_BUY*`/`STANDARD_ARRAY*`/`calcModifier`/`computeBoosts`) appear in
  exactly the four files above; `create-character-input.ts` shares none of them
  and re-implements aggregation from scratch.

## Proposed direction

Consolidate into two pure layers, both replacing the current four copies. No
wizard behavior changes.

1. **Shared rules module for the exact 5E score-generation rules.** Add
   `packages/shared/src/rules/ability-score-generation.ts` (unit tests beside
   it, per the `rules/` idiom — read `packages/shared/src/rules/MODULE.md`
   before adding the module): `STANDARD_ARRAY` as a single constant with the
   sorted comparison form *derived* from it, `POINT_BUY_COSTS`/`BUDGET`/`MIN`/
   `MAX`, and pure validators `isPointBuyWithinBudget(scores)` and
   `isStandardArrayAssignment(scores)`. `packages/shared/src/rules/` is the
   repo's home for exact 5E rules, and review-step already imports shared rules
   (starting-languages), so this is the copyable placement. Reuse the existing
   `abilityModifier` and `formatModifier` from
   `packages/shared/src/rules/character-rules.ts:135-145` — do **not** author
   new client copies — and delete both client `calcModifier` implementations
   plus the card's local `formatModifier`.
2. **Client-local pure model module for wizard-specific pieces.** Add
   `packages/client/src/components/character-create/ability-model.ts` owning:
   the canonical `ABILITIES` order (derive it from
   `abilityAbbreviationSchema.options` in `@musi/shared/schemas/srd.js` rather
   than re-typing the tuple), the `ABILITY_NAMES` display map (display strings
   stay client-side, not in shared), the `ScoreMap`/`AssignmentMap`/
   `AbilityMethod` types, `DEFAULT_SCORES`/`NULL_ASSIGNMENTS`, one boost
   aggregation returning a full `ScoreMap`, and a boosted-scores derivation
   that `create-character-input.ts`'s `buildBoostedScores` calls for its
   six-field projection.
3. **Rewire all four surfaces.** `ability-score-card.tsx` and
   `ability-scores-step.tsx` keep only JSX and local UI state and import from
   the model; `wizard-validation.ts` delegates `canAdvanceAbilities`' rule
   checks to the shared validators; `review-step.tsx` imports order/names from
   the model and `abilityModifier`/`formatModifier` from shared;
   `create-character-input.ts` drops `buildBoostMap` in favor of the model's
   aggregation.

Preserve exact current acceptance semantics: the `Infinity` sentinel for
off-table point-buy scores, the 1–30 manual range, and sorted-array equality
for the standard-array check. Work under TDD: migrate/extend the existing
suites `ability-score-card.test.tsx`, `ability-scores-step.test.tsx`,
`create-character-input.test.ts`, and `review-step.test.tsx`;
`wizard-validation.ts` has no dedicated test file, so the new shared validators
get their own tests beside the shared module.

## Scope / caveats

- **Explicitly out of scope:** the character-sheet ability components
  (`packages/client/src/components/sheet/ability-score-card.tsx` is a different
  file with no cross-import to the wizard card), homebrew monster ability
  forms, server-side point-buy enforcement, and any behavior change to the
  wizard.
- **Silent-drift risk during the merge is the main hazard.** The two boost
  aggregations differ in shape (partial record with `?? 0` vs. zero-filled
  `ScoreMap`), the two `calcModifier` copies differ in return type (number vs.
  formatted string), and the validator treats out-of-table scores as `Infinity`
  cost — a naive unification could change acceptance behavior for
  manual-method or edge scores. Pin the current semantics with tests before
  consolidating.
- **Scope-creep guard:** do not pull client display metadata into shared, and
  do not "while here" touch the sheet or homebrew ability surfaces that
  grep-match the same names — they are out of scope by ruling above.
- The shared-package change is client-consumed only, so no Prisma/tRPC guide
  applies; the one prerequisite read is `packages/shared/src/rules/MODULE.md`.
- No ordering dependency is recorded against other leaves. Note that
  [004-character-creation-large-pseudo-module-loose.md](004-character-creation-large-pseudo-module-loose.md)
  and
  [042-flat-character-creation-contract-forces.md](042-flat-character-creation-contract-forces.md)
  also work in the character-create area — avoid concurrent edits to the same
  files, but land order is free.
- No prior pack covers this consolidation.
