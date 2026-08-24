# 31. Spell save DC and spell attack bonus derivation lives in the weapon attack-damage module instead of `rules/spellcasting.ts`

Status: Not started
Theme: rules module placement · Area: shared · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/shared/src/rules/attack-damage.ts` reads as an accumulation of eight
sectioned blocks — property normalization, ability selection, attack/damage
bonuses, spell save DC/attack bonus, inventory adaptation, aggregation,
proficiency, formatting — but seven of the eight are one coherent concern:
deriving a weapon attack from character stats plus weapon data, in 200
clearly-sectioned lines. Splitting that apart would be churn for modest
navigational gain, especially since a recent rework already reshaped the
weapon-catalog side of this file.

The one genuine misplacement is the "Spell save DC & spell attack bonus"
section. `getSpellSaveDc` and `getSpellAttackBonus` are spellcasting rules, and
the package already has a 380-line `rules/spellcasting.ts` that owns caster-type
resolution and spellcasting derivation — the module any contributor would search
first. Both production consumers of the pair are spell features (the character
sheet's spell stats and the server's spell resolver) that today must import from
a weapon module to compute a spell number.

## Evidence

- `packages/shared/src/rules/attack-damage.ts:74-86` — the misplaced section: `SPELL_SAVE_DC_BASE` (`:78`), `getSpellSaveDc` (`:80`), `getSpellAttackBonus` (`:84`). Neither reads any weapon input; both are `proficiencyBonus(level)` + spellcasting ability mod.
- `packages/shared/src/rules/attack-damage.ts:15-200` — the remaining sections are all weapon-attack derivation: `normalizeWeaponProperties` (`:16`), `getWeaponAttackAbility` (`:29`), attack/damage bonuses (`:53`, `:67`), inventory→`WeaponData` adaptation (`:92-122`), `computeWeaponAttack` (`:144`), `isWeaponProficient` (`:181`), `formatWeaponDamage` (`:196`).
- `packages/shared/src/rules/spellcasting.ts` — 380 lines of spellcasting rules; contains no save-DC or spell-attack helper today (zero matches for either name in the file), so the move collides with nothing.
- Exactly two production importers of the pair: `packages/client/src/pages/character-sheet/sheet-helpers.ts:3` (used `:105-106`) and `packages/server/src/services/spell-casting/resolve-character-spell.ts:2` (used `:176-177`).
- Test coverage that moves with the code: `packages/shared/src/rules/attack-damage.test.ts:221-237` (`getSpellSaveDc`) and `:243-255` (`getSpellAttackBonus`); `packages/shared/src/rules/attack-damage.property.test.ts:183-199`, which relies on file-local helpers `SPELL_ABILITY_MOD_MIN`/`MAX` (`:23-24`), its own `SPELL_SAVE_DC_BASE` copy (`:25`), `characterLevelArbitrary` (`:30`) and `expectedProficiencyBonus` (`:66`).

## Proposed direction

Move `getSpellSaveDc` and `getSpellAttackBonus` from `rules/attack-damage.ts`
into the existing `rules/spellcasting.ts` and update the two importers
(`packages/client/src/pages/character-sheet/sheet-helpers.ts`,
`packages/server/src/services/spell-casting/resolve-character-spell.ts`),
leaving the rest of `attack-damage.ts` in place. Mechanics:

1. Move `attack-damage.ts:78-86` (`SPELL_SAVE_DC_BASE` plus both functions) into `spellcasting.ts`. Add `import { proficiencyBonus } from "./character-rules.js";` there — safe, no cycle: `character-rules.ts:1-2` imports only from `../schemas/`.
2. Repoint the two importers' specifiers from `@musi/shared/rules/attack-damage.js` to `@musi/shared/rules/spellcasting.js` (`sheet-helpers.ts:3`, `resolve-character-spell.ts:2`); named imports are unchanged.
3. Move the tests with the code (TDD: relocate first, watch them fail against the old module, then move the implementation): the two describe blocks `attack-damage.test.ts:221-255` into `spellcasting.test.ts`, and the property block `attack-damage.property.test.ts:183-199` into `spellcasting.property.test.ts` — carry over the file-local helpers it uses (`SPELL_ABILITY_MOD_MIN`/`MAX`, the expected-value `SPELL_SAVE_DC_BASE`, `characterLevelArbitrary`, `expectedProficiencyBonus`); the other property tests in the source file also use several of them, so copy rather than cut those helpers. `spellcasting.property.test.ts:19` already declares `PROPERTY_NUM_RUNS`.
4. Verify with `bun run test -- packages/shared/src/rules/spellcasting.test.ts packages/shared/src/rules/spellcasting.property.test.ts packages/shared/src/rules/attack-damage.test.ts packages/shared/src/rules/attack-damage.property.test.ts` plus the two importers' suites.

This is a pure relocation — no formula changes — but the files are shared
rules, so skim `docs/guides/change-rules-logic.md` (also pointed to by
`packages/shared/src/rules/MODULE.md:5`) before editing.

## Scope / caveats

- **No further split of `attack-damage.ts`.** The four-way split (weapon calculation / inventory adaptation / spellcasting / formatting-proficiency) is explicitly out of scope: the file is cohesive around weapon-attack derivation and the remaining sections stay where they are. Do not remove or restructure anything besides `:74-86`.
- **Do not disturb the landed weapon-catalog seams.** The live 2026-07-25 pack's `19-weapon-and-armor-catalog.md` (Done) already reworked this file — the `versatileDice`/`twoHandedDice` translation seam (`attack-damage.ts:100-107`) and the `normalizeWeaponDataDamageType` read seam (`:115-119`) — and records do-not-reopen rulings (no SRD versatile-dice fallback, no persisted-key migration). This leaf's move must not touch those blocks or their comments.
- **Same-file coordination.** Four other leaves touch `attack-damage.ts` with distinct problems: [027-condition-damage-modules-mix-contracts.md](./027-condition-damage-modules-mix-contracts.md) repoints its damage-type import, [035-weapon-helpers-widen-closed-vocabularies.md](./035-weapon-helpers-widen-closed-vocabularies.md) tightens weapon types, [193-shared-weapon-rules-helpers-demand-full.md](./193-shared-weapon-rules-helpers-demand-full.md) narrows helper inputs (and also edits `resolve-character-spell.ts`'s neighborhood), and [191-let-players-choose-strength-dexterity.md](./191-let-players-choose-strength-dexterity.md) changes finesse ability choice. No ordering dependency — the spell pair is outside all four leaves' targets — but avoid concurrent edits to the file.
- [025-spellcastingts-contains-five-independently.md](./025-spellcastingts-contains-five-independently.md) reorganizes `spellcasting.ts` itself; if both are in flight, land this small move first (or rebase it trivially) so the pair has a home before that leaf reshapes the module.
- `packages/shared/dist/` is untracked build output; no committed artifacts change.
