# 21. Rules constants that every layer must agree on are re-declared privately in shared, server and client instead of being exported once

Status: Done — landed 2026-07-26 as [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md)'s slices K1 (`04fe17f8`, `931ea939`, `ee5f1f3e`, `0c88baed`, `695f6545`), K2 (`1df927f4`, `0174e251`, `acb7ac75`) and K3 (`f43ef4ce`, `aa554a4b`, `da598760`), merge `7a4b10ac`. **No step was dropped or merged**; step 5 landed as its own slice (K3), and the `21 step 5 ↔ 22 step 5` edge the index recorded was dissolved as never-semantic. K1 went further than this note asks — the level bounds are now a `CHARACTER_LEVELS` tuple whose `satisfies` clause makes bound/enumeration drift a compile error — and carried one deliberate `RangeError` behaviour change in `calculateEncounterDifficulty`. See [`00-index.md`](./00-index.md#landed)
Theme: Single source of truth for cross-cutting constants · Area: shared · Severity: low · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`packages/shared` is supposed to own the values the whole system agrees on, but for
a handful of them it either does not export the constant or exports it from a
module nobody wants to import — so every consumer declares its own copy. The
values are currently identical everywhere, which is exactly why this is cheap now
and expensive later: nothing fails when one copy drifts.

Four independent clusters, one cause:

1. **Character level bounds inside shared itself.** `MIN_LEVEL`/`MAX_LEVEL` are
   exported from `schemas/character.ts:19-20`, and then re-declared privately in
   three more shared modules (`schemas/srd.ts:21-22`, `schemas/homebrew.ts:83`
   — `MAX_LEVEL` only — and `rules/spellcasting.ts:74-75`). Two of the three could
   import the exported pair today (`schemas/homebrew.ts:3` already imports
   `MAX_AC`/`MAX_HP` from `../constants.js`; `rules/spellcasting.ts` only
   type-imports from `schemas/srd.js`), and `rules/encounter-difficulty.ts` /
   `schemas/encounter.ts` already do. `schemas/srd.ts` is the exception that
   explains the whole cluster: `character.ts:12` runtime-imports
   `abilityAbbreviationSchema`/`speedSchema` from `./srd.js`, so `srd.ts` cannot
   import back from `character.ts` without a cycle. The bounds are simply living in
   the wrong module — a leaf module, not the character entity, is where a value
   every schema needs belongs.
2. **Constants shared exports, re-typed downstream.** `MAX_SPELL_LEVEL = 9`
   (`constants.ts:12`) is re-declared in the client spell form; `MAX_LEVEL = 20`
   is re-expressed as `MAX_FEATURE_LEVEL = 20` in the client class-feature editor.
   Worst of the group: `MIN_HP_GAIN = 1` is a *rules* constant that shared, server
   and client must all agree on, and shared keeps it **private**
   (`rules/character-rules.ts:197`), forcing the server rest service and the client
   level-up helper to each invent their own.
3. **The d20 face value, five times.** `MAX_D20_ROLL = 20` (`constants.ts:78`),
   `const D20 = 20` three times (`shared/rules/d20-roll.ts:13`,
   `shared/rules/concentration-save.ts:7`,
   `server/services/combat-actions/initiative.ts:7`), and
   `const NATURAL_CRIT = 20` (`shared/rules/attack-roll.ts:10`). The server copy
   makes this a cross-layer duplication like `MIN_HP_GAIN`, not a shared-internal
   tidy-up.
4. **A Zod shape copied to dodge an import cycle.** `schemas/character.ts:227-231`
   inlines the body of `asiIncreaseSchema` (`schemas/character-inputs.ts:228-232`)
   byte-for-byte, down to the same `eslint-disable-next-line no-magic-numbers`
   comment, because `character-inputs.ts` already depends on `character.ts`. The
   persisted shape and the validated input shape are now free to drift silently.

## Evidence

- `packages/shared/src/schemas/character.ts:19-20` — `export const MIN_LEVEL = 1; export const MAX_LEVEL = 20;`. Redeclared at `packages/shared/src/schemas/srd.ts:21-22`, `packages/shared/src/schemas/homebrew.ts:83` (`MAX_LEVEL` only), `packages/shared/src/rules/spellcasting.ts:74-75`. Four `MAX_LEVEL` declarations, three `MIN_LEVEL`.
- `packages/shared/src/schemas/character.ts:12` — `import { abilityAbbreviationSchema, speedSchema } from "./srd.js";` — a value import, so `character.ts` → `srd.ts` is a runtime edge and the reverse import is a cycle. `packages/shared/src/rules/spellcasting.ts:1` imports from `../schemas/srd.js` with `import type` only, so it carries no runtime edge either way.
- `packages/shared/src/constants.ts:1` — imports only `zod`; it is already the leaf module that `character.ts:3-9`, `srd.ts:3`, `homebrew.ts:3` and `weapon-mastery-inputs.ts:3` all import from, and it already hosts the sibling game-mechanic limits (`MAX_DEATH_SAVES`, `MAX_EXHAUSTION`, `MAX_SPELL_LEVEL`, `MAX_HIT_DICE`, …) at `:10-18`.
- Out-of-package importers of `MAX_LEVEL`, all via `@musi/shared/schemas/character.js`: `packages/server/src/services/level-up/core.ts:5`, `packages/server/src/services/level-up/level-up.test.ts:2`, `packages/client/src/components/sheet/level-up-submit.ts:1`, `sheet-header.tsx:1`, `level-up-dialog.tsx:3`. No out-of-package consumer imports `MIN_LEVEL`; the in-package consumers `schemas/encounter.ts:5` and `rules/encounter-difficulty.ts:11` import both.
- `packages/shared/src/constants.ts:12` — `MAX_SPELL_LEVEL = 9`; re-declared privately at `packages/client/src/components/homebrew/spell/spell-form-data.ts:53` and used at `:90`, `:150`. The same file declares `MIN_SPELL_LEVEL = 0` at `:54` (identical to `CANTRIP_LEVEL` at `constants.ts:14`, used at the same two call sites) and `LEVEL_COUNT = 10` at `:44` (`MAX_SPELL_LEVEL + 1`, feeding the `SPELL_LEVELS` option list at `:46-49`). Sibling client files already import both names from shared — `packages/client/src/components/sheet/spell-filter-bar.tsx:1`, `add-spell-dialog.tsx:1`.
- `packages/shared/src/rules/character-rules.ts:197` — `const MIN_HP_GAIN = 1;` (not exported), used at `:207`. Duplicated at `packages/server/src/services/rest-service.ts:42` (used `:195`) and `packages/client/src/components/sheet/level-up-helpers.tsx:33` (used `:116-117`).
- `packages/client/src/components/homebrew/class/class-feature-list.tsx:15-16` — `MIN_FEATURE_LEVEL = 1` / `MAX_FEATURE_LEVEL = 20`, bound to the level input at `:56-57`; the same 1..20 character-level range under a different name.
- `packages/shared/src/constants.ts:78` — `MAX_D20_ROLL = 20`, used as a Zod upper bound at `schemas/attack-roll-inputs.ts:69,96,119,121` and `schemas/spell-action-inputs.ts:135-136`.
- `packages/shared/src/rules/d20-roll.ts:13`, `packages/shared/src/rules/concentration-save.ts:7` and `packages/server/src/services/combat-actions/initiative.ts:7` — `const D20 = 20`, all three used as `rng(1, D20)` (`concentration-save.ts:50`, `initiative.ts:38`); `packages/shared/src/rules/attack-roll.ts:10` — `const NATURAL_CRIT = 20` (default `criticalRange` at `:51`).
- `packages/shared/src/rules/concentration-save.ts:50` — `const saveRoll = rng(1, D20);`, hand-rolled while `attack-roll.ts` and `saving-throw.ts` both go through `resolveD20Roll`. Its input/result types are at `:20-26` / `:28-38`.
- `packages/shared/src/schemas/character.ts:221-231` — the five-line comment explaining the cycle ("`asiIncreaseSchema` itself is not imported here because character-inputs.ts already depends on this module") followed by the inlined copy; `packages/shared/src/schemas/character-inputs.ts:228-232` — the original.

## Proposed direction

Steps 1-3 are pure re-pointing: values are already identical, so no behaviour
moves. Read `docs/guides/change-rules-logic.md` before step 2 (`MIN_HP_GAIN` is a
rules constant) even though the change is mechanical.

1. **Move the level bounds to the leaf module and repoint every call site.** Do
   **not** point the private declarations at `schemas/character.js`:
   `character.ts:12` value-imports `abilityAbbreviationSchema`/`speedSchema` from
   `./srd.js`, so `srd.ts` importing the bounds back out of `character.ts` is a
   runtime import cycle. Instead:
   - Declare `MIN_LEVEL`/`MAX_LEVEL` in `packages/shared/src/constants.ts`
     alongside `MAX_SPELL_LEVEL`, `MAX_HIT_DICE` and the other cross-cutting game
     limits. `constants.ts` imports only `zod`, so every consumer below can reach
     it without an edge in the other direction.
   - Delete the declarations at `schemas/character.ts:19-20`,
     `schemas/srd.ts:21-22`, `schemas/homebrew.ts:83` and
     `rules/spellcasting.ts:74-75`, and import from `../constants.js` in all four
     (`character.ts:3-9`, `srd.ts:3` and `homebrew.ts:3` already import from it).
   - Repoint the in-package consumers `schemas/encounter.ts:5` and
     `rules/encounter-difficulty.ts:11` to `../constants.js`, and the five
     out-of-package importers of `MAX_LEVEL`
     (`server/services/level-up/core.ts:5` and its `level-up.test.ts:2`, client
     `level-up-submit.ts:1`, `sheet-header.tsx:1`, `level-up-dialog.tsx:3`) to
     `@musi/shared/constants`. Do this in the same commit rather than leaving a
     `export { MAX_LEVEL, MIN_LEVEL } from "../constants.js";` shim in
     `schemas/character.ts`: ADR-0005 states "Imports name the module that defines
     the symbol", and `packages/shared/src/schemas/MODULE.md:14-16` states the
     schemas directory "deliberately does **not** own … runtime constants (those
     live in `../constants.ts`, `../rules/`, `../dice/`, `../map/`)". Seven call
     sites is cheaper than a re-export that contradicts both.
   Before you land it, confirm `packages/shared/src/constants.ts` still pulls in
   nothing from inside the package — `rg -n 'from "' packages/shared/src/constants.ts`
   must return exactly one line, `1:import { z } from "zod";`. Any second match
   (including an `export … from` re-export) means the leaf-module assumption this
   step rests on no longer holds. `code:intel dependents` cannot answer this: it
   reports what imports `constants.ts`, not what `constants.ts` imports
   (`docs/guides/code-intel.md:46`). If you want the blast radius instead, that is
   what `bun run code:intel -- dependents packages/shared/src/constants.ts
   --exclude-tests` gives you (56 files today).
2. **Export `MIN_HP_GAIN` from `rules/character-rules.ts:197`** and import it in
   `packages/server/src/services/rest-service.ts` and
   `packages/client/src/components/sheet/level-up-helpers.tsx`, deleting both local
   copies. This is the one with genuine cross-layer risk if it ever drifts.
3. **Re-point the client constants.** In
   `packages/client/src/components/homebrew/spell/spell-form-data.ts`, import
   `MAX_SPELL_LEVEL` and `CANTRIP_LEVEL` from `@musi/shared/constants` and delete
   `MAX_SPELL_LEVEL` (`:53`) and `MIN_SPELL_LEVEL` (`:54`), then derive
   `LEVEL_COUNT` (`:44`) as `MAX_SPELL_LEVEL + 1` — `spell-filter-bar.tsx:1` is the
   existing pattern to copy. The specifier is extensionless: `constants` is the one
   shared export declared as a bare, non-wildcard key in
   `packages/shared/package.json:29-32`, so the `.js` suffix the `schemas/`,
   `rules/`, `dice/`, `map/` and `test/` wildcards require does not apply — while
   *inside* `packages/shared` the relative form is still `../constants.js`. Bun's
   resolver accepts a wrong `@musi/shared/constants.js`; a client typecheck or
   `node -e 'require.resolve(…)'` does not, so verify there.
   In `class-feature-list.tsx:15-16`, import `MIN_LEVEL`/`MAX_LEVEL` from
   `@musi/shared/constants` (keep a local alias only if the JSX reads better with
   the feature-level name, and comment that it *is* the character-level range).
4. **Give the d20 face value one home.** Introduce a single shared constant (e.g.
   `D20_SIDES` in `constants.ts`, next to `MAX_D20_ROLL`) and have
   `shared/rules/d20-roll.ts:13`, `shared/rules/concentration-save.ts:7`,
   `shared/rules/attack-roll.ts:10` and
   `server/services/combat-actions/initiative.ts:7` use it. Keep `NATURAL_CRIT` as
   a *named* default even if its value comes from the shared constant — the name
   carries meaning the number does not.
5. **Break the ASI duplication with a new leaf module.** Move the
   `{ ability, amount }` object into a small `packages/shared/src/schemas/asi.ts`
   that both `schemas/character.ts` and `schemas/character-inputs.ts` import, then
   delete both copies and the five-line cycle comment at `character.ts:221-225`.
   It must be a new module, **not** `../constants.ts`: the shape needs
   `abilityAbbreviationSchema` from `./srd.js`, and `srd.ts:3` already imports
   `idField` from `../constants.js`, so hosting it there would create the exact
   cycle step 1 is avoiding. `asi.ts` importing `./srd.js` is safe — nothing in
   `srd.ts` reaches back. Add a test that a persisted `asiChoiceData` payload and a
   validated `asiIncreaseSchema` input parse the same values.

## Scope / caveats

- **Do not merge the three `HALF_DIVISOR = 2` declarations in shared.** They are a
  numeric coincidence across three unrelated rules: `rules/saving-throw.ts:12`
  halves damage on a successful save (`:111`), `rules/concentration-save.ts:10`
  derives the save DC as half the damage taken (`:17`), and
  `map/area-template.ts:29` halves a template side length (`:104`, `:109`) inside a
  named-geometry `no-magic-numbers` fence that ends at `:30`. Folding any two of
  them together couples rules that are free to change independently, and folding in
  the third also disturbs a lint fence.
- **Do not route `resolveConcentrationSave` through `resolveD20Roll` as part of
  this leaf.** It is not a pure refactor: `ConcentrationSaveInput`
  (`rules/concentration-save.ts:20-26`) has no `rollMode` field and
  `ConcentrationSaveResult` (`:28-38`) has no `secondRoll`/`rollMode`, so the
  unification adds one new input field and two new result fields to a shape that is
  persisted verbatim — `packages/server/src/utils/concentration-helpers.ts:114`
  calls it and `:134` writes `rolls: toJson(result)` into `combatLog`. That is a
  behaviour-widening change with its own advantage/disadvantage semantics to
  decide, and it belongs in a separate ticket. Step 4 is the safe half.
- **`MAX_D20_ROLL` and `D20` are not interchangeable by accident.** `MAX_D20_ROLL`
  is used as a *schema upper bound* (`attack-roll-inputs.ts`,
  `spell-action-inputs.ts`); `D20` is used as an *rng argument*. A single shared
  name has to serve both roles — pick the name deliberately and keep `MAX_D20_ROLL`
  exported so the schema call sites do not churn.
- **Do not unify `BYTES_PER_MB` with `MAP_IMAGE_BYTES_PER_MB`.** The values differ
  on purpose: decimal 10^6 at `schemas/homebrew-export.ts:28` for the JSON payload
  budget, binary 2^20 at `schemas/map.ts:34` for the 10 MiB image limit. The
  comment at `map.ts:28-33` says so explicitly, a prior closed pack already
  collapsed the duplicate copies onto `MAP_IMAGE_BYTES_PER_MB`
  (`docs/agent_notes/finished_work/drift-ai-findings.md:26-27`), and
  `packages/server/src/services/upload-service.test.ts:65-69` pins the result.
  What is left is a placement nit — a general-purpose unit constant exported from a
  feature schema, better read as `BYTES_PER_MB`/`BYTES_PER_MIB` in `constants.ts`,
  with one importer each (`homebrew/collections/import-collection-dialog.tsx:2`,
  `upload-service.ts:7`). Low enough value that it should only be swept up if
  someone is already editing those files; unifying the two *values* would be a bug.
- The eslint-disable comments that travel with the copied ASI shape
  (`character.ts:229`, `character-inputs.ts:230`) must end up on the single surviving
  copy, not be dropped — see `docs/guides/lint-ratchet.md` if the suppression count
  shifts.
- **Every import added by this leaf points at a leaf module, by construction.**
  That is the whole design constraint: `packages/shared/src/schemas` is not a flat
  namespace, and the private re-declarations exist precisely where the obvious
  import would cycle (`srd.ts` ← `character.ts`). Before adding any import this
  leaf did not enumerate, check the reverse direction first; `constants.ts` and a
  new `schemas/asi.ts` are the only two modules this leaf sanctions as new import
  targets.
- Leaves 19 and 20 also edit `packages/shared/src/rules/character-rules.ts` and the
  weapon/skill vocabularies nearby; leaf 20 step 3 additionally annotates and tests
  `rules/spellcasting.ts`, whose level-bound declarations step 1 deletes. No
  ordering dependency; just avoid concurrent edits to those files.
- **Sequence step 5 against leaf 22.** Leaf 22 step 5 restructures
  `choiceDataSchema` (`character.ts:266-273`), which contains the inlined ASI copy
  this leaf's step 5 removes. Land this leaf's step 5 first — it makes
  `asiChoiceDataSchema` and `asiChoiceSchema` share one definition, which is a
  precondition for leaf 22 reasoning about what an `asi` row can legally hold —
  or fold the two into one change. They must not run concurrently.
