# 23. Five summary projections hand-copy 33 canonical entity fields, and the copies have already drifted looser than their entity schemas

Status: Not started
Theme: derived schema projections · Area: shared · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/shared` already knows how a list-view projection should be built:
`characterSummarySchema` is derived from `characterSchema` with
`.pick().extend()`, and its JSDoc spells out why — a picked field cannot
silently fall out of sync with the entity that owns it. Five other projections
never adopted that idiom. `campaignMemberCharacterSchema`,
`campaignSummarySchema`, `magicItemSummarySchema`, `monsterSummarySchema` and
`encounterSummarySchema` each re-declare their fields by hand — 33 parallel
field declarations copied from five canonical entity schemas.

The cost is not hypothetical. The campaign member-character `level` copy has
already lost the character entity's `MIN_LEVEL`/`MAX_LEVEL` bounds, and the
monster summary has lost four canonical constraints, including the
challenge-rating validity refinement. A contributor reading any of these files
today cannot tell which of the 33 constraint differences are deliberate
loosenings and which are drift — every difference has to be re-adjudicated on
every edit, and nothing fails when a copy decays further. Because these
schemas are tRPC list-output contracts, the drift also means list endpoints
runtime-validate less strictly than the detail endpoints serving the same
rows.

## Evidence

- `packages/shared/src/schemas/character.ts:278-298` — the landed exemplar:
  `characterSummarySchema` is `characterSchema.pick({...}).extend({...})`, and
  the JSDoc at `:278-283` states the intent ("a projection of
  {@link characterSchema}, not a parallel declaration of it") and names the
  exact failure mode this leaf's five schemas still have.
- `packages/shared/src/schemas/campaign.ts:69-76` —
  `campaignMemberCharacterSchema` hand-declares `id`/`name`/`level`/`className`
  (3 canonical character fields + 1 computed). Its `level` at `:73` is
  `z.number().int().positive()`, while the entity's `level`
  (`packages/shared/src/schemas/character.ts:70`) is
  `z.number().int().min(MIN_LEVEL).max(MAX_LEVEL)` — the upper bound is
  already gone. This is the demonstrated drift.
- `packages/shared/src/schemas/campaign.ts:96-106` — `campaignSummarySchema`
  re-declares 7 `campaignSchema` fields (entity at `:16-30`) before adding
  `memberCount` and `role`.
- `packages/shared/src/schemas/magic-item.ts:75-82` — `magicItemSummarySchema`
  re-declares 6 `magicItemSchema` fields (entity at `:56-71`); all six are
  currently identical to canonical, so this file is the pure-mechanical case.
- `packages/shared/src/schemas/monster.ts:227-238` — `monsterSummarySchema`
  re-declares 10 `monsterSchema` fields with four constraints lost:
  `challengeRating` at `:233` is bare `z.number()` while the entity (`:191-193`)
  refines against `VALID_CR_VALUES`; `xp` at `:234` drops `.nonnegative()`
  (`:194`); `ac` at `:235` drops `.nonnegative().max(MAX_AC)` (`:147`);
  `maxHp` at `:236` drops `.nonnegative().max(MAX_HP)` (`:149`).
- `packages/shared/src/schemas/encounter.ts:187-196` — `encounterSummarySchema`
  re-declares 7 `encounterSchema` fields (entity at `:76-86`) before adding
  `participantCount`. These copies still match canonical today (`round` is
  `z.number().int().min(0)` on both sides), so the pick is a no-op tightening.
- Count: 3 + 7 + 6 + 10 + 7 = 33 parallel field declarations across the five
  projections.
- These are live output contracts: `packages/server/src/routers/monster.ts:153`
  outputs `listMonstersResponseSchema` (the summary) while `:180` outputs the
  full `monsterSchema` — so every row the detail endpoint can serve already
  passes the canonical bounds at runtime; only list-only rows are unproven.
- Cycle safety for the one new cross-file import:
  `packages/shared/src/schemas/campaign.ts:1-3` imports only `zod` and
  `../constants.js`, and `character.ts:1-16` imports nothing from
  `campaign.ts`, so `campaign.ts` → `character.ts` is acyclic at the pin.

## Proposed direction

Converge all five projections on the landed `characterSummarySchema` idiom
(`packages/shared/src/schemas/character.ts:284-298`, with its JSDoc as the
template): derive each summary from its canonical entity schema via `.pick()`,
and put every field that is not a verbatim entity field — or is deliberately
looser — into an `.extend()` with a one-line contract rationale. The default
posture per field is canonical-tight via pick; loose survives only as an
explicit, commented extend decision, so the 33-field intentional-vs-drift
adjudication is legible in the diff itself.

Concretely, per file:

1. `campaignSummarySchema` (`campaign.ts:96`) becomes
   `campaignSchema.pick({ id, name, description, ownerId, nextSessionDate, createdAt, updatedAt }).extend({ memberCount, role })`.
2. `magicItemSummarySchema` (`magic-item.ts:75`) becomes a pure pick of its six
   `magicItemSchema` fields — no extend needed.
3. `encounterSummarySchema` (`encounter.ts:187`) picks its seven
   `encounterSchema` fields and extends `participantCount`.
4. `monsterSummarySchema` (`monster.ts:227`) picks its ten fields from
   `monsterSchema`, restoring the dropped CR refinement and the
   `ac`/`maxHp`/`xp` bounds — unless seed data proves a bound must stay loose,
   in which case keep it loose explicitly in the extend with a comment. The CR
   refine lives on the field schema (`monster.ts:191-193`), so `.pick`
   preserves it automatically.
5. `campaignMemberCharacterSchema` (`campaign.ts:69`) picks `id`/`name`/`level`
   from `characterSchema` — restoring the lost `MIN_LEVEL`/`MAX_LEVEL` bound,
   the demonstrated drift — and extends `className`, which is a server-computed
   join field that does not exist on `characterSchema`. Preserve the outer
   `.nullable()` wrapper.

TDD note: each schema already has a sibling suite
(`campaign.test.ts`, `magic-item.test.ts`, `monster.test.ts`,
`encounter.test.ts` under `packages/shared/src/schemas/`); add assertions that
the summary constraints match canonical (e.g. the campaign member-character
summary rejects `level > MAX_LEVEL`, the monster summary rejects an invalid
CR) so future drift fails a test, mirroring how the `character.ts` JSDoc
motivates the pattern. Run them focused with
`bun run test -- packages/shared/src/schemas/campaign.test.ts` (and likewise
per file).

## Scope / caveats

- **Out of scope:** no generic summary-deriver helper or new abstraction; no
  changes to server serializers or client consumers beyond what tightened
  inferred types force; no changes to detail schemas
  (`campaignDetailSchema`, `encounterDetailSchema`, … are already
  `.extend()`-based); and no reopening of the landed `characterSummarySchema`
  work.
- **Prior pack:** the 2026-07-25 pack already fixed `characterSummarySchema`
  (leaf [23-schema-layout-and-naming.md](../code-quality-2026-07-25/23-schema-layout-and-naming.md),
  step 6, landed) and that work is do-not-reopen. Frame this leaf as extending
  its idiom to the four remaining domains, not as reworking character.
- **Runtime-validation risk:** restoring canonical bounds tightens runtime
  output validation on list endpoints. If any persisted or seeded row violates
  a restored bound (a monster CR outside `VALID_CR_VALUES`, a character level
  past `MAX_LEVEL`), currently-passing tRPC responses start throwing. Check
  each restored bound against seed/fixture data before landing — the monster
  seed loads its JSON through a cast, not through `monsterSchema`
  (`packages/server/src/seed/seed-srd-monsters.ts:200-201`), so seeded rows
  are not pre-validated. Mitigating: the monster `get` route already outputs
  full `monsterSchema` (`packages/server/src/routers/monster.ts:180`), so any
  row the detail path serves has been passing the canonical bounds at runtime.
  Keep a genuinely violated bound loose explicitly (commented, in extend)
  rather than papering over it.
- **Import cycle:** the new `campaign.ts` → `character.ts` import is verified
  acyclic at the pin (see Evidence); before adding any import this leaf did
  not enumerate, check the reverse direction first.
- Some type-level consumers typed against the looser summary shapes may need
  mechanical updates when the inferred types tighten.
- `className` stays in `.extend()` permanently — it is computed from the
  classes join on the server and must not be picked from `characterSchema`.
- No sequencing edges: no other leaf in this pack edits these five summary
  declarations.
