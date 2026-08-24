# 88. Three high-change client component MODULE maps are unreliable: the VTT map credits `VttSurface` with composition it does not do, the combat map advertises orphaned UI and paging ownership that does not exist, and the encounters map is nine lines for a 1,888-line feature

Status: Not started
Theme: component MODULE map accuracy · Area: docs · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`MODULE.md` files are mandatory first-reads: AGENTS.md tells every contributor to
read the nearest one before editing a feature area. That only works if the maps
are true, and three of the client's highest-change component maps fail in three
different ways.

**The VTT map attributes composition to the wrong component.**
`components/vtt/MODULE.md` says `VttSurface` "wraps map content with the in-VTT
drawer, action bar, and target-pick overlay" and lists `vtt-action-bar.tsx` as
"composed by `VttSurface`". The component composes none of that: it renders a
`Fragment` containing its children plus `InVttDrawer`, and wires the
character-sheet socket — nothing else. The action bar is actually mounted by the
combat screen (`combat-map-content.tsx`) inside `VttSurface`'s *children*, and
the target-pick overlay is mounted by `map-canvas.tsx`. A contributor changing
the action bar or overlay who trusts the map starts in `vtt-surface.tsx`, the
one file in the chain that never touches either.

**The combat map advertises dead UI and nonexistent state ownership.**
`components/campaign/combat/MODULE.md` lists `roll-mode-toggle.tsx` among the
"focused combat UI pieces consumed by the active encounter surface" — but the
component has zero production consumers anywhere in the client. The same doc's
State Ownership section claims the directory owns "log paging, and roll-mode
display": there is no paging state anywhere in the client (the wire contract
defines an unused `cursor`/`limit`, and no component holds a cursor), and
`CombatLogPanel` is a pure presenter that receives a complete `logs` array and
owns only an expand/collapse boolean plus round grouping. Even the fetching
happens outside the directory, in the encounters detail view.

**The encounters map is too thin to orient anyone.** The directory holds 14
production TypeScript/TSX files totaling 1,888 lines — list/detail views, five
dialog/mutation surfaces, difficulty and XP derivation, and the combat-log query
wiring — and its entire MODULE.md is a purpose sentence plus three ownership
bullets. None of the Data Flow / Entry Points / State Ownership / Test Seams /
Gotchas guidance the sibling combat map provides exists here, so the mandatory
first-read answers none of the questions a first edit raises.

## Evidence

### VTT: composition credited to the wrong component

- `packages/client/src/components/vtt/MODULE.md:22-26` — "`vtt-surface.tsx`
  exports `VttSurface`, the shell that wraps map content with the in-VTT drawer
  (`in-vtt-drawer.tsx`), action bar (`vtt-action-bar.tsx`), and target-pick
  overlay (`target-pick-overlay.tsx`)."
- `packages/client/src/components/vtt/MODULE.md:41` — "`vtt-action-bar.tsx` —
  in-VTT action bar surface composed by `VttSurface`." The Purpose paragraph at
  `:15-18` makes the same ownership claim without separating file ownership
  from mounting.
- `packages/client/src/components/vtt/vtt-surface.tsx:39-44` — the entire
  return: `<Fragment>{children}<InVttDrawer …/></Fragment>`; the only other
  behavior is `useCharacterSheetSocket` at `:32`. No action bar, no overlay.
- `packages/client/src/components/campaign/combat/combat-map-content.tsx:33`
  imports `VttActionBar`; `:151-157` mounts it — inside the children passed to
  `VttSurface` (opened at `:127`), not by the shell itself.
- `packages/client/src/components/campaign/maps/map-canvas.tsx:23` imports
  `TargetPickOverlay`; `:141` is its only production mount.
  `packages/client/src/hooks/canvas-input/tool-handlers.ts:286` references it
  in a comment (the overlay's target shapes call `confirmTargetPick`); no other
  production file touches it.

### Combat: orphaned UI and phantom paging ownership

- `packages/client/src/components/campaign/combat/MODULE.md:62-65` —
  `roll-mode-toggle.tsx` listed among "focused combat UI pieces consumed by the
  active encounter surface"; `:8` also claims "roll-mode UI lives here".
- `packages/client/src/components/campaign/combat/roll-mode-toggle.tsx` — zero
  production imports or references outside the defining file (git grep across
  `packages/client`, excluding tests and MODULE.md, finds only the component's
  own declarations).
- `packages/client/src/components/campaign/combat/MODULE.md:82-83` — "Owns
  combat UI state: selected participant affordances, dialogs, action controls,
  log paging, and roll-mode display."
- `packages/client/src/components/campaign/combat/combat-log-panel.tsx:228-236`
  — `CombatLogPanel` receives a complete `logs` array as a prop; its only owned
  state is `expanded` (`:236`); `:247` groups by round. No cursor, no paging.
- `packages/client/src/components/campaign/encounters/encounter-detail-view.tsx:233-236`
  — the sole production fetch: `listCombatLogs.queryOptions({ encounterId })`,
  no cursor or limit passed; the panel's sole production mount is `:265` in the
  same file. Invalidation lives in
  `packages/client/src/lib/query-invalidation.ts:63`.
- `packages/shared/src/schemas/encounter-inputs.ts:278-290` — the wire input
  does define optional `cursor` and a defaulted `limit`, so "paging" is a real
  contract capability the client never exercises — which is precisely why a doc
  claiming the combat directory *owns* paging is misleading rather than merely
  aspirational.

### Encounters: nine lines for a 1,888-line feature

- `packages/client/src/components/campaign/encounters/MODULE.md:1-9` — the
  entire document: title, concepts line, one purpose sentence, three bullets.
- 14 tracked production TS/TSX files, 1,888 lines at the pin (excluding tests
  and MODULE.md; measured from the git tree): `encounters-panel`,
  `encounter-detail-view`, `encounter-card`, `encounter-detail-card`,
  `encounter-header-actions`, `encounter-participants`,
  `add-participant-dialog`, `create-encounter-dialog`, `end-encounter-dialog`,
  `encounter-map-link`, `difficulty-indicator`, `difficulty-styles`,
  `encounter-icons`, `xp-summary-panel`.
- `packages/client/src/pages/campaign-detail-page.tsx:181` — `EncountersPanel`
  is the directory's external entry point;
  `encounters-panel.tsx:104` mounts `EncounterDetailView`, the main detail
  composition.

## Proposed direction

Two parts, committed separately so the sequencing edge below binds only the
first. Both are documentation-only: re-derive every composition claim from the
pinned source (grep the import, open the mount site) rather than paraphrasing
this leaf — doc-correction rounds that paraphrase are how true claims get
inverted while false ones get fixed.

1. **Correct the two existing maps against the import graph.**
   - `components/vtt/MODULE.md`: keep `VttSurface` named as the shell, and keep
     the four-directory / three-store split language and the "single public
     entry point" framing fully intact (see caveats). Reword Purpose
     (`:15-18`), Data Flow (`:22-26`), and the entry-point line (`:41`) to
     separate *file ownership* from *mounting*: the directory owns
     `vtt-action-bar.tsx` and `target-pick-overlay.tsx`, but the consumer
     screens mount them — `combat-map-content.tsx` composes the action bar
     (and the map) inside `VttSurface`'s children, and `map-canvas.tsx` mounts
     the overlay for cast/attack target picking. `VttSurface` itself composes
     only its children plus `InVttDrawer` and wires the character-sheet socket.
   - `components/campaign/combat/MODULE.md`: drop the `roll-mode-toggle.tsx`
     entry from the entry-point list at `:62-65` (and the "roll-mode UI lives
     here" claim at `:8` if the component is gone by then — see sequencing),
     and replace "log paging, and roll-mode display" at `:82-83` with what is
     true: `CombatLogPanel` is a pure presenter receiving a complete logs
     array, owning only expansion/grouping state; fetching lives in
     `encounters/encounter-detail-view.tsx` via
     `encounterCombat.listCombatLogs`, invalidation in
     `lib/query-invalidation.ts`, and the client passes no cursor or limit.
2. **Author a full `components/campaign/encounters/MODULE.md`** in the
   module-charter shape of `combat/MODULE.md` (Purpose, Data Flow, External
   Entry Points, State Ownership, Test Seams, Gotchas), following
   [`docs/guides/add-module-doc.md`](../../../guides/add-module-doc.md) and
   derived from the 14-file import graph
   (`bun run code:intel -- dependents <file>` answers who-mounts-what):
   `encounters-panel.tsx` as the external entry point (mounted by
   `pages/campaign-detail-page.tsx:181`) with `encounter-detail-view.tsx` as
   the main detail composition; the dialog/mutation surfaces
   (create/end-encounter, add-participant, header actions, map-link);
   difficulty/XP derivation; and the fact that combat-log query and
   invalidation wiring live here even though rendering delegates to
   `../combat/CombatLogPanel`. Keep it at ownership/flow altitude — too thin
   repeats the original defect, per-prop detail goes stale on the next
   refactor.

## Scope / caveats

- **Documentation only.** No component moves or refactors — in particular, do
  not relocate the combat-log fetching out of `encounter-detail-view.tsx` or
  add paging; correcting the doc to match the code is the whole job.
- **Do not reopen the shared-shell decision.** The live 2026-07-25 pack dropped
  a configurable-shell refactor permanently
  ([13-client-shell-duplication.md](../code-quality-2026-07-25/13-client-shell-duplication.md):
  "the existing `VttSurface` owns the shell, and two callers do not earn
  configurable canvas or panel primitives"; ruling recorded in that pack's
  CLIENT-CLUSTER-PLAN.md). That ruling leans on the VTT MODULE's
  `VttSurface`-is-the-shell framing — the reword must correct the composition
  claims *without* softening "the single public entry point of this directory",
  or it invites a future reopen.
- **Sequencing with
  [061-rollmodetoggle-complete-production-orphan.md](./061-rollmodetoggle-complete-production-orphan.md)**,
  which deletes `roll-mode-toggle.tsx` itself: the ownership is explicitly
  partitioned — leaf 61 removes the component, this leaf owns its doc lines.
  Land part 1 after or alongside leaf 61 so the map never advertises a
  just-deleted file; if leaf 61 slips, still drop the entry-point line (a
  MODULE map need not enumerate production orphans). Removing the component is
  out of scope here.
- **Re-derive, don't paraphrase.** Every composition sentence written in part 1
  or 2 should be checked against a fresh grep of the pinned tree, not copied
  from this leaf's prose — the panel/overlay mount sites and the
  paging-capability nuance (`encounter-inputs.ts:278-290` defines
  `cursor`/`limit`; the client uses neither) are exactly the kind of claims
  that invert during correction rounds.
- The encounters line/file counts (14 files, 1,888 lines) are measured at the
  audit pin and will drift; the authored MODULE should not embed them.
