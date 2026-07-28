# 18. Class identity uses two competing string conventions, both typed `string`, with a silent dual-key fallback papering over the gap

Status: **Done 2026-07-27** in [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md)
slices **I1 → I2 → I3**, merge `ec4d732c4`; see
[Landed](./00-index.md#landed). The plan superseded and shrank this leaf (L→M);
read its outcome rather than the `## Proposed direction` below.
Theme: Shared domain types · Area: shared · Severity: medium · Size: L

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

A character's class is identified by a bare `string` everywhere in
`packages/shared`, and two different string conventions are in circulation for
the same set of classes. The rules tables use the prefixed form
(`"class-bard"`, `"class-fighter"`, …). `SPELL_CLASS_IDS` uses the unprefixed
SRD index form (`"bard"`, `"cleric"`, …), because those are the literal values
persisted in the `Spell.classes` JSON column.

Because both sides are typed `string`, nothing catches a mismatch at compile
time. Instead the gap is patched at runtime in seven places: `spellcasting.ts:197`
looks a class up twice, once as given and once with `class-` prepended; five call
sites strip the prefix by regex (`add-spell-dialog.tsx:135`,
`spells-review-card.tsx:24`, `spell-selection-step.tsx:15`,
`character-create-spells.ts:148`, `character-spell.ts:87`); and
`combat-eligibility.ts:30` re-adds it with a template literal. Every patch works,
and every one is invisible to anyone adding a new lookup — the next class-keyed
table someone writes will silently return `undefined` for half its callers, and
the failure mode is a wrong prepared-spell count or a missing mastery slot rather
than a crash.

The cost is that "which spelling does this function want?" is currently answered
by reading the implementation, and four class-keyed `Record<string, …>` rule
tables plus the `SPELL_CLASS_IDS` array have to be kept in agreement by hand.

**The two conventions are also two different-sized domains, which is why this is
not a single-union fix.** The prefixed convention covers **twelve** SRD classes
(`MULTICLASS_PREREQUISITES`); the spell-facing surfaces cover the **eight**
spellcasters (`PREPARED_SPELLS_BY_CLASS`, `LEVEL_1_SPELL_SELECTION_BY_CLASS`,
and the `SPELL_CLASS_IDS` array); `MASTERY_SLOTS` covers **six**. Separately, every public
function over these tables takes `classId: string` and has a deliberate
unknown-id fallback (`?? 0`, `return []`, `?? null`, the caster-type formula),
because the value arrives from a `z.string()` payload or a DB column, never from
a literal. Any typing plan has to respect all three arities *and* keep the string
boundary — that is the work, and it is more than a mechanical retype.

## Evidence

- `packages/shared/src/rules/spellcasting.ts:178-187` — `PREPARED_SPELLS_BY_CLASS`
  keyed `"class-bard"` … `"class-wizard"` (the `"class-bard"` entry is at `:179`;
  `:178` is the declaration).
- `packages/shared/src/rules/spellcasting.ts:197` — the dual-key fallback:
  ``PREPARED_SPELLS_BY_CLASS[classId] ?? PREPARED_SPELLS_BY_CLASS[`class-${classId}`]``.
- `packages/shared/src/rules/spellcasting.ts:350-359` —
  `LEVEL_1_SPELL_SELECTION_BY_CLASS`, same prefixed convention.
- `packages/shared/src/rules/weapon-mastery.ts:92-99` — `MASTERY_SLOTS`, prefixed
  (`"class-fighter"` at `:94`).
- `packages/shared/src/rules/multiclass-rules.ts:29-48` — `MULTICLASS_PREREQUISITES`,
  prefixed (`"class-barbarian"` at `:30`).
- `packages/shared/src/rules/sorcery-points.ts:10` —
  `export const SORCERER_CLASS_ID = "class-sorcerer"`; the same prefixed
  convention merely extracted to a constant, **not** a third convention.
- `packages/shared/src/schemas/spell.ts:37-40` — the doc comment establishing
  `SPELL_CLASS_IDS` as "Class IDs as stored in the `Spell.classes` JSON field
  (SRD index values)"; `:41-50` the unprefixed array, `:52` the derived
  `SpellClassId` type.
- The six runtime conversions between the two conventions, none of them declared
  anywhere: `packages/client/src/components/sheet/add-spell-dialog.tsx:134-135`
  (`// Strip "class-" prefix to match SPELL_CLASS_IDS format` followed by
  `first.replace(/^class-/, "")`);
  `packages/client/src/components/character-create/steps/spells-review-card.tsx:24`;
  `packages/client/src/components/character-create/steps/spell-selection-step.tsx:14-16`
  (`classKeyFor`); `packages/server/src/services/character-create-spells.ts:148`;
  `packages/server/src/routers/character-spell.ts:87`; and the opposite direction
  at `packages/server/src/services/spell-casting/combat-eligibility.ts:29-31`
  (``entry.classId === `class-${classId}` ``).
- Table arities, counted in the live tree: `MULTICLASS_PREREQUISITES` **12**
  (`multiclass-rules.ts:29-48`), `PREPARED_SPELLS_BY_CLASS` **8**
  (`spellcasting.ts:178-187`), `LEVEL_1_SPELL_SELECTION_BY_CLASS` **8**
  (`spellcasting.ts:350-359`), `MASTERY_SLOTS` **6**
  (`weapon-mastery.ts:92-99`), `SPELL_CLASS_IDS` **8** (`spell.ts:41-50`).
- The string boundary and its load-bearing fallbacks:
  `weapon-mastery.ts:101-103` `getMasterySlotCount(classId: string)` → `?? 0`;
  `multiclass-rules.ts:91-93` `checkMulticlassPrerequisites(scores, classId: string)`
  → `if (!prereqs) return []`; `spellcasting.ts:189-194`
  `PreparedSpellLimitInput.classId: string` → `?? null` at `:204`;
  `spellcasting.ts:367-375` `getLevel1SpellSelection(classId: string, …)` →
  caster-type formula fallback at `:374`.
- Every production caller reads the value off a persisted row, not a literal:
  `packages/server/src/routers/character-spell.ts:54` and
  `packages/client/src/pages/sheet-helpers.ts:98`
  (`classId: c.classId` into `getMulticlassMaxPreparedSpells`);
  `packages/server/src/services/weapon-mastery-service.ts:62` and
  `packages/client/src/pages/character-sheet/sheet-state.ts:122`
  (`getMasterySlotCount(c.classId)`);
  `packages/server/src/services/level-up/core.ts:83`, `:90` and
  `packages/client/src/components/sheet/level-up-helpers.tsx:281`, `:315`
  (`checkMulticlassPrerequisites`);
  `packages/server/src/services/character-create-spells.ts:128` and
  `packages/client/src/components/character-create/wizard-state.ts:126`
  (`getLevel1SpellSelection`). `packages/shared/src/schemas/character.ts:118`,
  `:251`, `:329` type it `z.string()`.
- All four of the live `getMulticlassMaxPreparedSpells` / `getMasterySlotCount`
  call sites pass the **prefixed** `CharacterClass.classId`, so the unprefixed
  branch of the dual-key fallback at `spellcasting.ts:197` has no production
  caller today — it is defensive, not load-bearing, which is what makes step 4
  tractable at all.
- `packages/shared/src/rules/spellcasting.test.ts:283-296` —
  `it("resolves a bare class id via the class-prefixed SRD table fallback")`
  pins that unprefixed branch directly, asserting
  `getMaxPreparedSpells({ classId: "wizard", classLevel: 5, … })` is `9`. It is a
  characterisation test for the fallback, not for any production caller.
- `packages/shared/src/rules/armor-class.ts:112-115` — `UNARMORED_DEFENSE_CLASSES`
  keyed by **display name** (`Barbarian`, `Monk`), fed by `classNames`
  (`:120`), a third namespace with a different input path. Evidence of how far
  class identity has spread, not a target for this union (see caveats).

## Proposed direction

1. Introduce the two identity types explicitly in `packages/shared`, side by
   side, rather than trying to collapse them: a `ClassId` union for the prefixed
   rules convention and the existing `SPELL_CLASS_IDS`-derived type for the
   persisted SRD index values. Derive both from `as const` arrays per the
   shared-schema convention. No behaviour change; this commit only names what is
   already true.
2. Add a single declared, exported mapping between them (`classIdToSrdIndex` /
   `srdIndexToClassId`). **The mapping is not a bijection and the test must not
   assert that it is.** `ClassId` has twelve members and `SpellClassId` eight, so
   `srdIndexToClassId` is total (`Record<SpellClassId, ClassId>`, 8 → 8) while
   `classIdToSrdIndex` is partial (`Partial<Record<ClassId, SpellClassId>>` —
   barbarian, fighter, monk and rogue have no SRD spell index). Assert exactly
   that: total in the SRD-index → prefixed direction, and round-trip identity on
   the eight spellcasters only. This is the one place the correspondence is
   allowed to live.
3. Retype the four class-keyed rule tables as `Record<ClassId, …>` — or
   `Partial<Record<ClassId, …>>` where the table is intentionally incomplete
   (`MASTERY_SLOTS` covers six of twelve, `PREPARED_SPELLS_BY_CLASS` and
   `LEVEL_1_SPELL_SELECTION_BY_CLASS` eight of twelve) — in
   `multiclass-rules.ts`, `spellcasting.ts` (both tables), and
   `weapon-mastery.ts`.
   **Keep the public function signatures on `string`; do not "fix whatever the
   compiler surfaces at call sites".** A `Record<ClassId, …>` cannot be indexed
   with the `string` every caller holds, and every caller holds a `string`: the
   value comes off `CharacterClass.classId`, typed `z.string()` in
   `schemas/character.ts` and read straight from the DB in the server router, the
   level-up service, the weapon-mastery service, the character-create service,
   and two client helper modules. Instead add a `isClassId(value: string): value is ClassId`
   predicate next to the `as const` array, narrow **inside** each lookup function,
   and keep the existing unknown-id fallbacks (`?? 0`, `return []`, `?? null`, the
   caster-type formula) exactly as they are — they are the contract for ids these
   tables do not cover. Narrowing the signatures instead would require a parse
   boundary at all ten call sites and a decision about what to do when the parse
   fails; that is a separate, larger piece of work and is explicitly not this leaf.
4. Replace the dual-key fallback at `spellcasting.ts:197` with a single lookup
   plus, where the caller genuinely holds an SRD index, an explicit conversion
   through step 2's mapping. Both live callers
   (`routers/character-spell.ts:54`, `pages/sheet-helpers.ts:98`) already pass
   the prefixed form, so this should be a deletion rather than a rewrite — do it
   only after step 3 has made the convention visible in the types. Deleting the
   fallback while a caller still passes an SRD index is how you ship a silently
   wrong prepared-spell count.
   `spellcasting.test.ts:283-296` deliberately pins the unprefixed branch and
   will go red; it characterises the fallback, not a production caller, so delete
   or rewrite it in the same commit and state in the commit message that no
   production caller passes an unprefixed id.
5. Route all six ad-hoc conversions through step 2's mapping: the five
   `replace(/^class-/, "")` strips (`add-spell-dialog.tsx:135`,
   `spells-review-card.tsx:24`, `spell-selection-step.tsx:15`,
   `character-create-spells.ts:148`, `character-spell.ts:87`) and the
   `` `class-${classId}` `` comparison at `combat-eligibility.ts:30`. Delete the
   compensating comment at `add-spell-dialog.tsx:134`. `classIdToSrdIndex` is
   partial, so each of these sites now has to decide what a non-spellcaster class
   id means where today it silently produced an unmatched bare string: decide it
   per site and pin it with a test, because two of them feed a tRPC query argument
   (`spells-review-card.tsx:24`, `spell-selection-step.tsx:15`) and two gate a
   validation branch (`character-create-spells.ts:148`, `character-spell.ts:87`).
   Once the mapping returns a typed value the `isSpellClassId` guard at
   `add-spell-dialog.tsx:136` becomes redundant.

## Scope / caveats

- **Do not collapse the two conventions into one union and normalise the data.**
  They have different owners: `SPELL_CLASS_IDS` values are persisted in the
  `Spell.classes` JSON column and are documented at `spell.ts:37-40` as SRD index
  values consumed by the seed script. Unifying the spelling means a data
  migration of that column plus a seed-script change, which is a much larger and
  riskier piece of work than the typing fix. The declared mapping in step 2 buys
  the compile-time safety without touching persisted data; take that first and
  treat normalisation as a separate, explicitly scoped decision.
- If a migration is ever attempted anyway, it is a Prisma schema/data change —
  follow `docs/guides/add-prisma-migration.md` — and it invalidates seeded spell
  data, so it is not a "just change the type" commit.
- `armor-class.ts:112` (`UNARMORED_DEFENSE_CLASSES`, keyed `Barbarian`/`Monk`) is
  **out of scope** for this leaf. It keys on class display names arriving via
  `classNames`, a different input path from `classId`; folding it into a
  `ClassId` union would require changing what `computeCharacterAc` receives.
  Note it, leave it, and raise it separately if it matters.
- Every table listed here encodes SRD 5.2.1 numbers (prepared-spell progressions,
  mastery slots, multiclass ability prerequisites). Retyping must not touch a
  single numeric value, and the `eslint-disable`/`enable no-magic-numbers`
  comments around the SRD data blocks
  (`spellcasting.ts:176` and neighbours, `sorcery-points.ts:13`) must be preserved
  verbatim. Read `docs/guides/change-rules-logic.md` before editing these files,
  and `docs/guides/lint-ratchet.md` if the retype shifts any suppression.
- **`ClassId` is not the type of every class-shaped string in the system.**
  `Class.id` is a free-form `String @id` (`schema.prisma:468-469`) with no
  default, and `CharacterClass.classId` is a foreign key to it
  (`schema.prisma:904`, relation at `:910`). Today the only writer of `Class` rows
  is the SRD seed (`seed/seed-srd-classes-and-features.ts:11-13`, over the literal
  ids `class-barbarian` … `class-wizard` in `seed/seed-srd-classes.ts:22-276`),
  and homebrew classes are `HomebrewEntry` rows, not `Class`
  rows — so no non-SRD id reaches these tables in the current schema. That is a
  property of the data, not of the types: the ids are still `string` end to end,
  nothing stops a future writer, and the unknown-id fallbacks are the only thing
  standing between that and a wrong number. Type the tables, keep the fallbacks,
  and do not write a commit message claiming the union is exhaustive over
  runtime class ids.
- Steps 1-2 are additive and low-risk. Step 3 is mechanical *only* if the
  signatures stay on `string`; step 4 is the one that can change behaviour. Land
  step 4 separately with its own tests so a bisect can isolate it.
- Sizing note: four tables across three files, two new exported types plus a
  mapping and its test, a predicate at each lookup, six conversion sites to
  rewrite across `server` and `client`, and ten production lookup call sites that
  have to be read (even where they do not change) to confirm which convention
  they pass.
- No hard sequencing dependency on other leaves, but leaf 20 also edits
  `packages/shared/src/rules/spellcasting.ts` (the cantrip/progression tables) and
  leaf 21 moves shared constants. Avoid working them concurrently in the same
  file.
