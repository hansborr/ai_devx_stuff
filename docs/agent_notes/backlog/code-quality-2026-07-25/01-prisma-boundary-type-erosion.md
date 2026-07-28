# 01. Hand-written row/payload types re-erode Prisma's generated types, then buy the loss back with casts

Status: Done — landed 2026-07-26 (`6e86b597`…`2093989d`, merge `028a21d5`); step 2 was skipped as this leaf itself instructs, and step 8 grew: review found the restricted-delegate mechanism it builds on was never structurally closed. See [`00-index.md`](./00-index.md#landed)
Theme: Prisma boundary types · Area: server · Severity: medium · Size: L

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`packages/server/src` maintains a hand-written parallel type model alongside Prisma's
generated client types and the shared Zod schemas. Every place that hand-written model is
weaker than the generated one, the weakness is paid back at the use site with a type
assertion and a `type-assertion-boundary` marker comment. The mechanism is uniform:

- **Row interfaces widen Prisma enums to `string`.** `EncounterRow.state`,
  `ParticipantRow.type` and `CombatLogRow.action` are declared `string` even though
  `schema.prisma` declares all three columns as real Prisma enums. Five mappers then narrow
  them back with `as`, each carrying a marker comment whose stated justification — "widens
  to `string` so the row interface stays Prisma-shape-only" — is self-refuting, because the
  Prisma shape *is* the enum literal union.
- **Result interfaces restate Zod output contracts.** `map-types.ts` re-declares
  `mapTokenSchema` / `mapLayerSchema` / `mapDetailSchema` / `mapSummarySchema` field for
  field, while `routers/map.ts` already enforces the schema copy via `.output(...)`. Two
  copies of one contract, one enforced.
- **Query and update payloads are built as `Record<string, unknown>`.** 21 production sites
  build a filter or update object into a bare record and then hand it to a typed Prisma
  parameter. Because the object is assigned through a variable, excess-property checking
  never fires, and the record's `unknown` value type means neither the key names nor the
  value types are checked against the model. The concrete loss is compile-time: a misspelled
  filter key type-checks. It does **not** silently widen the result set — Prisma validates
  query arguments at runtime and throws `PrismaClientValidationError: Unknown argument …` —
  so the failure mode is a request-time 500 on whichever branch sets the bad key, caught only
  if a test exercises that branch. Editor autocomplete on filter and update fields is lost
  along with the check.
- **Four near-identical "copy the defined fields" builders** exist because there is no
  typed helper for the partial-update idiom.

None of this is a missing abstraction — the typed style is already the house pattern
*next door*. `routers/srd.ts` uses `Prisma.ClassFeatureWhereInput` / `Prisma.SpellWhereInput`
for exactly the incremental-filter idiom, and returns `z.input<typeof ...Schema>` from its
mappers. So the work is convergence on an existing in-repo pattern, not new invention.

A second, adjacent cluster lives in `utils/prisma-types.ts`: the restricted-delegate guard
repeats a five-way boilerplate skeleton, and 21 `as unknown as RawTxClient` casts each carry
a near-identical marker sentence. **That repetition is a deliberate compile-time guard, and
most of it is load-bearing** — it belongs in this leaf only because it is the same file
family, and it must be treated with the opposite instinct from the erosion above. See
"Scope / caveats".

## Evidence

Enum widening and its cost:
- `packages/server/src/utils/encounter-query.ts:43` — `state: string` on `EncounterRow`
- `packages/server/src/utils/encounter-query.ts:64` — `type: string` on `ParticipantRow`
- `packages/server/src/utils/encounter-query.ts:104` — `action: string` on `CombatLogRow`
- `packages/server/src/utils/encounter-query.ts:201,223,270,290` — four `prisma`-marked casts narrowing those three columns back
- `packages/server/src/routers/encounter.ts:169-170` — a fifth: marker at :169, `const from = encounter.state as EncounterDetail["state"]` at :170
- `packages/server/prisma/schema.prisma:114,123,131` — `enum EncounterState`, `enum ParticipantType`, `enum CombatActionType`; columns at `:1266`, `:1286`, `:1348`
- `packages/server/src/utils/encounter-query.ts:88-94` — documented reason `ParticipantRow.mapToken?` / `.character?` are optional: summary-include and detail-include rows must both satisfy one interface

Duplicated result contracts:
- `packages/server/src/utils/map-types.ts:71,92,102,117` — `MapTokenResult` / `MapLayerResult` / `MapDetailResult` / `MapSummaryResult`
- `packages/server/src/routers/map.ts:28,50,82` — `.output(mapDetailSchema)` already enforces the schema copy
- `packages/shared/src/constants.ts:89` — `dateTimeField` transforms `Date` -> ISO string, so `z.infer` and `z.output` are the *wrong* target
- `packages/server/src/routers/srd.ts:113,142,155,176,197,214,227` — the house pattern: mappers return `z.input<typeof ...Schema>`

Untyped where/update payloads (21 production sites: 10 where-clauses, 11 update payloads):
- where-clauses: `routers/note.ts:24` and `routers/npc.ts:21` (`type WhereClause = Record<string, unknown>`), `routers/homebrew.ts:171`, `routers/homebrew.ts:280`, `routers/encounter.ts:100`, `routers/character-spell.ts:249`, `routers/inventory.ts:32`, `routers/inventory.ts:43-44`, `services/inventory-service.ts:148`, `services/encounter-combat/combat-log.ts:89`
- update-data payloads: `routers/campaign.ts:194`, `routers/map-layer.ts:72`, `routers/homebrew.ts:326`, `routers/homebrew.ts:210` (`data: pickDefined(rest)` into `homebrewCollection.update`), `routers/note.ts:145`, `routers/npc.ts:92`, `services/inventory-service.ts:171` (`pickInventoryUpdateFields`, consumed at `:266`), `utils/map-helpers.ts:151-152`, `utils/map-helpers.ts:174-175`, `utils/encounter-helpers.ts:99-100`, `utils/encounter-helpers.ts:114-115`
- correct-usage counter-examples in the same package: `routers/srd.ts:294` (`Prisma.ClassFeatureWhereInput`), `routers/srd.ts:352` (`Prisma.SpellWhereInput`)

Copy-defined builders:
- `packages/server/src/utils/pick-defined.ts:6`
- `packages/server/src/utils/map-helpers.ts:151`, `:174`
- `packages/server/src/utils/encounter-helpers.ts:96`, `:112`
- `packages/server/src/services/encounter-combat/participant-action.ts:150` — `buildBlindData`, the **counter-example**: it already returns the typed `BlindParticipantFields`

Restricted-delegate boilerplate (guard, not erosion):
- `packages/server/src/utils/prisma-types.ts:3-16` — header documenting the pattern
- `packages/server/src/utils/prisma-types.ts:6` — header still says "Writes to `CharacterStats` and `EncounterParticipant`" though five tables are now restricted
- `packages/server/src/utils/prisma-types.ts:26-38, 40-52, 54-66, 68-80, 82-94` — five structurally identical `Omit<..., 'update'|'updateMany'|'updateManyAndReturn'|'upsert'> & { …: never }` types, each with four `@deprecated` JSDoc lines
- `packages/server/src/utils/prisma-types.ts:103,105-109` and `:134-138,141-145` — the model-name list and the five delegate assignments, duplicated between `TxClient` and `DbClient`
- `packages/server/src/utils/prisma-types.ts:150-161` — `toDbClient`, "the single sanctioned downgrade"
- 21 `as unknown as RawTxClient` casts, all in the `utils/*-mutations.ts` set that `prisma-types.ts:13-15` names as the permitted importers: `participant-stats-mutations.ts` 5, `encounter-state-mutations.ts` 5, `spell-slot-mutations.ts` 5, `character-class-mutations.ts` 4, `character-stats-mutations.ts` 2
- `packages/server/src/utils/participant-stats-mutations.ts:6-13` — per-file header declaring that file the sole sanctioned escape for its model
- `packages/server/src/utils/__type-tests__/` — one negative type-test file per restricted table; a refactor that accidentally unbans a method fails typecheck

## Proposed direction

Each numbered step is one commit. Steps 1-6 are the erosion fixes and are independent of
each other; steps 7-8 are the guard-deduplication and can be deferred or split into their own
branch entirely.

1. **Un-widen the three enum columns in `utils/encounter-query.ts`.** Type `EncounterRow.state`,
   `ParticipantRow.type` and `CombatLogRow.action` as the Prisma enum types (import the
   generated enums, or derive via `Prisma.EncounterGetPayload<…>["state"]`). Delete the four
   now-unnecessary casts and their marker comments at `:201,:223,:270,:290`, and the fifth at
   `routers/encounter.ts:169-170`. Net removal: 5 assertions.
2. **Only after step 1**, revisit `routers/encounter.ts:192-193`. Those two casts are marked
   `interop`, not `prisma`, and exist because `isValidTransition` is a runtime predicate
   rather than a TS type guard. They survive step 1 untouched. If you want them gone, the
   change is to make `isValidTransition` a real type guard — a separate, optional commit.
   Do not fold it into step 1.
3. **Retype the untyped where-clauses to `Prisma.<Model>WhereInput`.** Follow the existing
   `routers/srd.ts:294`/`:352` shape. Do the where-clauses first, as one commit per router,
   because they are pure type annotations with no expected fallout. Delete the two
   `type WhereClause = Record<string, unknown>` aliases (`routers/note.ts:24`,
   `routers/npc.ts:21`) rather than retyping them in place.
4. **Retype the update-data payloads to `Prisma.<Model>UpdateInput`,** separately and
   expecting fallout. Two picks are not mechanical. A payload that assigns a foreign-key
   scalar needs `Prisma.<Model>UncheckedUpdateInput`: the checked variant drops FK columns in
   favour of nested relation syntax (`MapLayerUpdateInput` has `map?: MapUpdateOneRequired…`
   where `MapLayerUncheckedUpdateInput` has `mapId?: string`). And `routers/homebrew.ts:326`
   feeds `homebrewEntry.updateMany`, whose `data` is
   `XOR<HomebrewEntryUpdateManyMutationInput, HomebrewEntryUncheckedUpdateManyInput>` — not
   `UpdateInput`. Nullable columns are not a problem: `CampaignUpdateInput.nextSessionDate` is
   `NullableDateTimeFieldUpdateOperationsInput | Date | string | null`, so the `null` branch at
   `routers/campaign.ts:194` types as written. Any mismatch that does surface is a genuine
   finding, not noise; fix it, do not widen the type to silence it.
5. **Replace `map-types.ts:71/:92/:102/:117` with `z.input<typeof mapTokenSchema>` etc.**
   from `@musi/shared/schemas/map.js`, matching `routers/srd.ts`. Keep the server-only
   remainder of `map-types.ts` (`MapTokenRow`, `MapRow`, `MapSummaryRow`, `MapUpdateFields`,
   `TokenUpdateFields`, `TokenBoundsCheck`) exactly as it is. Update `mapMapDetail`
   (`utils/map-helpers.ts:116`) and `routers/map.ts` to the new names.
6. **Collapse the copy-defined builders where they fold cleanly:** `utils/map-helpers.ts:151`
   and `:174` onto a generic key-allowlist helper built from `utils/pick-defined.ts`, typed
   against the corresponding `Prisma.*UpdateInput` for the *values*, with the key list still
   hand-declared per call site (see the whitelist caveat below). Use `participant-action.ts:150`
   (`buildBlindData` -> `BlindParticipantFields`) as the model to imitate.
7. **In `utils/prisma-types.ts`, extract only the mechanical repetition:** a shared
   `BannedWrite` key union and a `BanWrites<D> = Omit<D, BannedWrite>` alias, plus a single
   `RestrictedDelegates` interface reused by both `TxClient` (`:103-109`) and `DbClient`
   (`:134-145`). Every `@deprecated` JSDoc line stays verbatim. Realistic saving is ~5-10
   lines; this is a small mechanical dedupe, do not scope it larger. Fix the stale header at
   `:6` in the same commit.
8. **Collapse the 21 `RawTxClient` casts to 5** by adding one module-private helper per
   `utils/*-mutations.ts` file, each carrying its own single marker comment naming its own
   model. Five helpers, five markers. The helper must accept `TxClient | DbClient`, not
   `TxClient` — six of the 21 cast sites sit in functions that take the union
   (`encounter-state-mutations.ts:73,142,272`, `participant-stats-mutations.ts:193`,
   `spell-slot-mutations.ts:107`, `character-class-mutations.ts:48`), so
   `function rawWrites(client: TxClient | DbClient): RawTxClient`.

## Scope / caveats

- **Do NOT extract a shared `toRawTx` into `prisma-types.ts`.** This is the single most
  important warning in this leaf. Each of the five `utils/*-mutations.ts` files carries a
  header block (e.g. `participant-stats-mutations.ts:6-13`) declaring itself the *sole
  sanctioned escape* for one model, and `prisma-types.ts:13-15` limits `RawTxClient` imports
  to that file set. A globally importable `toRawTx` makes the escape available everywhere —
  precisely what the guard forbids. The safe reduction is 21 -> 5 file-local helpers, never
  21 -> 1. Note also that `local/type-assertion-boundary` must still see a marker on the one
  remaining cast inside each helper: this is a mechanical dedupe, not an escape from the rule.
- **Do NOT replace the five restricted-delegate types with a generic
  `Restricted<Model, Doc>`.** JSDoc `@deprecated` prose is not a type-level value, so a
  generic cannot emit per-table text. That prose is the entire mechanism: each line names the
  specific locked replacement (`updateCharacterStatsLocked`, `updateParticipantStatsLocked` /
  `blindUpdateParticipant`, encounter-state-mutations, spell-slot-mutations,
  character-class-mutations) and the `docs/CONCURRENCY.md` pattern letter that shows up in the
  editor hover. Collapsing it degrades the guard the file header at `:3-16` exists to build.
  Step 7 is deliberately the small version of this idea.
- **`ParticipantRow.mapToken?` / `.character?` must stay optional.** The comment at
  `encounter-query.ts:88-94` documents why: rows from the summary include and rows from the
  detail include both have to satisfy one interface, and a missing relation must project
  `null` for non-DM viewers (fail closed). A straight `Prisma.EncounterParticipantGetPayload<…>`
  substitution cannot express that. Step 1 needs a scalar payload intersected with the
  optional relations, not a wholesale swap. Keep the comment verbatim.
- **`z.infer` / `z.output` is the wrong target for step 5.** `dateTimeField`
  (`shared/src/constants.ts:89`) transforms `Date` -> ISO string, so the inferred output type
  has `createdAt: string` while the mappers return `Date` objects for tRPC's output transform
  to serialize. `z.input` is correct and is already the house pattern. It widens dates to
  `string | Date`, which is harmless here because these types are consumed only by
  `utils/map-helpers.ts` and `routers/map.ts`.
- **`buildBlindData` is not an instance of the builder duplication** — it already returns a
  typed shape. Do not "fix" it.
- **The cast at `participant-action.ts:229` (marker at `:227`) is unrelated to the builders and
  survives all of the above.** Its own justification says it exists because `buildAddParticipantData`
  returns a hand-built `CharacterCreate | MonsterCreate | NpcCreate` union that TS cannot
  discriminate. A generic `pickDefined` will not remove it; do not scope it into step 6.
- **`buildTokenUpdateData`'s eight-key list is a deliberate whitelist, not an accident.** The
  JSDoc at `utils/map-helpers.ts:162-173` forbids `encounterParticipantId` ("Every mutation
  that changes a token<->participant link must run through `services/map-tokens/`, which owns
  the transaction boundary, the Pattern C compound-WHERE CAS, and the captured-turn-origin
  clear"), and `services/map-tokens/MODULE.md:127-137` plus `docs/adr/0001-race-sensitive-writes.md`
  back it. Whatever step 6 produces must keep the key list explicitly hand-declared and carry
  that JSDoc verbatim onto the new call site. Do not derive the allowlist from
  `keyof Prisma.MapTokenUpdateInput` — that makes the forbidden key a legal member of the
  payload type.
- **`utils/encounter-helpers.ts:96` and `:112` will not fold cleanly** into the generic
  key-allowlist helper — `buildParticipantUpdateData` has an `isCharacter` branch and
  `buildCharacterStatsUpdate` returns `null` when empty. Retype them (step 4) but leave their
  bodies alone.
- Read `docs/guides/local-eslint-rules.md#type-assertion-boundary-marker` before touching any
  marker comment, `docs/guides/lint-ratchet.md` before steps 3-4, and `docs/CONCURRENCY.md` +
  `docs/guides/add-race-sensitive-mutation.md` before steps 7-8.
  `docs/guides/add-trpc-procedure.md` and `docs/adr/0004-trpc-shared-schema-boundary.md` cover
  the router-output side of step 5 — ADR-0004 is the decision step 5 converges on ("a router
  that declares its input or output shape inline owns a private copy of the wire contract")
  and names the surfaces that enforce it (`local/trpc-shared-output-schema`,
  `routers/app-router.output-coverage.test.ts`).
  Use `bun run code:intel -- refs …` (`docs/guides/code-intel.md`) to enumerate call sites
  rather than grepping by hand.
- **Splittable.** Steps 1-6 (erosion) and steps 7-8 (guard boilerplate) share a file family
  but not a cause, and land independently. If this leaf is too large to schedule, split at
  that seam and keep the caveats attached to their half.
- **The payoff is compile-time checking, not runtime behaviour.** A misspelled filter key does
  not silently widen the returned row set: Prisma rejects unknown arguments at runtime, so the
  typo throws `PrismaClientValidationError` on whichever branch sets it. Steps 3-4 buy back a
  compile-time check and editor completion — there is no behaviour change and no new test for
  steps 1-5. Size and describe the work accordingly.
- **Marker deletions are ratchet-neutral.** `eslint-rules/type-assertion-boundary.js:270-272`
  returns without reporting when a cast carries a valid marker, so only *unmarked* or
  badly-marked casts ever reach the ratchet. The `ratchet/local-type-assertion-boundary` entry
  in `lint-ratchet.baseline.json` therefore has an empty `items` map. Deleting a marked cast is
  a 0 -> 0 delta: steps 1-2, 6 and 8 need no `lint:ratchet:update`, and there are no baseline
  numbers to reconcile. The live constraint runs the other way — the floor is zero with no
  headroom, so a *new* unmarked cast introduced while retyping fails the ratchet immediately.
- **Ratchet churn can only come from steps 3-4.** Two files those steps retype already carry
  debt under other rules: `routers/character-spell.ts` (`ratchet/max-depth-production`, count
  1) and `services/inventory-service.ts`
  (`ratchet/strict-boolean-expressions-server-services`, count 3). Swapping
  `Record<string, unknown>` for a `Prisma.*WhereInput` / `*UpdateInput` can move
  `strict-boolean-expressions` results on those payloads, and the ratchet is symmetric —
  improvements fail too until `bun run lint:ratchet:update` is committed. Check the baseline
  after each of those commits.
- Sequencing with **leaf 02**: the only file overlap is `services/inventory-service.ts` — leaf
  02 rewrites `server: unknown` at `:60`, this leaf retypes the where-clause at `:148` and the
  update helper at `:171`. Different hunks, so a plain merge resolves it and no ratchet
  ordering is required. No other dependency on leaves in this pack.
