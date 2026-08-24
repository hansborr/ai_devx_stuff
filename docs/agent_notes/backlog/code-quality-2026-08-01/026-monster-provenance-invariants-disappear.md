# 26. Monster provenance mutual exclusion lives only in a superRefine, so the inferred type admits states the parser rejects and the exported monster schema skips the check entirely

Status: Not started
Theme: inference-visible schema invariants · Area: shared · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

A monster participant has exactly three provenance states: an SRD monster
(`monsterId`), a homebrew monster (`homebrewMonsterEntryId` **plus**
`homebrewMonsterEntryVersion`, always together), or a fully custom monster
(none of the three). The schema layer knows this — but only as runtime prose.
`addMonsterParticipantInputSchema` declares all three fields independently
optional, and the mutual-exclusion and id/version-pairing rules are enforced
solely by a `superRefine` attached to the *outer* participant union.
`superRefine` never narrows `z.infer`, so the invariant vanishes from the
static contract in two ways:

- **The inferred type lies.** `AddMonsterParticipantInput` and the monster arm
  of `AddParticipantInput` both admit impossible states (both ids set, an id
  without its version, an orphan version). Server code pays for this
  directly: after narrowing on `homebrewMonsterEntryId !== undefined`, the
  participant-add service still sees the version as `number | undefined` and
  has to thread it through as optional, even though the parser guarantees it
  is present.
- **The exported monster schema bypasses the invariant.**
  `addMonsterParticipantInputSchema` is exported separately from the union
  that carries the `superRefine`, so any direct
  `addMonsterParticipantInputSchema.parse(...)` accepts exactly the payloads
  the participant endpoint rejects.

This repo's contract model is that shared Zod schemas are the single source
from which types derive. Here the schema and its inferred type disagree about
what a monster participant can be, so every consumer either re-discovers the
invariant by reading the refinement, or writes defensively against states
that cannot occur. The transferable fix — structural union variants whose
excluded keys are declared `z.undefined().optional()` so exclusion is visible
to inference without changing the wire shape — is exactly the kind of pattern
this codebase exists to demonstrate.

## Evidence

- `packages/shared/src/schemas/encounter-inputs.ts:116-132` — the exported
  `addMonsterParticipantInputSchema`, with `monsterId` (`:120`),
  `homebrewMonsterEntryId` (`:121`), and `homebrewMonsterEntryVersion`
  (`:122`) all independently `.optional()`.
- `packages/shared/src/schemas/encounter-inputs.ts:159-182` — the
  `superRefine` on the outer `addParticipantInputSchema` discriminated union
  is the only enforcement of the both-set (`:161-167`), id-without-version
  (`:168-174`), and version-without-id (`:175-181`) rejections. Nothing here
  narrows the type exported at `:184`.
- `packages/shared/src/schemas/encounter-inputs.ts:134` —
  `AddMonsterParticipantInput` is inferred from the unrefined object, so a
  direct parse or an inferred-type consumer never sees the invariant.
- `packages/server/src/services/encounter-combat/participant-action.ts:197-203` —
  the service narrows on `input.homebrewMonsterEntryId !== undefined` yet must
  still pass `expectedVersion: input.homebrewMonsterEntryVersion` as an
  optional value; the pairing the parser enforced is invisible here.
- `packages/server/src/utils/encounter-participant-helpers.ts:33-36` —
  `buildAddParticipantData` reads all three provenance keys with `?? null`;
  it typechecks unchanged under an explicit-undefined union.
- `packages/shared/src/schemas/encounter-inputs.test.ts:232-290` — the four
  invariant cases (both-set, id-without-version, version-without-id,
  homebrew-pair accepted) all assert specific issue paths via
  `error.issues.some((i) => i.path.join(".") === ...)`, which is coupled to
  the current superRefine error shape.
- `packages/client/src/components/campaign/npcs/homebrew-monster-tab.tsx:26-27` —
  the only client producer of homebrew provenance already sends
  `homebrewMonsterEntryId` and `homebrewMonsterEntryVersion` together.
- `AddMonsterParticipantInput` has no consumer outside its defining file in
  any package `src/` tree (grep across `packages/*/src`, 2026-08-02), so
  changing its shape from object to union is low-blast-radius.
- zod is `^4.4.3` in both consumers: `packages/shared/package.json:39`,
  `packages/server/package.json:52`.

## Proposed direction

In `packages/shared/src/schemas/encounter-inputs.ts`, replace the single
permissive monster object (`:116-132`) with three strict variant objects
sharing the existing spread-field idiom (`baseParticipantFields` at `:89-96`,
`monsterNpcStatsFields` at `:98-103`):

1. **Define the three variants.** `srdMonster` (`monsterId: idField`
   required), `homebrewMonster` (`homebrewMonsterEntryId: idField` and
   `homebrewMonsterEntryVersion` positive int, both required), and
   `customMonster` (none of the three). Critically, each variant must declare
   the provenance keys it *excludes* as `z.undefined().optional()` rather
   than omitting them. This was verified against the repo's zod 4.4.3 to
   (a) enforce mutual exclusion and id/version pairing at runtime for all
   four rejection/acceptance cases, and (b) keep every key present in the
   inferred union so server code like `participant-action.ts:197-203` still
   typechecks — and narrowing on `homebrewMonsterEntryId !== undefined` now
   yields a required `number` version (verified with `tsc --strict`). For
   copyability, comment the variant block explaining why excluded keys are
   declared `z.undefined().optional()` (inference-visible exclusion plus
   narrowing) — that is the transferable pattern this leaf demonstrates.
2. **Re-export the monster schema as the union.** Redefine
   `addMonsterParticipantInputSchema` as
   `z.union([srdMonster, homebrewMonster, customMonster])` so direct parses
   through the exported monster schema also enforce the invariant, and derive
   `AddMonsterParticipantInput` from it.
3. **Restructure the outer schema as a plain union and delete the
   superRefine.** `addParticipantInputSchema` becomes
   `z.union([character, monsterUnion, npc])`. Do not attempt to keep
   `discriminatedUnion`: zod 4.4.3 rejects a plain-union option inside
   `discriminatedUnion` (parse-time "Invalid discriminated union option") and
   throws at construction on duplicate `"monster"` discriminator values —
   both were verified, so a plain union is the only shape that works without
   wire changes. Attach a custom `error` message to the monster union to keep
   rejection diagnostics readable.
4. **Rewrite the shared tests to the union error shape.** The assertions at
   `encounter-inputs.test.ts:232-290` break as written; the rewrite must
   preserve all four invariant cases (both-set, id-without-version,
   version-without-id, homebrew pair accepted) plus srd-only and custom
   acceptance — asserting only `success: false` would silently weaken the
   contract this change exists to strengthen. Run with
   `bun run test -- packages/shared/src/schemas/encounter-inputs.test.ts`.
5. **Server follow-through is minimal.** Optionally tighten the narrowed path
   in `participant-action.ts` (`expectedVersion` can stay optional in
   `assertHomebrewEntryLinkedToCampaign`'s signature — widening that helper
   is out of scope). `buildAddParticipantData`
   (`encounter-participant-helpers.ts:33-36`) needs no change. Server tests
   touching `AddParticipantInput` fixtures (`participant-action.test.ts`,
   `routers/encounter-participants-add.test.ts`,
   `encounter-participant-helpers.test.ts`) mostly construct valid payloads
   and should be unaffected, but run them. Client code needs no changes
   (`homebrew-monster-tab.tsx` already sends id and version together).

Wire payloads accepted and rejected are unchanged: all keys and `.strict()`
behavior are preserved.

## Scope / caveats

- **Out of scope:** adding a second wire discriminator key, restructuring the
  character/npc variants, widening `assertHomebrewEntryLinkedToCampaign`'s
  signature, and any Prisma or persistence changes.
- **Error-shape degradation is real and accepted.** Zod plain unions report
  failures as a single `invalid_union` issue with per-option errors nested
  under `errors`, so field-level error quality degrades versus the current
  targeted superRefine messages; any client/tRPC surface that formats
  field-level zod issues may show blunter errors. The custom `error` message
  on the monster union (step 3) is the mitigation.
- **Do not omit excluded keys instead of declaring them
  `z.undefined().optional()`.** A naive omission compiles the schema but
  breaks property-access narrowing across the server union consumers
  (`participant-action.ts`, `buildAddParticipantData`).
- **Do not re-litigate the verified zod facts** in the direction above
  (discriminatedUnion rejections, the `z.undefined().optional()` runtime and
  `tsc --strict` behavior); they were checked against zod 4.4.3 during
  triage.
- **Sequencing:** [024-encounter-inputs-monolith-spanning-three.md](./024-encounter-inputs-monolith-spanning-three.md)
  also modifies `packages/shared/src/schemas/encounter-inputs.ts` (a distinct
  problem — file-level structure, not the provenance invariant). Land the two
  leaves serially in either order to avoid merge conflicts. No dependency on
  the 2026-07-25 pack.
- **Related, not a dependency:**
  [048-monsteradddata-erases-mutually-exclusive.md](./048-monsteradddata-erases-mutually-exclusive.md)
  covers the client-side `MonsterAddData` counterpart of this invariant
  (`monster-tab.tsx:19`); the two touch different packages and can proceed
  independently.
