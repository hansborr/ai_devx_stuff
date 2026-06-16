# Turn/Round Pointer Must Push Live To All Clients

Status: Done — turn/round pointer live-sync hardened and regression-locked.
The `encounter:updated` broadcast and `encounter.get` invalidation are the
single source for both the round display and the `sortOrder`-based "Current"
highlight, so peers and the mutating DM follow turn-advance within one
broadcast. Added a hook-level live-refetch regression test
(`packages/client/src/hooks/realtime-invalidation-turn-pointer.test.tsx`,
red/green-verified against dropping detail invalidation), a two-context e2e
assertion that the player highlight + round move without a reload
(`e2e/encounter-combat.spec.ts`), and made the combat-log current-participant
derivation use the shared `sortOrder`-based `getActiveParticipantId` helper
instead of an array-index lookup so every turn-pointer surface agrees.
Order: 02
Source: audit P0-2 (`docs/agent_notes/ux-audit-2026-06-06.md:62-80`).

## Context

When the DM advances the turn, player clients update the "Turn X of N"
counter live, but the "Current" combatant highlight does not move until a
hard refresh. In the audited session this compounded into full
divergence (DM on "Round 1, Strider current" vs server on "Round 2,
Mithrandir current") and a wrongly downed PC.

Verified surfaces (2026-06-12) — note the broadcast already exists, so
this is a client cache bug, not a missing emit:

- Server: `advanceTurn` mutation
  (`packages/server/src/routers/encounter-combat.ts`) ->
  `services/encounter-combat/turn-action.ts` -> `fanOutBroadcasts`
  (`services/encounter-combat/broadcast-helpers.ts:25-55`) ->
  `broadcastEncounterUpdate` emitting `encounter:updated`
  (`packages/server/src/socket/encounter-broadcast.ts:13-20`).
- Client: `packages/client/src/hooks/realtime-invalidation.ts` handles
  `encounter:updated`; the highlight derives from
  `encounter.currentTurnIndex` in
  `packages/client/src/components/campaign/combat/initiative-tracker/initiative-tracker.tsx:79-89`.
- The audit's key observation: sibling fields of the same payload update
  (turn counter) while `currentTurnIndex`-derived UI does not — audit
  which query the tracker actually renders from and which fields the
  invalidation refreshes.
- Read `docs/socket-architecture.md` and the combat + client-hook
  `MODULE.md`s first.

## Scope

- Reproduce with two clients (the dev-DB fixtures from leaf 04's context
  are the repro environment), then root-cause the stale path: wrong query
  key, partial cache write, stale closure over the encounter object, or
  an unsubscribed component instance.
- Fix so turn-advance and round-increment reach every joined client
  without refresh; follow the existing invalidation conventions rather
  than introducing a parallel update path.
- Add a regression test at the level where the bug lives (hook-level
  cache test, plus an e2e two-context assertion in
  `encounter-combat.spec.ts` if the harness supports a second context).
- The audit also reports the DM's own client going stale (round pointer
  stuck) — verify the fix covers the mutating client, not just peers.

## Definition Of Done

Advancing the turn moves the "Current" highlight and round display on the
DM client and all player clients within one broadcast, with no manual
refresh, demonstrated by a test that fails on the old behavior.

## Verification

- New regression test red-green against the fix.
- `bun run e2e -- e2e/encounter-combat.spec.ts`.
- Manual two-browser check against the seeded encounter.
- `bun run verify:changed`.
