# 27. Condition and damage-type vocabulary, Zod contracts, and persisted-JSON repair live in rules modules, completing a bidirectional edge with the encounter schema

Status: Not started
Theme: shared contract layering · Area: shared · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/shared/src/rules/conditions.ts` is four modules wearing one name: the
SRD condition vocabulary and descriptions, the closed Zod validator the schema
layer builds contracts from, tolerant read-seam repair for persisted JSON rows,
and the executable turn-tick behavior (`tickConditions` and friends). Its
neighbor `rules/damage-types.ts` is the same mix minus the behavior — it
contains no executable rule at all, only vocabulary, validators, and
persisted-`weaponData` repair, yet it sits in the rules directory.

The cost shows up as a two-way dependency at the heart of the shared package.
`rules/conditions.ts` type-imports `ConditionEntry` from `schemas/encounter.ts`,
while `schemas/encounter.ts` value-imports `conditionNameSchema` straight back.
The type-only half avoids a runtime cycle, but a reader tracing "which layer
owns the condition concept" finds the contract layer depending on rules and
rules depending on the contract layer — there is no answer. Every new
condition- or damage-shaped feature has to guess which side of the seam its
schema, its normalizer, and its helper belong on, and the two MODULE.md
charters make the guess harder rather than easier: `rules/MODULE.md` says the
directory owns "rules calculations only; persistence … live[s] in
server/client callers", which the persisted-JSON normalizers contradict, while
`schemas/MODULE.md` documents the very "vocabulary lives in `../rules/` and is
imported back" doctrine that produced the back-edge.

## Evidence

- `packages/shared/src/rules/conditions.ts:3` — `import type { ConditionEntry } from "../schemas/encounter.js"` — and `packages/shared/src/schemas/encounter.ts:10` — `import { conditionNameSchema } from "../rules/conditions.js"` — the source-level bidirectional edge.
- `packages/shared/src/schemas/encounter.ts:65-70` — `conditionEntrySchema` / `ConditionEntry` are built from the back-imported validator, so the entity type rules needs is defined on the far side of the edge.
- `packages/shared/src/rules/conditions.ts` — four roles in one file: vocabulary (`SRD_CONDITIONS` :9-25, `CONDITION_DESCRIPTIONS` :40-67), contract (`conditionNameSchema` :38), persisted-value repair (`normalizeSrdCondition` :93-95, `normalizeConditionEntryName` :109-116 — the latter repairs the participant `conditions` JSON column per its own JSDoc at :97-108), and executable behavior (`hasCondition` :118, `INCAPACITATING_CONDITIONS` :125-131, `isIncapacitated` :133, `decrementConditionDurations` :145, `removeExpiredConditions` :157, `tickConditions` :184).
- `packages/shared/src/rules/damage-types.ts` — zero executable rules: `DAMAGE_TYPES` :9-23, `damageTypeNameSchema` :27, `isValidDamageTypeName` :29, `normalizeDamageTypeName` :46-49, `normalizeWeaponDataDamageType` :68-74 (persisted `weaponData` JSON repair), `damageTypeInputField` :85.
- `packages/shared/src/rules/MODULE.md:11-13` — "This package owns rules calculations only; persistence, campaign authorization, and UI state live in server/client callers" — contradicted by the normalizers above.
- `packages/shared/src/schemas/MODULE.md:25-28` — "cross-domain rules vocabulary … goes there [`../rules/`] and is imported back" — the documented doctrine behind the back-edge.
- Measured import surface (non-test, excluding `dist/`): 12 files (13 import statements) import `rules/conditions.js` — 5 shared schemas (`character-inputs.ts:14`, `character.ts:12`, `encounter.ts:10`, `homebrew.ts:4`, `monster.ts:11`, all for `conditionNameSchema`), 6 server files (`routers/monster.ts:1`, `seed/seed-srd-monsters.ts:4`, `services/combat-actions/turn-transaction.ts:2`, `services/encounter-combat/participant-action.ts:1`, `utils/character-mapping.ts:1`, `utils/encounter-query.ts:1`), 1 client file (`condition-toggle-popover.tsx:1-2`, two statements).
- Measured import surface for `rules/damage-types.js` (non-test, excluding `dist/`): 17 files (18 import statements) — 9 shared (`rules/attack-damage.ts:11`, `rules/srd-weapons.ts:5`, `schemas/attack-roll-inputs.ts:11`, `schemas/homebrew.ts:5`, `schemas/inventory.ts:4`, `schemas/monster.ts:12`, `schemas/spell-action-inputs.ts:14`, `schemas/spell.ts:15`, `schemas/srd.ts:4`), 6 server (`routers/srd.ts:1`, `seed/extract-monster-action.ts:1`, `seed/spell-parser/extract-spell-metadata.ts:7`, `services/inventory-service.ts:1`, `services/starting-equipment-service.ts:1`, `utils/srd-narrowing.ts:1-2`, two statements), 2 client (`components/homebrew/item/item-form-data.ts:5` — a re-export — and `components/sheet/homebrew-item-tab.tsx:1`).
- `packages/shared/src/rules/conditions.ts:69` — `export { MAX_EXHAUSTION } from "../constants.js"`, a pass-through whose only importer is `conditions.test.ts:12`; `schemas/character.ts:6` and `schemas/character-inputs.ts:8` already take it from `../constants.js`.
- Client `ConditionEntry` consumers — 10 non-test `.tsx` files — all import the type from `@musi/shared/schemas/encounter.js` (e.g. `condition-toggle-popover.tsx:3`, `initiative-tracker/initiative-row.tsx:2`, `tokens/token-shape.tsx:2`); none import it from `rules/conditions`.

## Proposed direction

Create two contract-layer leaf modules in `packages/shared/src/schemas/`, each
importing only `zod` and `../constants.js`:

1. **`schemas/condition.ts`** takes from `rules/conditions.ts`:
   `SRD_CONDITIONS`, `SrdCondition`, `conditionNameSchema`,
   `CONDITION_DESCRIPTIONS`, `isValidCondition`, `normalizeSrdCondition`,
   `normalizeConditionEntryName` — plus `conditionEntrySchema` /
   `ConditionEntry` moved down from `schemas/encounter.ts:65-70`.
   `encounter.ts` imports the entry schema from `./condition.js` for its own
   entity schema, while the ~11 client/server consumers are repointed directly
   to `schemas/condition.js`. Do not re-export `conditionEntrySchema` or
   `ConditionEntry` from `encounter.ts`: `schemas/MODULE.md:196-199` requires an
   import to name the defining file and forbids compatibility re-exports.
2. **`schemas/damage-type.ts`** takes the entire contents of
   `rules/damage-types.ts` (`DAMAGE_TYPES`, `DamageTypeName`,
   `damageTypeNameSchema`, `isValidDamageTypeName`, `normalizeDamageTypeName`,
   `normalizeWeaponDataDamageType`, `damageTypeInputField`), and
   `rules/damage-types.ts` is deleted — it has zero executable rules today, so
   nothing remains behind.

`rules/conditions.ts` survives as a pure behavior module — `hasCondition`,
`INCAPACITATING_CONDITIONS`, `isIncapacitated`, `decrementConditionDurations`,
`removeExpiredConditions`, `tickConditions` — importing its types from
`schemas/`, which matches `rules/MODULE.md`'s own "rules calculations only;
persistence lives in callers" charter. The tolerant read-seam normalizers ride
with their vocabulary in the schemas leaves: they are deterministic,
contract-adjacent pre-parse repair built on the same lowercase maps, and
`schemas/MODULE.md` already sanctions contract-adjacent helpers.

Mechanics:

- Update the 13 `rules/conditions`, 18 `rules/damage-types`, and ~11
  client/server `ConditionEntry` non-test import statements across
  shared/server/client to the new deep specifiers. Enumerate with
  `bun run code:intel -- dependents packages/shared/src/rules/conditions.ts`
  (and the damage-types and encounter-schema equivalents) rather than raw grep,
  and ignore `dist/` hits.
- Normalizer bodies move **verbatim**: no change to tolerant pass-through
  semantics (unknown values returned unchanged so the strict schemas still
  reject), the lowercase canon, or the open `damageTypeInputField` vs closed
  `damageTypeNameSchema` distinction (`damage-types.ts:77-85`).
- Update the mirrored JSDoc cross-references in both directions:
  `conditionNameSchema`'s doc cites "`damageTypeNameSchema` in
  `damage-types.ts`" (`conditions.ts:32`) and `normalizeSrdCondition`'s cites
  `normalizeDamageTypeName` (`conditions.ts:85`) — both must point at the new
  file names. `normalizeConditionEntryName`'s doc names its server consumers
  (`encounter-query.ts`, `turn-transaction.ts`) at `conditions.ts:105-107`;
  those stay valid.
- Drop the `MAX_EXHAUSTION` pass-through re-export at `rules/conditions.ts:69`
  — grep shows no non-test importer — but re-verify with
  `bun run code:intel -- refs` before deleting (its own test at
  `conditions.test.ts:136-138` repoints to `../constants.js`).
- Split `rules/conditions.test.ts` between a new `schemas/condition.test.ts`
  (vocabulary/normalizer cases) and the residual `rules/conditions.test.ts`
  (behavior cases); move `rules/damage-types.test.ts` wholesale to
  `schemas/damage-type.test.ts`.
- Update both MODULE.md docs in the same change: `schemas/MODULE.md:25-28`'s
  "cross-domain rules vocabulary goes in `../rules/` and is imported back"
  paragraph must carve out condition/damage-type as contract-owned leaves, with
  the invariant that these schema leaves import nothing from `rules/`.
- Read `docs/guides/change-rules-logic.md` (cited by `rules/MODULE.md:5`)
  before touching rules files.

## Scope / caveats

- **Out of scope:** the remaining one-way `schemas` → `rules` value imports
  (`xp.ts` CR values, sorcery-points, weapon-mastery — same documented pattern
  but not bidirectional); any `attack-damage.ts` restructuring beyond its one
  import-path line (`rules/attack-damage.ts:11`); all server read-path
  behavior.
- **Risk — deep-specifier blast radius:** every shared file is its own public
  subpath, so deleting `rules/damage-types.ts` and slimming
  `rules/conditions.ts` breaks ~30 deep-specifier import sites across three
  packages. A missed site fails typecheck, but stale build artifacts
  (`packages/server/dist/` and `packages/shared/dist/` both exist in the tree
  and carry `.d.ts` copies) can mask misses locally — verify from a clean
  build.
- **Risk — load-bearing tolerance:** the normalizers' pass-through semantics
  keep legacy display-cased rows readable while letting strict schemas reject
  genuinely unknown values. Any "cleanup" during the move silently changes read
  behavior on persisted data. Move, don't improve.
- **Risk — doc drift:** `schemas/MODULE.md` currently documents the opposite
  ownership doctrine; landing the code without the coordinated MODULE.md edits
  creates immediate drift, so both doc updates are in scope with the code.
- **Client check:** the 10 non-test client `ConditionEntry` importers must be
  repointed from `@musi/shared/schemas/encounter.js` to
  `@musi/shared/schemas/condition.js`; re-confirm the census before landing.
- **Sequencing:** soft edge with the `attack-damage.ts` cluster —
  [031-attack-damagets-eight-concern-rules-grab-bag.md](./031-attack-damagets-eight-concern-rules-grab-bag.md),
  [035-weapon-helpers-widen-closed-vocabularies.md](./035-weapon-helpers-widen-closed-vocabularies.md),
  [193-shared-weapon-rules-helpers-demand-full.md](./193-shared-weapon-rules-helpers-demand-full.md),
  and [191-let-players-choose-strength-dexterity.md](./191-let-players-choose-strength-dexterity.md)
  all touch `attack-damage.ts`, and this leaf rewrites its import line at
  `rules/attack-damage.ts:11`. Coordinate landing order to avoid textual
  conflicts; there is no semantic dependency in either direction.
- **Prior pack:** the 2026-07-25 pack's
  [23-schema-layout-and-naming.md](../code-quality-2026-07-25/23-schema-layout-and-naming.md)
  step 5 (SHARED-CLUSTER-PLAN.md slice S2, merge `75bad57dc`) renamed
  `srdConditionSchema` → `conditionNameSchema` but explicitly did not rule on
  ownership or dependency direction — this leaf extends it; do not reopen the
  rename. Carry S2's durable constraint forward: do **not** collapse the two
  lookup mechanisms in the condition module — `isValidCondition` is a type
  predicate and needs the `.some()` form; `Map.has()` does not narrow.
