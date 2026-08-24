# 211. Reuse validated class references during spell-bearing character creation

Status: Not started
Theme: Spell-bearing character creation reloads class and subclass references already being validated · Area: server · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Spell-bearing character creation has two authorities for the selected class
and subclass. General reference validation loads them to prove they exist and
belong together, while spell-create validation independently reloads narrower
caster projections.

Each affected request therefore pays for duplicate reads. More importantly,
caster fields can be added or interpreted in one projection without being
added to the other, allowing general reference validation and spell validation
to reason from different snapshots of the same selected references.

## Evidence

- `packages/server/src/services/character-create.ts:50-67` — core reference
  validation loads the selected class, including `casterType` and the gameplay
  fields needed to build the character.
- `packages/server/src/services/character-create.ts:135-151` — optional
  reference validation separately loads the selected subclass and verifies
  that it belongs to the selected class.
- `packages/server/src/services/character-create.ts:221-224` — the coordinator
  launches general reference validation and spell-create validation as
  independent paths.
- `packages/server/src/services/character-create-spells.ts:115-131` — when
  spells are submitted, the spell path reloads the same class and optional
  subclass solely for `casterType` and `spellcastingAbility`.
- `packages/server/src/services/character-create-spells.ts:133-155` — spell
  validation resolves the caster fields, applies the level-1 selection rules,
  and independently maps the request's class id to its spell-list identity.

## Proposed direction

Expand the character-creation reference bundle so the selected class includes
`spellcastingAbility` and the optional selected subclass includes only the
identity, owning class id, `casterType`, and `spellcastingAbility` fields needed
by validation. Load each selected reference once, and validate the subclass's
class relationship from that bundled row rather than issuing a later lookup.

After general reference validation has established the bundle, pass a narrow
caster-reference shape into `validateAndBuildSpellCreates`. Keep spell choice
loading, duplicate detection, class-list validation, selection limits, and
nested-create assembly in the spell module, but delete its class and subclass
queries. Continue to return immediately for an empty spell list without
loading spell rows.

Update the direct spell-validation tests to supply validated caster references,
and retain end-to-end creation coverage for missing classes, missing or
wrong-class subclasses, Wizard choices, the Warlock `casterType: "none"`
special case, invalid spell ids, and spell-list errors. Add a focused
coordination assertion that a spell-bearing creation performs one class lookup
and at most one selected-subclass lookup.

## Scope / caveats

- Land after, or rebase onto,
  [004-character-creation-large-pseudo-module-loose.md](./004-character-creation-large-pseudo-module-loose.md).
  That proposal moves these files and types without changing behavior; apply
  this consolidation to its post-move module layout rather than competing with
  the move.
- Preserve the existing `BAD_REQUEST` class and subclass failures, the
  subclass-to-class relationship check, `NOT_FOUND` spell failures, all message
  text, and the character-creation transaction shape.
- CQ25-185 in
  [code-quality-2026-07-25/SHARED-CLUSTER-PLAN.md](../code-quality-2026-07-25/SHARED-CLUSTER-PLAN.md)
  leaves non-`SrdClassId` caster behavior as a binding extension-contract
  fallback. Keep the request class id as a string and preserve the existing
  `resolveCharacterClassCaster`, `getLevel1SpellSelection`, and
  `spellClassIdForClassId` answers; do not narrow the bundle to SRD ids or
  invent a spell-list identity for an unknown class.
- Do not use the shared bundle to absorb spell-row loading or spell-choice
  policy into the creation facade. The proposal consolidates class/subclass
  references only.
