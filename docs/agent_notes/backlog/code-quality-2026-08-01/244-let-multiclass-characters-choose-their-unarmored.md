# 244. Let multiclass characters choose their Unarmored Defense calculation

Status: Not started
Theme: Let multiclass characters choose among valid Unarmored Defense calculations · Area: cross-cutting · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The seeded Armor Class rule gives players a choice when multiple base-AC
calculations apply. Musi instead scans the character's classes and silently
uses the first recognized Unarmored Defense formula. Multiclass row order is
therefore an undocumented rules input: with the tested ability scores,
Barbarian-first selects AC 13 even though the same character's Monk formula
would produce AC 15.

The character sheet computes that row-order-dependent value from current
classes and equipment, while encounter projection reads the separately
persisted numeric `CharacterStats.ac`. A formula selector added to only one
surface would deepen that split. The choice needs a stable persisted identity
and one authority for the resolved AC so the sheet and encounter cannot report
different defenses for the same character.

## Evidence

- `packages/server/src/seed/data/5e-srd-rules-glossary.json:51-54` — the seeded
  Armor Class rule says that when another base-AC calculation is available,
  the player chooses which calculation to use.
- `packages/shared/src/rules/armor-class.ts:119-148` — Unarmored Defense is
  keyed by class display name, and `computeCharacterAc` stops at the first
  matching class before passing one formula to `calculateArmorClass`.
- `packages/shared/src/rules/armor-class.test.ts:266-269,294-299` — existing
  examples produce Barbarian AC 13 and Monk AC 15, then explicitly pin a
  Barbarian-before-Monk multiclass character to AC 13.
- `packages/client/src/pages/character-sheet/sheet-helpers.ts:36-46` — the
  sheet converts `character.classes` to an ordered class-name array and calls
  the shared computation without a formula-choice input.
- `packages/server/prisma/schema.prisma:918-943` — `CharacterStats` stores a
  numeric `ac` but has no field identifying the selected base-AC formula.
- `packages/server/src/utils/encounter-query.ts:155-164` — encounter character
  participants receive AC directly from persisted `stats.ac`, independently
  of the sheet computation.

## Proposed direction

Define a shared closed formula discriminator, such as
`"base" | "barbarian" | "monk"`, and make `computeCharacterAc` accept the
selected discriminator explicitly. Determine eligible formulas independently
of `character.classes` order. Validate at the server boundary that the
character qualifies for the selected class formula; the ordinary base formula
remains valid for every character.

Persist the selection on `CharacterStats` through a reviewable Prisma
migration and carry it through the shared stats schemas, server mapping, and
character-sheet state. Keep the new column nullable while legacy rows exist.
For a missing selection, resolve the highest eligible calculation with a
fixed discriminator tie-break, so the fallback is deterministic and cannot
change when multiclass rows are reordered. Once the player saves a choice,
persist the explicit discriminator rather than the fallback decision.

Make persisted `stats.ac` the server-owned projection of that choice. Recompute
it through the shared helper whenever an AC input changes: the selected
formula, a relevant ability score, equipped armor or shield state, or class
membership. The sheet should display the returned authoritative AC rather
than independently selecting a formula; it may use the same pure helper to
preview each selector option. Encounter projection can then continue reading
`stats.ac` and will agree with the sheet.

Expose the selector on the character sheet when more than one valid base-AC
formula exists. Label each option by formula, show its computed value, retain
the saved selection across reloads, and submit the stable discriminator
through the character-stats mutation boundary.

Add focused coverage before implementation:

1. Shared rules cases for each formula, order-independent eligibility, armor
   interaction, shields, deterministic legacy fallback, and fixed tie
   behavior.
2. Shared-schema and server cases rejecting unavailable formulas and proving
   that selection and numeric AC are updated together.
3. Persistence coverage for legacy null rows and the Prisma migration.
4. Client coverage for option visibility, previews, selection persistence,
   and mutation payloads.
5. An integration case proving the sheet and encounter project the same AC
   after a choice and after each AC-affecting mutation.

Classify the calculation as SRD behavior under
`docs/guides/change-rules-logic.md`, verify it against the repository's SRD
authority, and name any legacy fallback or tie-break explicitly as Musi policy
in tests and code comments.

## Scope / caveats

- Any persisted selection requires a Prisma migration; do not use a schema
  push as committed migration history. Preserve legacy rows through a nullable
  or otherwise migration-safe transition.
- Use a formula discriminator, not multiclass row position, as stored identity.
  Validation may reuse the existing resolved class information, but this leaf
  does not normalize persisted class IDs or replace display-name lookup
  infrastructure.
- [code-quality-2026-07-25/18-shared-class-identity.md](../code-quality-2026-07-25/18-shared-class-identity.md)
  (CQ25-219) completed the compile-time SRD class-identity work while
  explicitly excluding `UNARMORED_DEFENSE_CLASSES` and persisted
  normalization. This leaf covers the separate player-choice residual and
  must not reopen that broader normalization.
- [code-quality-2026-07-25/SHARED-CLUSTER-PLAN.md](../code-quality-2026-07-25/SHARED-CLUSTER-PLAN.md)
  (CQ25-174) rejected moving the shield input into `unarmoredAc`.
  Keep Monk shield eligibility and the final shield bonus together in
  `calculateArmorClass`; this feature changes formula selection, not ownership
  of the existing shield rule.
- [191-let-players-choose-strength-dexterity.md](./191-let-players-choose-strength-dexterity.md)
  establishes a similar explicit-choice pattern for Finesse attacks, but it
  excludes persistence and contains no Armor Class work. Do not merge the two
  choices or broaden this leaf into weapon resolution.
- Preserve armored AC, custom-armor fallback, shield bonus, and encounter
  visibility behavior except where the shared authoritative AC projection
  must be threaded through them.
