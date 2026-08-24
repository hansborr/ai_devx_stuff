# 29. Cast-input validation caps metamagic per cast with the level-up picks constant, coupling two unrelated rules that only coincidentally equal 2

Status: Not started
Theme: single-purpose rule constants · Area: shared · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The sorcery rules module defines two semantically independent quantities that both
happen to be 2: `METAMAGIC_PICKS_PER_LEVEL` (how many metamagic options a sorcerer
*learns* at each milestone level) and `MAX_METAMAGIC_PER_CAST` (how many options may
be *applied* to a single cast). Only the first is exported — and
`castSpellInputSchema` uses it as the `metamagicIds` array cap, even though the
per-cast limit is the quantity that schema is actually expressing. A contributor
adjusting how many options are learned per milestone — a level-up rule — would
silently change what the cast endpoint accepts, and nothing in the code signals
that the two rules were ever coupled.

The blast radius is bounded but asymmetric: the server's cast path
(`applyMetamagicCost` → `validateMetamagicCombination`) independently enforces
`MAX_METAMAGIC_PER_CAST`, so *raising* the picks constant would only loosen input
parsing and still be rejected downstream with a different error; *lowering* it
would tighten the effective per-cast limit at the input boundary with no rules
change intended. Either way, the reader of the schema is told the wrong reason
for the bound, and the correctly named constant sits unexported eleven lines
below the misuse's import source.

## Evidence

- `packages/shared/src/rules/sorcery-points.ts:12` —
  `export const METAMAGIC_PICKS_PER_LEVEL = 2;` — the learned-per-milestone
  quantity, consumed as such by `getMetamagicSlotsAtLevel`
  (`sorcery-points.ts:162-170`).
- `packages/shared/src/rules/sorcery-points.ts:181` —
  `const MAX_METAMAGIC_PER_CAST = 2;` — module-private, enforced only inside
  `validateMetamagicCombination` (`sorcery-points.ts:190-193`); the error string
  at `:192` hard-codes the same value in prose ("Cannot apply more than 2
  metamagic options").
- `packages/shared/src/schemas/spell-casting-inputs.ts:4,19` —
  `castSpellInputSchema` imports `METAMAGIC_PICKS_PER_LEVEL` and uses it as
  `metamagicIds: z.array(idField).max(METAMAGIC_PICKS_PER_LEVEL)` — a per-cast
  cap expressed with the level-up constant.
- Legitimate uses of the picks constant are all level-up selection:
  `packages/shared/src/schemas/character-inputs.ts:285` (level-up input),
  `packages/client/src/components/sheet/level-up-state.ts:134`,
  `packages/client/src/components/sheet/metamagic-step.tsx:22,27`.
- Downstream enforcement that qualifies the failure mode:
  `packages/server/src/utils/metamagic-helpers.ts:13-18` (`applyMetamagicCost`
  calls `validateMetamagicCombination`), reached from the cast service at
  `packages/server/src/services/spell-casting/non-combat-cast.ts:123`.
- `packages/shared/src/schemas/spell-casting-inputs.test.ts` has zero metamagic
  coverage (grep for `metamagic`: 0 matches), so nothing pins the cast schema's
  cap to either constant today.

## Proposed direction

Export `MAX_METAMAGIC_PER_CAST` from `packages/shared/src/rules/sorcery-points.ts`
and use it (instead of `METAMAGIC_PICKS_PER_LEVEL`) as the `metamagicIds` max in
`castSpellInputSchema`, leaving the picks constant to level-up selection only.

Mechanics: add `export` at `sorcery-points.ts:181`; in
`spell-casting-inputs.ts:4` swap the imported name and update the `.max(...)`
call at `:19`. No numeric value changes; every current payload parses
identically. Add a small test in `spell-casting-inputs.test.ts` asserting the
`metamagicIds` cap equals `MAX_METAMAGIC_PER_CAST` (accepts an array of that
length, rejects one longer), so the boundary is pinned to the right constant.
Focused check: `bun run test -- packages/shared/src/schemas/spell-casting-inputs.test.ts`.

## Scope / caveats

- Out of scope: changing either constant's value, touching level-up selection
  semantics, or merging the two constants — they must stay separate; the
  coincidence of values is the hazard, not a duplication to collapse.
- The prose "2" in the `validateMetamagicCombination` error string
  (`sorcery-points.ts:192`) may be interpolated from the now-exported constant in
  the same touch; if you do, keep the message text otherwise stable — the server
  forwards it verbatim as a tRPC error message
  (`packages/server/src/utils/metamagic-helpers.ts:22`).
- This is a rules-adjacent shared-schema edit: read
  `docs/guides/change-rules-logic.md` before landing, even though no behavior
  moves.
- **Sequencing:** Coordinate with
  [221-rename-metamagic-slot-terminology-to-options-known.md](./221-rename-metamagic-slot-terminology-to-options-known.md):
  both edit `sorcery-points.ts`, so do not work them concurrently; whichever
  lands second must preserve both this constant split and leaf 221's terminology
  rename. No prior-pack ruling or scheduled slice covers this constant pair.
