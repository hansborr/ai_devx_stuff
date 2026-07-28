---
title: Follow-up — SRD provenance for casterType / ritualAdept
status: resolved
date: 2026-04-19
resolved: 2026-06-16
source: review of `refactor/class-caster-type`
---

# Follow-up — SRD provenance for casterType / ritualAdept

Three issues were surfaced during review of `refactor/class-caster-type`. They
pre-date that branch or are better addressed outside it, but we should not let
them slip.

## 1. `Class.ritualCaster` semantics don't match 2024 SRD 5.2

Status as of 2026-05-10: resolved in the BatonLoop branch by renaming
`Class.ritualCaster` / `classes.ritual_caster` to
`Class.ritualAdept` / `classes.ritual_adept`, seeding only Wizard as true, and
preserving legacy `ritualCaster` import/form payloads as `ritualAdept`.

### What the reviewed branch shipped

`seed-srd-classes.ts` seeded `ritualCaster: true` for Bard, Cleric, Druid, and
Wizard, and `false` for everyone else.

### Why that's wrong for 2024 SRD

In 2014, several classes had a class-level "Ritual Casting" feature that
gated whether a character could cast rituals at all. 2024 SRD 5.2 removed
that pattern. The general rule (`08_RulesGlossary.md:857-859`, `07_Spells.md:56`)
is now: *any* caster with a ritual-tagged spell prepared can cast it as a
ritual. There is no class-gating feature on Bard, Cleric, or Druid.

Wizard is the only class with a distinct ritual-related feature in 2024:
**Ritual Adept** (`03_Classes/12_Wizard.md:84-86`) lets the Wizard cast
rituals from the spellbook *without preparing them first* — an additive
power, not a gate.

So the old `ritualCaster: true` for Bard/Cleric/Druid/Wizard conflated:

- The removed 2014 "Ritual Casting" gate, and
- The current 2024 Wizard-only "Ritual Adept" feature.

### Why it's latent

At review time, no consumer read `Class.ritualCaster`. The column was plumbed
from Prisma → shared schema → tRPC output → client homebrew form defaults, but
nothing branched on it. The SRD review flagged this as a trap for any future
consumer — the semantics didn't match any 2024 rule.

### Options

1. **Drop the column entirely.** Derive "can cast this spell as a ritual"
   purely from `casterType !== "none"` ∧ spell is Ritual-tagged ∧ spell is
   prepared.
2. **Redefine as Wizard-only "Ritual Adept."** Rename to `ritualAdept`
   (or similar) and set `true` only for Wizard. Other classes default
   `false`. Any future UI that needs "can cast without preparing" reads
   this flag; general ritual casting uses option 1's logic.
3. **Ship as-is and document.** Add a docstring on the schema field and
   in `docs/srd-data-sources.md` explaining that the current assignment
   doesn't cleanly map to a 2024 rule. Cheap; risky if another dev wires
   it up later without reading the doc.

### Recommendation

Option 2 is the chosen path as of 2026-05-10. Rename the field to
`ritualAdept` and define it as the Wizard-style ability to cast Ritual-tagged
spells from a spellbook/book-equivalent without preparing them. SRD class seed
data should set it to `true` only for Wizard; Bard, Cleric, and Druid should
be `false`.

General ritual casting should not read this flag. It is derived from the
spell being prepared and Ritual-tagged (`08_RulesGlossary.md:857-859`).
Wizard's exception is the only SRD 5.2.1 class-level ritual exception
(`03_Classes/12_Wizard.md:84-86`).

### Implementation slice

Landed on 2026-05-10 as a metadata-only slice:

1. Renamed `Class.ritualCaster` / `classes.ritual_caster` to
   `Class.ritualAdept` / `classes.ritual_adept` with a Prisma migration.
2. Updated SRD seed data so Wizard is the only `ritualAdept: true` class.
3. Renamed the shared schemas, tRPC output mapping, homebrew data shape, client
   class form data plumbing, and related fixtures/tests from `ritualCaster` to
   `ritualAdept`.
4. Do not add cast-flow gating in this slice. The follow-up class-form UI leaf
   exposed `casterType`, `spellcastingAbility`, and a `ritualAdept` checkbox.
   A later spellcasting behavior audit should make unprepared ritual casting
   require `ritualAdept`; prepared ritual casting continues to use only
   prepared spell plus Ritual tag.

### Changed files

- `packages/server/prisma/schema.prisma` (rename column + migration)
- `packages/server/src/seed/seed-srd-classes.ts`
- `packages/shared/src/schemas/srd.ts` (`classSchema.ritualAdept`)
- `packages/shared/src/schemas/homebrew.ts` (`classDataSchema` inherits)
- `packages/client/src/components/homebrew/class/class-form-data.ts`
- Related tests

## 2. Eldritch Knight and Arcane Trickster are not in SRD 5.2.1

Status as of 2026-06-16: resolved. `2f1d857d` (`fix(licensing): prepare public
SRD release`) removed the `subclass-eldritch-knight` and
`subclass-arcane-trickster` entries from `seed-srd-subclass-data.ts`.

### What the branch ships

`seed-srd-subclass-data.ts` seeds Eldritch Knight (Fighter) and Arcane
Trickster (Rogue) as third casters with INT spellcasting.

### Why that's a provenance issue

A grep of `docs/refs/dndsrd5.2_markdown/src/` for "Eldritch Knight" and
"Arcane Trickster" returns zero hits. `03_Classes/05_Fighter.md` ships only
the Champion subclass; `09_Rogue.md` ships only the Thief. Both archetypes
exist only in the proprietary 2024 PHB, not in the CC-licensed 2024 SRD 5.2.

EK/AT in this codebase pre-date the `refactor/class-caster-type` branch.
The current branch only added caster metadata (`casterType`, `spellcastingAbility`)
— it did not introduce the subclasses themselves. But the rules review
flagged the licensing/provenance issue, and it's worth addressing before
we ship any additional content tied to these subclasses (spell lists,
feature tables, etc.).

### What's missing

Even setting provenance aside, only caster metadata is seeded today. The
subclass feature records — Weapon Bond, War Magic, Eldritch Strike, Arcane
Charge, Magical Ambush, Versatile Trickster, Spell Thief, plus the per-level
spells known / cantrips known tables — are not present.

### Options

1. **Relabel as non-SRD.** Change `sourceType` on these two subclass rows
   (and any associated feature rows) to `homebrew` or a new value like
   `phb2024`. Adjust seed pathways so EK/AT are only seeded when that
   pathway is enabled.
2. **Remove from seed and re-add via a separate data source.** Keep the
   code paths (casterType override works regardless of source) but don't
   seed the rows until we have a licensed or clearly scoped data source.
3. **Document and keep.** Add a comment in the seed file and a note in
   `docs/srd-data-sources.md` that these two subclasses are NOT from SRD
   5.2 and are included pending a licensing/content decision. Weakest
   option from a provenance standpoint.

### Recommendation

Option 1 or 2. Option 3 leaves a licensing ambiguity in SRD-labeled data
that's hard to clean up later. The fix is small; the cost of getting it
wrong compounds as more EK/AT content lands.

### Where to change things

- `packages/server/src/seed/seed-srd-subclass-data.ts`
- `packages/server/prisma/schema.prisma` (if `sourceType` needs a new value)
- `docs/srd-data-sources.md` (document the provenance explicitly)
- `packages/server/src/seed/seed-srd-classes-and-features.ts` (if EK/AT
  feature records are seeded there)

## 3. Homebrew subclass caster fields still need UI input

Status: resolved. `subclass-form-fields.tsx` now renders both the subclass
`casterType` select (line 45) and the `spellcastingAbility` select (line 66).

### What the branch ships

`Class.casterType` / `Class.ritualAdept` and `Subclass.casterType` /
`Subclass.spellcastingAbility` are now plumbed through Prisma, the shared
schemas, the homebrew form data layer (`ClassFormData`, `SubclassFormData`),
and `caster-form-utils.ts` exports ready-to-use caster option helpers.

### What's missing

`class-form-fields.tsx` now renders class `casterType`, `spellcastingAbility`,
and `ritualAdept` controls. `subclass-form-fields.tsx` still does not render
inputs for `casterType` or `spellcastingAbility`. A DM creating an EK-style
third-caster subclass gets the schema defaults (`casterType: "none"`, no
ability override) with no way to change them — the homebrew entry will have
the right shape but no subclass spell slot or spellcasting ability override at
runtime.

Acceptable for the refactor-first branch; the branch existed specifically
to land the data-layer denormalization ahead of the homebrew UI work.

### Where to change things

- `packages/client/src/components/homebrew/subclass/subclass-form-fields.tsx` —
  add Select controls for `casterType` and `spellcastingAbility`. The
  EK/AT pattern is the canonical example: third caster, INT ability.
- Extend the form E2E coverage in `e2e/homebrew-*.spec.ts` once controls
  are wired.

### Recommendation

Land the remaining subclass controls from the BatonLoop queue. The data layer
is ready; this is purely the user-facing surface.

## Scope

All three issues were **out of scope** for `refactor/class-caster-type`.
That branch preserved existing behavior for Warlock, EK, AT, and ritual flags,
and intentionally deferred homebrew UI until dedicated follow-ups. All three
are now resolved: section 1 in the BatonLoop rename, section 2 by the
public-release seed cleanup (`2f1d857d`), and section 3 by the subclass caster
controls in `subclass-form-fields.tsx`.
