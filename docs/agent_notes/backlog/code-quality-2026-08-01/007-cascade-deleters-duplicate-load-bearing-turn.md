# 7. Two cascade deleters hand-copy the load-bearing snapshot-then-cascade-then-clear turn-origin sweep, with comments as the only synchronization mechanism

Status: Not started
Theme: transaction protocol single-sourcing · Area: server · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Map deletion and character deletion each cascade-delete `MapToken` rows,
which severs token↔participant links without going through a link
mutation. Both must therefore run the same three-step, order-sensitive
sequence inside their transaction: read the linked participant ids
*before* the cascade removes the rows the read depends on, perform the
cascade delete, then batch-clear the surviving participants' captured
turn origins with the tolerant helper. Get the order wrong — hoist the
read out of the transaction, or clear before the cascade resolves — and
a participant can be left holding a fresh-round origin whose token is
gone, in exactly the concurrency-sensitive area where
`docs/CONCURRENCY.md` spends the most care.

Today that protocol exists twice, as two near-verbatim executable twins
in two distant files (`services/map-tokens/map-cascade.ts` and
`services/character-delete.ts`), and the only thing holding them
together is prose: each file carries its own comment restating the
ordering constraint, and the map-tokens `MODULE.md` openly admits that
"a change to the cascade protocol here almost certainly belongs there
too". Nothing structural makes a single-sided edit fail. A contributor
who finds one copy, changes it, and never learns the twin exists gets a
green build and a silent divergence in the invariant the comments were
guarding — the exact failure mode this codebase elsewhere prevents with
type-level bans and sanctioned helpers.

## Evidence

- `packages/server/src/services/map-tokens/map-cascade.ts:50-67` — the
  map-delete transaction: in-tx `mapToken.findMany` on
  `{ mapId, encounterParticipantId: { not: null } }` selecting
  `encounterParticipantId`, then `map.delete`, then
  `clearTurnOriginsForParticipants` over the ids.
- `packages/server/src/services/character-delete.ts:36-59` — the
  character-delete transaction: the same in-tx `findMany` on
  `{ characterId, encounterParticipantId: { not: null } }` with the same
  select, then `character.delete`, then the same batch clear.
- The trailing clear call — six lines including the
  `flatMap((t) => t.encounterParticipantId !== null ? [...] : [])`
  null-filter — is character-for-character identical between
  `map-cascade.ts:61-66` and `character-delete.ts:53-58`; the whole
  read/delete/clear block differs only in each file's `where` selector
  and delete statement.
- The ordering constraint is stated separately in each file's comments:
  `map-cascade.ts:17-24` (header: the linked-token read "must therefore
  also happen inside the transaction, before the cascade removes the
  rows it reads") plus the in-tx restatement at `:51-55`, and
  `character-delete.ts:40-47` (the read-in-tx-then-clear-survivors
  rationale). Neither references a shared enforcement point, because
  none exists.
- `packages/server/src/services/map-tokens/MODULE.md:14-23` — documents
  the duplication as a hazard: character delete "runs the same cascade
  protocol as `map-cascade.ts`", "the two are near-verbatim twins; a
  change to the cascade protocol here almost certainly belongs there
  too". Prose cross-reference is the declared sync mechanism.
- The two-caller protocol is additionally enumerated in three more doc
  surfaces that must stay in lockstep: `docs/CONCURRENCY.md:200-204`
  (writer class 3 names both deleters),
  `packages/server/src/utils/participant-stats-mutations.ts:43-55`
  (header shape-4 block, "the cascade sweeps (map delete, character
  delete)"), and the helper's own JSDoc at
  `participant-stats-mutations.ts:287-298` (names both callers and the
  read-in-tx-beforehand precondition).
- `packages/server/src/utils/participant-stats-mutations.ts:299-314` —
  `clearTurnOriginsForParticipants` is exported, so nothing prevents a
  future caller invoking it outside the snapshot→cascade→clear order;
  its only production importers today are the two deleters
  (`map-cascade.ts:6`, `character-delete.ts:3`).
- The repo already has the idiom the fix needs:
  `participant-stats-mutations.ts:6-13` structurally enforces its writer
  whitelist (type-level ban in `prisma-types.ts` plus sanctioned
  helpers), `updateParticipantStatsLocked` at `:80-99` is the
  mutator-callback precedent, and
  `packages/server/src/services/README.md:69-73` blesses a utility
  owning "one transaction-local check-and-write protocol".

## Proposed direction

Extract the protocol into one transaction-local coordinator so the
ordering is enforced by structure instead of by twin comments. Pure
protocol extraction — no behavior change, no new gating.

1. **Add a cascade-origin sweep coordinator in
   `packages/server/src/utils/participant-stats-mutations.ts`** (writer
   class 3's home), shaped like the file's existing mutator-callback
   helpers (`updateParticipantStatsLocked` is the precedent): it takes
   the `TxClient`, a `MapToken` where-selector, and a cascade-delete
   callback, and internally enforces the order — in-tx linked-token read
   (`encounterParticipantId: { not: null }`, select
   `encounterParticipantId`), then the caller's cascade delete, then the
   tolerant batch clear over the surviving ids. Read
   `docs/CONCURRENCY.md` first per AGENTS.md — this is a race-sensitive
   mutation helper surface.
2. **Make `clearTurnOriginsForParticipants` module-private** so the
   protocol cannot be invoked out of order: the coordinator becomes the
   only way to reach the batch clear. (Its production importers are
   exactly the two deleters, so no other call site needs migration.)
3. **Convert both deleters** —
   `services/map-tokens/map-cascade.ts:50-67` and
   `services/character-delete.ts:48-58` — to the coordinator, keeping
   each caller's selector (`{ mapId, ... }` vs `{ characterId, ... }`)
   and delete statement explicit at the call site via the callback.
4. **Sync the doc surfaces that enumerate the two-caller protocol in the
   same change**: `docs/CONCURRENCY.md:200-204` (writer class 3), the
   `participant-stats-mutations.ts` header shape-4 block (`:43-55`), the
   helper JSDoc at `:287-298` (which moves with the privatization), and
   `services/map-tokens/MODULE.md:14-23` and `:48-50` — the twin-warning
   paragraph should become a pointer to the coordinator rather than a
   plea to edit two files together.

Existing tests must stay green and are the proof the extraction
preserves semantics — both sides already pin the turn-origin clears:
`routers/map.test.ts` (turn-origin invalidation assertions around
`:398-430`), `services/character-delete.test.ts` (cross-linked-survivor
clear assertions around `:372-389`), and
`services/map-tokens/empty-string-semantics.test.ts`. Run
`bun run test:server -- src/services/map-tokens src/services/character-delete.test.ts src/routers/map.test.ts`
from the repo root.

## Scope / caveats

- **The coordinator must not change semantics covered by the accepted
  residual-window ruling.** `docs/CONCURRENCY.md:263-275` accepts the
  origin-without-token window (a late link racing a cascade delete) as
  non-disclosing by construction; this leaf is a pure protocol
  extraction and must add no new gating, retry, or lock machinery
  against it.
- **Preserve the tolerant no-count-check semantics** of the batch clear
  (`participant-stats-mutations.ts:295-297`): ids whose participant row
  was itself cascade-deleted are deliberate no-ops. Do not "harden" it
  with an affected-row assertion while moving it behind the coordinator.
- **Keep selectors and delete statements at the call sites.** The
  coordinator owns ordering, not the deleters' domain queries; folding
  the `where` clauses or the `map.delete`/`character.delete` statements
  into the helper would couple two services that are free to evolve
  their own cascade scope.
- Character delete's turn-index adjustment loop
  (`character-delete.ts:37-39`) is part of the same transaction but not
  part of this protocol — it stays where it is, before the sweep.
- The rule-of-three objection (only two callers) was considered and
  rejected: the repo's documented design for these columns is
  structure-over-comments (the type-level writer ban plus sanctioned
  helpers), and the MODULE.md twin warning is an explicit admission that
  comment-synchronization is already the failure mode here.
- The prior pack's leaf 45
  (`docs/agent_notes/backlog/code-quality-2026-07-25/45-comments-compensating-for-code.md`,
  landed) did not touch this executable duplication, but its plan explicitly
  dropped the proposed header trimming: `docs/CONCURRENCY.md`, the numbered
  `utils/*-mutations.ts` helper-selection header, and the per-helper JSDoc were
  ruled to be three distinct documentation altitudes. This leaf may update
  their facts for the new coordinator, but must preserve the shape-4 selection
  guidance and local invariants rather than reducing the header to a pointer.
- The prior pack's keep-the-duplication ruling
  (`code-quality-2026-07-25/CONSTRAINTS.md`, "a guard in front of a
  destructive statement must own its own alphabet") applies only to the
  destructive DB-guard alphabets; it does not protect this duplication.
- No ordering dependency on other leaves, but one file overlap: leaf
  [017-participant-mutation-comments-misstate.md](./017-participant-mutation-comments-misstate.md)
  corrects the *same* `participant-stats-mutations.ts` header — its
  shape-1/2/3 guidance (`:26-40`, `:168-174`), while this leaf's step 4
  rewrites the shape-4 block (`:43-55`). Different paragraphs, either
  order works; just do not work the two leaves concurrently. No other
  leaf edits `map-cascade.ts` or `character-delete.ts`.
