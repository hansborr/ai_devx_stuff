---
title: Follow-up — SRD provenance for casterType / ritualCaster
status: open
date: 2026-04-19
source: review of `refactor/class-caster-type`
---

# Follow-up — SRD provenance for casterType / ritualCaster

Two issues were surfaced during review of `refactor/class-caster-type`. Both
pre-date that branch or are better addressed outside it, but we should not
let them slip.

## 1. `Class.ritualCaster` semantics don't match 2024 SRD 5.2

### What the branch ships

`seed-srd-classes.ts` seeds `ritualCaster: true` for Bard, Cleric, Druid, and
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

So the current `ritualCaster: true` for Bard/Cleric/Druid/Wizard conflates:

- The removed 2014 "Ritual Casting" gate, and
- The current 2024 Wizard-only "Ritual Adept" feature.

### Why it's latent

No consumer currently reads `Class.ritualCaster`. The column is plumbed from
Prisma → shared schema → tRPC output → client homebrew form defaults, but
nothing branches on it. The SRD review flagged this as a trap for any future
consumer — the semantics don't match any 2024 rule.

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

Option 2 is the cleanest alignment with 2024 SRD 5.2. Option 1 is fine too
if we don't anticipate needing the Ritual Adept distinction soon. Prefer
not to leave option 3 as a permanent state.

### Where to change things

- `packages/server/prisma/schema.prisma` (rename or drop column + migration)
- `packages/server/src/seed/seed-srd-classes.ts`
- `packages/shared/src/schemas/srd.ts` (`classSchema.ritualCaster`)
- `packages/shared/src/schemas/homebrew.ts` (`classDataSchema` inherits)
- `packages/client/src/components/homebrew/class-form-data.ts`
- Related tests

## 2. Eldritch Knight and Arcane Trickster are not in SRD 5.2.1

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

## 3. Homebrew caster fields have no UI input

### What the branch ships

`Class.casterType` / `Class.ritualCaster` and `Subclass.casterType` /
`Subclass.spellcastingAbility` are now plumbed through Prisma, the shared
schemas, the homebrew form data layer (`ClassFormData`, `SubclassFormData`),
and `caster-form-utils.ts` exports a ready-to-use `CASTER_TYPE_OPTIONS`.

### What's missing

Neither `class-form-fields.tsx` nor `subclass-form-fields.tsx` renders an
input for these fields. A DM creating a homebrew full-caster class or an
EK-style third-caster subclass gets the schema defaults (`casterType:
"none"`, no ability override) with no way to change them — the homebrew
entry will have the right shape but no spell slots or spellcasting ability
at runtime.

Acceptable for the refactor-first branch; the branch existed specifically
to land the data-layer denormalization ahead of the homebrew UI work.

### Where to change things

- `packages/client/src/components/homebrew/class-form-fields.tsx` — add
  a `Select` bound to `form.casterType` using `CASTER_TYPE_OPTIONS`, plus
  (pending the §1 ritualCaster semantics decision) either a checkbox for
  `ritualCaster` or nothing until that flag is redefined.
- `packages/client/src/components/homebrew/subclass-form-fields.tsx` —
  add Select controls for `casterType` and `spellcastingAbility`. The
  EK/AT pattern is the canonical example: third caster, INT ability.
- Extend the form E2E coverage in `e2e/homebrew-*.spec.ts` once controls
  are wired.

### Recommendation

Land alongside the next homebrew-class branch. The data layer is ready;
this is purely the user-facing surface.

## Scope

All three issues are **out of scope** for `refactor/class-caster-type`.
That branch preserves existing behavior for Warlock, EK, AT, and ritual
flags, and intentionally defers homebrew UI until the dedicated follow-up.
The correctness concerns in §1 and §2 apply equally to `main`; §3 is new
surface introduced by this branch and is expected next-branch work.
