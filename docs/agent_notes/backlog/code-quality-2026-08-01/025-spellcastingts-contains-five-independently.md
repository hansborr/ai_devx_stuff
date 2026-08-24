# 25. spellcasting.ts packs five independently changing rule areas — caster resolution, slot progression, prepared limits, cantrip fallback, and creation selection — into one 380-line module

Status: Not started
Theme: one rule area per file · Area: shared · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/shared/src/rules/spellcasting.ts` is where five separate rule areas
happen to live: effective-caster resolution (class vs subclass override),
spell-slot progression with multiclass stacking, prepared-spell limits, a
non-SRD cantrip-count fallback policy, and level-1 character-creation spell
selection. Each area has its own tables, its own public API, and its own reasons
to change — a slot-table correction, a prepared-limit errata, a house-policy
tweak to the unknown-class fallback, and a creation-flow change are four
unrelated edits that all land in the same file and share one review boundary.

The rules directory's own contract is one rule area per file: every non-test
`.ts` file is its own public subpath, and the module doc explicitly prefers
"the specific rule module that owns the concept" over broader groupings. The
siblings honor that (`armor-class.ts`, `attack-roll.ts`, `concentration-save.ts`,
`sorcery-points.ts`, …); `spellcasting.ts` is the grab-bag exception, and its
broad name no longer tells a navigating reader which of the five areas they
will find — or which consumers a change can break. The consumers themselves
show the seams: ten production files import from it, and each pulls from only
one or two of the five areas. The paired test files inherit the problem at
double size — 676 example-test lines plus 149 property-test lines against one
module path.

The 2026-07-25 shared cluster already did the typing work inside this file
(class-keyed `Record` typing, level-bound dedup) but left the
module boundary itself untouched.

The cantrip tests also hide the authority of the behavior they protect. Their
generic progression names read like ordinary 5E rules even though production
explicitly classifies the caster-type tables as Musi non-SRD fallback policy
because the SRD class-specific counts differ.

## Evidence

- `packages/shared/src/rules/spellcasting.ts` — exactly 380 lines (re-measured
  at the pin), organized into five banner-comment sections:
  - `:18-34` effective-caster resolution — `EffectiveCaster`,
    `resolveEffectiveCaster`.
  - `:36-146` slot tables and progression — `EMPTY_SLOTS`, `FULL_CASTER_SLOTS`,
    `getSpellSlotsForLevel`, `ClassEntry`, `getMulticlassCasterLevel`,
    `getMulticlassSpellSlots`.
  - `:148-245` prepared-spell limits — five class tables,
    `PreparedSpellLimitInput`, `getMaxPreparedSpells`,
    `getMulticlassMaxPreparedSpells`.
  - `:247-332` cantrip fallback — three caster-type tables and
    `getCantripsKnown`, each table marked "Musi non-SRD policy" (`:251-252`,
    `:276`, `:300`).
  - `:334-380` level-1 creation selection — `Level1SpellSelection`,
    `getLevel1SpellSelection`.
- The tail two areas are separable, not one: `getLevel1SpellSelection` prefers
  the per-class SRD table (`:353-364`, keyed via `isSrdClassId` at `:376`) and
  only falls back to `getCantripsKnown` at `:379`.
- Ten production consumers, each importing one or two areas:
  `packages/server/src/utils/caster-resolver.ts:1-2` (effective caster only),
  `packages/server/src/utils/spell-slot-sync.ts:1-2`,
  `packages/server/src/services/rest-service.ts:4`,
  `packages/server/src/services/level-up/types.ts:1`,
  `packages/server/src/services/level-up/core.ts:5`,
  `packages/server/src/services/character-create-helpers.ts:1` (all slots only),
  `packages/server/src/utils/prepared-spells.ts:30` (prepared only),
  `packages/server/src/services/character-create-spells.ts:3` (selection +
  prepared), `packages/client/src/pages/character-sheet/sheet-helpers.ts:10-13`
  (prepared + effective caster),
  `packages/client/src/components/character-create/wizard-state.ts:1`
  (selection only). Two server test files also import:
  `packages/server/src/utils/spell-slot-sync.test.ts:1` and
  `packages/server/src/services/character-create-spells.test.ts:1`.
- The cross-area dependencies inside the file are narrow: prepared limits
  reuses the private `clampSpellSlotTableLevel` (`:80-85`, called at `:202` and
  `:213`) and the `HALF_CASTER_DIVISOR`/`THIRD_CASTER_DIVISOR` constants
  (`:76-77`, used at `:220`, `:222`); level-1 selection also calls
  `getCantripsKnown` at `:379`.
- `packages/shared/src/rules/spellcasting.ts:9` — `export type { CasterType }`,
  a pass-through whose only importer anywhere is the module's own test
  (`spellcasting.test.ts:3`); every other consumer of the type already imports
  it from `@musi/shared/schemas/srd.js` (e.g. `level-up/core.ts:7`,
  `sheet-helpers.ts:16`, `wizard-state.ts:2`).
- `packages/shared/src/rules/MODULE.md:24-26` — "Each non-test `.ts` file is
  its own public subpath after build. Prefer adding or changing the specific
  rule module that owns the concept instead of introducing a directory barrel."
  `packages/shared/package.json:13-16` — the wildcard `"./rules/*.js"` export
  that makes any new sibling file importable with zero package.json changes.
- Paired tests: `spellcasting.test.ts` is 676 lines / 75 `it(` cases;
  `spellcasting.property.test.ts` is 149 lines / 8 `it(` cases (re-counted).
  Reproduce these totals, together with the 380-line source-module total, with
  `wc -l packages/shared/src/rules/spellcasting{,.test,.property.test}.ts` and
  `rg -c 'it\(' packages/shared/src/rules/spellcasting{.test,.property.test}.ts`.
- `packages/shared/src/rules/spellcasting.test.ts:569-610` — the nine
  full-/half-/third-caster progression cases use generic describe and test
  names; `:666-670` likewise names the unknown-class fallback without saying
  that it protects Musi non-SRD policy.
- `docs/guides/change-rules-logic.md:38-40` — behavior absent from or ambiguous
  in the SRD must remain explicit app policy, and the test name must identify
  the policy it protects.
- Directives that must travel with a split: broad
  `eslint-disable no-magic-numbers` blocks at `:42`/`:65` (slot table) and
  `:156`/`:176` (prepared tables); `Stryker disable next-line` at `:93` and
  `:143` (both in the slots section); the
  `type-assertion-boundary: framework` marker at `:83`. The file-level broad
  disable is permitted by name at
  `scripts/data/eslint-disable-broad-allowlist.txt:6`
  (`packages/shared/src/rules/spellcasting.ts|no-magic-numbers`), enforced by
  `scripts/eslint-disable-register.sh` via `bun run lint:suppressions`.

## Proposed direction

Split `packages/shared/src/rules/spellcasting.ts` along its five existing
section-comment boundaries into flat sibling modules matching the rules
directory's one-rule-area-per-file idiom:

1. `effective-caster.ts` — `EffectiveCaster`, `resolveEffectiveCaster`.
2. `spell-slots.ts` — `EMPTY_SLOTS`, `FULL_CASTER_SLOTS`, `ClassEntry`,
   `getSpellSlotsForLevel`, `getMulticlassCasterLevel`,
   `getMulticlassSpellSlots`, plus `clampSpellSlotTableLevel` and the
   HALF/THIRD caster divisors newly exported, since prepared limits needs them
   (`THIRD_CASTER_START_LEVEL` and `slotsForTableLevel` stay private here).
3. `prepared-spell-limits.ts` — the five prepared tables,
   `PreparedSpellLimitInput`, `getMaxPreparedSpells`,
   `getMulticlassMaxPreparedSpells`; imports the clamp helper and divisors from
   `spell-slots.ts`.
4. `cantrips.ts` — the three non-SRD fallback tables and `getCantripsKnown`,
   keeping the Musi-policy comments that mark them non-SRD.
5. `level-1-spell-selection.ts` — `Level1SpellSelection`,
   `getLevel1SpellSelection`; imports `getCantripsKnown` and `isSrdClassId`.

Delete `spellcasting.ts` outright with no compatibility barrel — the package's
wildcard `"./rules/*.js"` subpath export makes the new files importable with
zero package.json changes — and repoint the ten production consumer files plus
the two server test files listed in Evidence; each imports only one or two
areas, so the repoint is purely mechanical and compiler-verified
(`bun run code:intel -- dependents packages/shared/src/rules/spellcasting.ts`
gives the census; ignore any `packages/server/dist/*.d.ts` grep hits — build
artifacts). Drop the unused `export type { CasterType }` pass-through; each new
module (and split test file) imports `CasterType` from `../schemas/srd.js`
directly, as `spellcasting.property.test.ts:4` already does.

Split `spellcasting.test.ts` (676 lines) and `spellcasting.property.test.ts`
(149 lines) beside the new modules along the same boundaries. As part of the
cantrip test split, rename every fallback-policy `describe` and `it` case so
its full name explicitly says it pins Musi non-SRD fallback policy. This
includes all nine progression cases at `spellcasting.test.ts:569-610` and the
unknown-class fallback at `:666-670`, wherever that case lands after the split.
Preserve the tables, assertions, characterization coverage, and existing
provenance comments; this is a naming change, not a rules change. Treat the
policy-bearing full test names as an acceptance criterion alongside the
before/after case census.

Retarget the `scripts/data/eslint-disable-broad-allowlist.txt:6` entry to the
two new table-bearing files (`spell-slots.ts`, `prepared-spell-limits.ts` — one
line each) in the same commit as the split, and confirm with
`bun run lint:suppressions`. Check `packages/shared/src/rules/MODULE.md`
afterwards: it names spellcasting only at concept level (`:3`, `:10`) and keeps
no per-file inventory, so it likely needs no edit — verify rather than assume.

Land the module/test split and all shared/server/client import repoints in one
atomic commit; deleting `spellcasting.ts` without a compatibility barrel makes
a staged multi-commit split fail the commit gate until every consumer is
repointed.

Out of scope: any behavior or table-value change, further typing work (the
2026-07-25 shared cluster landed that), reorganizing the server-side spell
utils, and touching other rules files.

## Scope / caveats

- **Directive travel is the main lint/mutation risk.** The
  `eslint-disable no-magic-numbers` fences (`:42`/`:65`, `:156`/`:176`), both
  `Stryker disable next-line` comments (`:93`, `:143`), and the
  `type-assertion-boundary: framework` marker (`:83`) must land in the correct
  new files — the fences and marker all belong to `spell-slots.ts` and
  `prepared-spell-limits.ts`. The broad-disable allowlist retarget (Evidence,
  last bullet) is part of the same unit; without it the suppressions gate fails
  on the two new files.
- **Keep the new exports minimal.** Exporting `clampSpellSlotTableLevel` and
  the two divisors widens the public rules API; export exactly those three,
  documented, and do not export every former private (`MIN_PREPARED`,
  `slotsForTableLevel`, `THIRD_CASTER_START_LEVEL`, the raw tables' helpers
  stay private).
- **Verify the test split by census, not eyeball.** With 825 test lines
  redistributed across the new files it is easy to silently drop cases; compare
  `it(`-name counts before/after (75 + 8 at the pin), and require every
  fallback-policy case name to identify Musi non-SRD policy explicitly.
- **Do not invent SRD provenance or change the accepted fallback.** The tables,
  values, assertions, and production comments remain authoritative; propagate
  their existing Musi-policy classification into test names only.
- **Expect ratchet accounting, not regressions.** The known lint-ratchet
  net-neutral-rename gap means moved code counts under new file paths; run the
  ratchet gate early and treat a delta as baseline accounting to resolve, not
  as a real regression.
- Comment-only path references to the old file may be updated opportunistically
  (`packages/server/src/utils/prepared-spells.ts:5`,
  `prepared-spells.test.ts:16`, `packages/server/src/seed/seed-srd-classes.test.ts:9`);
  the two migration-SQL comments naming the file are immutable history — leave
  them.
- Shared rules are contract surface: read `docs/guides/change-rules-logic.md`
  before starting, even though no behavior moves.
- Prior pack: the 2026-07-25 shared cluster
  ([SHARED-CLUSTER-PLAN.md](../code-quality-2026-07-25/SHARED-CLUSTER-PLAN.md),
  landed) typed the class-keyed tables in this file and deduplicated its level
  bounds, but did not address the five-area module boundary; this leaf is the
  boundary work only, and re-doing typing here is out of scope.
- Prior-pack residual: CQ25-95 in
  [code-quality-2026-07-25/CONSTRAINTS.md](../code-quality-2026-07-25/CONSTRAINTS.md)
  requires policy-bearing test names, while CQ25-182 in
  [code-quality-2026-07-25/SHARED-CLUSTER-PLAN.md](../code-quality-2026-07-25/SHARED-CLUSTER-PLAN.md)
  settles the cantrip tables as Musi non-SRD fallback policy. This leaf carries
  those rulings into the affected names; it does not re-open their provenance
  or values.
- Cross-reference: [021-shared-production-builds-expose-colocated.md](./021-shared-production-builds-expose-colocated.md)
  counts shared's production modules vs colocated test suites (72/73 at the
  pin); this split shifts those counts (+4 production modules, more test
  files). No ordering dependency — whichever lands second absorbs the drift —
  but do not work the two concurrently in `packages/shared`.
- Cross-reference:
  [004-character-creation-large-pseudo-module-loose.md](./004-character-creation-large-pseudo-module-loose.md)
  moves and renames the character-creation files this leaf repoints. No hard
  ordering, but do not work the leaves concurrently: if 004 lands first, apply
  these shared-rule import repoints to its post-move `nested-creates.ts`,
  `spells.ts`, and `spells.test.ts`; if 025 lands first, 004 must move the
  already-repointed files without restoring the old shared imports.
