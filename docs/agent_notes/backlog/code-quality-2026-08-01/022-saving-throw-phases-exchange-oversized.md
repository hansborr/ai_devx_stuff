# 22. Saving-throw phases pass the full 13-field input everywhere, so a check and the input it was rolled from travel as an unlinked pair callers must keep synchronized

Status: Not started
Theme: Phase-boundary data contracts · Area: shared · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The staged saving-throw API in `packages/shared/src/rules/saving-throw.ts`
exists so multi-target spells can roll every target's check first and then share
one damage roll. That split is right; what is wrong is that the phase
boundaries do not express what each phase actually needs. `rollSavingThrowCheck`
demands the full 13-field `SavingThrowInput` (12 required fields plus optional
`rollMode`) but reads only four of them, and the returned `SavingThrowCheck`
does not record the DC or modifier it rolled against. So the final phase,
`resolveSavingThrowFromCheck`, has to take *both* the original input *and* the
check — two objects describing one logical saving throw, with nothing linking
them. The result is assembled by picking `saveDc`/`saveModifier` from one object
and `saveRoll`/`totalSave`/`saved` from the other; pass a check that was rolled
from a different input and the composed `SavingThrowResult` is silently
incoherent (a `saved` verdict next to a DC it was never compared against).

The one caller that uses the phases separately pays for this directly:
`resolveSaves` on the server's multi-target spell path builds a complete
13-field input per target up front, derives a parallel `checks` array from it,
and later reunites the two arrays by index — including a guard for a
"missing check" state that the construction makes impossible. Every future
contributor touching this path must maintain the input/check correspondence by
hand, and the type system offers no help because the API never says which fields
belong to which phase.

## Evidence

- `packages/shared/src/rules/saving-throw.ts:14-29` — `SavingThrowInput` has 13
  fields (12 required plus optional `rollMode`), mixing check inputs
  (`saveDc`, `saveModifier`, `rng`, `rollMode`) with damage config
  (`damageDice`, `damageBonus`, `damageType`, `halfDamageOnSave`) and
  presentation/identity fields (`spellName`, `casterName`, `targetName`,
  `targetParticipantId`, `saveAbility`).
- `packages/shared/src/rules/saving-throw.ts:56-66` — `rollSavingThrowCheck`
  accepts the full input but reads exactly four fields: `input.rng`,
  `input.rollMode`, `input.saveModifier`, `input.saveDc`.
- `packages/shared/src/rules/saving-throw.ts:36-42` — `SavingThrowCheck`
  carries `saveRoll`/`secondSaveRoll`/`rollMode`/`totalSave`/`saved` but not
  the `saveDc`/`saveModifier` they were derived from, so a check cannot stand
  alone.
- `packages/shared/src/rules/saving-throw.ts:82-101` — `resolveSavingThrowFromCheck`
  therefore takes both the original `input` and the `check`; nothing ties the
  pair together.
- `packages/shared/src/rules/saving-throw.ts:127-148` — the returned
  `SavingThrowResult` interleaves fields from the two objects: `saveDc` and
  `saveModifier` from `input`, `saveRoll`/`totalSave`/`saved` from `check`.
- `packages/server/src/services/spell-casting/resolve-character-spell.ts:227-258`
  — `resolveSaves` builds full `SavingThrowInput`s per target (`:227-244`),
  maps them to a parallel `checks` array (`:249`), then re-joins the arrays by
  index (`:254-257`) with an `INTERNAL_SERVER_ERROR` guard (`:256`) for an
  index mismatch that cannot occur.
- `packages/server/src/services/spell-casting/resolve-spell.ts:133` — the only
  other caller, the single-target custom-spell path, uses the
  `resolveSavingThrow` convenience wrapper (`saving-throw.ts:75-80`) and never
  touches the phases individually.
- `packages/shared/src/rules/saving-throw.test.ts:11-27` — every test drives
  the API through `resolveSavingThrow(makeInput(...))`; the two-object seam has
  no direct coverage.

## Proposed direction

Split `SavingThrowInput` along the phase boundary in
`packages/shared/src/rules/saving-throw.ts` so that each phase's signature is
the statement of what it needs, and an incoherent input/check pair becomes
unrepresentable rather than merely unlikely:

1. Give the check phase a focused input:
   `rollSavingThrowCheck({ saveDc, saveModifier, rng, rollMode? })`. Make the
   returned `SavingThrowCheck` carry the `saveDc` and `saveModifier` it used
   alongside `saveRoll`/`secondSaveRoll`/`rollMode`/`totalSave`/`saved`, so the
   check is the single self-describing source of truth for everything
   save-roll-related.
2. Reshape the final phase as
   `resolveSavingThrowFromCheck(context, check, sharedDamage?)`, where the
   context type is `SavingThrowInput` minus the check-owned fields (drop
   `saveDc`, `saveModifier`, `rollMode`). The `SavingThrowResult` composition
   reads DC/modifier/roll/saved exclusively from the check, and damage
   config/names/`targetParticipantId` from the context.
3. Keep the `resolveSavingThrow(input, sharedDamage?)` convenience wrapper with
   its current full-input signature, splitting into check-input + context
   internally, so the single-target custom-spell path
   (`packages/server/src/services/spell-casting/resolve-spell.ts:133`) needs no
   change.
4. In `resolveSaves`
   (`packages/server/src/services/spell-casting/resolve-character-spell.ts:227-258`),
   replace the parallel `saveInputs`/`checks` arrays with one map over
   `loaded.targets` producing a per-target `{ context, check }` pair, rolling
   the check as the pair is built. That deletes the index-join and its
   impossible `INTERNAL_SERVER_ERROR` guard. Preserve the existing RNG
   consumption order: all checks first, then the shared damage roll.

Full consumer inventory for the scope check: shared `saving-throw.ts` +
`saving-throw.test.ts`, server `resolve-character-spell.ts` (`resolveSaves`,
the only multi-phase caller), and `resolve-spell.ts` (single-target
`resolveSavingThrow` wrapper call at `:133`, unchanged under this direction).
`packages/shared/dist` is generated output; ignore it.

`savingThrowResultSchema` stays byte-identical
(`packages/shared/src/schemas/spell-action-inputs.ts:131-154`). The proof of
parity is the existing suite passing with only construction-site updates —
`bun run test -- packages/shared/src/rules/saving-throw.test.ts` — plus one
added test asserting the check-owned fields flow into the result (e.g.
`result.saveDc === check.saveDc` by construction).

## Scope / caveats

- **Out of scope:** any change to `savingThrowResultSchema` / `SavingThrowResult`
  in `packages/shared/src/schemas/spell-action-inputs.ts` — the result
  intentionally repeats input fields because it is the client wire contract,
  and "deduplicating" it would break the client. Also out of scope: the
  attack-roll path, and `rollSavingThrowDamage` (already focused — three
  scalar parameters).
- **RNG call-order drift is the main regression vector.** If the refactored
  `resolveSaves` interleaves check rolls and damage rolls differently,
  deterministic-seed tests and replay behavior change even though rules logic
  is identical. The current order — every check (`:249`), then one shared
  damage roll (`:251-253`) — must survive the restructure.
- The check now carrying `saveDc`/`saveModifier` means any future caller
  constructing a `SavingThrowCheck` by hand (tests included) must populate them
  coherently. The fixtures in `saving-throw.test.ts` need a mechanical update,
  not a semantic one; behavior parity is shown by keeping existing assertions
  unchanged.
- This touches shared rules code: read `docs/guides/change-rules-logic.md`
  before editing `packages/shared/src/rules/`.
- Sequencing: independent — no other leaf in this pack touches
  `saving-throw.ts` or `resolve-character-spell.ts`. Soft consistency edge
  only: [193-shared-weapon-rules-helpers-demand-full.md](./193-shared-weapon-rules-helpers-demand-full.md)
  fixes the analogous over-demanding-input idiom on the attack path
  (`attack-damage.ts` / `resolve-attack.ts`). No ordering required, but
  whichever lands second should match the focused-phase-input shape the first
  established, so the two rules modules read as one idiom.
