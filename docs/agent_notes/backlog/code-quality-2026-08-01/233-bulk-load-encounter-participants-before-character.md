# 233. Bulk-load encounter participants before character deletion reconciliation

Status: Not started
Theme: Character deletion serially reloads every active encounter's participant list · Area: server · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Character deletion first loads the character's participants in active
encounters, then serially reloads each encounter's complete participant order.
The resulting 1+N read pattern makes deletion latency grow with the number of
affected encounters.

Those reads also occur before the deletion transaction. Serial execution
therefore lengthens the interval between the reconciliation snapshot and the
transaction that applies the computed turn-index adjustments, without adding
any consistency guarantee.

## Evidence

- `packages/server/src/services/character-delete.ts:29-34` — deletion first
  loads every active encounter participant associated with the character, then
  passes the result into turn-index reconciliation.
- `packages/server/src/services/character-delete.ts:68-73` — reconciliation
  loops over those rows and awaits an ordered participant-list query for each
  encounter.
- `packages/server/src/services/character-delete.test.ts:66-94` — the focused
  harness models one character-scoped query followed by encounter-keyed ordered
  queries, matching the production 1+N shape.
- `packages/server/src/services/character-delete.test.ts:332-363` — the
  multi-encounter case already pins independent adjustment results and their
  placement in the deletion transaction.

## Proposed direction

Keep the initial active-participant query, but replace the per-encounter query
loop with one bulk read. Derive the distinct affected encounter IDs, return no
adjustments immediately when that set is empty, and otherwise query all their
participants with `encounterId: { in: encounterIds }`,
`orderBy: PARTICIPANT_ORDER`, and a selection containing `id`, `encounterId`,
and `sortOrder`.

Group the returned rows by encounter ID in memory, then iterate the original
active-participant list and run the existing deleted-index and adjusted-index
calculation against the corresponding group. Preserve the original iteration
order so adjustment ordering does not change.

Update `character-delete.test.ts` first so its harness accepts the bulk query.
Add a multi-encounter assertion that the participant delegate receives exactly
one initial character query and one ordered query containing both encounter
IDs, while retaining the existing exact turn-index writes, stale-row skip, and
empty-participant behavior.

## Scope / caveats

- Read `docs/CONCURRENCY.md` before changing this service. Keep the
  reconciliation reads outside the transaction and the CAS adjustments inside
  it; moving either boundary requires a separate explicit concurrency
  decision.
- Preserve `PARTICIPANT_ORDER`, every adjustment branch, the no-op adjustment
  guard, and the existing transaction ordering.
- Preserve the linked-token snapshot, character cascade, and tolerant
  turn-origin clear unchanged. Participant IDs whose rows are cascade-deleted
  must remain tolerated no-ops.
- Do not implement this concurrently with
  [007-cascade-deleters-duplicate-load-bearing-turn.md](./007-cascade-deleters-duplicate-load-bearing-turn.md).
  That proposal also edits `character-delete.ts`, but explicitly excludes the
  turn-index reconciliation loop owned here.
