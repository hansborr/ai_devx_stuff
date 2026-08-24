# 15. The participant create-data builder erases the discriminated type it just built, so its only caller mutates an opaque record and re-stamps it as Prisma create data

Status: Not started
Theme: Prisma boundary types · Area: server · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`buildAddParticipantData` exists to centralize the branch-specific construction
of an encounter-participant create payload: it takes the discriminated
`AddParticipantInput` union, branches on `input.type`, and assembles three
distinct shapes (character, monster, NPC). Then it throws that work away by
declaring its return type as `Record<string, unknown>`.

Its only caller, `addParticipant`, pays for the erasure twice. To merge a
character's persistent conditions into the payload it must go through an
`existing as unknown[]` assertion, and to hand the finished record to
`prisma.encounterParticipant.create` it must re-stamp the whole object as the
Prisma create-data type. Both casts carry `type-assertion-boundary: prisma`
markers, so they pass lint — but the compiler now checks nothing at either
site. If the `EncounterParticipant` schema gains a required column tomorrow,
neither the builder nor the caller fails typecheck; the mistake surfaces at
runtime, on the participant-creation mutation path that evolves with the
schema.

The erasure also hides dead code: `AddParticipantInput` has no `conditions`
field and the builder never sets one, so the caller's
`Array.isArray(data.conditions)` merge-with-existing branch can never see a
non-empty array. The opaque record type is the only reason that branch looks
necessary.

The codebase already knows the right shape. `buildBlindData` in the same file
returns the typed `BlindParticipantFields`, and the character-creation builders
return `Prisma.CharacterCreateInput` directly. This builder is the outlier.

## Evidence

- `packages/server/src/utils/encounter-participant-helpers.ts:7-10` —
  `buildAddParticipantData(input: AddParticipantInput, sortOrder: number): Record<string, unknown>`;
  the branches at `:19-39` build three distinct shapes off the discriminant,
  then the signature discards the union.
- `packages/shared/src/schemas/encounter-inputs.ts:153-184` —
  `addParticipantInputSchema` is a `z.discriminatedUnion("type", …)` of three
  branch schemas; none of them has a `conditions` field (the only `conditions`
  key in the file is on the separate stats-update schema at `:225`).
- `packages/server/src/services/encounter-combat/participant-action.ts:221-223` —
  the conditions merge: `Array.isArray(data.conditions)` guards a branch that is
  unreachable (the builder never sets `conditions`), and the append goes through
  `existing as unknown[]` under a `type-assertion-boundary: prisma` marker.
- `packages/server/src/services/encounter-combat/participant-action.ts:227-229` —
  the whole-object re-stamp:
  `data as Parameters<typeof ctx.prisma.encounterParticipant.create>[0]["data"]`,
  with its own `type-assertion-boundary: prisma` marker admitting the builder
  "returns a hand-built union … that TS can't pick the right branch generically".
- `packages/server/src/generated/prisma/models/EncounterParticipant.ts:606-635` —
  `EncounterParticipantUncheckedCreateInput`: FK scalars (`encounterId`,
  `characterId`, `monsterId`, `homebrewMonsterEntryId`) as plain fields, `name`
  and `encounterId` required, `conditions` an optional JSON input — exactly the
  flat shape the builder already produces.
- `packages/server/src/generated/prisma/models/EncounterParticipant.ts:2882` —
  create args take
  `Prisma.XOR<Prisma.EncounterParticipantCreateInput, Prisma.EncounterParticipantUncheckedCreateInput>`,
  so an unchecked-typed payload is accepted with no cast and no adapter.
- House counter-examples: `participant-action.ts:150-160` (`buildBlindData`
  returns the typed `BlindParticipantFields`),
  `packages/server/src/services/character-create.ts:188-192` (`buildCreateData`
  returns `Prisma.CharacterCreateInput`), and
  `packages/server/src/services/character-create-helpers.ts:66-69`
  (`buildNestedCreates` returns `Pick<Prisma.CharacterCreateInput, …>`).
- `packages/shared/src/schemas/encounter.ts:65-70` — `conditionEntrySchema` /
  `ConditionEntry` (`{ name, durationRounds: number | null }`) is exactly the
  entry shape the service hand-builds at `participant-action.ts:213-220`.
- Behavior safety net:
  `packages/server/src/routers/encounter-participants-add.test.ts:479-503`
  already pins the persistent-conditions copy ("syncs persistent
  CharacterConditions into participant conditions on add").

## Proposed direction

1. **Type the builder's return as
   `Prisma.EncounterParticipantUncheckedCreateInput`** (imported
   `import type { Prisma } from "../generated/prisma/client.js"`, the house
   style per `character-create.ts:6`). The builder writes FK scalars directly,
   and Prisma's create `data` accepts the XOR with the unchecked variant, so
   the call-site re-stamp cast at `participant-action.ts:229` disappears with
   no adapter. A hand-built discriminated union of the three branches is
   unnecessary — the Prisma input type alone restores compiler checks for
   future required fields (a new required column fails typecheck at the
   builder's return statements).
2. **Pass persistent conditions into the builder as a typed optional
   parameter** (`ConditionEntry[]` from the shared `conditionEntrySchema`
   shape) instead of mutating the returned object. The service keeps the
   `characterCondition.findMany` query and the `normalizeSrdCondition`
   mapping (`participant-action.ts:209-220`, including its canonicalization
   comment); only the attachment moves behind the typed boundary. Since
   `AddParticipantInput` has no `conditions` field and the builder never sets
   one, the `Array.isArray(data.conditions)` merge branch at `:221` is dead
   code — assembling in the builder deletes both `type-assertion-boundary`
   markers plus that dead branch.
3. This mirrors the existing `character-create.ts` /
   `character-create-helpers.ts` precedent of returning `Prisma.*CreateInput`
   from builders — house style, not new machinery.

Run the existing suite to confirm no behavior change:
`bun run test -- packages/server/src/routers/encounter-participants-add.test.ts`.

## Scope / caveats

- **No behavior change.** This is a type-boundary fix plus a dead-branch
  deletion; the conditions-copy behavior is pinned by
  `encounter-participants-add.test.ts:479-503` and must stay green.
- **Out of scope:** the other helpers in `encounter-participant-helpers.ts`
  (`lockTurnIndexForRemoval`, `reindexSortOrders`) and any change to
  `buildBlindData` — the prior pack's
  [`01-prisma-boundary-type-erosion.md`](../code-quality-2026-07-25/01-prisma-boundary-type-erosion.md)
  ruled explicitly that `buildBlindData` "is not an instance of the builder
  duplication — do not 'fix' it".
- **Prior-pack context, not a conflict:** that same landed leaf 01
  (Done, 2026-07-26) carved this exact cast out of its own scope — "The cast
  at `participant-action.ts:229` … is unrelated to the builders and survives
  all of the above … do not scope it into step 6." That was a deferral because
  its generic `pickDefined` mechanics could not remove the cast, not a ruling
  against fixing it; this leaf is the follow-up, and it should follow leaf
  01's landed conventions (typed builder returns, no hand-declared row
  mirrors).
- **Marker hygiene:** removing the casts must remove their
  `type-assertion-boundary` markers in the same commit — an orphaned marker
  fails lint. See
  [`docs/guides/local-eslint-rules.md`](../../../guides/local-eslint-rules.md#type-assertion-boundary-marker).
- No sequencing edges with other leaves in this pack; helper plus one caller
  keeps this S.
