# 22. Order-dependent `z.union`s with catch-all fallbacks stand in for discriminated unions in the shared contract

Status: **Done 2026-07-27** in
[SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md) slices **S1, U1 and U2**,
merge `75bad57dc`; see [Landed](./00-index.md#landed). **U3 is
closed-declined**, not remaining work. The plan superseded and cut this leaf
(M→S); read its outcome rather than the `## Proposed direction` below.
**Dropped: step 3, and step 5's writer and discriminated-union sub-steps** —
correction 7 in the plan shows the mapper fallback both this leaf and leaf 26
rely on does not protect the whole-entity tRPC `.output(...)`, so "fix the read
path first" is insufficient as written. **Merged: step 2 into slice S1**, since
leaf 23 was already opening `schemas/MODULE.md` and the move and the doc
correction belonged in one slice — which also dissolved the `22 ↔ 23` layout
overlap both leaves note. **Split out, then declined: step 4 as U3.** Its four
`campaignId`-only payloads are independent wire contracts that merely coincide
in shape; aliasing them to one schema identity would weaken the registry
identity assertion and mis-wiring typecheck for about 8 saved lines.
Theme: Contract modelling · Area: shared · Severity: low · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

Two of the shared contract's JSON payload types — level-choice data and notification
data — are modelled as bare `z.union([...])` whose correctness depends on member
*order* and whose last member accepts any object-shaped payload. In both cases the
record that carries the payload already stores an explicit discriminator right next
to it, so the type information exists and is simply thrown away.

`characterLevelChoiceSchema` stores `choiceType` (a closed six-value enum) and
`choiceData` as two independent fields, and `choiceDataSchema` ends in
`z.record(z.string(), z.unknown())`. That tail means the union rejects only
non-object JSON (primitives, `null`, arrays) and `ChoiceData` can never be narrowed:
a consumer holding a `choiceType: "subclass"` row still has to hand-check for
`subclassId`. The same shape recurs in `notificationSchema`, where `type` and `data`
are independent and `notificationDataSchema` ends in `z.object({})`.

The order dependence is the sharper hazard. Because Zod unions return the first
member that parses and `z.object` strips unknown keys, putting the *subset* shape
first silently deletes fields rather than failing. Both unions carry multi-line
comments whose entire job is to warn future editors not to reorder them — a comment
that exists because the type is under-specified. For notifications the failure is
invisible: `messageId` is written by the whisper-offline path
(`packages/server/src/routers/chat.ts:83-88`) and has no reader today, so a reorder
would be silent data loss with no test to catch it.

Compounding the navigability cost, the whole notification entity — enum, data
shapes, `notificationSchema` — lives inside `campaign.ts`, so
`notification-inputs.ts` imports its own entity back out of `campaign.js`, and
`schemas/MODULE.md` documents this under "Cross-named / unpaired files (the traps)".

A related but distinct problem lives in `socket-events.ts`: 15 exported payload
schemas cover roughly 7 distinct shapes, with three byte-identical or
field-reordered pairs, all written out longhand.

## Evidence

- `packages/shared/src/schemas/character.ts:260-265` — six-line comment whose only
  content is "Order matters: asi (with required asiIncreases) before feat (featId
  only), with a generic record fallback for `skill` types that don't have a defined
  shape yet".
- `packages/shared/src/schemas/character.ts:266-273` — `choiceDataSchema`, with
  `z.record(z.string(), z.unknown())` at `:272` as the terminal member.
- `packages/shared/src/schemas/character.ts:277-284` — `characterLevelChoiceSchema`
  keeps `choiceType` (`:281`) and `choiceData` (`:282`) as independent fields.
- `packages/shared/src/schemas/character.ts:75-82` — `levelChoiceTypeSchema` is a
  closed enum of `asi | feat | subclass | skill | metamagic | other`.
- Both catch-all tails are object-only. `z.record(z.string(), z.unknown())` and
  `z.object({})` accept any plain object and reject strings, numbers, booleans,
  `null`, and arrays. So neither union is total over arbitrary JSON — only over JSON
  *objects*, which matters for the read paths below.
- `packages/server/src/services/level-up/asi.ts:124-137` — builds `asiData` with
  `asiIncreases` conditionally spread, then writes `choiceType: isAsiFeat ? "asi" :
  "feat"`. The conditional spread re-expresses, weakly, an invariant that is
  already enforced upstream: `asiChoiceSchema`'s refine
  (`packages/shared/src/schemas/character-inputs.ts:250-261`) rejects any choice
  whose `featId` is `ASI_FEAT_ID` unless `asiIncreases` is non-empty and totals 2,
  and the only production entry point (`packages/server/src/routers/character.ts:121-128`)
  parses `levelUpInputSchema` before calling `performLevelUp`. So the writer cannot
  emit an `asi` row without `asiIncreases` in production; what it emits is a
  `TypeScript`-shaped hedge, since `AsiChoice` keeps `asiIncreases` optional
  (refines do not narrow the inferred type). Direct in-process callers that skip
  the parse are all tests.
- The four production writers of `characterLevelChoice.choiceData` —
  `asi.ts:126-137` (asi/feat), `apply-level-up.ts:45-57` (`other`/`level_up`),
  `sorcerer.ts:97-105` (metamagic) and `subclass.ts:141-149` (subclass) — each emit
  a payload matching one of the four typed union members. No production writer
  reaches the `z.record` tail today.
- `packages/server/src/utils/character-mapping.ts:106` — reads with
  `fromJsonValidated(lc.choiceData, choiceDataSchema)` (two args).
- `packages/server/src/utils/prisma-json.ts:70-78` — `fromJsonValidated` throws when
  no fallback is supplied; the level-choice read path has none.
- `packages/client/src/test/fixtures-character.ts:1,:149` — the only file referencing
  `ChoiceData` outside its own definition.
- `packages/shared/src/schemas/campaign.ts:37-42` — the ordering comment;
  `:43-47` — `z.union([whisper, campaign, z.object({})])`.
- `packages/shared/src/schemas/campaign.ts:12-19` — `notificationTypeSchema`, six
  values; `:104-113` — `notificationSchema` with independent `type` and `data`.
- `packages/server/src/utils/notification-helpers.ts:14` —
  `fromJsonValidated(n.data, notificationDataSchema, {})`; the `{}` fallback is what
  keeps the notification list query from throwing on a legacy row.
- `packages/server/src/services/notification-service.ts:23,:49` — `data` is optional
  on the create params and written as `toJson(params.data ?? {})`, so a data-less
  notification of any type is legal today. Only two production creators exist:
  `packages/server/src/services/invite-service.ts:152` and
  `packages/server/src/routers/chat.ts:83`.
- `packages/shared/src/schemas/notification-inputs.ts:4` — imports
  `notificationSchema` from `./campaign.js`. `packages/shared/src/schemas/MODULE.md`
  records the misplacement twice: the trap bullet at `:59-62` ("the `Notification`
  entity lives in `campaign.ts`") and the quick-map row at `:105`, which lists
  `notificationSchema` among the campaign entity file's notable schemas.
- `packages/shared/src/schemas/socket-events.ts` — `z.object({ campaignId: idField })`
  four times at `:11-13`, `:17-19`, `:42-44`, `:99-101`; `{ <entity>Id, campaignId }`
  four times at `:52-55`, `:63-66`, `:74-77`, `:81-84` (`mapTokenUpdated` and
  `mapLayerUpdated` byte-identical). Both campaign/presence pairs are the same shape
  with the fields declared in opposite order: `campaignPlayerLeft` `:35-38` is
  `{ userId, campaignId }` against `presenceUserLeft` `:127-130`'s
  `{ campaignId, userId }`, and `campaignPlayerJoined` `:27-31` against
  `presenceUserJoined` `:119-123` likewise.

## Proposed direction

Take the notification half first — it is smaller, and the read path already has the
degradation hook the level-choice path lacks.

1. **Collapse `notificationDataSchema` to one order-independent object.** Replace the
   union at `packages/shared/src/schemas/campaign.ts:43-47` with a single
   `z.object({ campaignId: z.string().optional(), messageId: z.string().optional() })`
   (or equivalent) and delete the ordering comment at `:37-42`. The reorder hazard
   disappears and nothing that parses today stops parsing. It is not output-identical,
   though: a partial row such as `{ messageId }` with no `campaignId` currently falls
   through to the `z.object({})` tail and parses to `{}`, whereas the all-optional
   object preserves `messageId`; a wrong-typed `campaignId` stops matching the schema
   but still lands on `{}` via the helper's fallback. Both are improvements, but pin
   them — add parse tests for `{ messageId }` alone, for `{ campaignId, messageId }`,
   and for a wrong-typed field before the swap. Keep
   `fromJsonValidated(..., {})` at `notification-helpers.ts:14` exactly as is.
2. **Move the notification entity out of `campaign.ts`** into a new
   `packages/shared/src/schemas/notification.ts`: `notificationTypeSchema` (`:12-19`),
   the data schemas (`:26-49`), and `notificationSchema`/`Notification` (`:104-113`).
   Re-point the 14 importing files:
   - shared — `schemas/notification-inputs.ts`, `schemas/socket-events.ts` (the
     in-package `ServerToClientEvents` contract, which types `"notification:new"` at
     `:156`), and `schemas/campaign.test.ts` (whose `notificationTypeSchema`
     assertions at `:32-51` should move to a new `notification.test.ts` beside the
     entity);
   - server — `routers/notification.ts`, `socket/broadcast-registry.ts`,
     `utils/notification-helpers.ts`, `services/notification-service.ts`,
     `test/enum-sync.test.ts`, `routers/notification.test.ts`,
     `routers/notification-mutations.test.ts`, `socket/broadcast-registry.test.ts`;
   - client — `hooks/use-notifications.ts`,
     `components/notifications/notification-item.tsx` and its test.

   Update `packages/shared/src/schemas/MODULE.md` in the same commit — there is no
   barrel, so that doc is the navigational aid. Both statements go stale: the trap
   bullet at `:59-62` (`notification-inputs.ts` is no longer entity-less) and the
   quick-map row at `:105`, which must drop `notificationSchema` from the campaign
   row and gain a notification row (`notification-inputs.ts` / `notification.ts`).
   See `docs/guides/add-module-doc.md`. Mechanical, but a 14-file rename, so keep it
   as its own commit.
3. **Only then consider a discriminated `notificationSchema`.** If it is worth doing,
   it must land as three things in one commit: a `z.discriminatedUnion("type", ...)`
   on the entity, a decision about what `system` / `encounterStart` /
   `sessionReminder` rows carry, and a tightening of
   `notification-service.ts:23` so `data` is no longer blanket-optional. Test-first:
   add a mapper test proving a legacy row with mismatched `data` still degrades to
   `{}` through `notification-helpers.ts:14` before changing the schema.
4. **Deduplicate `socket-events.ts` with a base-plus-extend rewrite.** Define one
   `campaignScopedSchema = z.object({ campaignId: idField })` and derive the four
   `campaignId`-only payloads from it; define one `{ userId, campaignId }` base and
   derive `campaignPlayerLeft`/`presenceUserLeft` and (via `.extend({ displayName })`)
   `campaignPlayerJoined`/`presenceUserJoined`. Both presence schemas declare
   `campaignId` first, so deriving them from a `{ userId, campaignId }` base flips
   declaration order; that is inert for Zod parsing and for the inferred types, but
   say so in the commit message so the diff does not read as a contract change. Keep
   every existing export name and inferred type alias so socket handlers and
   `docs/socket-architecture.md` stay accurate; see
   `docs/guides/add-socket-broadcast.md` before touching the event contract. Realistic
   saving is 20-30 lines of a 187-line file — do this for the "one shape, one
   definition" property, not for the line count.
5. **Level-choice data, last and most carefully.** The order here is *read path
   first*, not writer first. `character-mapping.ts:106` calls `fromJsonValidated`
   with no fallback, so `prisma-json.ts:77` throws and the whole character load
   fails on any `choiceData` the union rejects. Today the `z.record` tail makes the
   union total over JSON objects, so that is confined to a non-object payload; a
   `z.discriminatedUnion("choiceType", …)` removes even that. So:
   - Give `character-mapping.ts:106` an explicit degradation first — a fallback
     value, or a quarantine path that keeps the rest of the character loading and
     surfaces the unparseable row — with tests that a row of an unknown object shape
     *and* a non-object row both survive the mapper. This is the commit that makes
     the rest safe, and it is worth landing even if nothing else here is.
   - Then tighten `asi.ts:126-131` to stop hedging: with `asiChoiceSchema`'s refine
     upstream, the `asi` branch should assert `asiIncreases` is present (throw or
     narrow) rather than silently omitting it. This is a defensive-writer cleanup,
     not a data fix — no migration or backfill is called for, because no production
     path produces a malformed row (see Evidence).
   - Only then fold `choiceDataSchema` into `characterLevelChoiceSchema` as a
     `z.discriminatedUnion("choiceType", …)`. Decide explicitly what the `skill`
     branch becomes (see the caveat below) and keep a permissive member or the
     mapper fallback for rows written before the current four writers existed —
     that history has not been inventoried, and the discriminated union is only as
     safe as the read path underneath it.

## Scope / caveats

- **The record fallback at `character.ts:272` is load-bearing — because of the read
  path, not because of bad data.** `character-mapping.ts:106` passes no fallback and
  `fromJsonValidated` throws (`prisma-json.ts:77`), so the `z.record` tail is the
  only thing guaranteeing that a row of any *object* shape — a legacy row from a
  writer that no longer exists, a hand-edited row, a future `skill` row — still
  loads. No malformed production row is evidenced and no backfill or migration is
  called for: `asiChoiceSchema`'s refine (`character-inputs.ts:250-261`) rejects such
  an input at the only production entry point (`routers/character.ts:121-128`), and
  all four production writers emit payloads matching a typed member. A naive
  per-`choiceType` discriminated union removes that guarantee, which is why step 5
  fixes the read path first.
- **Keep the four typed members of `choiceDataSchema`.** Zod tries union members in
  order and `z.object` strips unknown keys, so a payload matching
  `asiChoiceDataSchema` is still shape-checked and pruned even though the `z.record`
  tail makes the union total over objects. What the current shape lacks is *static*
  discrimination, not runtime value — do not delete the typed members as a shortcut.
- **There is no `skill` writer.** Production writes only occur at `asi.ts:137`,
  `apply-level-up.ts:50`, `sorcerer.ts:102` and `subclass.ts:146`, covering
  asi/feat/metamagic/subclass/other. Inventing a `skillChoiceDataSchema` would be
  speculative; either retire the enum value or leave that branch opaque.
- **Do not remove the `{}` fallback at `notification-helpers.ts:14`.** It is the only
  thing standing between a corrupt or legacy `data` column and a thrown notification
  list query. Any tightening of `notificationDataSchema` must keep that degradation.
- **Blast radius is smaller than it looks, in the level-choice case.** `ChoiceData` is
  referenced in exactly one file outside its definition
  (`packages/client/src/test/fixtures-character.ts:1,:149`), so no consumer is
  currently fighting the un-narrowable type. Rank this work as modelling hygiene and a
  latent-hazard fix, not as an unblocking change and not as a live-defect fix —
  there is no known-bad persisted data behind it.
- **Step 4 (`socket-events.ts`) is a different underlying cause** — copy-paste
  accretion, not under-specified unions — and shares nothing with steps 1-3 beyond the
  file's directory. It can be split into its own leaf without loss. Likewise step 2 is
  a layout move that overlaps the theme of leaf 23; if 23 is being done first, fold
  step 2 into it and leave this leaf purely about the unions.
- Sequencing: steps 1-3 must run in order (the move in step 2 rewrites the import
  paths that step 3 edits). Step 5's own three sub-steps are ordered (read path,
  then writer, then schema) and depend on nothing in steps 1-4.
- **Sequence step 5 against leaf 21.** Leaf 21 step 5 moves the `{ ability, amount }`
  shape that `asiChoiceDataSchema` (`character.ts:219-233`) inlines into a shared
  leaf module, deleting the copy this leaf's step 5 then wraps in a discriminated
  union. Land leaf 21 step 5 first, or combine the two; they must not run
  concurrently against `character.ts`.
