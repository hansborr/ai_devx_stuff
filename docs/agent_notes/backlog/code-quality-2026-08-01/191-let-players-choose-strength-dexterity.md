# 191. Let players choose Strength or Dexterity for Finesse attacks

Status: Not started
Theme: Finesse ability choice · Area: cross-cutting · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The seeded Finesse rule grants the attacker a choice between Strength and Dexterity and requires the same modifier for the attack and damage rolls. Musi instead silently chooses whichever modifier is higher. That is usually optimal, but it is not the rule expressed by the system’s own SRD data and cannot represent effects or table rulings that care which ability was used.

The attack schema has no choice field, the server cannot validate such a choice, and the VTT drawer neither displays nor sends one. Players must leave the normal attack workflow and roll manually when they need the non-optimal legal ability.

## Evidence

- `getWeaponAttackAbility` compares the Strength and Dexterity modifiers for every Finesse weapon and returns the greater one, preferring Strength on a tie (`packages/shared/src/rules/attack-damage.ts:29-39`).
- The seeded Finesse reference says the attacker chooses Strength or Dexterity and must use the same modifier for attack and damage (`packages/server/src/seed/data/reference/5e-SRD-Weapon-Properties.json:9-12`).
- `characterAttackInputSchema` is strict and includes weapon, versatile, critical, and roll-mode fields but no ability selection (`packages/shared/src/schemas/attack-roll-inputs.ts:58-75`).
- Server resolution obtains normalized weapon data and calls `computeWeaponAttack` without an ability choice (`packages/server/src/services/combat-actions/resolve-attack.ts:66-79`, `packages/server/src/services/combat-actions/resolve-attack.ts:98-103`).
- `useWeaponAttack.apply` accepts only `weaponItemId`, then sends the character attack with a hard-coded normal roll mode and no ability field (`packages/client/src/hooks/vtt-drawer/use-weapon-attack.ts:25-30`, `packages/client/src/hooks/vtt-drawer/use-weapon-attack.ts:79-103`).
- The drawer already computes each weapon’s attack and damage presentation through `computeWeaponAttack`, but its attack callback carries only the item ID (`packages/client/src/components/vtt/drawer/tabs/actions-tab-weapons.tsx:63-70`, `packages/client/src/components/vtt/drawer/tabs/actions-tab-weapons.tsx:82-119`).
- Existing property tests explicitly pin automatic best-modifier selection and consistency across the three shared helpers, so they must distinguish default behavior from explicit overrides (`packages/shared/src/rules/attack-damage.property.test.ts:68-108`, `packages/shared/src/rules/attack-damage.property.test.ts:155-175`).

## Proposed direction

1. Extend the shared rules contract in `packages/shared/src/rules/attack-damage.ts`:

   - Add optional `abilityOverride?: "STR" | "DEX"` to `WeaponAttackInput` and the internal ability/bonus input shapes.
   - Have `getWeaponAttackAbility` honor an override only when `weapon.finesse` is true; with no override, retain the current best-modifier selection exactly.
   - Pass the selected ability consistently through `calculateWeaponAttackBonus`, `calculateWeaponDamageBonus`, and `computeWeaponAttack`, so attack and damage cannot diverge.
   - Keep `WeaponAttackResult.ability` reporting the selected ability. Its computed bonuses continue into the existing attack result and combat-log description without widening those schemas.

2. Add `abilityOverride: z.enum(["STR", "DEX"]).optional()` to `characterAttackInputSchema` only. Custom and monster attacks already supply raw bonuses and do not need the field. Optionality preserves existing callers and payloads.

3. In `resolveCharacterAttack`, validate the choice after `getWeaponDataFromItem` has produced normalized properties. If `abilityOverride` is present and the weapon does not include `"finesse"`, reject it with `TRPCError` code `BAD_REQUEST`; otherwise pass it to `computeWeaponAttack`. Do not disturb the two nearby `type-assertion-boundary: prisma` comment blocks.

4. Extend `useWeaponAttack.apply` with the optional override and forward it in the tRPC mutation payload. In `actions-tab-weapons.tsx`, show a compact STR/DEX selector only when normalized weapon properties include `"finesse"`. Its initial presentation should reflect the automatic best choice; an explicit selection must feed both the displayed `computeWeaponAttack` result and the dispatched attack.

5. Add focused coverage before implementation:

   - Shared examples for each legal override, unchanged automatic selection, and identical ability use for attack and damage.
   - Condition existing property invariants that assume “Finesse always means maximum modifier” on the absence of an override, then add override-aware properties.
   - Server coverage for the non-Finesse `BAD_REQUEST` and for an explicit non-optimal Finesse choice changing both attack and damage bonuses.
   - Drawer/hook coverage proving that the displayed bonus and mutation payload use the same choice.

## Scope / caveats

- Out of scope: storing a per-weapon preference, custom-attack mode, thrown-weapon or two-weapon interaction changes, character-sheet equipment-summary controls, and implementing Strength-gated rider mechanics.
- The shared helper may defensively ignore an override for a non-Finesse weapon, but the public server boundary must reject that invalid payload rather than silently allowing a Dexterity greatsword attack.
- Because the input schema is strict, a client sending the new field to an older server would be rejected. Shared, server, and client changes must land atomically; do not partially cherry-pick the client portion.
- Finesse detection must reuse normalized weapon properties and the same `properties.includes("finesse")` rule used by `computeWeaponAttack`, not introduce another spelling check.
- [031-attack-damagets-eight-concern-rules-grab-bag.md](./031-attack-damagets-eight-concern-rules-grab-bag.md), [193-shared-weapon-rules-helpers-demand-full.md](./193-shared-weapon-rules-helpers-demand-full.md), and [035-weapon-helpers-widen-closed-vocabularies.md](./035-weapon-helpers-widen-closed-vocabularies.md) touch the same shared rules area for distinct reasons. There is no hard order, but if the module-split leaf lands first, apply this work to the relocated ability-selection module; whichever lands later must rebase helper signatures. Leaf 193 also overlaps `resolve-attack.ts`.
- **Coordination with [049-player-monster-attack-hooks-duplicate-target.md](./049-player-monster-attack-hooks-duplicate-target.md):**
  serialize edits to `use-weapon-attack.ts` and its test. If 049 lands first,
  add `abilityOverride` to its thin weapon adapter and capture it in the
  coordinator payload builder; if 191 lands first, 049 must preserve the
  widened apply contract and forwarding while extracting the lifecycle. There
  is no semantic dependency outside this adapter rebase.
