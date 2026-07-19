# 06 — Turn Movement: Server-Authoritative Turn Origin

Status: Done — landed 2026-07-19 (`fb1bf8b5`). Design settled 2026-07-18
(architecture-review candidate grilled to rulings with the owner).
Cross-reviewed 2026-07-19 (both reviewers adopt-with-changes): no
owner ruling needs reversal, but four implementation gates were
missing and several facts were stale — corrections are inline below,
marked ▸.
Date: 2026-07-18 (rulings) / 2026-07-19 (corrections)
Source: 2026-07-18 architecture review, candidate 1, rated Strong;
all eight design questions grilled to rulings in-session.

## Problem

The client movement badge ("Moved: N ft") infers its own turn origin
from a server snapshot that mutates underneath it. `useMovementTracking`
(`packages/client/src/components/campaign/combat/combat-map-bridges.ts`)
captures `turnStartPos` client-side and must then guess whether each
refreshed map object is a real turn boundary or the invalidation echo
of its own `mapToken.move` mutation. Five related commits landed
2026-07-15 (`063463bc`, `3da15069`, `e1acb03e`, `55daca7d`,
`16fec5a1`) — ▸ four fixes plus one cleanup — progressively
stabilizing heuristics (`boundaryKey`, `hasMoved`,
`shouldRefreshOrigin`) because the interface cannot hide information
the client does not have. The code comment at
`combat-map-bridges.ts:52-53` names the fix: only a
server-authoritative origin can answer the boundary-or-echo question.
(▸ The lint-adoption leaf once cited alongside it was retired at the
2026-07-19 docs triage, `2f4c7e6d`; the code comment is the surviving
in-tree source.)

Secondary frictions the same change dissolves: the show-the-badge
invariant is enforced in two places (hook return and header
conditional), the call site must manually pair `tokens.move.mutate`
with `updateMovement` with nothing enforcing the pairing, and movement
lives in the combat/map glue grab-bag with no module of its own.

## Rulings

Each ruling below was put as a question and answered by the owner.
▸ corrections annotate implementation constraints found at
cross-review; none reverses an owner decision.

1. **Scope: origin only (display unchanged).** No speed budget, no
   legal-square validation — governance has no product signal yet and
   would extend a race-sensitive mutation surface that
   `docs/CONCURRENCY.md` §Scope says only grows on reported bugs. The
   seam is placed so governance can land behind it later.
   ▸ "Display unchanged" is semantic, not temporal: today the badge
   updates synchronously via `updateMovement`; after the deletion it
   updates when the move mutation's success invalidation refetches
   (`map-token-mutations.ts:37`). Accepted latency — record it in the
   implementing commit; if it bothers players, centralize an
   optimistic map-cache update in the mutation hook, never re-add
   content-side pairing.
2. **Schema home: nullable columns on `EncounterParticipant`** —
   `turnStartX`, `turnStartY`, `turnStartMapId`, `turnStartRound`.
   Written only inside the already-CAS'd turn transactions, so no
   participant `version` bump — consistent with the documented
   non-racing-fields ruling (`encounter-combat/MODULE.md`). Stale
   values linger on non-active participants between turns; harmless by
   design and worth a schema comment. Prisma migration per
   `docs/guides/add-prisma-migration.md`.
   ▸ Write-path gate: direct `encounterParticipant` updates are
   type-banned (`packages/server/src/utils/prisma-types.ts:103-106`).
   Either extend `blindUpdateParticipant`'s field whitelist
   (`participant-stats-mutations.ts:160` — its header marks additions
   as a reviewable decision) with the four columns, or add a narrow
   sanctioned `setParticipantTurnOrigin` mutation utility beside it.
   Update `docs/CONCURRENCY.md`'s exhaustive non-racing-fields list
   with the four columns in the same commit.
3. **Capture points and staleness: activation + turn advance,
   freshness by round stamp.** Captured in the `setup → active`
   activation CAS (round 1, turn index 0 —
   ▸ `encounter-combat/activate-encounter.ts`, after the reindex
   loop) and in `executeAdvanceTurnTx` for the participant whose turn
   starts. ▸ Corrected motivation, same ruling: `rollAllInitiative` is
   setup-only, so mid-combat rerolls are not the live path; the real
   ways the active participant changes *without* a turn advance are
   active-participant removal (which adjusts `currentTurnIndex` via
   `lockTurnIndexForRemoval`, `encounter-participant-helpers.ts:56`,
   including the wrap case) and unrestricted manual `sortOrder` edits
   (`participant-action.ts:136`). A stale origin must therefore be
   inert rather than cleaned up: validity is
   `turnStartRound === encounter.round`, checked in exactly one place
   (ruling 5). Accepted edge: a same-round swap back to a participant
   who already acted passes the round check; stamping the turn index
   too would close it but would hide the badge across benign index
   shifts. Round stamp only.
4. **Capture ownership: one in-tx helper** —
   `captureTurnOrigin(tx, encounterId, turnIndex, round)`, called by
   both transactions. Hides token resolution via the
   `MapToken.encounterParticipantId` `@unique` FK and the
   unlinked-participant → nulls case. Not a new service directory;
   promotion can follow the deferred-promotion convention
   `rest-MODULE.md` uses if governance lands.
   ▸ Placement: a separate internal `combat-actions/turn-origin.ts`,
   imported directly by `turn-transaction.ts` and re-exported through
   the facade for activation — `combat-actions.ts` already imports
   `turn-transaction.ts`, so putting the helper in the facade creates
   a gated runtime cycle. The encounter-combat → combat-actions import
   direction already exists (`initiative-action.ts:7` et al.).
5. **Exposure: a single projected
   `activeTurnOrigin: { x, y, mapId } | null` on
   `encounterDetailSchema`** — not per-participant fields. The server
   detail mapping resolves the active participant and applies the
   round freshness check at projection time, where round and origin
   are read in the same snapshot. Contract: if present, it is valid.
   `turnStartRound` never leaves the server.
   ▸ Visibility gate, required: `mapEncounterDetail` filters hidden
   participants for non-DM viewers (`encounter-query.ts:217-219`) and
   map mapping independently filters hidden tokens
   (`map-helpers.ts:116`); a round-only projection would hand every
   player a hidden combatant's exact coordinates. Project `null` for
   non-DM viewers unless both the active participant and its linked
   token are visible; test hidden-participant and hidden-token
   separately.
6. **Client shape: one pure selector** in a new `turn-movement.ts`
   beside the combat components (not `shared/` — one consumer means
   the shared seam is hypothetical; promote when governance lands).
   ▸ Signature: `activeTurnMovementFt(encounter, map): number | null` —
   it must take the `MapDetail`, not just tokens: distance requires
   `map.gridSize` (`gridDistanceFt`, `shared/src/map/grid-utils.ts:138`;
   grid sizes range 1–30 ft), which the current hook already supplies.
   `null` is the single "nothing to show" value: inactive combat, no
   origin, unlinked token, cross-map token, and zero distance. Header
   renders iff non-null. `useMovementTracking`, its state, its
   heuristics, and the manual `updateMovement` pairing are deleted; a
   token move is just a mutation and recomputation falls out of query
   refresh.
7. **Tests: TDD; the hook's `renderHook` tests die with the hook.**
   ▸ There are six (`combat-map-bridges.test.ts:11,50,90,132,176,205`),
   not seven: four ordinary scenarios (reindex, pause/resume, resolve,
   unlinked participant) recur as pure selector data cases; the two
   refresh-order race tests (same-turn echo, late refetch) have no
   observable behavior left to assert — there is no state, so
   identical inputs cannot yield different answers — and porting them
   would assert a tautology while looking like a race guard. The
   implementing commit body must record this so nobody re-adds them.
   New coverage: capture cases in
   `combat-actions-advance-turn.test.ts` and
   `activate-encounter.test.ts` (linked → coords/map/round, unlinked →
   nulls, no `version` bump); projection freshness and visibility at
   the detail mapping (stale round → null, hidden participant → null,
   hidden token → null — seam precedent at
   `encounter-query.test.ts:218`); selector cases for variable grid
   size and positive/zero/null outputs.
8. **Vocabulary: MODULE.md only, no new CONTEXT.md** (owner reversed
   the initial recommendation). Combat-actions `MODULE.md` gains
   `captureTurnOrigin` in its contract with the Turn Origin definition
   and carries the governance-deferred decision in its gotchas; the
   client combat `MODULE.md` replaces the movement-tracking line in
   the bridges entry with the Turn Movement selector description.
   ▸ Also update `encounter-combat/MODULE.md`, whose activation
   section currently states activation composes only
   `blindUpdateParticipant` + `setEncounterState` — false once the
   capture call is added. Root `CONTEXT.md` and `MODULE-INDEX.md`
   unchanged (the previously named `CONTEXT-MAP.md` does not exist).

## Implementation order

Package flow `shared → server → client`, committed by logical unit —
▸ with the correction that the schema step cannot land alone: a
required `activeTurnOrigin` key makes `mapEncounterDetail` and every
client `EncounterDetail` fixture literal (~10 files) fail typecheck,
and lint/typecheck run on every commit even in fast-commit mode.

1. Server storage + shared contract + projection as **one
   compile-coherent commit**: Prisma migration for the four columns,
   `captureTurnOrigin` in `combat-actions/turn-origin.ts` + calls from
   activation and advance-turn transactions, the
   `blindUpdateParticipant`/mutation-utility whitelist change,
   `activeTurnOrigin` on `encounterDetailSchema`, the projection with
   round-freshness and visibility gates in the encounter detail
   mapping, and the shared/server/client fixture updates. Tests first
   (capture + projection).
2. Client: `turn-movement.ts` selector + header consumption; delete
   `useMovementTracking`, the content-side pairing, and the six hook
   tests. Selector tests first.
3. Docs: the three MODULE.md updates plus the `docs/CONCURRENCY.md`
   non-racing-list addition (ruling 2/8).
4. Housekeeping: mark
   `../lint-review-followups-2026-07/05-combat-map-bridges-fixture-builder.md`
   superseded — it schedules a fixture builder for the hook suite this
   change deletes.
