# 35. Weapon attack and proficiency helpers widen the closed WeaponCategory and DamageTypeName vocabularies back to string

Status: Not started
Theme: Closed vocabularies erased at helper boundaries · Area: shared · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The weapon pipeline goes to real trouble to model two closed vocabularies —
`WeaponData` carries `damageType: DamageTypeName` and
`weaponCategory: WeaponCategory` — and then the very next helper boundaries in
`attack-damage.ts` throw that precision away. `WeaponAttackResult` re-types the
damage type as plain `string`, the category-to-proficiency map is a
`Record<string, string>`, and `isWeaponProficient` accepts any string as a
category. The cost is concrete: if a third weapon category is ever added, the
compiler cannot point at the proficiency map entry that must be written, and a
caller that passes a miscased or wrong category string is silently treated as
"no category proficiency" instead of failing to compile. Downstream consumers of
attack results also lose the stronger damage-type contract the source data
already guarantees, so they cannot switch on damage types exhaustively without
re-validating a value that was already closed.

## Evidence

- `packages/shared/src/rules/srd-weapons.ts:22-31` — the closed source types:
  `WeaponCategory = "simple" | "martial"` (`:22`), and `WeaponData` with
  `damageType: DamageTypeName` (`:26`) and `weaponCategory: WeaponCategory`
  (`:27`).
- `packages/shared/src/rules/attack-damage.ts:139` — `WeaponAttackResult`
  declares `damageType: string`, even though the only production value flowing
  into it is `weaponData.damageType` (a `DamageTypeName`) at `:166`.
- `packages/shared/src/rules/attack-damage.ts:176-179` —
  `CATEGORY_PROFICIENCY_MAP: Record<string, string>` with exactly the two
  `WeaponCategory` keys; nothing forces a new category to get an entry.
- `packages/shared/src/rules/attack-damage.ts:181-186` — `isWeaponProficient`
  takes `weaponCategory: string` and indexes the map with it; an unknown string
  degrades to a name-only proficiency check rather than a compile error.
- All three production callers already pass the narrow type, so the widening
  buys nothing: `packages/server/src/services/combat-actions/resolve-attack.ts:92`,
  `packages/client/src/components/vtt/drawer/tabs/actions-tab-weapons.tsx:95`,
  and `packages/client/src/components/sheet/equipment-summary.tsx:92` all call
  `isWeaponProficient(proficiencies, weaponData.weaponCategory, item.name)`.
- `packages/shared/src/rules/attack-damage.ts:11-13` — the file already imports
  from `./damage-types.js` and `./srd-weapons.js`, so the type imports this
  change needs add no new module edges.

## Proposed direction

In `packages/shared/src/rules/attack-damage.ts`, type
`CATEGORY_PROFICIENCY_MAP` as `Record<WeaponCategory, string>`, change
`isWeaponProficient`'s `weaponCategory` parameter to `WeaponCategory`, and type
`WeaponAttackResult.damageType` as `DamageTypeName`, fixing any call sites the
compiler flags.

Mechanics: add `import type { DamageTypeName } from "./damage-types.js"` and
widen the existing `srd-weapons.js` type import (`:12`) to include
`WeaponCategory`. No production caller should need changes — the three
proficiency callers above pass `weaponData.weaponCategory`, and
`computeWeaponAttack` (`:162-169`) already returns `weaponData.damageType`.
Existing tests pass literal `"simple"`/`"martial"` categories
(`attack-damage.test.ts:494-525`, `attack-damage.property.test.ts:201-233`) and
stay valid. `bun run test -- packages/shared/src/rules/attack-damage.test.ts`
covers the touched surface.

## Scope / caveats

- Out of scope: any change to the proficiency-name strings themselves
  (`"Simple Weapons"`/`"Martial Weapons"`), to `WeaponData`, or to how the
  server narrows Prisma proficiency rows (the marked assertion at
  `resolve-attack.ts:91` is a separate concern).
- Four other leaves touch `attack-damage.ts` with distinct problems; there is no ordering dependency, but avoid concurrent edits: [027-condition-damage-modules-mix-contracts.md](./027-condition-damage-modules-mix-contracts.md) repoints the damage-type import; [031-attack-damagets-eight-concern-rules-grab-bag.md](./031-attack-damagets-eight-concern-rules-grab-bag.md) moves the spell helpers; [193-shared-weapon-rules-helpers-demand-full.md](./193-shared-weapon-rules-helpers-demand-full.md) narrows helper inputs around the same functions; and [191-let-players-choose-strength-dexterity.md](./191-let-players-choose-strength-dexterity.md) changes finesse ability choice in `computeWeaponAttack`.
- Prior pack: the live 2026-07-25 pack's
  [19-weapon-and-armor-catalog.md](../code-quality-2026-07-25/19-weapon-and-armor-catalog.md)
  (landed 2026-07-26, SHARED-CLUSTER-PLAN slice W2) narrowed
  `WeaponData.damageType` to `DamageTypeName`; it did not rule on these
  downstream widenings, and this leaf completes that direction. Nothing in its
  dropped-steps list forbids this change.
