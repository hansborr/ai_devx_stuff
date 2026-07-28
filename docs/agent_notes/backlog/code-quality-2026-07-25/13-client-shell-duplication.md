# 13. Sibling campaign surfaces copy each other's chrome: two canvas hosts and two filter panels duplicate their shells

Status: **Done 2026-07-27** in
[CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md) slice **O1**, merge
`6cf8c78d5`; see [Landed](./00-index.md#landed). Step 1 landed as the one
option-free shared unit. **Every other step is dropped permanently**: the
existing `VttSurface` owns the shell, and two callers do not earn configurable
canvas or panel primitives.
Theme: Client shell duplication · Area: client · Severity: low · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

Four campaign surfaces were each built by copying the neighbouring surface and
editing the payload. The copies have since drifted only in their *content*, so
what remains duplicated is the **chrome**: the container element, the canvas prop
block, the context-menu mount, the card header, the search box, the filter select.
That chrome is the part nobody reads carefully during review, which is exactly why
a fix applied to one copy (a `data-testid`, an `aria-label`, a `minHeight`
regression, a new `MapCanvas` prop) silently misses the other.

Two clusters, one cause:

**Canvas hosts.** `map-detail-content.tsx` (190 lines) and `combat-map-content.tsx`
(224 lines) both host a `MapCanvas` inside a sized container with a
`TokenContextMenu` overlay. The `ContextMenuState` interface and the
`handleTokenMoved` callback are byte-identical between the two files; the
container `div` plus `MapCanvas` prop block is structurally identical with
different constants; and maps' seven `TokenContextMenu` props are byte-identical
to combat's first seven, which then adds six encounter-only props. The genuinely
shared kernel is roughly 55 lines.

**Filter panels.** `NotesToolbar` and `NpcToolbar` are the same component with
different nouns: identical `CardHeader className="pb-3"`, identical
`CardTitle className="flex items-center gap-2 font-serif text-lg"` with a lucide
icon, identical `size="sm"` Plus button, identical `mt-3 flex gap-2` row with a
`Search` icon positioned at `absolute left-2.5 top-2.5 h-4 w-4` over an
`Input className="pl-9"`, and a `Select` filter. Their empty states differ only in
copy. Both files also import `DeleteConfirmDialog` from
`components/campaign/settings/`.

Neither cluster is a defect today. Both are places where the next change costs
double and the second copy is easy to forget.

## Evidence

- `packages/client/src/components/campaign/maps/map-detail-content.tsx:26-27` — `DEFAULT_CONTAINER = { width: 800, height: 500 }` and `MIN_CANVAS_HEIGHT = "500px"`.
- `packages/client/src/components/campaign/combat/combat-map-content.tsx:37-38` — the same two constants at `600x400` / `"400px"`. Only the numbers differ.
- `packages/client/src/components/campaign/maps/map-detail-content.tsx:29-33` and `packages/client/src/components/campaign/combat/combat-map-content.tsx:40-44` — `interface ContextMenuState { token; x; y }`, byte-identical.
- `packages/client/src/components/campaign/maps/map-detail-content.tsx:78-83` and `packages/client/src/components/campaign/combat/combat-map-content.tsx:92-97` — `handleTokenMoved`, byte-identical including the dep array.
- `packages/client/src/components/campaign/maps/map-detail-content.tsx:117-131` and `packages/client/src/components/campaign/combat/combat-map-content.tsx:154-177` — the sized container `div` (`ref={containerRef}`, `style={{ minHeight: MIN_CANVAS_HEIGHT }}`) plus the `MapCanvas` prop block. Combat additionally passes `encounter` and nests a `VttActionBar` overlay at `:159-165`.
- The two container class strings differ by one token: maps (`map-detail-content.tsx:118`) is `relative flex-1 overflow-hidden rounded-lg border bg-background` because that div is a flex child of `<div className="flex gap-3">` (`:115`) beside `TokenSidebar` (`:133`); combat (`combat-map-content.tsx:156`) is `relative overflow-hidden rounded-lg border bg-background` and sits as a block child of `space-y-2` (`:142`). No test asserts either string, so a lost `flex-1` is visual-only and silent.
- `packages/client/src/components/campaign/maps/map-detail-content.tsx:165-185` and `packages/client/src/components/campaign/combat/combat-map-content.tsx:193-219` — `TokenContextMenu`. Maps' entire seven-prop usage (`token`, `position`, `isDm`, `onEdit`, `onRemove`, `onToggleVisibility`, `onClose`) is a byte-identical prefix of combat's: `map-detail-content.tsx:165-184` and `combat-map-content.tsx:193-212` differ in no character, including the `tokens.remove.mutate` / `tokens.update.mutate` bodies. Combat then adds six encounter-only props at `combat-map-content.tsx:213-218` (`isInCombat`, `participantId`, `onAdjustHp`, `unlinkedParticipants`, `onLinkParticipant`, `onUnlinkParticipant`).
- `packages/client/src/components/campaign/combat/combat-map-content.tsx:98-103` — `handleContextMenu` here calls `syncTokenToParticipant(token)`; the maps version at `:84-90` does not. **Not** shared.
- `packages/client/src/components/campaign/notes/notes-panel.tsx:40-46` / `:48-108` — `NotesEmptyState` and `NotesToolbar` (file is 359 lines).
- `packages/client/src/components/campaign/npcs/npc-panel.tsx:48-65` / `:67-124` — `NpcEmptyState` and `NpcToolbar` (file is 336 lines); header markup matches notes line for line.
- `packages/client/src/components/campaign/notes/notes-panel.tsx:10` and `packages/client/src/components/campaign/npcs/npc-panel.tsx:10` — both import `DeleteConfirmDialog` from `components/campaign/settings/delete-confirm-dialog.js`.
- `packages/client/src/components/campaign/maps/maps-panel.tsx:111` and `packages/client/src/components/campaign/encounters/encounters-panel.tsx:119` — `CardHeader className="pb-3"`, but **no** search input and **no** filter `Select` anywhere in either file.
- `packages/client/src/components/campaign/homebrew-link/campaign-homebrew-section.tsx:242` — a different header layout entirely: `CardHeader className="flex flex-row items-center justify-between pb-3 space-y-0"`, no filter.

## Proposed direction

The governing constraint: **two call sites do not earn a configurable shell.** Every unit
below is either a state protocol with no options, or a component with at most three props
plus a slot. If a proposed unit needs a boolean flag or an "optional callback" to fit both
callers, it is out of scope — leave the duplication.

1. Move the context-menu **state protocol**, not the rendering, into
   `packages/client/src/components/campaign/tokens/` next to `TokenContextMenu`:
   `useTokenContextMenu()` owns the (currently duplicated) `ContextMenuState` type, the
   `useState`, an `open(token, screenX, screenY)`, a `close()`, and an `anchorProps` object
   (`{ token, position, onClose }`) for the caller to spread. It takes no parameters.
   Each caller keeps its own `handleContextMenu` and calls `open(...)` as the last line —
   maps after `store.selectToken`, combat after `store.selectToken` *and*
   `syncTokenToParticipant`.
   `anchorProps` stops at `{ token, position, onClose }` even though all seven of maps'
   props are identical text: those three are the only ones derived from the state the hook
   owns. The other four cannot cross a parameterless hook — `isDm` is a caller prop,
   `onEdit` closes over the caller's `setEditToken` dialog state, and `onRemove` /
   `onToggleVisibility` close over the caller's `map.id` and mutation object, whose types
   differ between callers (`TokenMutations` vs `CombatTokenMutations`, see step 5). Sharing
   them would require parameters, which the governing constraint rules out; leave that text
   duplicated on purpose.
   Do not let the shared unit own the rendered `TokenContextMenu` as well as the state — the
   caller's `handleContextMenu` is what produces the state, so a unit owning both forces an
   options bag. Owning the state and exposing `open(...)` keeps it option-free.
2. Extract `<MapCanvasFrame>` into `packages/client/src/components/campaign/maps/`, beside
   `use-map-container-size.ts` (already imported by both callers —
   `map-detail-content.tsx:19`, `combat-map-content.tsx:25`), covering **only**
   the sized container: it calls `useMapContainerSize(defaultSize)` internally, renders the
   `relative flex-1 overflow-hidden rounded-lg border bg-background` div with `ref` and
   `style={{ minHeight }}`, and passes the measured size to a render-prop child. Props:
   `defaultSize`, `minHeight`, optional `testId`, child. That is the whole drift-prone
   chrome (classNames, `minHeight`, `data-testid`) in one place.
   `flex-1` is emitted unconditionally. Maps requires it — its container is a flex item
   sized against `TokenSidebar` — and it is inert for combat, whose container is a block
   child of a non-flex `space-y-2` parent, since `flex: 1 1 0%` applies only to flex and
   grid items and sets no width on its own. Confirm combat's layout is unchanged when the
   frame lands (step 4). Do not add a `flexible?: boolean` or a `className` prop: the
   boolean is exactly the `hasX`/`showX` flag the governing constraint forbids, and a
   `className` escape re-opens the class-drift seam this step exists to close. A third
   caller that genuinely cannot tolerate `flex-1` is the trigger to reconsider.
   Do not put the frame in `components/vtt/`: `packages/client/src/components/vtt/MODULE.md:15-18`
   says that directory "owns the shared tabletop **shell** (`VttSurface`), the in-VTT action
   bar, the drawer mount, and the target-pick overlay. It does not own map rendering", and
   `:56-57` assigns "map listing, canvas, fog, drawing, measurement, and template placement"
   to `../campaign/maps/`.
   Deliberately **not** in the frame: the `MapCanvas` element itself. Forwarding nine canvas
   props through a wrapper is the over-parameterised shell this leaf must avoid, and it buys
   less than it looks: TypeScript already fails both call sites when `MapCanvas` gains a
   *required* prop, so the residual drift risk is optional props only. Each caller keeps its
   `MapCanvas` JSX explicit and visible.
3. Rewrite `map-detail-content.tsx` onto both units first — keeping its header, dialogs,
   sidebar and chat panel where they are — and confirm the maps route behaves identically
   before touching combat.
4. Rewrite `combat-map-content.tsx` onto the same two units, keeping `VttActionBar` as an
   ordinary absolutely-positioned child inside the frame's render-prop body (no "overlay
   slot" prop needed) and `syncTokenToParticipant` inside its local `handleContextMenu`.
   Pass `testId="combat-map-canvas"` — `e2e/page-objects/vtt-drawer.po.ts:30` resolves the
   canvas by that attribute; see `docs/guides/add-e2e-test.md`.
5. `handleTokenMoved` is identical text but not identical types: maps holds `TokenMutations`
   and combat holds `CombatTokenMutations` (`map-detail-mutations.ts` /
   `combat-map-mutations.ts`), so sharing it means a helper generic over
   `{ move: { mutate } }`. Six duplicated lines are not worth that indirection — leave the
   callback in each caller unless the two mutation types are unified for other reasons.
6. For the panels, extract two small primitives instead of one `<FilterablePanelHeader>`
   with nine parameters:
   - `<PanelSearchInput value onChange placeholder ariaLabel />` — the `relative flex-1`
     wrapper, the absolutely-positioned `Search` icon and the `pl-9` `Input`. This is the
     block where a class-level regression is genuinely invisible in review.
   - `<PanelCardHeader icon title action>{children}</PanelCardHeader>` — the
     `CardHeader className="pb-3"`, the `CardTitle` with icon, an `action` slot (`ReactNode`,
     so `isDm ? <Button/> : null` stays in the caller and no `showAction` flag appears) and a
     children slot for the `mt-3 flex gap-2` filter row.
   The filter `Select` stays in each panel: notes uses a `w-36` trigger with four options,
   one of them `isDm`-gated; NPCs uses `w-28` with three. Parameterising width plus option
   lists plus a per-option visibility predicate would re-create the flag-bag this leaf is
   trying to avoid.
7. Move `notes-panel.tsx` onto the primitives, then `npc-panel.tsx`. Two commits, verified
   against the existing panel tests each time.
8. Refresh the affected `MODULE.md` files (`components/campaign/maps/`,
   `components/campaign/combat/`, `components/campaign/tokens/`, and the notes and NPC
   panel module docs) per `docs/guides/add-module-doc.md`.

## Scope / caveats

- **Two call sites is the whole justification, so hold a hard parameter budget.** The
  drift-prone material here is chrome (class strings, `minHeight`, `data-testid`, the
  context-menu state protocol), roughly 55 lines. If the extraction's prop list starts
  approaching the number of lines it removes, or grows a `hasX`/`showX` boolean, stop and
  keep the duplication — that is a worse trade than the copy. This is why step 2 stops at
  the container and step 6 splits into two slot-based primitives rather than one configured
  header.
- **Do not build a shared "map host hook" or a component that owns the whole
  surface.** The dialog mounts are not shared — maps mounts `MapEditorDialogs`
  (`map-detail-content.tsx:150`), combat mounts `EditTokenDialog`
  (`combat-map-content.tsx:180`), different components with different prop sets —
  and only `TokenContextMenu` is common. The headers differ (`MapDetailHeader` vs
  `CombatMapHeader` with `distanceFt`), the store slices differ
  (`useMapDetailStoreSlice` at `map-detail-content.tsx:61` vs
  `useCombatMapStoreSlice` at `combat-map-content.tsx:70`), maps-only concerns
  are `TokenSidebar`, `ChatPanel`, the placement slice and `onBack`, and
  combat-only concerns are `VttActionBar`, link/unlink handlers,
  `unlinkedParticipants`, `handleEditSubmit` and the `encounter` passed into
  `MapCanvas`. Stop at the container frame and the context-menu state protocol
  (steps 1-2).
- **`handleContextMenu` is not shared.** Combat's version calls
  `syncTokenToParticipant`; maps' does not. Do not lift it into a shared unit
  "with an optional callback" — it stays in each caller and calls the shared
  `open(...)` from step 1. Note this also means step 1 must land compatibly with
  leaf 10 step 6, which may remove `syncTokenToParticipant`'s guard or turn the
  combat selection into a read-time derivation.
- **The panel primitives fit notes + NPCs only.** `maps-panel.tsx` (198 lines)
  and `encounters-panel.tsx` (207 lines) have no search box and no filter select
  at all; they share only Card/CardHeader/CardTitle + list +
  `DeleteConfirmDialog`. `campaign-homebrew-section.tsx` uses a different header
  layout and no filter. Conflating those three into the same abstraction would
  force a search/filter-shaped component to grow "hasSearch" / "hasFilter" flags,
  which is worse than the duplication it removes. If a thinner list-card shell is
  wanted for those three later, it is a separate leaf.
- The two clusters share a cause but touch disjoint files. They can be split into
  two branches (steps 1-5, then steps 6-8) if that is easier to review; nothing in
  the canvas work depends on the panel work. The panel half (steps 6-8) has one
  constraint: leaf 08 step 4a rewrites the `DeleteConfirmDialog` import in
  `notes-panel.tsx` and `npc-panel.tsx`, so land 08 step 4a before step 7 here
  (or re-point step 7 at the moved import path). Otherwise steps 6-8 can go
  first if the canvas files are busy.
- Sequencing for the canvas half: **leaf 10** and **leaf 12** rewrite the same two
  files (`map-detail-content.tsx`, `combat-map-content.tsx`). Land leaf 10's reset
  centralisation first (it changes hook wiring), then steps 1-5 here (they move
  JSX), then leaf 12's `isDm` prop removal (it deletes props from that JSX).
  Landing leaf 12 first would mean re-doing its prop deletions against relocated
  markup. If leaf 10 ends up needing its read-gate escalation (its step 5, which
  re-signatures the store slice hooks), that lands before step 2 here as well.
- Follow `docs/guides/add-client-feature-module-cache-socket.md` when moving
  components between client feature directories. TDD applies: the existing panel
  and map-content tests should be green before and after each step, with no test
  edits beyond import paths.
