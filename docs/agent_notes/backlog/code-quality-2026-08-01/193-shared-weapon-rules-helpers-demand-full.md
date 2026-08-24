# 193. Weapon rules helpers over-demand wire entities and force narrow server projections through double assertions

Status: Not started
Theme: Narrow rules boundaries · Area: cross-cutting · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Two weapon helpers describe their inputs in terms of richer shared entities than their computations require. `getWeaponDataFromItem` demands a complete `InventoryItem` while reading three fields. `isWeaponProficient` is already narrower, but its `Pick<CharacterProficiency, ...>` still carries the schema's closed proficiency enum even though the function only compares two strings.

The server intentionally loads focused Prisma-facing rows, so it must pretend those rows are fully validated wire entities by passing them through two `as unknown as` bridges. Those assertions hide the actual rules boundary and make unrelated additions to the shared entity contracts appear relevant to attack resolution.

## Evidence

- `packages/shared/src/rules/attack-damage.ts:1-3` imports the full `CharacterProficiency` and `InventoryItem` types, while `getWeaponDataFromItem` at `:111-121` reads only `itemType`, `name`, and `properties`.
- `packages/shared/src/rules/attack-damage.ts:119-121` already treats `properties` as a runtime boundary through `weaponPropertiesSchema.safeParse`, so the caller does not need to prove a complete inventory entity.
- `packages/shared/src/rules/attack-damage.ts:181-189` types proficiencies as a `Pick<CharacterProficiency, "type" | "name">` but only tests `type === "weapon"` and compares `name`.
- `packages/server/src/services/combat-actions/resolve-attack.ts:22-42` declares the focused item and proficiency rows the attack path actually loads.
- `packages/server/src/services/combat-actions/resolve-attack.ts:71-72` widens the three-field item row through `as unknown as InventoryItem` solely for `getWeaponDataFromItem`.
- `packages/server/src/services/combat-actions/resolve-attack.ts:91-96` contains a separate double assertion because Prisma exposes proficiency `type` as `string`, while the helper's `Pick` retains the narrower shared enum.
- Client callers already hold complete entities (`packages/client/src/components/sheet/equipment-summary.tsx:62-93` and `packages/client/src/components/vtt/drawer/tabs/actions-tab-weapons.tsx:73-96`); they demonstrate compatibility, not a current client assertion problem.

## Proposed direction

Narrow `getWeaponDataFromItem` and `isWeaponProficient` in `packages/shared/src/rules/attack-damage.ts` to structural inputs containing only the fields they read: `{ itemType: string; name: string; properties: unknown }` and `readonly { type: string; name: string }[]`. Keep `weaponPropertiesSchema.safeParse` at the boundary, and delete the two `as unknown as` bridges in `packages/server/src/services/combat-actions/resolve-attack.ts`.

Use small named interfaces if they make the public signatures clearer. The existing `AttackerInventoryItemRow` and proficiency projection at `resolve-attack.ts:22-42` should then satisfy the helpers directly; do not widen the database projection or introduce a mapper merely to recreate the discarded entities.

Add focused cases to `packages/shared/src/rules/attack-damage.test.ts`: call the item helper with only its three required fields, retain invalid-property and SRD-fallback behavior, and pass wide-string weapon and non-weapon proficiency rows to `isWeaponProficient`. Existing full-entity client calls should remain unchanged.

## Scope / caveats

- This changes input typing, not weapon calculation, fallback, damage, proficiency, or persistence behavior.
- Do not weaken or remove the runtime `weaponPropertiesSchema.safeParse`; `properties` remains an untrusted `unknown` boundary.
- CQ25-115 already fixed the weapon representation and adapter behavior in [SHARED-CLUSTER-PLAN.md](../code-quality-2026-07-25/SHARED-CLUSTER-PLAN.md):554-555. Do not reopen the `twoHandedDice`/`versatileDice` decisions or SRD fallback rules here.
- [031-attack-damagets-eight-concern-rules-grab-bag.md](./031-attack-damagets-eight-concern-rules-grab-bag.md), [035-weapon-helpers-widen-closed-vocabularies.md](./035-weapon-helpers-widen-closed-vocabularies.md), and [191-let-players-choose-strength-dexterity.md](./191-let-players-choose-strength-dexterity.md) also touch `attack-damage.ts` for distinct concerns. There is no semantic ordering dependency, but avoid concurrent edits to that file.
