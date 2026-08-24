# 37. Uppercase SRD reference tables export mutable arrays and records while the neighboring difficulty table shows the readonly idiom

Status: Not started
Theme: reference-data mutability contracts · Area: shared · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/shared/src/rules/` holds the canonical SRD vocabularies and lookup
tables — skill names, save abilities, condition descriptions, the weapon and
armor catalogs. These are immutable reference data by intent, and they use the
SCREAMING_CASE naming that signals it. But the exported types don't say so:
most of the tables are plain `T[]` arrays and `Record<K, V>` objects, so any
consumer can `sort()`, `push()`, or assign into the shared singleton and
corrupt it for every other importer. Meanwhile `DIFFICULTY_XP_BUDGETS` in the
same directory does it right — `readonly` row fields plus
`Readonly<Record<...>>` — so the public type surface communicates two
different invariants for the same kind of data. Contributors get no compiler
help distinguishing "shared constant, never mutate" from "mutable value", and
at least one client module already compensates by re-wrapping the arrays in
`readonly` annotations at the consumer side.

## Evidence

- `packages/shared/src/rules/character-rules.ts:65` — `export const SKILL_NAMES = Object.keys(SKILL_ABILITY_MAP) as SkillName[];` — mutable array (the `type-assertion-boundary: interop` marker sits at `:64`).
- `packages/shared/src/rules/character-rules.ts:67` — `SAVE_ABILITIES: AbilityAbbreviation[]`; `:69` — `ABILITY_FULL_NAMES: Record<AbilityAbbreviation, string>`; `:152` — `ABILITY_ABBREVIATION_TO_KEY: Record<AbilityAbbreviation, keyof AbilityScores>` — all mutable.
- `packages/shared/src/rules/conditions.ts:40` — `CONDITION_DESCRIPTIONS: Record<SrdCondition, string>`; `:125` — `INCAPACITATING_CONDITIONS: SrdCondition[]` — both mutable.
- `packages/shared/src/rules/srd-weapons.ts:326-327` — `SRD_WEAPONS: Record<WeaponName, WeaponData> & Record<string, WeaponData>` — mutable intersection; the JSDoc at `:320-325` documents the deliberate tolerant string-index half (homebrew weapon lookups under `noUncheckedIndexedAccess`).
- Siblings with the same gap: `packages/shared/src/rules/armor-class.ts:30` (`SRD_ARMOR: Record<string, ArmorData>`), `packages/shared/src/rules/weapon-mastery.ts:25-26` (`WEAPON_MASTERY_MAP`, same mutable two-`Record` intersection) and `:75` (`WEAPON_MASTERY_DESCRIPTIONS: Record<WeaponMasteryProperty, string>`).
- The in-directory contrast: `packages/shared/src/rules/encounter-difficulty.ts:16-20` declares `XpBudget` with all-`readonly` fields and `:26` exports `DIFFICULTY_XP_BUDGETS: Readonly<Record<CharacterLevel, XpBudget>>`.
- Consumers already treat the tables as immutable: `packages/client/src/components/homebrew/background/background-form-data.ts:16-18` re-exports `SAVE_ABILITIES`/`SKILL_NAMES` under local `readonly` annotations, and a grep of all non-test consumers finds only reads (`.map`, `.filter`, `.some`, `.flatMap`, indexed lookups, `Object.keys`/`Object.entries`) — no mutation anywhere, so tightening is type-only.

## Proposed direction

Add readonly element/`Readonly<Record>` typing to the mutable uppercase
reference tables (`SKILL_NAMES`, `SAVE_ABILITIES`, `ABILITY_FULL_NAMES`,
`CONDITION_DESCRIPTIONS`, `INCAPACITATING_CONDITIONS`, `SRD_WEAPONS`, and
siblings), matching the encounter-difficulty idiom while preserving
`SRD_WEAPONS`' documented tolerant string-index lookup. Mechanically:

- Arrays → `readonly` element types: `SAVE_ABILITIES: readonly AbilityAbbreviation[]`, `INCAPACITATING_CONDITIONS: readonly SrdCondition[]`, and `SKILL_NAMES` cast to `readonly SkillName[]` (keep the derivation from `SKILL_ABILITY_MAP` and the `interop` marker at `character-rules.ts:64` — only the cast target widens to readonly).
- Records → `Readonly<Record<...>>`: `ABILITY_FULL_NAMES`, `ABILITY_ABBREVIATION_TO_KEY` (`character-rules.ts:69`, `:152`), `CONDITION_DESCRIPTIONS` (`conditions.ts:40`), `WEAPON_MASTERY_DESCRIPTIONS` (`weapon-mastery.ts:75`), `SRD_ARMOR` (`armor-class.ts:30`).
- The two-`Record` intersections keep both halves: `SRD_WEAPONS` (`srd-weapons.ts:326`) and `WEAPON_MASTERY_MAP` (`weapon-mastery.ts:25`) become `Readonly<Record<WeaponName, ...>> & Readonly<Record<string, ...>>` — the string-index half must survive, and under `noUncheckedIndexedAccess` its lookups still yield `... | undefined` exactly as the `srd-weapons.ts:320-325` JSDoc promises.
- If any consumer signature turns out to demand a mutable array/record parameter, widen that parameter to accept readonly input; do not spread-copy at the table to appease it.
- Verify with `bun run test:shared` (the tables' pinned suites: `character-rules.test.ts`, `conditions.test.ts`, `srd-weapons.test.ts`, `weapon-mastery.test.ts` — `.sort()` calls there operate on fresh `Object.keys()` arrays and stay green) and `bun run typecheck` for the cross-package ripple.

## Scope / caveats

- **`FRESH_ACTION_ECONOMY` (`combat.ts:38`) is out of scope.** It is a state *template*, not reference data; its only consumer spreads it (`packages/server/src/services/combat-actions/turn-transaction.ts:77`), so `Readonly` would compile, but whether a default-state template should advertise immutability is a separate judgment from this consistency sweep.
- **Deep readonly of row interfaces is out of scope.** This leaf tightens the containers, not `WeaponData`/`ArmorData` field mutability. `WeaponData.properties` is already `readonly string[]` (`srd-weapons.ts:29`), and `attack-damage.test.ts:348` already pins that helpers do not alias that array.
- Prior pack: the 2026-07-25 shared cluster (CQ25-115, landed) tightened these vocabularies' keys and value domains — and its review expressly accepted the current `SKILL_NAMES` derivation as a valid way to close the skill key set — but never adjudicated mutability. Keep that derivation intact; this leaf changes only the exposed type.
- [027-condition-damage-modules-mix-contracts.md](./027-condition-damage-modules-mix-contracts.md) also edits `srd-weapons.ts` to repoint its damage-type import. No ordering dependency, but avoid concurrent edits to that file; leaf 035 only edits `attack-damage.ts`.
- Do not "fix" tolerant lookups while here: the string-index halves of `SRD_WEAPONS` and `WEAPON_MASTERY_MAP` are documented accommodations for homebrew names, not oversights.
