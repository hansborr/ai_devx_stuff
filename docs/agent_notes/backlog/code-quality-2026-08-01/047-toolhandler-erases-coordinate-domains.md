# 47. ToolHandler's runtime `coordinateSpace` flag erases the pixel/cell type distinction, forcing a no-op `onStart` and an out-of-registry eraser special case

Status: Not started
Theme: descriptor unions over runtime flags · Area: client · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The canvas-input module organizes map-tool pointer behavior around a
module-private `ToolHandler` interface, but the interface does not encode the
distinctions it exists to manage. Every handler carries a runtime
`coordinateSpace: "pixel" | "cell"` string, and every point callback takes the
same structurally identical `{ x: number; y: number }` — so whether a handler
receives local pixels or grid cells depends entirely on a string staying
aligned with the callback bodies. A drawing handler wired as `"cell"` (or a
fog handler wired as `"pixel"`) type-checks cleanly and fails only at runtime,
as shapes land at `1 / cellSizePx` of their intended scale or fog regions snap to pixel coordinates. Both
pointer helpers even return the same anonymous shape, so nothing anywhere in
the module distinguishes the two coordinate domains at the type level.

The interface also forces capabilities tools do not have. `onStart` is
mandatory, so target-pick — which has no stage-level pointer behavior at all —
ships a commented no-op member solely to satisfy the interface. And draw-eraser,
an interactive tool by every user-facing measure (crosshair cursor, stage drag
disabled), is absent from the registry entirely: `isInteractiveTool` is the
handler-map lookup *plus* a hard-coded `|| activeTool === "draw-eraser"`, so
interaction semantics live half in the registry and half in a special case a
contributor must know to maintain by hand.

The drawing handler also grants every drawing tool the freehand tool's
point-history capability. Each pointer move for line, rectangle, and circle
replaces and copies a growing `freehandPoints` array even though those builders
read only `startPoint` and `currentPoint`. Across a gesture, repeatedly copying
the full prefix produces quadratic cumulative allocation on a
pointer-frequency path and pushes an unused replacement array through the
subscribed drawing object.

Adding tools is this module's primary change vector as the VTT grows, and each
new tool re-rolls the same dice: pick the right string, pad out members you do
not need, inherit capabilities the tool may not consume, and remember whether
your tool belongs in the registry or in the special case next to it.

## Evidence

- `packages/client/src/hooks/canvas-input/tool-handlers.ts:21-34` — the
  `ToolHandler` interface: `coordinateSpace: "pixel" | "cell"` at `:25`,
  mandatory `onStart(point: { x: number; y: number }, ...)` at `:27`, and
  `onMove` at `:29` taking the identical anonymous point shape. Nothing ties
  the flag to the callback parameter types.
- `packages/client/src/hooks/canvas-input/use-canvas-input.ts:77-81` and
  `:95-98` — mouseDown and mouseMove both convert by the flag
  (`handler.coordinateSpace === "pixel" ? getPointerLocal(stage) :
  getPointerCell(stage, cellSizePx)`) and feed the undifferentiated callback;
  a pixel/cell mismatch type-checks.
- `packages/client/src/hooks/canvas-input/use-canvas-input.ts:12-22` — both
  pointer helpers return `{ x: number; y: number } | null`; the pixel and cell
  domains are structurally indistinguishable throughout the module.
- `packages/client/src/hooks/canvas-input/tool-handlers.ts:284-299` —
  `createTargetPickHandler` declares `onStart() { /* no-op */ }` at `:292-294`
  solely to satisfy the mandatory member; the comment at `:285-288` explains
  the handler exists only so ESC and right-click route through the shared
  keydown listener.
- `packages/client/src/hooks/canvas-input/use-canvas-input.ts:144` —
  `isInteractiveTool: registry.handlerMap.has(activeTool) || activeTool ===
  "draw-eraser"`; the comment block at `:25-29` documents the bypass.
- `packages/client/src/hooks/canvas-input/MODULE.md:75-77` — the gotcha
  contributors must carry: "`draw-eraser` has no handler … `isInteractiveTool`
  therefore explicitly includes it even though it is absent from the handler
  map."
- `packages/client/src/components/campaign/maps/map-canvas.tsx:70,118-119` —
  where eraser interaction actually lives: a Konva `onClick` handler and a
  `Layer listening={s.activeTool === "draw-eraser"}` around `DrawingOverlay`.
- `packages/client/src/stores/map-canvas-store.ts:74,157-177` — the store
  already types every cell-consuming action on a named `GridCell`; the typed
  domain exists downstream but the dispatch seam erases it.
- `packages/client/src/hooks/canvas-input/tool-handlers.ts:207-225` — one
  drawing handler sends pointer moves for `draw-freehand`, `draw-line`,
  `draw-rect`, and `draw-circle` through the same `updateDrawing` action.
- `packages/client/src/stores/map-canvas-store.ts:428-457` — `startDrawing`
  initializes `freehandPoints` for every drawing tool, and every
  `updateDrawing` replaces that array with a copied prefix plus the new point.
- `packages/client/src/hooks/canvas-input/tool-handlers.ts:50-87` — only the
  freehand builder reads `freehandPoints`; line, rectangle, and circle build
  solely from `startPoint` and `currentPoint`.
- `packages/client/src/components/campaign/maps/use-map-canvas-handlers.ts:60-73`
  — the map-canvas store slice subscribes to the complete `drawing` object, so
  each replaced history array is part of the selected value delivered on
  pointer moves.
- `packages/client/src/stores/map-canvas-store.test.ts:275-305` — current store
  tests encode unconditional history accumulation in `startDrawing` and
  `updateDrawing`, while the hook-level shape tests distinguish the four tools
  at `packages/client/src/hooks/canvas-input/use-canvas-input-drawing-template.test.ts:17-145`.

## Proposed direction

Replace the module-private `ToolHandler` interface in
`packages/client/src/hooks/canvas-input/tool-handlers.ts` with a discriminated
descriptor union of four kinds:

- **`"pixel"`** (the four drawing tools) and **`"cell"`** (measure, fog,
  template, place-token): both carry `onStart` plus optional
  `onMove`/`onFinalize`/`onCancel`, but their callbacks receive structurally
  distinct wrappers — e.g. `{ pixel: { x, y } }` versus
  `{ cell: GridCell }`. Handler bodies unwrap the matching member when calling
  existing store actions, so swapping a handler's descriptor kind makes its
  callback body fail to compile without changing the store shape.
- **`"cancel-only"`** (target-pick): a required `onCancel` and no pointer
  members at all, which deletes the no-op `onStart` at `tool-handlers.ts:292-294`.
- **`"overlay-managed"`** (draw-eraser): no callbacks at all — it exists so the
  tool registers in the `handlerMap` and `isInteractiveTool` becomes just
  `registry.handlerMap.has(activeTool)`, removing the
  `|| activeTool === "draw-eraser"` special case at `use-canvas-input.ts:144`.

Within the pixel drawing variant, make history recording a bounded,
tool-specific capability. Split the drawing store actions into named
current-only and freehand paths: geometric start/move actions set only
`startPoint`/`currentPoint`, while freehand start/move actions also seed or
append `freehandPoints`. The handler chooses the freehand path only when its
tool argument is `draw-freehand`; `draw-line`, `draw-rect`, and `draw-circle`
use the current-only path. Keep the state shape and all four builders
unchanged.

Dispatch in `use-canvas-input.ts` switches exhaustively on the discriminant:
the pixel arm wraps `getPointerLocal` as `{ pixel }`, the cell arm wraps
`getPointerCell` as `{ cell }`, and cancel-only/overlay variants receive no
pointer calls. The wrapper member accessed by each handler body then enforces
the coordinate pairing, while the exhaustive switch enforces handling of every
descriptor kind. Right-click and ESC cancel paths keep calling `onCancel` on
variants that declare it.

Update `MODULE.md` in the same leaf — the doc contradiction is by
construction, so the refresh is in scope, and both the Gotchas and Test Seams
sections mention the current shape. The "`draw-eraser` has no handler" gotcha
(`MODULE.md:75-77`) becomes "`draw-eraser` is an overlay-managed descriptor;
its shape removal still happens via Konva `onClick` hit detection in
`map-canvas.tsx`/`DrawingOverlay`."

Tests go through `useCanvasInput` per the module's test-seam rule
(`MODULE.md:68-71`). Add one assertion that draw-eraser now derives
`isInteractiveTool` from the registry, and that cancel-only/overlay variants
never receive pointer calls; `use-canvas-input.test.ts:44-61` already asserts
`isInteractiveTool` is true for draw-eraser and target-pick, and must stay
green through the change. Extend the drawing lifecycle coverage so repeated
moves grow `freehandPoints` for `draw-freehand` but leave it empty for line,
rectangle, and circle, while their existing finalized shapes remain unchanged.
Update the focused store tests to cover both named action paths.

Branded/nominal point types remain unnecessary. Structurally distinct
`{ pixel: ... }` / `{ cell: ... }` wrappers provide the required compiler
separation without casts or `type-assertion-boundary` markers, while the
exhaustive descriptor switch centralizes conversion and capability dispatch.

## Scope / caveats

- **Out of scope:** branded/nominal point types (see above); moving eraser
  hit-detection out of `map-canvas.tsx`; any broader change to
  `map-canvas-store` shape or actions; and the `SHAPE_BUILDERS` partial record
  (`tool-handlers.ts:47-89`), which stays inside the drawing variant. The only
  store-action change in scope is the bounded current-only/freehand split
  needed to stop geometric tools recording history.
- **Dispatch-ordering regressions are the main hazard.** Right-click cancel,
  ESC keydown, and the finalize read-build-clear ordering documented in
  `MODULE.md:80-81` must survive the restructure. The existing
  `use-canvas-input*.test.ts` files exercise all of it through the hook and must
  stay green unmodified, except where they assert the eraser special case or
  unconditional drawing history.
- **Registering draw-eraser as overlay-managed can silently change
  `isToolCapturing`/stage-draggable or cursor semantics** if the variant leaks
  into pointer dispatch or is omitted from `isInteractiveTool`. The variant
  must carry no callbacks so pointer dispatch cannot reach it.
- **Hold the union to the four kinds.** The freehand/current-only distinction
  belongs inside the pixel drawing handler and its narrowly split store
  actions; do not add more top-level descriptor kinds.
- **Prior pack:** [`11-canvas-tool-typing.md`](../code-quality-2026-07-25/11-canvas-tool-typing.md)
  (landed 2026-07-26) narrowed the `MapTool` union at this module's seams and
  kept the eraser gotcha true, but did not rule on coordinate-domain typing or
  capability-shaped descriptors. Its `SelectableMapTool = Exclude<MapTool,
  "target-pick">` narrowing (`map-canvas-store.ts:49`) is complementary — do
  not disturb it or `templateShapeForTool` (`map-canvas-store.ts:66`).
- `CQ25-188` in
  [`code-quality-2026-07-25/CLIENT-CLUSTER-PLAN.md`](../code-quality-2026-07-25/CLIENT-CLUSTER-PLAN.md)
  declined broad store decomposition and the `fireAfterCommit` reshape. This
  leaf's per-tool point-history split does not reopen either decision.
- **Same-file sequencing:** [105-client-source-comments-preserve-three.md](./105-client-source-comments-preserve-three.md)
  also edits the current `ToolHandler.onFinalize` comment, which this descriptor
  restructure removes. Land 105 first, or skip that comment-only step if this
  leaf has already landed. Within this leaf, land the point-history split with
  or after the descriptor restructure, not as a concurrent edit to
  `tool-handlers.ts`; preserve coordinate typing and finalize/cancel ordering
  across both steps.
