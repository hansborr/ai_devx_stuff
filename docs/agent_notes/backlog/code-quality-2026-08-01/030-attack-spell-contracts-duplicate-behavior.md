# 30. Attack and spell-action contracts privately re-compose the same combat field validators and -10/99 bonus bounds, which can silently diverge

Status: Not started
Theme: shared combat field schemas · Area: shared · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/shared/src/schemas/attack-roll-inputs.ts` and
`packages/shared/src/schemas/spell-action-inputs.ts` are sibling contract
families for the same combat surface, and each privately declares the same
building blocks: a `damageDiceField` and a `combatNameField` that are
byte-equivalent between the two files, and the same -10..99 bonus range under
different constant names (`MIN_ATTACK_BONUS`/`MAX_ATTACK_BONUS`/
`MIN_DAMAGE_BONUS`/`MAX_DAMAGE_BONUS` vs `MIN_BONUS`/`MAX_BONUS`). These are
behavior-bearing validators, not incidental Zod boilerplate: they decide what
bonus values, dice strings, and combat names both families accept and emit.

The raw vocabulary underneath is already single-sourced — both files import
`DICE_NOTATION_REGEX`, `DICE_NOTATION_MESSAGE`, `MAX_DICE_NOTATION_LENGTH`,
and `MAX_NAME_LENGTH` from `../constants.js` — so a regex or length change
needs one edit. What is duplicated is the Zod *composition* on top of that
vocabulary and the bonus bounds themselves. A contributor tightening the name
field (say, adding a max after trim change) or widening the bonus range in one
file has nothing telling them the sibling exists; attack and spell contracts
then accept different values for what players experience as one combat system,
and nothing fails until the divergence is user-visible.

## Evidence

- `packages/shared/src/schemas/attack-roll-inputs.ts:24-27` — `MAX_ATTACK_BONUS = 99`, `MIN_ATTACK_BONUS = -10`, `MAX_DAMAGE_BONUS = 99`, `MIN_DAMAGE_BONUS = -10`, applied at `:90` (`attackBonus`) and `:93` (`damageBonus`).
- `packages/shared/src/schemas/spell-action-inputs.ts:22-23` — `MAX_BONUS = 99`, `MIN_BONUS = -10`, the same range under different names, applied at `:50` (`damageBonus`) and `:79` (`attackBonus`).
- `packages/shared/src/schemas/attack-roll-inputs.ts:38-42` and `spell-action-inputs.ts:32-36` — `damageDiceField`, byte-equivalent five-line Zod chains (`.min(1).max(MAX_DICE_NOTATION_LENGTH).regex(DICE_NOTATION_REGEX, DICE_NOTATION_MESSAGE)`).
- `packages/shared/src/schemas/attack-roll-inputs.ts:48` and `spell-action-inputs.ts:37` — `combatNameField`, byte-equivalent (`z.string().trim().min(1).max(MAX_NAME_LENGTH)`). Used 4 times in the attack file (`:89`, `:147`, `:156`, `:158`) and 7 times in the spell file (`:78`, `:93`, `:123-124`, `:147-149`).
- `packages/shared/src/schemas/attack-roll-inputs.ts:32-36` and `spell-action-inputs.ts:26-30` — even the explanatory banner above the field schemas is copied verbatim between the files.
- `packages/shared/src/schemas/attack-roll-inputs.ts:3-10` and `spell-action-inputs.ts:3-13` — both files already import the notation/name vocabulary from `../constants.js`; the duplication is confined to the composed field schemas and the bonus bounds.
- `packages/shared/src/schemas/spell-action-inputs.ts:15` — the spell file already imports `attackResolutionResultSchema` and `rollModeSchema` from `./attack-roll-inputs.js`, so a shared fragment fits the existing dependency direction rather than introducing a new edge.
- `packages/shared/src/schemas/spell.ts:89-90` — a third private copy of the same -10/99 pair (`MIN_DAMAGE_BONUS`/`MAX_DAMAGE_BONUS`), used at `:156` for homebrew spell damage bonuses.

## Proposed direction

Extract the shared bonus bounds (-10/99), `damageDiceField`, and
`combatNameField` into a small neutral combat-fields fragment in
`packages/shared/src/schemas/` and consume it from both
`attack-roll-inputs.ts` and `spell-action-inputs.ts`, keeping genuinely
family-specific validators (e.g. `damageDiceResultField`, save DC) local.

Mechanics: a new leaf module (e.g. `schemas/combat-fields.ts`) importing only
from `../constants.js` and exporting the two field schemas plus named bonus
bounds; both contract files delete their private copies (`attack-roll-inputs.ts:24-27`,
`:38-42`, `:48`; `spell-action-inputs.ts:22-23`, `:32-36`, `:37`) and import
the fragment. `damageDiceResultField` (`attack-roll-inputs.ts:43-47`),
`MAX_EXTRA_CRIT_DICE`/`MIN_CRITICAL_RANGE` (`:28-30`), and `MAX_SAVE_DC`
(`spell-action-inputs.ts:24`) stay where they are — they encode one family's
rules, not shared combat behavior.

## Scope / caveats

- Do not claim or fix notation-grammar duplication: `DICE_NOTATION_REGEX` and
  its companions are already single-sourced in `constants.ts`. This leaf is
  about the composed Zod fields and the bounds only.
- `packages/shared/src/schemas/monster.ts:22` declares `MAX_BONUS = 30` for
  monster stat modifiers (used symmetrically as ±30 at `:122`, `:128`). That is
  a deliberately different range — do not fold it into the shared fragment.
- The third -10/99 pair at `schemas/spell.ts:89-90` (homebrew spell damage
  bonus) is compatible with the shared bounds but sits in an entity schema, not
  the combat-action contracts this leaf scopes; repoint it only if already
  editing that file, and do not move its other local bounds.
- Keep the fragment a leaf module (imports from `../constants.js` at most) so
  neither contract family gains a cycle risk; `spell-action-inputs.ts` already
  imports from `attack-roll-inputs.ts`, so the fragment must not import either.
- Pure re-pointing — every value is identical today, so no runtime behavior
  moves; existing schema tests must stay green unchanged.
- Prior pack: the 2026-07-25 shared-cluster/constants work
  ([21-shared-constants-single-source.md](../code-quality-2026-07-25/21-shared-constants-single-source.md),
  landed) centralized the neighboring dice and damage vocabulary these files
  consume, but neither scheduled nor declined consolidating these composed
  combat field validators — no conflict with a prior ruling.
- Leaf [031-attack-damagets-eight-concern-rules-grab-bag.md](./031-attack-damagets-eight-concern-rules-grab-bag.md)
  restructures `rules/attack-damage.ts` nearby and
  [024-encounter-inputs-monolith-spanning-three.md](./024-encounter-inputs-monolith-spanning-three.md)
  reshapes the adjacent encounter contracts; no ordering dependency, but avoid
  concurrent edits to the combat schema files.
