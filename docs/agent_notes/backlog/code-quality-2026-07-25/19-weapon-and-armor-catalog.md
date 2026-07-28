# 19. Versatile weapon damage is silently dropped because the SRD equipment catalog spells one concept two ways

Status: Done — landed 2026-07-26 in two slices of [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md), which supersedes the `## Proposed direction` below: W1, the live-defect adapter fix (`29ac3137`, `272cd4a0`, merge `028a21d5`), then the riders W2 and A1 (`a2335c75`, `a2e2923f`, `39ad2cd3`, `9b7dd0aa`, merge `7a4b10ac`). **Dropped, and not to be re-raised from this note:** step 1(b)'s `?? srd?.versatileDice` fallback (it would attach the SRD longsword's `1d10` to a custom same-named 2d6 weapon), steps 3 and 4 (never scheduled — no reader exists outside the adapter, and 4 is the persisted-key migration the plan's Trap 2 guards; there is now a [Constraints](./00-index.md#constraints-on-future-proposals) row), and step 7's `unarmoredAc(hasShield)` half (moving one `hasShield` read out splits the rule across two functions). See [`00-index.md`](./00-index.md#landed)
Theme: SRD equipment catalog data contract · Area: shared · Severity: medium · Size: L

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`packages/shared/src/schemas/inventory.ts` carries **two field names for the same
SRD concept** on the same object: `versatileDice` (line 41) and `twoHandedDice`
(line 45). Nothing anywhere translates between them, and the two halves are wired
to different layers:

- The **rules and read side** know only `versatileDice` — `srd-weapons.ts:28`
  declares it on `WeaponData`, `attack-damage.ts:109-111` copies it, and
  `resolve-attack.ts:77` is the only place versatile damage is ever applied.
- The **write side** knows only `twoHandedDice` — the SRD equipment schema
  (`schemas/srd.ts:290`), the homebrew item schema (`schemas/homebrew.ts:333`),
  the server SRD seed (`seed-srd-equipment.ts:249`), the Prisma `weapon_data`
  payload comment (`schema.prisma:667`), and the whole client homebrew item form
  (`item-form-data.ts`, `item-weapon-fields.tsx:158-161`).

The consequence is a real 5E rules bug, not just a naming smell. `enrichFromSrd`
(`attack-damage.ts:101-113`) falls back to the SRD row for `weaponCategory` and
`ranged`, but for versatile dice it reads **only** `wp.versatileDice` — it never
falls back to `wp.twoHandedDice` and never falls back to `srd?.versatileDice`. So
any weapon inventory item whose persisted properties parse successfully while
carrying `twoHandedDice` reaches `computeWeaponAttack` with
`versatileDice: undefined`, and the versatile branch at `resolve-attack.ts:77-79`
never fires. A longsword two-handed rolls 1d8 instead of 1d10. Two live paths put
an item in that state: starting equipment copied from the SRD seed
(`starting-equipment-service.ts:31-39,55`) and items authored through the
homebrew item form (`homebrew-item-tab.tsx:73-84`). The manual add-item dialog is
*not* affected — it writes `properties: {}`, which fails the parse and falls back
to the `SRD_WEAPONS` row, which does carry `versatileDice`.

Four cheaper defects sit on the same catalog and share the same underlying
cause — the catalog's data contract is stated only weakly in types, so each layer
re-derives the part that is missing:

1. `attack-damage.ts:15-22` is a leftover facade from the relocation of the weapon
   table into `srd-weapons.ts`. It re-exports five symbols "so existing importers
   keep resolving"; the only importers that still use it are three tests, and
   three of the five symbols have no importer through it at all.
2. `WeaponData` declares `damageType: string` and `properties: readonly string[]`
   (`srd-weapons.ts:22-29`) even though the closed vocabularies —
   `WEAPON_PROPERTIES` (`srd-weapons.ts:5-16`) and `DamageTypeName`
   (`damage-types.ts:9-27`) — sit in the same package, so the ~280-line table is
   checked against almost nothing.
3. Armor has no `category` in its persisted shape (`armorPropertiesSchema`,
   `inventory.ts:51-57`), so `getArmorDataFromItem` re-derives it from an unnamed,
   uncommented three-branch heuristic over `dexBonus`/`maxDex`
   (`armor-class.ts:103-105`), and the monk-with-a-shield rule is split away from
   the function that owns unarmored AC.
4. The homebrew item form hand-maintains a second copy of the weapon property
   vocabulary: `item-weapon-fields.tsx:8-20` lists the same ten values as the
   shared `WEAPON_PROPERTIES` plus `special`. The damage-type vocabulary on the
   same form is already single-sourced (`item-form-data.ts:3` re-exports
   `DAMAGE_TYPES` from `@musi/shared/rules/damage-types.js`), so the property
   list is the odd one out and drifts silently when the shared list changes.

## Evidence

- `packages/shared/src/schemas/inventory.ts:41` and `:45` — `versatileDice` and `twoHandedDice`, both optional strings, on the same `weaponPropertiesSchema`.
- `packages/shared/src/rules/attack-damage.ts:101-113` — `enrichFromSrd`; falls back to `srd?.weaponCategory` / `srd?.ranged`, but versatile dice comes only from `wp.versatileDice`.
- `packages/server/src/services/combat-actions/resolve-attack.ts:77-79` — `if (input.versatile && weaponData.versatileDice !== undefined)`; the sole consumer, skipped whenever the field is undefined.
- `packages/shared/src/schemas/srd.ts:290`, `packages/shared/src/schemas/homebrew.ts:333`, `packages/server/src/seed/seed-srd-equipment.ts:54,62,249`, `packages/server/prisma/schema.prisma:667` — every writer emits `twoHandedDice`.
- `packages/server/src/test/srd-weapon-sync.test.ts:80` — the repo already asserts
  the two names are one concept: `actualRows()` maps the seeded
  `weaponData.twoHandedDice` onto `versatileDice` so it can be compared at `:92`
  against `expectedRows()`, which reads `versatileDice` straight off
  `SRD_WEAPONS` (`:56`). Only the runtime read seam is missing the equivalence.
- `packages/server/src/services/starting-equipment-service.ts:31-39,55` — the
  concrete SRD path into the bug: `resolveProperties` parses the seeded
  `Equipment.weaponData` (carrying `twoHandedDice`) through
  `weaponPropertiesSchema`, which accepts the key at `inventory.ts:45`, and
  `buildItemData` writes the result into `InventoryItem.properties`. A character
  created with a starting longsword therefore has `properties.twoHandedDice`
  and no `versatileDice`, `weaponPropertiesSchema.safeParse` succeeds, and
  `enrichFromSrd` drops the value on the floor.
- `packages/client/src/components/sheet/homebrew-item-tab.tsx:73-84` — the
  homebrew path into the same bug: `buildWeaponProperties` copies
  `twoHandedDice` from the homebrew display data into `ItemProperties`.
- Not affected: `packages/client/src/components/sheet/add-item-dialog.tsx:97`
  writes `properties: {}`, which fails `weaponPropertiesSchema` and falls back to
  `SRD_WEAPONS[item.name]` — that branch does carry `versatileDice`. The bug
  reaches the starting-equipment and homebrew paths, not the manual add path.
- `packages/client/src/components/homebrew/item/item-form-data.ts:12,88,137,190`, `item-weapon-fields.tsx:158-161`, `packages/client/src/components/sheet/homebrew-item-tab.tsx:83` — client authoring writes `twoHandedDice`; `packages/client/src/components/sheet/equipment-summary.tsx:114` renders `versatileDice`.
- `packages/shared/src/rules/attack-damage.ts:15-22` — the relocation facade: five-line comment plus `export type { WeaponCategory, WeaponData, WeaponProperty }` and `export { SRD_WEAPONS, WEAPON_PROPERTIES }` from `./srd-weapons.js`. The file already imports what it needs directly at `:12-13`.
- Only consumers of that facade: `packages/shared/src/rules/attack-damage.test.ts:15` (`SRD_WEAPONS`), `packages/shared/src/rules/attack-damage.property.test.ts:14` (`type WeaponData`), `packages/shared/src/rules/weapon-mastery.test.ts:3` (`SRD_WEAPONS`). The five production importers (`equipment-summary.tsx:1-6`, `actions-tab-weapons.tsx:1-6`, `pages/sheet-helpers.ts:3`, `resolve-attack.ts:2-6`, `resolve-character-spell.ts:2`) pull only real functions. `WEAPON_PROPERTIES`, `WeaponCategory` and `WeaponProperty` have zero importers through it anywhere in `packages/`, `e2e/`, `scripts/` or `tools/` — `packages/server/src/test/srd-weapon-sync.test.ts:1` already imports from `@musi/shared/rules/srd-weapons.js`.
- `packages/shared/src/rules/srd-weapons.ts:22-29` — `damageType: string`, `properties: readonly string[]`; `:313` — the table is closed with `satisfies Record<string, WeaponData>` over 38 entries.
- `packages/client/src/components/homebrew/item/item-weapon-fields.tsx:8-20` — a local `WEAPON_PROPERTIES` of `{ value, label }` pairs: the ten values of `packages/shared/src/rules/srd-weapons.ts:5-16` plus `special`. `packages/client/src/components/homebrew/item/item-form-data.ts:3` shows the single-sourcing pattern for the neighbouring damage-type vocabulary.
- `packages/shared/src/schemas/inventory.ts:37` — `damageType: damageTypeNameSchema` (closed); `:40` — `properties: z.array(z.string()).optional()` (open).
- `packages/shared/src/rules/armor-class.ts:96-110` — `getArmorDataFromItem`; `:103-105` is the bare `dexBonus === false → heavy / maxDex !== undefined → medium / else light` chain.
- `packages/shared/src/rules/armor-class.ts:48-57` — `unarmoredAc` owns barbarian/monk/neither; `:77-80` re-inlines `UNARMORED_BASE_AC + abilityModifier(scores.dexterity)`, byte-identical to what `unarmoredAc(scores, null)` returns at `:56`, with the PHB comment attached to the branch instead of to the rule's owner.
- `packages/shared/src/rules/character-rules.ts:157-165` — a *different* tombstone that must be kept; see caveats.

## Proposed direction

1. **Pin the bug first (TDD).** Add failing cases to
   `packages/shared/src/rules/attack-damage.test.ts`: (a) an inventory weapon item
   whose properties carry `twoHandedDice: "1d10"` and no `versatileDice` yields
   `versatileDice: "1d10"` from `getWeaponDataFromItem`; (b) an item named after an
   SRD versatile weapon whose properties parse without either key inherits
   `srd.versatileDice`. Read `docs/guides/change-rules-logic.md` before touching
   rules behaviour.
2. **Fix the read seam.** In `enrichFromSrd` (`attack-damage.ts:101-113`) resolve
   versatile dice as `wp.versatileDice ?? wp.twoHandedDice ?? srd?.versatileDice`.
   One commit, no schema or DB change, and it makes the `resolve-attack.ts:77`
   branch reachable for seeded and homebrew weapons. Add a server-side test that a
   versatile attack on a seeded longsword uses the larger die.
3. **Normalize every persisted-JSON read seam *before* touching any writer.**
   The dual-read from step 2 lives only in `attack-damage.ts`; it does not protect
   the other four seams that parse the same persisted payloads. Zod strips unknown
   keys by default, so deleting `twoHandedDice` from any of these schemas silently
   erases it from every legacy row on read — and in the homebrew form that loss is
   then written back to the database. Each seam needs to **accept both keys and
   emit `versatileDice`**, in its own commit, modelled on the existing
   `normalizeWeaponDataDamageType` read seam (`rules/damage-types.ts`, applied at
   `routers/srd.ts:240-242`, `inventory-service.ts:96-98`,
   `starting-equipment-service.ts:31-36`, `attack-damage.ts:123`):
   - `weaponPropertiesSchema` (`inventory.ts:33-46`) — keep `twoHandedDice`
     accepted; add a preprocess that folds it into `versatileDice` when the latter
     is absent. This subsumes step 2 for every consumer, not just `enrichFromSrd`.
   - `equipmentWeaponDataSchema` (`srd.ts:281-291`) — the tRPC read parse for the
     `Equipment.weaponData` Json column (`routers/srd.ts:56`, `:242`, via
     `equipmentSchema` at `srd.ts:314`). Removing the key here blanks versatile
     dice on the whole SRD equipment browse surface until a re-seed.
   - `homebrewWeaponDisplaySchema` (`homebrew.ts:323-334`, used at `:353`) — the
     read projection over homebrew item data; it feeds
     `homebrew-item-tab.tsx:73-84`, which is one of the two paths that create the
     bug in step 1.
   - `parseWeaponData` / `buildWeaponData` (`item-form-data.ts:126-138`,
     `:182-191`) — **this is the destructive one.** `getDefaultItemData` →
     `parseWeaponData` loads an existing entry into the form and `buildItemData` →
     `buildWeaponData` rebuilds the payload from scratch from `ItemWeaponData`, so
     any key the form does not model is dropped on save. Change these together:
     read `data.versatileDice ?? data.twoHandedDice` into a single
     `versatileDice` form field, and only then have `buildWeaponData` emit
     `versatileDice`. Rename the input in `item-weapon-fields.tsx:158-161` in the
     same commit.
4. **Only then converge the writers on `versatileDice`** — `seed-srd-equipment.ts:54,62,249`,
   `homebrew-item-tab.tsx:83`, and the payload comment at `schema.prisma:667`.
   Accept `twoHandedDice` on read forever (step 3), write only `versatileDice`
   going forward. This is the medium-risk commit; keep it separate from step 2 so
   the behaviour fix can land and be verified on its own, and add a test per seam
   that a legacy `{ twoHandedDice }` payload still reads — and, for the homebrew
   form, still survives a load/save round trip. `srd-weapon-sync.test.ts:80` maps
   `weaponData.twoHandedDice` onto `versatileDice`; change it to
   `weaponData.versatileDice` in the same commit as the seed change, or the
   seed-vs-table assertion at `:92` reads `undefined` and fails.
5. **Delete the relocation facade.** Retarget the three shared-package test
   imports (`attack-damage.test.ts:15`, `attack-damage.property.test.ts:14`,
   `weapon-mastery.test.ts:3`) at `./srd-weapons.js`, then remove
   `attack-damage.ts:15-22` entirely. Trivial, zero risk.
6. **Narrow `WeaponData.damageType`** from `string` to the shared
   `DamageTypeName` (`damage-types.ts:9-27`). Both producers are already closed:
   the table literals, and `wp.damageType` via `damageTypeNameSchema`
   (`inventory.ts:37`) with the legacy read seam canonicalized at
   `attack-damage.ts:123`. Optionally tighten the table's own `properties` with a
   table-local `satisfies` in `srd-weapons.ts` — **not** by changing the interface.
7. **Armor cleanup** (behaviour-preserving, one commit): extract
   `armor-class.ts:103-105` into a named, commented helper (e.g.
   `armorCategoryFromProperties`) that states the "no dex bonus ⇒ heavy, capped dex
   ⇒ medium, otherwise light" inference and why the persisted shape lacks a
   category; and give `unarmoredAc` a `hasShield` parameter so the monk-loses-it
   case at `:77-80` returns to the function that owns the rule, moving the PHB
   comment with it.
8. **Single-source the homebrew property vocabulary.** Derive
   `item-weapon-fields.tsx:8-20` from the shared `WEAPON_PROPERTIES`
   (`srd-weapons.ts:5-16`) with `special` appended explicitly, following the
   pattern `item-form-data.ts:3` already uses for `DAMAGE_TYPES`. Keep `special`:
   it is deliberate homebrew latitude and is the reason the shared SRD list must
   not gain it.

## Scope / caveats

- **Never remove `twoHandedDice` from a schema that parses persisted JSON.** Zod
  strips unknown keys by default, so dropping the key from
  `weaponPropertiesSchema`, `equipmentWeaponDataSchema` or
  `homebrewWeaponDisplaySchema` does not "migrate" anything — it makes the value
  vanish from every legacy row at read time. The same applies to
  `item-form-data.ts`: `buildWeaponData` rebuilds the whole payload from the
  form's own `ItemWeaponData`, so a key the form stops modelling is deleted from
  the database on the next save of that item. Step 3 exists specifically to close
  this, and it must land before step 4.
- **Do not delete the tombstone at `packages/shared/src/rules/character-rules.ts:157-165`.**
  It looks like the same kind of dead comment as the facade in step 5, and it is
  not: it documents *why* the armor symbols are deliberately **not** re-exported —
  `armor-class.js` imports `abilityModifier` from `character-rules.js`, so
  re-exporting them back forms a runtime import cycle caught by
  `lint:import-cycles`. Deleting the note invites someone to re-break it. Only
  `attack-damage.ts:15-22` is dead.
- **Do not narrow `WeaponData.properties` to `WeaponProperty[]`.** It is tempting
  because `WEAPON_PROPERTIES` (`srd-weapons.ts:5-16`) sits a few lines above the
  interface, but
  `enrichFromSrd` populates it from `normalizeWeaponProperties(wp.properties ?? [])`
  over `z.array(z.string()).optional()` (`inventory.ts:40`) — arbitrary persisted
  and DM-authored strings. A global narrowing is unsound; only a table-local
  `satisfies` is safe.
- **Do not rename the persisted JSON key in place.** `Equipment.weaponData`
  (`schema.prisma:658-668`) and `InventoryItem.properties` are `Json` columns
  already holding `twoHandedDice`; there is no Prisma migration for a payload
  key, which means there is also no
  backfill unless one is written. The read shims from steps 2-3 are therefore
  permanent, not transitional — at **every** seam listed in step 3, not just in
  `attack-damage.ts`. If you do decide to backfill, follow
  `docs/guides/add-prisma-migration.md`.
- `packages/shared/src/rules/srd-weapons.test.ts` is a 359-line hand-maintained
  mirror of the 38-weapon table, and `packages/server/src/test/srd-weapon-sync.test.ts`
  cross-checks the table against seeded equipment. Both declare their own row
  types with a wide `damageType: string` (`srd-weapons.test.ts:5-13`,
  `srd-weapon-sync.test.ts:17-25`), so step 6 does not force an edit in either —
  what forces one is step 4, at `srd-weapon-sync.test.ts:80`.
- `packages/client/src/test/fixtures-homebrew.ts:96`,
  `packages/shared/src/schemas/srd.test.ts:162` and `:188-196`, and
  `packages/client/src/components/sheet/homebrew-item-tab.test.tsx:28,142,298`
  pin `twoHandedDice` today; they are the regression net for step 3 and must gain
  `versatileDice` cases rather than simply being renamed. The homebrew tab test is
  the strictest of them: `:138-143` asserts an exact `toHaveBeenCalledWith`
  properties object, and `:298` asserts a non-versatile weapon carries no
  `twoHandedDice` key at all.
- Step 7 must not change any AC number. `UNARMORED_BASE_AC + abilityModifier(dex)`
  at `:80` and the `unarmoredAc(scores, null)` return at `:56` are already
  identical; the PHB comment at `:78-79` is load-bearing SRD documentation and must
  survive verbatim on the branch that keeps the rule.
  `unarmoredAc(scores, unarmoredDefense, hasShield)` is three parameters and stays
  inside the repo's parameter-count lint cap.
- Steps 1-4 (the behaviour fix and the compatibility work) and steps 5-8 (the
  cleanups) are independently landable; if effort is tight, take 1-2 and 5 and
  leave the rest. Steps 1-2 alone repair the rules bug without touching a single
  schema, which is why they are ordered first.
- Sizing note: steps 1-2 are small, but step 3 is four independent read seams
  across `shared`, `server` and `client`, each needing its own legacy-payload
  test; step 4 spans the seed, the homebrew form, the Prisma comment and the seed
  sync test; and the regression net in three test files has to gain cases rather
  than be renamed.
- Leaves 20 and 21 also edit `packages/shared/src/rules/character-rules.ts` and
  `armor-class.ts`-adjacent constants. No ordering dependency, but avoid working
  them concurrently in the same file.
