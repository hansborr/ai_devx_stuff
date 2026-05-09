---
title: Character-level homebrew selection
status: parked
date: 2026-04-26
source: extracted from the old product roadmap during the 2026-04-26 cleanup
---

# Character-Level Homebrew Selection

Deferred follow-up for letting players and DMs pick homebrew species,
backgrounds, classes, subclasses, feats, and spells when building or leveling
a character. These surfaces were intentionally cut because they require a
schema design that is a one-way door.

Promote when the polymorphic schema design is ready to start.

## Why This Was Deferred

Character-level selection requires moving Character-scoped foreign keys from
"FK to SRD-only table" to a polymorphic shape that can resolve to either
SRD or homebrew rows. That migration is a one-way door; the 7c review
unanimously chose to land DM-facing surfaces first and design the character
migration as its own workstream.

## Remaining Work

- [ ] **Schema migration.** Polymorphic FKs — or FK plus nullable homebrew
      FK — on every Character-scoped reference: `Character.speciesId`,
      `Character.subspeciesId`, `Character.backgroundId`,
      `CharacterClass.classId`, `CharacterClass.subclassId`,
      `CharacterFeat.featId`, `CharacterSpell.spellId`.
- [ ] **Authorization policy when a DM unlinks** a homebrew collection a
      character already references. Pick one explicitly per reference type:
      grandfather the existing character, block new level-ups while
      preserving current state, or snapshot the homebrew row at character
      time. The right answer may differ for species/background (immutable)
      vs. spells (acquired over time).
- [ ] **Unified SRD + homebrew loader** in `packages/shared/rules/` and the
      server services that consume those rules, so feature/proficiency/spell
      resolution does not branch on `sourceType`.
- [ ] **Character wizard.** Homebrew tabs on species, class, subclass,
      background, feat, and spell steps. Reuse the campaign-link-aware
      `homebrew.listCampaignEntries` query.
- [ ] **Character sheet and level-up.** Homebrew-aware proficiency, feature,
      and spell rendering. Class/subclass/feat pickers must surface homebrew
      collections linked to the campaign.
- [ ] **Compendium pages (optional).** Homebrew species/class/background/feat
      browse, parallel to the existing `/compendium/magic-items`.

## Groundwork Already Landed

These items are in main today and reduce the blast radius of the migration
above:

- **Caster-type denormalization.** `Class.casterType`, `Class.ritualCaster`,
  `Subclass.casterType`, and `Subclass.spellcastingAbility` columns now live
  on the row and replace the hardcoded SRD-name maps in
  `packages/shared/rules/spellcasting.ts`. Homebrew classes and subclasses
  can specify spellcasting metadata directly.
- **Homebrew data shapes for every character-level type** exist in
  `packages/shared/src/schemas/homebrew.ts` (species, class, subclass,
  background, feat, spell) and mirror their SRD counterparts.
- **Campaign-scoped read access** through
  `homebrew.listCampaignEntries({ campaignId, type })` works for any entry
  type — the wizard and sheet can consume it directly once the UI lands.
- **Two proven polymorphic patterns** to pick from:
  - Inline snapshot plus provenance breadcrumb, as used by
    `EncounterParticipant.homebrewMonsterEntryId` /
    `homebrewMonsterEntryVersion`.
  - `sourceType` plus `sourceId`, as used by `InventoryItem` and
    `ItemSourceType`.

## Open Prerequisites

- `followup-srd-castertype-issues.md` — `Class.ritualCaster` semantics need
  to be redefined or dropped; Eldritch Knight / Arcane Trickster need
  provenance cleanup; homebrew class and subclass forms need caster-field
  inputs wired before character-level selection is meaningful.

## Promotion Checklist

1. Decide which polymorphic pattern (inline snapshot vs. `sourceType` +
   `sourceId`) applies to each Character-scoped reference type.
2. Resolve the prerequisites in `followup-srd-castertype-issues.md` — at
   minimum the `ritualCaster` semantics question.
3. Promote into `in_progress/` with a per-table migration plan and the
   chosen unlink policy per reference type.
