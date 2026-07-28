# 11. Canvas tool dispatch widens the closed `MapTool` union to `string`, then casts back — and the JSDoc admits it

Status: Done — landed 2026-07-26 (`1f750dc5`, `b1f337cd`, `a716407d`, `3b091e28`); see [`00-index.md`](./00-index.md#landed)
Theme: Types thrown away at a module seam · Area: client · Severity: low · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`MapTool` is a genuinely closed 17-member union, exported from the map-canvas store and
used correctly by the caller: `use-canvas-input.ts` reads a properly typed
`activeTool: MapTool` out of the store before dispatching. It then hands that value into
`tool-handlers.ts`, which types every tool parameter as bare `string` — the registry key,
the handler's `tools` set, the `onStart`/`onMove` arguments, and the shape-builder table.
The union is thrown away at the seam and immediately re-derived downstream by string
surgery: `extractShape` slices the `"template-"` prefix off and needs a
`type-assertion-boundary: interop` marker to get back to `TemplateShape`, i.e. the file
pays a documented escape hatch to recover information it was handed for free one call
earlier.

The tell is that the code documents its own gap. The JSDoc directly above the widest
declaration reads "Which MapTool values this handler responds to" while the type on the
next line is `ReadonlySet<string>`. Nothing enforces that a `tools: new Set([...])` literal
contains real tool ids, that a handler covers a tool the toolbar can actually select, or
that `SHAPE_BUILDERS` keys are drawing tools — a typo in any of the six set literals
compiles and silently produces a tool that does nothing.

The same seam repeats on the render side. `map-canvas.tsx` passes the store's typed
`activeTool` into `map-canvas-overlays.tsx`, which re-declares it as `string` three times,
hand-rolls an `isTemplateShape` type guard, and re-derives the shape with the same
`"template-"` prefix slice; `drawing-overlay.tsx` widens it a fourth time. So the
`tool id -> template shape` mapping exists twice, in two different shapes (cast vs. runtime
guard), and neither copy is checked against the tool union.

The handler file also carries a small vocabulary problem that is cheapest to fix in the same
pass: the shape-builder table calls its `DrawingToolState` parameter `d` while its only
caller spells the identical value `drawing`; `extractShape` returns a `TemplateShape` from a
file that also owns `DrawingShape`, fourteen lines below `buildShape`, so the two names read
as a pair when they are not; `computeAndSet` names a sequencing detail rather than what it
does (compute template cells and write them to the store); and the fog finalize path binds
`s`/`e` immediately above four `Math.min`/`Math.max` lines. All four symbols are
module-private, so renaming them is contained.

## Evidence

- `packages/client/src/hooks/canvas-input/tool-handlers.ts:16-17` — JSDoc `/** Which MapTool values this handler responds to. */` sitting directly above `tools: ReadonlySet<string>`.
- `packages/client/src/hooks/canvas-input/tool-handlers.ts:21` and `:23` — `onStart(point, tool: string)`, `onMove?(point, tool: string)`.
- `packages/client/src/hooks/canvas-input/tool-handlers.ts:36-39` — `SHAPE_BUILDERS: Record<string, (base: ShapeBase, d: DrawingToolState) => DrawingShape | null>`; entries read `d.startPoint` / `d.currentPoint` / `d.freehandPoints`.
- `packages/client/src/hooks/canvas-input/tool-handlers.ts:81` — `function buildShape(activeTool: string, drawing: DrawingToolState)`, the sole caller, spelling the same value `drawing`.
- `packages/client/src/hooks/canvas-input/tool-handlers.ts:95-99` — `extractShape(tool: string): TemplateShape | null`, slicing `"template-"` and carrying the `// type-assertion-boundary: interop` marker at `:97` to recover the literal union.
- `packages/client/src/hooks/canvas-input/tool-handlers.ts:105` and `:115` — `interface ComputeAndSetInput` / `function computeAndSet(input): void`, which ends in `useMapCanvasStore.getState().setPlacedCells(cells)`; called only from the template handler at `:247` and `:256`.
- `packages/client/src/hooks/canvas-input/tool-handlers.ts:143` and `:307` — `handlerMap: Map<string, ToolHandler>` in `ToolHandlerRegistry`, and `new Map<string, ToolHandler>()` in the registry builder.
- `packages/client/src/hooks/canvas-input/tool-handlers.ts:186-187` — `const s = fogDraw.startCell;` / `const e = fogDraw.endCell;` above four min/max lines.
- `packages/client/src/components/campaign/maps/map-canvas-overlays.tsx:34`, `:124`, `:146` — `readonly activeTool: string` on `OverlayState`, `DrawingPreviewBody`, and `TemplateOverlayBody`, all fed the store-typed value from `map-canvas.tsx:151`.
- `packages/client/src/components/campaign/maps/map-canvas-overlays.tsx:41-42` and `:150-153` — a hand-rolled `function isTemplateShape(shape: string): shape is TemplateShape` over `TEMPLATE_SHAPES`, plus a second `activeTool.startsWith("template-") ? activeTool.slice("template-".length) : null` derivation guarded by it: the same mapping as `extractShape`, written a different way.
- `packages/client/src/components/campaign/maps/drawing-overlay.tsx:148` — `readonly activeTool: string` on `DrawingPreviewProps`, compared against the four `draw-*` literals at `:166`, `:181`, `:194`, `:214`.
- `packages/client/src/stores/map-canvas-store.ts:17-34` — the `MapTool` union (17 members); `:42` — `SelectableMapTool = Exclude<MapTool, "target-pick">`; `:620` — both exported.
- `packages/client/src/hooks/canvas-input/use-canvas-input.ts:65-66`, `:81`, `:89-90`, `:100`, `:109` — the handler-side consumer, already holding a typed `activeTool: MapTool` before feeding it into the stringly-typed map.
- All six `tools: new Set([...])` literals (`:149`, `:173`, `:205`, `:234`, `:272`, `:286`) contain only members of the union, so the narrowing type-checks as-is.

## Proposed direction

1. Import `MapTool` into `tool-handlers.ts`, which today imports only `DrawingToolState` /
   `useMapCanvasStore` from `stores/map-canvas-store.js`. Narrow `ToolHandler.tools` to
   `ReadonlySet<MapTool>` and `onStart` / `onMove`'s `tool` to `MapTool` (`:17`, `:21`,
   `:23`). No literal changes needed.
2. Narrow the registry: `ToolHandlerRegistry.handlerMap` to `Map<MapTool, ToolHandler>`
   (`:143`) and the constructor at `:307` to match.
3. Type `SHAPE_BUILDERS` as `Partial<Record<MapTool, ...>>` **or** as a `Record` over an
   explicitly spelled four-member alias
   (`"draw-freehand" | "draw-line" | "draw-rect" | "draw-circle"`) — never a mechanically
   derived ``Extract<MapTool, `draw-${string}`>``, which has five members: `draw-eraser` is
   deliberately handler-less (`canvas-input/MODULE.md:75-77`: "`draw-eraser` has no handler
   because it uses Konva `onClick` hit detection on drawing overlay shapes"), so a total
   `Record` over the derived alias does not compile and invites a bogus
   `"draw-eraser": () => null` entry. Narrow `buildShape(activeTool: MapTool, ...)` (`:81`).
   Under `noUncheckedIndexedAccess` the existing `if (!builder) return null;` guard already
   handles the lookup, so this is a signature change only.
4. Add a `TemplateTool -> TemplateShape` lookup record keyed on the five `template-*` ids and
   make it the single home for that mapping. Put it next to `MapTool` in
   `stores/map-canvas-store.ts` (it gains a `TemplateShape` type import from
   `@musi/shared/map/area-template.js`) so both the handler and the overlay can use it.
   Replace `extractShape` (`:95-99`) with a lookup against that record: this deletes the
   `type-assertion-boundary` marker at `:97` outright rather than relocating it — the point
   of the change.
5. Narrow the overlay side onto the same record: `activeTool` becomes `MapTool` at
   `map-canvas-overlays.tsx:34`, `:124`, `:146` (adds a store import to that file) and at
   `drawing-overlay.tsx:148`; `isTemplateShape` (`:41-42`) and the prefix slice at
   `:150-153` are deleted in favour of a record lookup, which drops the file's
   `TEMPLATE_SHAPES` / `TemplateShape` import at `:1` (nothing else there uses either).
   Landing steps 1-4 without this leaves half the pattern in place.
6. Rename in `tool-handlers.ts`, all module-private: `SHAPE_BUILDERS`' `d` → `drawing`
   (matching `buildShape`); `computeAndSet` / `ComputeAndSetInput` → a name stating that it
   computes template cells and writes them to the store; `s`/`e` at `:186-187` →
   `startCell`/`endCell`.

Steps 1-3 are type-only. Steps 4-5 swap a prefix slice for a record lookup on both sides;
the record must cover exactly the five `template-*` ids so every input keeps its current
result — there is no intended behaviour change. Step 6 is a mechanical rename that can ride
along or land last. One commit per step.

## Scope / caveats

- Do **not** widen `SHAPE_BUILDERS` to a total `Record<MapTool, ...>` to make the types line
  up — it would force sixteen `null` entries for tools that have no shape. `Partial` or the
  explicit four-member drawing alias is the correct shape, and `draw-eraser` stays out of the
  builder table.
- `SelectableMapTool` at `map-canvas-store.ts:42` exists for a documented reason (the JSDoc
  above it explains that `target-pick` must be entered through `activateTargetPick` so the
  `filter`/`onPick`/`onCancel` triple is captured). The handler registry legitimately
  handles `target-pick`, so key the handler types on `MapTool`, not `SelectableMapTool`, and
  leave that distinction alone.
- This leaf claims no behaviour change. If any step forces a runtime edit to make types
  pass, stop — that means a tool id is out of sync somewhere and it is a separate finding.
- Ratcheted lint: `local/type-assertion-boundary` reports only casts *without* a valid
  marker, so the marked cast at `:97-98` contributes nothing to
  `ratchet/local-type-assertion-boundary` today — there is nothing to update in
  `lint-ratchet.baseline.json` (its `items` map for that test is empty) and the suppression
  ledger does not track these markers at all (it scans `eslint-disable` / `@ts-expect-error` /
  `stryker-disable` dialects only). Delete the cast and its marker together, as step 4
  specifies: that ratchet's scope includes `packages/**/*.{ts,tsx}` under `mode: "no-new"`
  with an empty per-file floor, so dropping the marker while leaving the cast in place is a
  brand-new message and fails the gate outright — no baseline edit can legitimately absorb
  it. Re-read `docs/guides/local-eslint-rules.md#type-assertion-boundary-marker` before
  touching the marker.
- `canvas-input/MODULE.md` documents behaviour, not signatures — no `string` types appear in
  it — so these steps need no doc edit; just keep its `draw-eraser` gotcha true.
- Leaf 12 also edits `map-canvas-overlays.tsx`, but only its `isDm` prop; the two touch
  disjoint props and can land in either order.
