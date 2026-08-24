# 43. Encounter-detail mutation behavior is fragmented across a 384-line view and its presentation files instead of one controller module

Status: Not started
Theme: detail-surface controller ownership · Area: client · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Changing one encounter action — say, how removing a participant reports a
conflict — requires discovering behavior in three places: a 384-line
composition view that assembles race-sensitive mutation payloads in ad-hoc
hooks, a six-mutation hook hidden at the bottom of the file that renders
participant rows, and raw mutation objects threaded through presentational
props so that buttons call `mutations.transitionState.mutate({...})` directly.
No single module owns the encounter-detail mutation surface.

The cost is concrete. `useEncounterDetailMutations` — the hook that builds all
six tRPC mutations, the shared invalidation callback, and the `removingId`
pending state — lives inside `encounter-participants.tsx`, a file whose name
says "row and list rendering". Three other files type their props as
`ReturnType<typeof useEncounterDetailMutations>`, importing a type from a
presentation file to describe a behavior contract. Meanwhile the view file
keeps four more behavior hooks (`useParticipantHandlers`,
`useSetInitiativeMutation`, `useAddCombatLogMutation`, `useHpDialogHandler`)
plus the `ACTION_FIELD_MAP` table, so the `expectedVersion` /
`expectedStatsVersion` concurrency tokens that `docs/CONCURRENCY.md` treats as
race-sensitive are assembled in a component file, guarded only by comments.
Passing the whole mutations bag into `EncounterDetailCard`,
`EncounterHeaderActions`, and `ParticipantList` means presentational files also
construct mutation input objects inline, so the payload logic is scattered
rather than owned.

The sibling maps module already demonstrates the target shape in this repo:
`maps/map-detail-mutations.ts` is a 30-line non-JSX module that owns mutation
construction and exports a named `MapUpdateMutation` type that presentational
files consume as a prop. Encounters simply never got the same seam.

## Evidence

- `packages/client/src/components/campaign/encounters/encounter-detail-view.tsx` — 384 lines (measured) mixing queries, dialog state, and composition with behavior: `ACTION_FIELD_MAP` at `:29-36`, `useParticipantHandlers` at `:83-127`, `useSetInitiativeMutation` at `:129-140`, `useAddCombatLogMutation` at `:142-153`, `useHpDialogHandler` at `:155-184`.
- `packages/client/src/components/campaign/encounters/encounter-participants.tsx:123-215` — `useEncounterDetailMutations` builds six mutation factories (`addParticipant` `:133`, `removeParticipant` `:143`, `updateParticipant` `:157`, `transitionState` `:176`, `rollAllInitiative` `:186`, `advanceTurn` `:196`), the shared `invalidate` callback `:128-131`, and `removingId` pending state `:126` — in the same file as `ParticipantRow` (`:14`) and `ParticipantList` (`:83`).
- Three files re-derive `ReturnType` of the presentation-file hook to type their props: `encounter-detail-card.tsx:24`, `encounter-header-actions.tsx:11`, `encounter-participants.tsx:90`; the view repeats the same `ReturnType` expression at `:86`, `:157`, and `:199`.
- Race-sensitive payload construction sits in presentation code: `encounter-detail-view.tsx:97` (`expectedVersion` for conditions), `:115-122` (`expectedVersion` + `expectedStatsVersion` for death saves), `:170-180` (HP write with character-only `expectedStatsVersion`). Measured: within `encounters/`, only `encounter-detail-view.tsx` and its test construct `expectedVersion`/`expectedStatsVersion` (`rg -n "expectedVersion|expectedStatsVersion" packages/client/src/components/campaign/encounters/`).
- Load-bearing concurrency comments guard the current code: HP-dialog stale-participant rationale and character-vs-monster `statsVersion` branching at `encounter-detail-view.tsx:161-169`, the `key={p.id}` retargeting discipline at `:327-330`, and the CONFLICT-reload rationale at `encounter-participants.tsx:162-164`.
- Presentational files assemble mutation inputs inline: `encounter-participants.tsx:105-115` (`setRemovingId` + `removeParticipant.mutate`, `updateParticipant.mutate` for visibility), `encounter-header-actions.tsx:47`, `:57`, `:72`, `:94` (`rollAllInitiative`, `transitionState` with state literals), `encounter-detail-card.tsx:72`, `:75` (`advanceTurn`, `updateParticipant`).
- In-repo precedent: `packages/client/src/components/campaign/maps/map-detail-mutations.ts` (30 lines) owns mutation construction and exports `export type MapUpdateMutation = ReturnType<typeof useMapUpdateMutation>` at `:30`; the hook is called once in `map-detail-view.tsx:66` and presentational files consume the named type as a prop (`map-detail-content.tsx:38`, `map-editor-dialogs.tsx:23`).
- `packages/client/src/components/campaign/encounters/MODULE.md:7` — "Owns encounter CRUD views and participant-list mutation wiring" — the ownership line the extraction changes by construction.

## Proposed direction

A pure relocation-and-retyping refactor in two independently landable parts,
verified by the existing co-located tests. The copyable pattern is the
**detail-surface controller module**: one non-JSX hook file owns mutation
construction, concurrency tokens, and pending state; presentational files
receive named intent callbacks — `maps/map-detail-mutations.ts` is the smaller
in-repo instance of the same shape.

1. **Create the controller module — no prop-shape changes.** Add
   `packages/client/src/components/campaign/encounters/encounter-detail-mutations.ts`
   (naming mirrors the sibling `maps/map-detail-mutations.ts`) and make it the
   single owner of the encounter-detail mutation surface:
   - Move `useEncounterDetailMutations` — with its six mutation factories,
     shared `invalidate`, `removingId` pending state, and the CONFLICT-reload
     comment (`encounter-participants.tsx:162-164`) — out of
     `encounter-participants.tsx`.
   - Move `useSetInitiativeMutation`, `useAddCombatLogMutation`,
     `useParticipantHandlers`, and `useHpDialogHandler` (with
     `ACTION_FIELD_MAP`) out of `encounter-detail-view.tsx` into the same
     module, so all `expectedVersion`/`expectedStatsVersion` payload
     construction lives in one place.
   - Export a named type — `export type EncounterDetailMutations =
     ReturnType<typeof useEncounterDetailMutations>`, matching the
     `MapUpdateMutation` alias idiom — and retype the three consumers that
     currently re-derive `ReturnType` from the presentation-file hook:
     `encounter-detail-card.tsx:24`, `encounter-header-actions.tsx:11`,
     `encounter-participants.tsx:90`.
   - Move the three load-bearing comment blocks **verbatim, not rewritten**:
     view `:161-169` (HP-dialog identity + `statsVersion` branching) travels
     with `useHpDialogHandler`; participants `:162-164` (CONFLICT reload)
     travels with `updateParticipant`; the `key={p.id}` comment at view
     `:327-330` stays put, because `HpDialogSection` does not move.
   - After this part, `encounter-participants.tsx` keeps only
     `ParticipantRow`/`ParticipantList`; split `encounter-participants.test.tsx`
     accordingly, moving (not rewriting) the mutation-hook coverage beside the
     new module.
   - Update `encounters/MODULE.md:7`, whose "participant-list mutation wiring"
     ownership line changes by construction.
   - Done-check for the extraction: grep that no file outside
     `encounter-detail-mutations.ts` constructs
     `expectedVersion`/`expectedStatsVersion` for encounter mutations —
     `rg -n "expectedVersion|expectedStatsVersion" packages/client/src/components/campaign/encounters/`
     should hit only the controller module and tests.
2. **Narrow what presentation receives — separate commits from part 1.**
   Replace the raw mutations bag in `EncounterDetailCard`,
   `EncounterHeaderActions`, and `ParticipantList` props with intent callbacks
   plus explicit pending flags — `onAdvanceTurn`/`isAdvancing`,
   `onToggleVisibility`, `onRemoveParticipant`/`removingId`,
   `onTransitionState`/`isTransitioning`, `onRollAllInitiative` — built in the
   controller module, so no presentational file assembles mutation input
   objects. `encounter-detail-view.tsx` keeps queries, dialog-open local
   state, `HpDialogSection` (its participant-identity `key` discipline and
   comments intact), and composition — it shrinks to wiring the controller's
   callbacks into sections.

## Scope / caveats

- **Out of scope:** server/router changes, socket behavior, `../combat/`
  directory internals (`InitiativeTracker` and `CombatLogPanel` prop shapes
  stay as-is), optimistic updates, and any behavior change.
- **The concurrency payloads are race-sensitive** (`docs/CONCURRENCY.md`
  territory — read it before moving these hooks). The HP-dialog handler
  deliberately uses the participant the dialog rendered rather than re-reading
  `hpDialogParticipantId` from the store, and death-saves/HP updates pair
  `expectedVersion` with `expectedStatsVersion` only for character
  participants. A careless move that re-reads the store, drops the `key={p.id}`
  discipline, or normalizes the `statsVersion` branching would reintroduce the
  exact cross-participant write bug the comments guard against — hence the
  verbatim-comment requirement.
- **Callback reshaping can silently change behavior:** widening or reshaping
  callbacks can change memoization identity and invalidation timing — e.g.
  losing the `removeParticipant` `onError` `setRemovingId(null)` reset
  (`encounter-participants.tsx:150-154`). Tests in
  `encounter-detail-view.test.tsx`, `encounter-participants.test.tsx`,
  `encounter-header-actions.test.tsx`, and `encounter-detail-card.test.tsx`
  must be moved/extended, not rewritten.
- **Do not fold part 2 into part 1's commits.** Part 1 is mechanically
  verifiable precisely because no prop shape changes; part 2 touches four
  component prop contracts at once, and doing both in one commit makes
  regressions hard to attribute.
- **Sequencing:** No hard ordering dependency with
  [060-participant-presentation-duplicated-between.md](./060-participant-presentation-duplicated-between.md),
  but do not work the two concurrently in `encounter-participants.tsx`;
  whichever lands second must preserve both the controller extraction and the
  participant-presentation relocation. Apart from that shared-file relation,
  no other leaf edits these files
  ([024-encounter-inputs-monolith-spanning-three.md](./024-encounter-inputs-monolith-spanning-three.md)
  and [026-monster-provenance-invariants-disappear.md](./026-monster-provenance-invariants-disappear.md)
  target `encounter-inputs.ts` in shared, not this directory). Soft note: if
  [088-client-component-module-documents-misstate.md](./088-client-component-module-documents-misstate.md)
  (combat MODULE refresh) lands nearby, keep the encounters-vs-combat
  delegation lines in the two MODULE.md files consistent.
- No prior-pack coverage: earlier encounter work touched isolated behaviors,
  not this controller-ownership seam.
