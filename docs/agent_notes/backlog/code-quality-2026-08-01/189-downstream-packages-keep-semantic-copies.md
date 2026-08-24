# 189. Consolidate downstream semantic copies around shared rule authorities

Status: Not started
Theme: Shared rule authorities · Area: cross-cutting · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Seven rules contracts already have shared authorities but retain equivalent or
conflicting declarations in downstream packages, while an eighth SRD rule
remains client-local beside the shared rules module where contributors
naturally look for it. Most values agree today, but three description controls
already cap valid input at 5,000 characters while their shared schemas accept
10,000. Neither the compiler nor the package boundary connects these copies.

The result is both drift risk and discoverability cost. A contributor changing
roll modes, spell-level bounds, template defaults, monster spell frequencies,
ability abbreviations, spell schools, or description limits can update the
apparent authority without finding the downstream copy. Parallel ability-name
and property-key arrays can also drift positionally, while the homebrew spell
parser's private school set could silently normalize a schema-valid but locally
absent school to Evocation. Campaign and collection authors are already unable
to enter descriptions that the canonical create and update contracts accept.
Challenge-rating proficiency is not itself duplicated in shared; its problem
is different and narrower: a reusable SRD rule is embedded in client form code
while adjacent CR-to-XP and valid-CR behavior live in shared.

## Evidence

- Shared declares `rollModeSchema` and `RollMode` inside the attack-specific input module, forcing generic d20, saving-throw, and attack-roll rules to import from that location (`packages/shared/src/schemas/attack-roll-inputs.ts:13-18`, `packages/shared/src/rules/d20-roll.ts:1-14`, `packages/shared/src/rules/saving-throw.ts:3`, `packages/shared/src/rules/attack-roll.ts:4`).
- The character-sheet context menu independently declares the same `"normal" | "advantage" | "disadvantage"` union and uses it for its helpers and menu inventory (`packages/client/src/components/sheet/roll-context-menu.tsx:7`, `packages/client/src/components/sheet/roll-context-menu.tsx:29-50`).
- Shared exports `MAX_SPELL_LEVEL = 9`, while server spell-slot synchronization declares `SPELL_LEVEL_COUNT = 9` and uses it as its loop bound (`packages/shared/src/constants.ts:12`, `packages/server/src/utils/spell-slot-sync.ts:7-17`).
- Shared exports `DEFAULT_TEMPLATE_SIZE_FT = 20`, while the map store declares and installs a separate `DEFAULT_TEMPLATE_SIZE = 20` (`packages/shared/src/map/area-template.ts:19-20`, `packages/client/src/stores/map-canvas-store.ts:196-208`).
- Shared owns `MONSTER_SPELL_FREQUENCIES`, but the monster spellcasting panel repeats the same ordered tuple; its labels are typed only as `Record<string, string>` (`packages/shared/src/schemas/monster.ts:102-113`, `packages/client/src/components/campaign/npcs/monster-spellcasting-block.tsx:8-17`).
- `packages/shared/src/schemas/srd.ts:26-28` — `abilityAbbreviationSchema`
  defines the canonical closed six-value ability contract and its inferred
  type.
- `packages/shared/src/rules/character-rules.ts:67-76` — `SAVE_ABILITIES`
  repeats all six schema literals beside the typed full-name presentation map.
- `packages/client/src/components/homebrew/monster/monster-form-data.ts:84-99`
  — the monster form derives neighboring size and creature-type options from
  shared authorities, but handwrites the full ability inventory.
- `packages/client/src/components/sheet/asi-step.tsx:1-16` — the ASI picker
  imports adjacent shared ability rules and types, then declares another
  six-value iteration list.
- `packages/client/src/components/campaign/npcs/monster-detail-dialog.tsx:23-31,82-96`
  — the NPC dialog keeps abbreviation and monster-property arrays aligned by
  positional index when rendering scores.
- `packages/shared/src/schemas/spell.ts:22-33` — `spellSchoolSchema` defines the
  canonical closed eight-value spell-school contract and its inferred type.
- `packages/client/src/components/homebrew/spell/spell-form-data.ts:34-45` —
  the homebrew editor repeats all eight school values with labels and derives
  its validator set from that private inventory.
- `packages/client/src/components/homebrew/spell/spell-form-data.ts:79-81` —
  `parseSchool` normalizes anything absent from the private set to
  `"evocation"`.
- `packages/client/src/components/sheet/add-spell-dialog.tsx:26-29` —
  neighboring spell UI already derives its school options from
  `spellSchoolSchema.options` and indexes a typed label authority.
- `packages/shared/src/constants.ts:55-60` — `MAX_DESCRIPTION_LENGTH` is the
  shared description-field authority and sets the canonical limit to 10,000.
- `packages/shared/src/schemas/campaign-inputs.ts:3-12,42-52` — campaign create
  and update schemas both validate descriptions against
  `MAX_DESCRIPTION_LENGTH`.
- `packages/shared/src/schemas/homebrew-inputs.ts:3-30` — collection create and
  update schemas use the same shared description limit.
- `packages/client/src/components/campaign/settings/create-campaign-dialog.tsx:60-71`
  — campaign creation exposes a description `Textarea` with an independent
  `maxLength={5000}`.
- `packages/client/src/components/campaign/settings/campaign-settings-panel.tsx:91-101`
  — campaign settings repeat the 5,000-character cap.
- `packages/client/src/components/homebrew/collections/collection-form-fields.tsx:48-60`
  — the shared collection create/edit control also repeats
  `maxLength={5000}`.
- `monster-form-data.ts` already imports shared `crToXp`, `formatCr`, and `VALID_CR_VALUES`, yet declares its own `CR_PROF` table and `crToProficiencyBonus` helper beside the form (`packages/client/src/components/homebrew/monster/monster-form-data.ts:1`, `packages/client/src/components/homebrew/monster/monster-form-data.ts:101-123`). No shared `crToProficiencyBonus` exists; this is a homing defect, not evidence of a duplicate.
- The current CR proficiency test merely checks that every valid CR produces a value from 2 through 9, rather than carrying the rule’s complete table behavior in the shared rules suite (`packages/client/src/components/homebrew/monster/monster-form-data.test.ts:422-428`).

## Proposed direction

Deliver this as two reviewable parts. The ability and spell-school additions
inside Part A are independently reviewable subparts and should not be coupled
to each other.

1. **Part A — consolidate the eight authorities.**

   - Move `rollModeSchema` and `RollMode` from `schemas/attack-roll-inputs.ts` into a neutral module such as `packages/shared/src/schemas/roll-mode.ts`. Repoint `attack-roll-inputs.ts`, `spell-action-inputs.ts`, `rules/d20-roll.ts`, `rules/saving-throw.ts`, `rules/attack-roll.ts`, and the surviving client combat toggle. Delete the private union in `roll-context-menu.tsx` while keeping `applyRollMode`, labels, and menu presentation client-local. Do not leave a compatibility re-export in the attack-specific module.
   - Replace `SPELL_LEVEL_COUNT` in `packages/server/src/utils/spell-slot-sync.ts` with `MAX_SPELL_LEVEL` from `@musi/shared/constants`.
   - Replace the map store’s `DEFAULT_TEMPLATE_SIZE` with `DEFAULT_TEMPLATE_SIZE_FT` from `@musi/shared/map/area-template.js`.
   - Import `MONSTER_SPELL_FREQUENCIES` into `monster-spellcasting-block.tsx` as the ordering authority. Keep labels local, but type them as `Record<MonsterSpellFrequency, string>` so vocabulary changes become compiler-visible.
   - Import `MAX_DESCRIPTION_LENGTH` from `@musi/shared/constants.js` into the campaign creation dialog, campaign settings panel, and collection form fields. Replace each `maxLength={5000}` with the shared constant so all three controls expose the same limit as their create and update schemas.
   - Move `CR_PROF` and `crToProficiencyBonus` from the client form into `packages/shared/src/rules/xp.ts`, beside `CR_TO_XP` and `VALID_CR_VALUES`. Treat this explicitly as homing a client-local SRD rule, not deduplicating an existing shared implementation. Add the provenance comment required for an SRD table and move complete valid-CR behavior coverage into the shared XP tests.
   - **Ability-vocabulary subpart.** Derive complete six-ability iterations from
     `abilityAbbreviationSchema.options`, including `SAVE_ABILITIES`, the
     homebrew monster form, and the sheet ASI picker. In the NPC dialog,
     replace the two positionally synchronized arrays with one explicit typed
     abbreviation-to-property map, then iterate the schema options. Keep
     display labels and property mappings explicit and typed rather than
     deriving presentation or object keys from abbreviation spelling.
   - **Spell-school subpart.** Build the homebrew spell editor's options from
     `spellSchoolSchema.options` plus one explicit
     `Record<SpellSchool, string>` label map. Remove `VALID_SCHOOLS` and parse
     through `spellSchoolSchema`, preserving `"evocation"` only as the fallback
     for genuinely invalid input. Add focused coverage that every schema
     option survives parsing and that invalid input retains the existing
     fallback.

2. **Part B — pin these consolidations narrowly.**

   Add a focused source-structure test that discovers and asserts the single declaration site for each of the eight authorities consolidated above. Match the distinctive removed identifiers and semantic literal shapes, including the three description-control caps; exclude generated and `dist` artifacts, assert that each scan found its intended subject, and avoid creating a general duplicate-literal detector or repository-wide constants framework.

   Extend the existing campaign creation, campaign settings, and collection
   dialog UI tests with focused assertions that each rendered description
   textarea's `maxLength` equals `MAX_DESCRIPTION_LENGTH`. Import the shared
   constant in those tests so the assertions do not introduce another literal
   copy.

The implementation acceptance pass must still search the whole live tree by identifier and semantic role, including complete ability inventories, spell-school option or validator copies, and description-limit controls or validators. Classify every remaining match as a canonical use, an intentional subset or presentation map, or a duplicate to remove. The permanent regression test may remain narrowly scoped to these eight authorities.

## Scope / caveats

- Shared authority values, tuple order, and rule behavior must remain unchanged.
  Apart from intentionally raising the three description controls from 5,000
  to the shared 10,000-character contract, this is six mechanical
  consolidations plus one SRD-rule homing move.
- Presentation labels remain client concerns. Keep ability labels,
  spell-school labels, and abbreviation-to-property mappings explicit and
  typed. `SPELL_FREQUENCY_OPTIONS` in `monster-form-data.ts` may be unified
  with the panel’s label map if convenient, but that is not required.
- Preserve intentional ordering. During the whole-tree sweep, retain and
  classify genuine subsets such as restricted spellcasting abilities rather
  than widening them to all six abilities.
- Do not touch the character-creation wizard surfaces owned by
  [045-character-creation-ability-rules-have-four.md](./045-character-creation-ability-rules-have-four.md);
  that leaf explicitly excludes sheet and homebrew ability surfaces.
- [053-filterselect-erases-schema-derived-option.md](./053-filterselect-erases-schema-derived-option.md)
  owns the generic `FilterSelect` value-typing boundary, not the homebrew
  spell editor's private school authority.
- Do not confuse CR-based proficiency with the level-based proficiency table in `packages/shared/src/rules/character-rules.ts`; they have different inputs and rules.
- Do not introduce a general constants package, generic duplicate-literal detection, or a policy for choosing new constant values.
- The prior pack’s binding [whole-tree straggler ruling](../code-quality-2026-07-25/CONSTRAINTS.md) (CQ25-110) remains an acceptance criterion for all eight consolidations, including the newly added ability and spell-school vocabularies and description limit. Its [CR table work](../code-quality-2026-07-25/20-rules-tables-to-formulas.md) covers the `formatCr`/`parseCr` round trip, not CR-to-proficiency behavior.
- Prefer landing [061-rollmodetoggle-complete-production-orphan.md](./061-rollmodetoggle-complete-production-orphan.md) first because it deletes the only production client component importing shared `RollMode`; otherwise skip that soon-to-be-deleted file during the move.
- [032-encounter-calculators-re-declare-participant.md](./032-encounter-calculators-re-declare-participant.md) shares the prior-pack single-sourcing constraint and has minor file-level overlap in `packages/shared/src/rules/xp.ts`.
