# 55. Token placement mirrors store state into dialog state through an effect hidden behind a callback, leaving two sources of truth every close path must coordinate

Status: Not started
Theme: Derived dialog state · Area: client · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Clicking a cell with the place-token tool writes `pendingTokenCell` into the
canvas store; the add-token dialog's visibility, however, lives in a separate
component `useState` boolean. The two are stitched together by
`usePlacementSlice`, whose only effect watches the store cell and invokes an
`openDialog` callback the component passes in — a wrapper around the dialog's
`useState` setter. This is exactly the "effect that only calls setState
synchronously" pattern the client-effects guide tells contributors to replace
with derived state, but because the setState call hides behind an opaque
callback parameter (and in a different file), neither `local/no-effect-misuse`
nor the React set-state-in-effect ratchet can see it. The cost is ongoing:
dialog visibility now has two sources of truth, so the dialog close handler
and the create-success handler must each remember to both flip the boolean and
clear the pending cell, and any future close path that forgets one of them
desyncs the pair. As a copyable idiom in a repo that documents effects
discipline, it also teaches the wrong move to the next dialog author.

## Evidence

- `packages/client/src/components/campaign/maps/map-detail-content.tsx:53` — `const [addTokenOpen, setAddTokenOpen] = useState(false);`, the component-owned mirror.
- `packages/client/src/components/campaign/maps/map-detail-content.tsx:58-61` — `openAddToken`, a `useCallback` wrapper around `setAddTokenOpen(true)`, passed into `usePlacementSlice(openAddToken)`.
- `packages/client/src/components/campaign/maps/map-detail-store-hooks.ts:39-41` — the effect: `useEffect(() => { if (cell) openDialog(); }, [cell, openDialog]);` — its only work is triggering a state set already derivable from `cell`.
- `packages/client/src/hooks/canvas-input/tool-handlers.ts:274-282` — the place-token tool handler writes the cell: `useMapCanvasStore.getState().setPendingTokenCell(cell)` at `:279`; `packages/client/src/stores/map-canvas-store.ts:359` is the store setter.
- `packages/client/src/components/campaign/maps/map-editor-dialogs.tsx:77-80` — the close path coordinates both truths: `setAddTokenOpen(v); if (!v) placement.clear();`.
- `packages/client/src/components/campaign/maps/map-editor-dialogs.tsx:89-92` — the create-success path repeats the pair: `setAddTokenOpen(false); placement.clear();`.
- `packages/client/src/components/campaign/maps/map-detail-content.tsx:129-131` — the second opener (TokenSidebar `onAdd`) sets only the boolean; this is the manual-add path with no pending cell.
- `docs/guides/client-effects.md:22-23` — "if an effect only calls a `setState` synchronously, it is probably one of the above in disguise"; the derived-state row is at `:17`.
- `docs/guides/client-effects.md:49-58` — `local/no-effect-misuse` is a normal-lint error on client production source. The rule resolves state setters from `useState` destructuring in the analyzed file (`eslint-rules/no-effect-misuse.js:227`, `:334-335`), so a callback parameter invoked in another file is invisible to it — this effect passes lint today.

## Proposed direction

Remove the `openDialog` parameter and its `useEffect` from `usePlacementSlice`
and derive the add-token dialog's visibility in `map-detail-content.tsx` from
the manual-add boolean OR a non-null `pendingTokenCell`, keeping pending-cell
clearing in the existing close/success handlers. Concretely:

- In `map-detail-store-hooks.ts:33-43`, drop the parameter and the effect so the
  hook only reads `cell` and exposes `clear` (the `useEffect` import at `:1`
  goes with it — this is its only use in the file).
- In `map-detail-content.tsx`, rename the state at `:53` to a manual-add boolean
  (e.g. `manualAddOpen`), delete `openAddToken` (`:58-60`), and compute
  `const addTokenOpen = manualAddOpen || placement.cell !== null;` during
  render. Pass the derived value as `addTokenOpen` and a close handler as
  `setAddTokenOpen` to `MapEditorDialogs` (`:150-151`) that sets the manual
  boolean; `map-editor-dialogs.tsx:77-80` and `:89-92` already clear the
  pending cell on close/success, and after this change those `placement.clear()`
  calls are what actually closes a placement-opened dialog — they become
  load-bearing, not bookkeeping.
- TDD per the repo workflow: there is no component test covering the
  placement-opens-dialog flow today (`map-detail-view.test.tsx` never mentions
  the add-token dialog or placement) — add one beside the component asserting
  that a set pending cell shows the dialog with `initialX`/`initialY` from the
  cell (`map-editor-dialogs.tsx:83-84`) and that closing it clears the cell.

## Scope / caveats

- Out of scope: moving dialog visibility into the canvas store, redesigning the
  placement flow, or touching the place-token tool handler and store shape
  (`tool-handlers.ts:279`, `map-canvas-store.ts:359` stay as-is).
- Do not delete the `placement.clear()` calls in `map-editor-dialogs.tsx` —
  with derived visibility they are the close mechanism for placement-opened
  dialogs, and dropping one leaves the dialog stuck open.
- Minor deliberate behavior shift: the store clears `pendingTokenCell` on tool
  switch (`map-canvas-store.ts:284-296`, pinned by
  `stores/map-canvas-store.test.ts:353-368`). Today that leaves the dialog open
  with no cell (undefined `initialX`/`initialY`); with derived visibility a
  placement-opened dialog closes instead, which is the more coherent outcome.
  Keep the manual-add boolean independent so sidebar-opened dialogs are
  unaffected.
- Read `packages/client/src/components/campaign/maps/MODULE.md` first (working
  model); its `map-detail-store-hooks.ts` description at `:65-66` ("exposes
  narrow canvas-store slices") stays true — no doc update expected.
- Prior pack: the live 2026-07-25 pack's
  [10-client-effect-misuse.md](../code-quality-2026-07-25/10-client-effect-misuse.md)
  (landed 2026-07-27) removed one of the two direct set-state-in-effect
  findings; leaf 16 slice Q3 removed the other, and the completed client cluster
  promoted `local/no-effect-misuse` to a hard error. Leaf 10's C3/C4 covered
  route-identity reset and direct inline-setter effects — not this callback-hidden
  site, which survives precisely because the setter hides
  behind a callback the lint cannot follow. This leaf closes that residue; it
  does not reopen leaf 10's landed decisions.
