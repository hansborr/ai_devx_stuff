# 53-PLAN. Initiative tie resolution: scheduling plan

Status: Planned — supersedes the implementation sketch in
[`53-initiative-tie-resolution-policy.md`](./53-initiative-tie-resolution-policy.md)'s
`## Decided direction`. **The owner ruling itself is not superseded and is not
re-opened here**: ties get a DM-facing resolution workflow with persisted state,
and an automatic deterministic secondary key remains refused. This plan decides
*how*, and answers the leaf's four open design questions.

Date: 2026-07-27 · Area: shared + server + client · Source leaf: 53 (L)

All anchors below were re-measured against `6a934c666` (`main`). The leaf's own
evidence is pinned to `75bad57dc` and `2decbb56a`; every citation it makes still
resolves, and every file this plan cites is byte-identical between `main` and
the branch it was drafted on except
`packages/client/src/components/campaign/encounters/encounter-detail-view.tsx`,
whose anchors below are taken from `main`.

Cross-model planning session: four independent `consult` runs against the same
brief — `consult codex` (GPT), `consult claude -m claude-opus-4-8`,
`consult cursor` (Grok) and `consult claude -m fable`. No `work` dispatch was
made and nothing on disk changed but this file. They **agreed unanimously on
four calls and split four ways on the schema shape**; every split and its ruling
is recorded in
[Consult disagreements and how they were called](#consult-disagreements-and-how-they-were-called).

## Verdict

**This is an M, not an L, and it is a `setup`-time feature.** The leaf's own
framing — "shared + server + client + socket" — is right about three of those
four and wrong about the fourth. There is **no socket work in this leaf**, and
that finding is unanimous across all four models: Musi's combat sockets are
invalidation-only (`encounter:updated` carries `{encounterId, campaignId}` and
nothing else, `packages/shared/src/schemas/socket-events.ts:52-57`), every
combat mutation already ends in `broadcastEncounterUpdate`, and every viewer
already re-fetches the whole `EncounterDetail`. A pending tie that lives in
`EncounterDetail` therefore converges across reloads, reconnects and multiple DM
tabs *with no new event*, which is exactly what the leaf's
"persisted, not client-local dialog state" caveat asks for. Adding
`encounter:tiePending` would cost five surfaces — a shared Zod schema, a
`ServerToClientEvents` member, a `RegisteredEvent` union member
(`packages/server/src/socket/broadcast-registry.ts:22-37`), a registry entry and
client wiring — to deliver zero information the refetch does not already carry.

The second sizing correction is that **the tie only needs resolving where an
order gets *finalized*, and that happens in exactly one place**: the
`setup → active` transition. Once an encounter is `active`, `sortOrder` is
authoritative, the turn pointer is `sortOrder === currentTurnIndex`
(`packages/shared/src/rules/initiative.ts:106-111`;
`initiative-tracker.tsx:83`), and the read path already breaks duplicate
`sortOrder` by `id` (`packages/server/src/utils/encounter-query.ts:115-125`).
`initiative` does not drive active turns at all. So a mid-combat tie is a
display fact, not a state machine problem — and this plan surfaces it without
building a second mid-combat reordering path.

The third correction is the one none of the four consults reached, and it is
the reason this leaf is closable at all: **the repo already owns the canonical
answer to `sortByInitiative`'s own complaint.** The helper's doc comment
(`packages/shared/src/rules/initiative.ts:35-41`) says "a caller that needs a
reproducible full-tie order must order its own input", and
`PARTICIPANT_ORDER = [{sortOrder:"asc"},{id:"asc"}]`
(`packages/server/src/utils/encounter-query.ts:125`) is precisely that ordering
— already load-bearing, already the contract that keeps `captureTurnOrigin` and
`resolveActiveTurnOrigin` agreeing on "the participant at index N". Passing it
as the `orderBy` of both unordered `findMany` calls closes the leaf's entire
Postgres-row-order evidence set without adding a hidden key, **because the key
being read back is the DM's own persisted `sortOrder`**, not an invented one.

## Corrections to the leaf, verified

1. **"Socket" is not in scope.** See [Verdict](#verdict). The leaf's step 5
   ("Broadcast the persisted pending/resolved transition") is satisfied by the
   existing `broadcastEncounterUpdate` call that every one of these mutations
   already makes. Step 5 is **done by construction**, not dropped.
2. **The DM can already reorder combatants today, and the leaf does not say
   so.** `updateParticipant` classifies both `initiative` and `sortOrder` as
   `"non-racing"` (`packages/server/src/services/encounter-combat/participant-action.ts:64-66`)
   and writes them blind through one funnel
   (`buildBlindData`, `:150-158`, called at `:142`), and the client already
   wires `onSetInitiative` through the tracker
   (`initiative-tracker.tsx:24, :42, :102`). This changes the leaf's shape
   twice: the new workflow must not become a *second* competing ordering
   channel, and "the DM has no way to order tied combatants" is false — what
   the DM has no way to do is be **told a tie exists** and have the decision
   recorded.
3. **The leaf's step 3 as written ("persist the pending state") cannot mean
   "do not persist an order".** `executeRollAllInitiative` must write contiguous
   `sortOrder`, because the turn pointer and the read path's index invariant
   both depend on a written order. "Pending" therefore means *a suggested order
   is written but not blessed*, which is what the ruling's own "may be useful as
   a suggested initial presentation" sentence already allows. All four consults
   converged on this independently; `claude-opus-4-8` stated it most sharply.
4. **`activateEncounter` can currently undo a resolution.** It re-runs
   `sortByInitiative` over an unordered `findMany`
   (`activate-encounter.ts:35-37`, `:50`), so the modifier rule would re-sort a
   band the DM had just ordered *against* the modifier. Any design that only
   adds a gate at activation and leaves the re-sort in place ships the leaf's
   defect through the fix.
5. **Roll-all's read is unordered too, and it is half the leaf's evidence.**
   `combat-actions/initiative.ts:32-34`. Three of four consults fixed only
   activation. Both callers need the ordered read.
6. **Tie groups must be derived server-side, not on the client.**
   `mapEncounterDetail` filters hidden participants for non-DM viewers
   (`encounter-query.ts:267-271`, `.filter((p) => isDm || p.isVisible)`). A
   helper run client-side over `encounter.participants` therefore computes over
   a *different set* for each role, and a non-DM could see a two-member "tie"
   that is really a three-member one. The derivation belongs beside
   `resolveActiveTurnOrigin` (`:254-262`, `:285`), which is also the precedent
   for the read shape: a nullable, `isDm`-aware, computed-at-projection-time
   field on `encounterDetailSchema`
   (`packages/shared/src/schemas/encounter.ts:179-185`) that is not a stored
   column.
7. **The initiative tracker is not rendered during `setup`.**
   `encounter-detail-view.tsx:204` — `showTracker = encounter.state !== "setup"`.
   Two consults placed the resolution panel inside `InitiativeTracker`, where it
   would never mount. Grok caught this; the panel is a sibling of the tracker,
   mounted from the encounter detail surface.

## The design

### Persisted shape — one boolean, on the participant

```prisma
// model EncounterParticipant (packages/server/prisma/schema.prisma:1283-1303)
initiativeTieResolved Boolean @default(false) @map("initiative_tie_resolved")
```

Nothing on `Encounter`. No new table. No new enum. No new `EncounterState`.

The invariant is one sentence, and it has exactly one enforcement point in each
direction:

> `initiativeTieResolved` means **"the DM has blessed this participant's current
> `initiative` value as ordered"**. Any write to a participant's `initiative`
> sets it `false` (one funnel: `buildBlindData`, plus roll-all's own write). The
> resolve mutation sets it `true` for a group's members. Nothing else touches it.

A tie group is derived, never stored: participants sharing the same non-null
`initiative`, group size ≥ 2. The group is **pending** iff any member has
`initiativeTieResolved = false`. A `null` initiative never ties — unrolled
participants are already gated by `allInitiativeRolled`
(`packages/shared/src/rules/initiative.ts:66-70`).

**Migration backfill:** default `false`, then one statement setting
`initiative_tie_resolved = true` for participants of encounters whose
`state <> 'setup'`. Grandfathering non-setup encounters is deliberate — running
and finished fights were already played under their order and must not sprout a
retroactive pending badge. Setup encounters with tied rolls correctly become
pending and meet the new activation gate on their next start attempt. Follow
`docs/guides/add-prisma-migration.md`.

### Transaction and CAS strategy — no new CAS

**No `Encounter.version` column** (unanimous across all four consults). Adding
one would force a bump through `setEncounterState` (`:82-104`),
`advanceTurnCompound` (`:123`), `setCurrentTurnIndex` (`:149`),
`assertTurnLock` (`:216`) and `updateEncounterMeta` (`:277`) in
`packages/server/src/utils/encounter-state-mutations.ts` — the whole
state-machine surface and its single sanctioned raw-write escape — for a fact
nothing else needs. Pattern C's existing compound-WHERE is sufficient
(`docs/CONCURRENCY.md` §Pattern C).

**No new CAS at all**, in fact — and that is the payoff of putting the flag on
the participant rather than on the encounter. Every write composes from existing
primitives:

- **Roll-all** (`combat-actions/initiative.ts:48-55`): inside the existing
  `$transaction`, each `blindUpdateParticipant` call additionally writes
  `initiativeTieResolved: false`. One extra column in a write that already
  happens. No second row, no second table, no lock-order question.
- **`updateParticipant`** (`participant-action.ts:150-158`): `buildBlindData`
  writes `initiativeTieResolved: false` whenever `input.initiative !== undefined`.
  One conditional in the one funnel.
- **`addParticipant`**: relies on the column default. No code change.
- **Resolve** (new): `assertEncounterDm`, then one `$transaction` that re-reads
  participants with `orderBy: PARTICIPANT_ORDER`, validates set-equality against
  the freshly derived group, and `blindUpdateParticipant`s each member with
  `{ sortOrder, initiativeTieResolved: true }`. The permutation is *within the
  group's own existing `sortOrder` slots*, so contiguity is preserved trivially
  and no other participant is touched.
- **Activation** (`activate-encounter.ts`): a pending-group check raising
  `BAD_REQUEST`, placed beside the existing `allInitiativeRolled` guard
  (`:44-49`) **and repeated inside the transaction**. The `setEncounterState`
  setup→active CAS (`:55-60`) is unchanged.

Concurrent writers this defends against:

- *Two DM tabs resolving the same group.* Both validate against a fresh in-tx
  read; Postgres row locks serialize them and the last commit wins a *complete,
  valid* order. This is the same last-writer-wins class as today's manual
  `sortOrder` edit and introduces no new anomaly.
- *A DM hand-edits `initiative` mid-resolution.* The edit clears the flag; the
  resolve mutation's set-equality check against the fresh derived group then
  fails with `BAD_REQUEST` and the tab refetches. **This is the load-bearing
  reason tie membership is derived and not persisted**: a stored group snapshot
  would silently disagree with the rows after any blind edit, and every blind
  edit path would need snapshot-rewrite logic.
- *Activation racing a resolution.* Activation's in-transaction re-check either
  sees the committed resolution and proceeds, or sees a pending group and raises
  `BAD_REQUEST`. Neither interleaving finalizes an unblessed order.
- *A player acting during resolution.* Not reachable: resolution is `setup`-only
  and player combat locks require `state = "active"`
  (`encounter-state-mutations.ts:216-243`).

### The two ordered reads

Both production `findMany` calls take `orderBy: PARTICIPANT_ORDER`
(`encounter-query.ts:125`):

- `combat-actions/initiative.ts:32-34` — makes roll-all's *suggestion*
  reproducible for a full tie instead of Postgres-order-dependent.
- `activate-encounter.ts:35-37` — makes activation preserve the persisted order
  within an equal-initiative band.

and `activateEncounter`'s sort becomes **initiative-descending only**, so it can
never re-apply the modifier rule over a band the DM has ordered. Activation
still reindexes to contiguous `sortOrder`; it does not assume contiguity.

This is **not** the hidden deterministic secondary key the leaf bans. The key
being read is `sortOrder` — the DM's own persisted decision, or roll-all's
declared suggestion. The `id` component only disambiguates *duplicate*
`sortOrder`, a corner `encounter-query.ts:115-124` already documents and already
relies on.

### The shared rules contract

`packages/shared/src/rules/initiative.ts` gains two named helpers and loses one
name:

- `suggestInitiativeOrder(participants)` — today's comparator exactly
  (initiative desc, then modifier desc, stable). Named as a **Musi display
  suggestion**. It is what roll-all persists as the provisional order and what
  the resolver panel prefills.
- `findInitiativeTieGroups(participants)` — groups of ≥2 sharing non-null
  `initiative`, each carrying `pending`.
- `sortByInitiative` is **renamed away**, not kept as a wrapper. Leaving the old
  name alive is what lets a future caller re-acquire the "modifier finalizes the
  order" behaviour by accident, and the package is private with every consumer
  in-tree (the same reasoning that deleted leaf 21's K3 shim,
  `aa554a4b`).

Per `docs/guides/change-rules-logic.md:7-10` and `:42-45`, every landed name and
test must state the provenance explicitly: initiative-descending is SRD;
**DM resolution of ties is Musi policy**; the modifier rule survives **only as a
suggestion** and is neither SRD nor the final answer; and the SRD 5.2.1 p.13
GM/player split is named as the thing Musi deliberately does not implement.
The three E2 policy tests at
`packages/shared/src/rules/initiative.test.ts:42-80` are rewritten, not deleted
— the "different caller order gives a different result" corollary becomes the
gate on `suggestInitiativeOrder`'s suggestion semantics.

### The read contract

`encounterDetailSchema` (`packages/shared/src/schemas/encounter.ts:179-185`)
gains one nullable derived field, computed in `mapEncounterDetail` beside
`activeTurnOrigin` (`encounter-query.ts:285`) from the **unfiltered** rows and
the caller's `isDm`:

```ts
initiativeTies: z.array(initiativeTieGroupSchema).nullable()
```

`null` when there are none. The projection follows the existing
visibility policy at `encounter-query.ts:267-271` rather than inventing a new
one — do not surface a hidden participant's membership to a non-DM viewer, and
do not compute the groups on the client.

`encounterParticipantSchema` also carries `initiativeTieResolved` so a row can
render its own badge.

### The DM affordance

A new `initiative-tie-panel.tsx` under
`packages/client/src/components/campaign/combat/initiative-tracker/`, mounted as
a **sibling of** `InitiativeTracker` from the encounter detail surface — not
inside it, because the tracker does not render during `setup`
(`encounter-detail-view.tsx:204`).

One card per pending group, rows prefilled from the persisted `sortOrder`, with
**up/down arrow buttons** and one "Confirm order" button per group. Arrows, not
drag-and-drop: unanimous across all four consults — there is no drag-reorder
dependency in this surface, arrows are keyboard-accessible by default, and they
test with the existing testing-library patterns. Confirming without moving
anything is the explicit acceptance the ruling requires; a displayed default
never self-finalizes.

Start Combat is disabled with a "resolve initiative ties first" tooltip while
any group is pending — a client mirror of the server guard, never a substitute
for it. Non-DM viewers see a "Tied · 14" badge and an "awaiting DM" marker, and
no controls. Unsubmitted arrow arrangement is plain component state and is
correctly lost on reload; the *pending fact* is server truth and survives
reload, reconnect and a second tab.

## Slices

Six slices. Each is one agent session, several well under one.

| # | Slice | Done when | Verify |
|---|---|---|---|
| **T1** | **Shared rules contract (S).** Add `findInitiativeTieGroups` and `suggestInitiativeOrder`; rename `sortByInitiative` away and repoint both callers mechanically (no behaviour change yet). Rewrite the doc comment at `packages/shared/src/rules/initiative.ts:13-44` and the three policy tests at `initiative.test.ts:42-80` per `docs/guides/change-rules-logic.md`: SRD = initiative descending; **Musi policy = the DM resolves ties**; modifier = suggestion only; SRD's GM/player split named as deliberately not implemented. **Do not** delete the caller-order corollary test — re-aim it at the suggestion. | `grep -rn "sortByInitiative" packages/` returns 0; every new test name states which of the three provenance answers it pins | `bun run test -- packages/shared/src/rules/initiative.test.ts` then `bun run typecheck` |
| **T2** | **Migration and flag lifecycle (S).** Add `initiativeTieResolved` per `docs/guides/add-prisma-migration.md`, with the `state <> 'setup'` backfill. Roll-all writes `false` for every participant inside its existing transaction; `buildBlindData` (`participant-action.ts:150-158`) writes `false` when `input.initiative !== undefined`. Expose the column on `encounterParticipantSchema` and in `mapParticipant` (`encounter-query.ts:205`). Red-first, with the **injected deterministic `rng`** the leaf's caveat requires and unequal modifiers at equal initiative. Nothing gates on the flag yet. | Migration applies and reverts cleanly; a forced full tie leaves every member `false`; a hand-edit of `initiative` clears a previously-`true` flag | `bun run --filter @musi/server db:migrate`; `bun run test -- packages/server/src/routers/encounter-combat-initiative.test.ts packages/server/src/services/combat-actions/combat-actions-roll-initiative.test.ts` |
| **T3** | **The two ordered reads and the activation sort (S).** Give both `findMany` calls `orderBy: PARTICIPANT_ORDER` (`combat-actions/initiative.ts:32-34`, `activate-encounter.ts:35-37`) and make activation's sort initiative-descending only. Rewrite both callers' "deliberately unordered" doc comments (`combat-actions/initiative.ts:17-22`, `activate-encounter.ts:21-25`) — they currently document the opposite contract. **Do not** make activation assert contiguous `sortOrder`; blind `sortOrder` edits and `addParticipant` can both produce non-contiguous values, and asserting would newly reject encounters that work today. | A test proves a DM `sortOrder` order within an equal-initiative band survives activation unchanged; roll-all's full-tie result is stable across repeated runs | `bun run test -- packages/server/src/services/encounter-combat/activate-encounter.test.ts packages/server/src/services/combat-actions/combat-actions-roll-initiative.test.ts` |
| **T4** | **Read contract and activation gate (M).** Derive `initiativeTies` in `mapEncounterDetail` from unfiltered rows with the `isDm` projection, beside `activeTurnOrigin` (`encounter-query.ts:254-285`); add it to `encounterDetailSchema`. Add the pending-group `BAD_REQUEST` to `activateEncounter`, **both** before the transaction (for the message) and inside it (for the race). **Do not** compute groups on the client — see correction 6. | A non-DM detail read never names a hidden participant in a group; `setup → active` with a pending group fails with a resolve-first message; the in-tx re-check has its own test | `bun run test -- packages/server/src/utils/encounter-query.test.ts packages/server/src/services/encounter-combat/activate-encounter.test.ts packages/server/src/routers/encounter.test.ts` |
| **T5** | **`resolveInitiativeTie` mutation (M).** Shared input schema, router entry, and a request-facing service (shape 1) under `services/encounter-combat/`. `assertEncounterDm`; `state === "setup"` only; in-tx re-read with `PARTICIPANT_ORDER`; **set-equality** validation of the submitted ids against the freshly derived group; within-group permutation of the group's own `sortOrder` slots plus `initiativeTieResolved: true`; `logMutation` and the existing `broadcastEncounterUpdate`. Update `services/encounter-combat/MODULE.md`. Concurrency tests: two-tab resolve, and resolve-after-a-membership-change. | Submitting a subset, a superset, a duplicate id, or a stale membership all give `BAD_REQUEST`; a non-DM gets the module's standard denial; no participant outside the group changes `sortOrder` | `bun run test -- packages/server/src/routers/encounter-combat-initiative.test.ts packages/server/src/routers/encounter-combat-concurrency.test.ts` |
| **T6** | **Client (M).** `initiative-tie-panel.tsx` as a sibling of `InitiativeTracker`, mounted from the encounter detail surface (**not** inside the tracker — `encounter-detail-view.tsx:204`). Arrow reorder, per-group Confirm, Start Combat disabled with a tooltip while pending, tied badge in `initiative-row-info.tsx`, non-DM read-only marker. Refresh `components/campaign/combat/MODULE.md`. Reload/second-tab behaviour has a test. **Do not** add a drag-and-drop dependency; **do not** persist unsubmitted arrangement. | Panel renders in `setup` for a DM with a pending group and never for a non-DM; Start Combat is disabled; a refetch that clears the pending group unmounts the panel | `bun run test -- packages/client/src/components/campaign/combat/initiative-tracker.test.tsx packages/client/src/components/campaign/encounters/encounter-detail-view.test.tsx` plus the new panel test |

Out of scope for this leaf: any socket event, any `Encounter` column, any
mid-combat resolution path, any player-facing affordance, and any change to
`updateParticipant`'s input contract.

## Dependency edges

- **`T1 → T2`** (hard). T2's roll-all write needs the tie-group helper to decide
  nothing — but its tests are written against the new names, and landing the
  rename separately keeps the behaviour-free commit reviewable on its own.
- **`T2 → T3`** (soft). T3 is independently valuable and independently
  landable; sequencing it after T2 only avoids two migrations of the same test
  files.
- **`T2 → T4`** (hard). The derived read field needs the column.
- **`T3 → T4`** (hard). The activation gate and the activation sort change touch
  the same function; landing them apart means two rounds on
  `activate-encounter.test.ts`.
- **`T4 → T5`** (hard). The mutation's validation and the read's derivation must
  use one helper and one definition of "the group".
- **`T4, T5 → T6`** (hard). The client needs both the read field and the
  mutation.
- **No edge to any other leaf.** The leaf's own statement holds: this is
  follow-on product work from E2's review, not unfinished shared-cluster work.
  It is not part of `SHARED-CLUSTER-PLAN.md` and does not join a cluster.

## The leaf's four open design questions — answered

**a. What state is the encounter in while a tie is unresolved, and what stays
available?** It stays in **`setup`**. There is no new `EncounterState` — all
four consults refused one independently, and the reason is that a fifth state
ripples through `VALID_TRANSITIONS`
(`packages/shared/src/rules/combat.ts:8-16`), every compound-WHERE in
`encounter-state-mutations.ts`, `assertTurnLock`'s state pins, and every client
branch that switches on `setup|active|paused|resolved`, for a condition that is
orthogonal to the machine. While a group is pending: roll and re-roll, add and
remove participants, hand-edit initiative, edit encounter metadata, delete the
encounter, and resolve all remain available. **Exactly one door is gated:
`setup → active`.** Turn advance is not gated because it is not reachable — the
encounter is not `active`.

**b. Required, or may the DM skip it?** **Required to activate, and it costs one
click.** Confirming the prefilled suggested order without moving a row is a
valid resolution: it writes `initiativeTieResolved = true` and persists the
order that was already on screen. That is exactly the distinction the leaf's own
caveat draws — "a deterministic display default is not a persisted resolution
unless the DM explicitly accepts it". There is no separate skip action, no
timeout, no auto-accept and no background job, because each of those is the
silent finalize the ruling refuses. There is also no reason to add a distinct
"accept suggestion" button beside "Confirm order"; they would be the same
mutation with the same payload.

**c. Retroactive reorder within the current round, or only from a later
boundary?** **Neither — resolution is a `setup`-time workflow and does not run
during combat at all.** A tie that arises after combat has begun (a DM
initiative edit, or an `addParticipant` at an equal value) is *surfaced* as a
badge and is not resolvable through this feature. Two arguments decide this
together. First, it is not needed: `initiative` does not drive active turns —
`sortOrder` does — so a mid-combat tie changes nothing observable, and the DM
retains the existing blind `sortOrder` edit if they want to move someone.
Second, both alternatives are expensive in the repo's most dangerous places. A
deferred "apply at the next round boundary" needs a second persisted order plus
a copy-and-clear loop *inside* `advanceTurnCompound`'s compound CAS
(`encounter-state-mutations.ts:123-135`). An immediate mid-round reorder needs
`assertTurnLock` plus a `setCurrentTurnIndex` pointer remap and has to reason
about captured turn origins. Both buy a validated path to an anomaly the
existing unvalidated escape hatch already exhibits.

**d. Do players ever order their own tied characters?** **No — resolution is
exclusively DM-facing, as declared Musi policy.** The owner ruling grants the DM
authority including where SRD 5.2.1 p.13 assigns tied-character choice to
players, and leaves the player question unsettled rather than scheduled. This
plan keeps it visible rather than buried: T1's doc comment and test names must
state that Musi's policy is DM-resolves-all, that the SRD splits GM (monsters) /
players (characters), and that a player affordance is deliberately not
implemented. Nothing in the schema forecloses it — a player-scoped variant of
the same mutation with a character-ownership assertion would slot in beside
`resolveInitiativeTie` — but it is not scheduled here, and shipping a
DM-resolves-all workflow is not a claim to have implemented the SRD.

## Operational risks

1. **T2's migration is the only irreversible slice.** The `state <> 'setup'`
   backfill is a judgement, not a mechanical default: get it wrong in the
   permissive direction and every historical encounter sprouts a pending badge.
   Write the backfill assertion as a test over seeded rows in all four states
   before writing the migration.
2. **T3 changes `activateEncounter`'s output for encounters with unequal
   modifiers at equal initiative.** That is the point of the slice, but it means
   any existing test that asserts an activation order was asserting the modifier
   rule as final. Re-read each such assertion and decide whether it is pinning
   SRD, the suggestion, or nothing — do not mechanically update it green.
3. **Do not let T4's derived field and T5's validation drift apart.** They must
   call the same `findInitiativeTieGroups`. Two definitions of "the group" is
   how the set-equality check starts rejecting valid submissions.
4. **`sortOrder` contiguity is not an invariant and must not be asserted.**
   `participant-action.ts:64-66` blind-writes it and `encounter-query.ts:115-124`
   exists precisely because duplicates are reachable. Any slice tempted to add
   `assert(contiguous)` is about to reject live data.
5. **This is a rules-facing pack item under a standing constraint.**
   `00-index.md`'s [Constraints](./00-index.md#constraints-on-future-proposals)
   row — "call a rules-facing slice complete without classifying its provenance
   and naming any non-SRD policy in the tests" — was written *because E2 missed
   exactly this obligation on exactly this file*. T1 is the slice it applies to;
   do not sign it off without asking the three-way SRD / named-source / Musi
   policy question out loud for each landed name.
6. **Do not reach for `fast-commit` to escape the gates on T2.** A Prisma schema
   change plus generated-client regeneration is exactly the shape that the
   `Landed` section's process note says `verify:changed` can under-select. Run
   the full `bun run verify` on the migration slice.

## Index reconciliation

To apply when T1 lands, in one commit, as the sibling plans do:

1. `00-index.md`, header: the leaf count line already says leaves 53 and 54 have
   owner decisions; add that 53 now has a scheduling plan, and add `53-PLAN.md`
   to the plan inventory in
   [Read this first](./00-index.md#read-this-first) — which currently names six
   XL plans and four cluster plans and would otherwise not mention this one.
2. `00-index.md`, [Leaves](./00-index.md#leaves): point row 53 at this plan and
   **re-size it L → M**, and correct its Area from
   `shared + server + client + socket` to `shared + server + client` — there is
   no socket work (see [Verdict](#verdict)).
3. `00-index.md`, [Read this first](./00-index.md#read-this-first): the sentence
   "**Leaves 53 and 54 are the exception:** their owner rulings are recorded
   under `## Decided direction`" now needs the standing "read the plan, not the
   leaf" rule applied to 53 as well — 54 remains plan-free.
4. `00-index.md`, [How to use this pack](./00-index.md#how-to-use-this-pack):
   add no dependency edge. This plan confirms the leaf's "no sequencing
   dependency on another leaf"; record that it was checked, so it is not
   re-derived later.
5. `00-index.md`,
   [Constraints on future proposals](./00-index.md#constraints-on-future-proposals):
   add one row — **"Add a deterministic secondary sort key to `sortByInitiative`
   or an `orderBy` to either initiative caller *as the resolution*"** — because
   the ordered reads this plan does land (T3) will make that look like the
   remaining half of an obvious fix. It is not: the ordered read makes the
   *suggestion* reproducible; the DM's confirmation is what makes an order
   final. Cite `53-PLAN.md` for the distinction.
6. `53-initiative-tie-resolution-policy.md`: add a Status pointer to this plan
   above `## Decided direction`, and record that the leaf's step 5 (broadcast) is
   satisfied by the existing `encounter:updated` invalidation rather than by new
   socket work, so it is not re-scheduled as an unbuilt step.

## Rejected alternatives — why

| Rejected | Why |
|---|---|
| A new socket event (`encounter:tiePending` or similar) | Musi combat sockets are invalidation-only. `encounter:updated` already converges every viewer after every one of these mutations, and the pending fact rides in the `EncounterDetail` refetch that reload and reconnect need anyway. Five new surfaces for zero information. Unanimous across four consults. |
| An `Encounter.version` column | Would force a bump through all five helpers in `encounter-state-mutations.ts` and its single sanctioned raw-write escape. Pattern C's compound-WHERE already covers everything here. Unanimous across four consults. |
| A new `EncounterState` (`awaiting_ties`) | Ripples through `VALID_TRANSITIONS` (`combat.ts:8-16`), every compound-WHERE, `assertTurnLock`'s state pins, and every client state switch — for a condition orthogonal to the state machine. Unanimous across four consults. |
| Persisting tie groups as a JSON snapshot or an id array on `Encounter` (Grok's `pendingInitiativeTies`) | Goes stale on every `addParticipant`, `removeParticipant` and blind `initiative` edit — all of which are non-racing writes that arrive from anywhere (`participant-action.ts:64-66`). Every one of those call sites would need snapshot-rewrite logic, and a disagreement between the snapshot and the rows is silent. Derived membership has no such failure mode. |
| A separate `EncounterInitiativeTie*` table | Buys audit history the `logMutation` stream already covers, at the cost of cascade rules, includes and mappers. Three of four consults rejected it independently. |
| The pending flag on `Encounter` rather than on the participant (Opus 4.8's `initiativeTiePending`) | Makes every writer of `initiative` — roll-all, `updateParticipant`, `addParticipant`, `removeParticipant` — recompute the *whole encounter's* tie state and write a second row in the same transaction, turning four lock-free non-racing paths into cross-table writers under `docs/CONCURRENCY.md` §Cross-table writers. Opus 4.8's own slice list schedules that hole separately and calls it "the riskiest interaction"; the participant-scoped flag does not have it. |
| Codex's `initiativeOrderStatus` enum + `initiativeOrderRevision` + `pendingSortOrder` (3 columns, 1 enum) | The most machinery for the most speculative capability. Its `scheduled` state exists only to serve mid-combat resolution at a round boundary, which this plan declines (question **c**), and its apply step writes inside `advanceTurnCompound`'s compound CAS — the single most concurrency-sensitive transaction in the repo. Its revision column is also a general `Encounter.version` under another name. |
| Immediate current-actor-preserving mid-combat resolution (Fable) | Technically sound — `assertTurnLock` plus a `setCurrentTurnIndex` remap does work, and turn origins are safe because they are keyed on `turnStartRound === round`. Declined on cost/benefit: it is the highest-risk surface in the design, and its own justification ("the DM can already do this unvalidated") is the argument that the marginal value is low. |
| Deleting the sort from `activateEncounter` and asserting contiguous `sortOrder` (Codex, Grok) | Right that activation must stop *re-sorting*, wrong that contiguity can be asserted. Blind `sortOrder` edits (`participant-action.ts:66, :158`) and `addParticipant`'s own sort-order computation both reach non-contiguous states, so the assertion would newly reject encounters that work today. The ordered read plus an initiative-only reindex gets the same guarantee without the new rejection. |
| Removing `initiative`/`sortOrder` from `updateParticipantInputSchema` (Codex) | An API break to a live client path (`onSetInitiative`, `initiative-tracker.tsx:24`) and to the DM override surface, which converts an M-sized feature into a contract migration. The flag-clearing rule in `buildBlindData` is sufficient to keep the two channels coherent. |
| Blocking `sortOrder` writes only while a tie is pending (Grok) | Adds a state-dependent input contract to a schema whose entire design is a static fail-closed whitelist (`PARTICIPANT_FIELD_KIND` `satisfies Record<keyof UpdateParticipantInput, ...>`, `participant-action.ts:64-66`). A field that is sometimes accepted and sometimes rejected is exactly what that shape exists to prevent. |
| Drag-and-drop reordering | No drag dependency exists in this surface, it costs a11y and touch surface, and arrows test cleanly with the existing patterns. Unanimous across four consults. |
| A combat-log entry per resolution | The combat log is player-visible fiction, not an admin audit trail (`services/encounter-combat/MODULE.md` — "do not collapse chat broadcasts and structured combat logs into one output"). `logMutation` is the right stream. |
| Keeping `sortByInitiative` as a wrapper over `suggestInitiativeOrder` | Leaves the name that means "the modifier finalizes the order" alive for a future caller to re-acquire by accident. The package is private with every consumer in-tree; leaf 21's K3 deleted a shim on the same reasoning (`aa554a4b`). |
| Restoring `originalIndex`, its cast or its Stryker suppressions | The leaf bars re-opening E2, and it only re-implements stable sort. |

## Consult disagreements and how they were called

Four models, one brief, four different schema shapes. They were unanimous on
**no new socket event, no `Encounter.version`, no new `EncounterState`, arrows
over drag, tie membership derived rather than stored (3 of 4), resolution
required but one-click, and no player affordance** — that convergence is why
those calls are stated flatly above rather than argued.

- **Where the pending fact lives — a genuine four-way split.** Codex: an enum
  plus two ints plus a participant column. Opus 4.8: one boolean on `Encounter`.
  Grok: a boolean plus a JSON group snapshot on `Encounter`. Fable: one boolean
  on `EncounterParticipant`. **Called for Fable**, on a code fact rather than
  taste: `updateParticipant` writes `initiative` blind, one participant at a
  time, through a single funnel (`participant-action.ts:142, :150-158`). A
  participant-scoped flag makes the invalidation rule local — the same write
  that changes `initiative` clears the flag, no extra row and no lock order. An
  encounter-scoped flag makes four non-racing participant paths into cross-table
  writers. Opus 4.8 saw the hole and scheduled it as a separate slice; that is
  the tell that the shape is wrong, not that the slice is missing. Grok's
  snapshot is refuted on the leaf's own ground (staleness under blind edits) and
  Codex's is refuted with the mid-combat capability it exists to serve.
- **Mid-combat resolution — a three-way split.** Codex staged it to the next
  round boundary; Fable applied it immediately with a pointer remap; Opus 4.8
  and Grok confined the workflow to `setup`. **Called for Opus 4.8 and Grok on
  scope, using Fable's reasoning for why it is safe.** Fable's argument that the
  DM's existing unvalidated `sortOrder` edit already exhibits the anomaly is the
  decisive one — but it cuts against building the validated path, not for it.
  Codex additionally required the DM to *pause combat* to fix a tie, which is a
  worse product outcome than a badge.
- **What activation does with `sortOrder` — three positions.** Opus 4.8 left the
  re-sort in place; Codex and Grok deleted it and asserted contiguity; Fable
  kept a sort but made the read ordered and the reindex initiative-only.
  **Called for Fable.** Opus 4.8's position ships the defect through the fix
  (correction 4); Codex's and Grok's assertion would reject live data
  (correction 4's companion — blind `sortOrder` edits are unconstrained).
- **`updateParticipant`'s contract — three positions.** Codex removed the
  fields, Grok blocked them conditionally, Opus 4.8 and Fable kept them and
  cleared the flag. **Called for Opus 4.8 and Fable**, on API-break cost and on
  the whitelist's static-by-design shape.

**What all four missed, and I found in the code.** Three things, and they are
the reason this plan is not the union of the four proposals.

1. **`PARTICIPANT_ORDER` already is the answer to `sortByInitiative`'s own
   complaint.** The helper's comment asks callers to order their own input
   (`initiative.ts:35-41`); `encounter-query.ts:125` is the repo's canonical
   ordering for exactly that question, already load-bearing for the
   `captureTurnOrigin` / `resolveActiveTurnOrigin` agreement. Codex and Grok
   proposed deleting the sort instead; Fable used the ordering but only at
   activation.
2. **Roll-all's `findMany` is unordered too**
   (`combat-actions/initiative.ts:32-34`) — it is half the leaf's own evidence
   (`53-...md:41-42`), and three of four consults fixed only activation. Without
   it, roll-all's *suggestion* for a full tie is still Postgres row order, so
   the leaf's headline symptom survives its own fix in the one place a DM
   actually looks first.
3. **Tie groups cannot be derived on the client.** `mapEncounterDetail` filters
   hidden participants for non-DM viewers
   (`encounter-query.ts:267-271`), so a shared helper run over
   `encounter.participants` computes over a different set per role. Fable
   explicitly proposed "one shared helper, both roles"; Opus 4.8 and Grok
   implied it. Only Codex raised DM-gating at all, and for a different reason
   (leaking ids) than the one that actually bites. The derivation belongs in
   `mapEncounterDetail` beside `activeTurnOrigin` (`:254-262`, `:285`), which is
   also the repo's existing precedent for a nullable, `isDm`-aware,
   computed-at-projection-time detail field — a shape none of the four cited.
