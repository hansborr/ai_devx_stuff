# 09. map-canvas-store is split by line count, not by concept — so its reset field set drifts and its leftovers pile into createViewActions

Status: **Done 2026-07-27** in
[CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md) slice **C2**, merge
`6cf8c78d5`; see [Landed](./00-index.md#landed). Steps 1-2 landed. **Steps 3
and 4 are dropped permanently**: do not reshape `fireAfterCommit`, and if the
store is ever split, split it by lifetime rather than tool family.
Theme: VTT map canvas store structure · Area: client · Severity: medium · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`packages/client/src/stores/map-canvas-store.ts` is 620 lines holding eight state
slices (view transform, selection, measurement, fog draw, drawing, template,
pending token placement, target pick). Its internal seams are not conceptual —
the section header at `:275` says so out loud: "Action creators (split to stay
under max-lines-per-function)". Because the cut was made to satisfy a lint rule
rather than to name a responsibility, the file has two concrete defects.

**The reset field set has already drifted once and can drift again.**
`buildToolReset` exists specifically to prevent that: its JSDoc says it is
"Shared by `setActiveTool` and `cancelCast` so the field set can never drift
between them (silent drift is exactly what regressed cancelCast)." But two other
actions hand-roll the same field set inline instead of calling it.
`resetTransient` writes all eight fields with identical values and identical
preservation logic — it is exactly
`{ ...buildToolReset(s, "select"), stagePosition: { x: 0, y: 0 }, stageScale: 1 }`.
`activateTargetPick` writes the same eight-field reset byte for byte, differing
only in `activeTool: "target-pick"` and the `targetPick` session payload it
layers on top. So there are four sites that must agree and only two of them are
linked. An eight-line comment above `resetTransient`'s inline object is doing
explanatory work that the call would do for free.

**`createViewActions` is the leftovers bucket.** Its four siblings —
`createMeasureFogActions`, `createDrawingActions`, `createTemplateActions`,
`createTargetPickActions` — each own exactly their named slice. `createViewActions`
owns the view transform *plus* `selectToken`, `setActiveTool`, `toggleGrid`,
`setCellSizePx` and `setPendingTokenCell`. `setActiveTool` is the most
behaviourally loaded action in the file (it fires the target-pick `onCancel`
through `fireAfterCommit`), and it is filed under "view".

Compounding both: `fireAfterCommit` needs a 19-line JSDoc to justify a mutable
single-key holder object passed as an out-param, and five call sites reach into
`holder.fire = …` inside their updater. The *helper* is deliberate and documented;
what leaks is the out-param mutation at each call site.

## Evidence

- `packages/client/src/stores/map-canvas-store.ts` is exactly 620 lines. `interface MapCanvasState` at `:105-118` mixes `stagePosition`/`stageScale`, `selectedTokenId`, `activeTool`, `gridVisible`, `cellSizePx`, `measurement`, `fogDraw`, `drawing`, `template`, `pendingTokenCell`, `targetPick`.
- `:275` — section header: "Action creators (split to stay under max-lines-per-function)".
- `:249-256` — `buildToolReset`'s JSDoc, including "Shared by `setActiveTool` and `cancelCast` so the field set can never drift between them (silent drift is exactly what regressed cancelCast)."
- `:257-272` — `buildToolReset` returns exactly eight fields: `activeTool`, `selectedTokenId`, `pendingTokenCell`, `measurement` (`EMPTY_MEASUREMENT`), `fogDraw` (`EMPTY_FOG_DRAW`), `drawing` (`EMPTY_DRAWING` with `strokeColor`/`strokeWidth` preserved), `template` (`EMPTY_TEMPLATE` with `sizeFt` preserved), `targetPick` (`EMPTY_TARGET_PICK`).
- `:295-324` — `resetTransient` inlines all eight with identical values and identical preservation logic, plus `stagePosition` and `stageScale`; the object literal is `:305-320`. `:296-303` is the eight-line comment; only its first sentence (no target-pick `onCancel` fires because the user navigated away) is non-recoverable.
- `:516-546` — `activateTargetPick` inlines the same reset again. The returned object at `:524-544` sets `selectedTokenId: null` (`:526`), `pendingTokenCell: null` (`:527`), `measurement: EMPTY_MEASUREMENT` (`:528`), `fogDraw: EMPTY_FOG_DRAW` (`:529`), `drawing` with `strokeColor`/`strokeWidth` preserved (`:530-534`) and `template` with `sizeFt` preserved (`:535`) — the same preservation logic as `buildToolReset` — differing only in `activeTool: "target-pick"` (`:525`) and the `targetPick` payload (`:536-543`).
- `:334` and `:592` — the only two callers of `buildToolReset` (`setActiveTool`, `cancelCast`). `resetTransient` (`:295-324`) and `activateTargetPick` (`:524-544`) are the third and fourth, unlinked sites; the comment at `:330-332` inside `setActiveTool` already records the bypass ("activateTargetPick bypasses this path by setting state directly").
- `"target-pick"` is a member of `MapTool` (`:34`); only `SelectableMapTool` (`:42`) excludes it, so `buildToolReset(s, "target-pick")` type-checks.
- `:278` `createViewActions` owns `setStagePosition`, `setStageScale`, `zoomIn`, `zoomOut`, `resetView`, `resetTransient` **plus** `:325` `selectToken`, `:328` `setActiveTool`, `:337` `toggleGrid`, `:340` `setCellSizePx`, `:343` `setPendingTokenCell`.
- `:349` `createMeasureFogActions`, `:405` `createDrawingActions`, `:467` `createTemplateActions`, `:514` `createTargetPickActions` each own exactly their named slice; all five are spread at `:606-610`.
- `:216-234` — `fireAfterCommit`'s 19-line JSDoc; `:235-247` the function. `:244` allocates `const holder: { fire: ((...args: Args) => void) | null } = { fire: null }` purely so the post-`set` call at `:246` is not narrowed to dead code — the JSDoc states this explicitly and states that a generic `T | null` return would re-introduce the exact narrowing the holder defeats.
- Five call sites mutate the out-param: `:333`, `:522`, `:561`, `:573`, `:591` (all `holder.fire = …`). Two of them no-op by returning the whole state first: `:560` (`if (!s.targetPick.active || !s.targetPick.filter?.(tokenId)) return s;`) and `:572` (`if (!s.targetPick.active) return s;`).
- Domain action families are similar in *shape* but not interchangeable: `measurement` (`:351-378`) and `fogDraw` (`:379-401`) share a `{ startCell, endCell, isDragging }` shape; `drawing` (`:405-465`) carries `startPoint`/`currentPoint`/`freehandPoints` and a clear that preserves `strokeColor`/`strokeWidth`; `template` (`:467-511`) carries `originCell`/`directionCell`/`placedCells`/`sizeFt` plus an extra `setPlacedCells` (`:508-510`).
- `packages/client/src/stores/MODULE.md:112-118` (Gotchas): "`map-canvas-store.ts` is the densest non-generated client source file. Keep actions grouped through the `create*Actions(set)` creators (split to stay under the max-lines-per-function lint), and keep the target-pick fire-after-commit idiom …".
- `eslint.config.js:50-53` — `max-lines-per-function` is `{ max: 100, skipBlankLines: true, skipComments: true }`, backed by the `ratchet/max-lines-per-function-production` ratchet (`scripts/lint-ratchet/lint-ratchet-config.ts:200-201`).

## Proposed direction

1. **Link the two unlinked reset sites (do this first — it is the whole risk
   story).**

   a. Replace the inline object in `resetTransient` (`:305-320`) with
   `{ ...buildToolReset(s, "select"), stagePosition: { x: 0, y: 0 }, stageScale: 1 }`.
   Trim the comment at `:296-303` to its first sentence — the "no target-pick
   `onCancel` fires; the user navigated away" rationale — and drop the rest,
   which the `buildToolReset` call now states.

   b. Replace `activateTargetPick`'s inline object (`:524-544`) with
   `{ ...buildToolReset(s, "target-pick"), targetPick: { active: true, filter: opts.filter, onPick: opts.onPick, onCancel: opts.onCancel, hoveredTokenId: null, previousTool } }`.
   Keep the `previousTool` computation at `:523` and the comment at `:518-521`
   as they are. The explicit `targetPick` key overrides the spread's
   `targetPick: EMPTY_TARGET_PICK`.

   c. Update `buildToolReset`'s JSDoc at `:249-256`. It currently says the reset
   target is "always `select` for the cast-unwind paths" and that the helper is
   "Shared by `setActiveTool` and `cancelCast` so the field set can never drift
   between them" — both go stale once four actions call it. Rewrite it to name
   all four callers, keep the "(silent drift is exactly what regressed
   cancelCast)" regression fact verbatim, and note that `activateTargetPick`
   overrides the returned `targetPick`, so `EMPTY_TARGET_PICK` is not the value
   that lands there.

   d. Extend `map-canvas-store.test.ts` to assert that all four entry points —
   `setActiveTool`, `cancelCast`, `resetTransient`, `activateTargetPick` — clear
   the same transient field set and preserve the same prefs (`strokeColor`,
   `strokeWidth`, `sizeFt`), with `activateTargetPick`'s `targetPick` asserted as
   the live session rather than `EMPTY_TARGET_PICK`. The suite already exercises
   these actions (`:327`, `:339`, `:384`, `:453`), so this extends existing
   coverage rather than adding a harness. Write it before the refactor.

2. **Re-split the action creators by concept and rename.** Leave the view
   transform (`setStagePosition`, `setStageScale`, `zoomIn`, `zoomOut`,
   `resetView`, `resetTransient`) in `createViewActions`, and move `selectToken`,
   `setActiveTool`, `toggleGrid`, `setCellSizePx`, `setPendingTokenCell` into a
   creator named for what they are (e.g. `createToolAndSelectionActions`). Spread
   the new creator at `:606-610`. Pure re-grouping: no action body changes.

   The `create*Actions` seam itself must stay — every creator still has to fit
   under `max-lines-per-function` (100 lines, blanks and comments skipped), and
   `packages/client/src/stores/MODULE.md:112-118` mandates the grouping. What
   changes is that the boundaries stop being arbitrary. So:

   a. Rewrite the `:275` header to name conceptual ownership as the primary
   organizing principle while stating that each creator also stays under
   `max-lines-per-function`.

   b. Update `MODULE.md:112-118` in the same commit to match: creators are named
   for the slice they own, and the line-count ceiling is a bound each one must
   respect, not the reason the seams fall where they do. Leaving that Gotcha as
   written would send the next reader back to line-count grouping.

3. **Put the fire-after-commit contract in the type instead of an out-param.**
   Change `fireAfterCommit`'s `update` callback to return
   `{ patch: Partial<MapCanvasStore>; onCommit?: (...args: Args) => void }`
   rather than mutating `holder.fire`. The holder + narrowing workaround stays,
   confined to `fireAfterCommit` itself; the five call sites (`:333`, `:522`,
   `:561`, `:573`, `:591`) stop reading as out-param assignments. Rewrite the
   JSDoc at `:216-234` to describe the new shape, keeping the paragraph that
   explains why the holder exists.

   The one non-mechanical part: two updaters currently no-op by returning the
   whole state (`:560` in `confirmTargetPick`, `:572` in `cancelTargetPick`).
   Under the new shape they need an explicit no-op form — `return { patch: {} }`,
   or `{ patch: s }` to keep the identity write. The other three updaters
   (`:333`, `:522`, `:591`) return unconditionally. Confirm with the existing
   `confirmTargetPick`/`cancelTargetPick` guard tests in
   `map-canvas-store.test.ts` that the no-op path still fires no callback.

4. **Optional, after 1-3: split the file.** If it still reads as too much, move
   the per-domain creators into sibling modules (`map-canvas-measure.ts`,
   `map-canvas-drawing.ts`, `map-canvas-template.ts`, `map-canvas-target-pick.ts`)
   that the store composes, keeping one store and one `MapCanvasState`. This is
   a file split only — do not split the store itself.

## Scope / caveats

- **Do not build a generic `dragSession` factory.** Only `measurement`
  (`:351-378`) and `fogDraw` (`:379-401`) are near-identical. `drawing` and
  `template` share the *shape* (start sets `isDragging`, update guards on it,
  finalize clears it, clear resets while preserving prefs) but not the bytes, and
  carry different payloads plus an extra action. A generic factory would need
  per-domain start/update payload callbacks and is not an obvious win — it would
  trade five readable families for one parameterised abstraction that is harder
  to follow.
- **`fireAfterCommit`'s JSDoc is load-bearing; do not delete it and do not
  "simplify" the helper away.** The single-key holder object exists because
  TypeScript's control-flow analysis narrows a `let fire = null` to `null` across
  the `set` closure boundary, which would make the post-commit `fire?.(...)` a
  dead-code error; the object wrapper defeats that without an `as`-cast. Step 3
  is specifically *not* what that JSDoc warns against — the warning is against
  `fireAfterCommit` **returning** `T | null`, which would re-introduce the
  narrowing. Returning `{ patch, onCommit }` from the *updater* keeps the
  workaround inside the helper. If that distinction is not clear to the
  implementer, skip step 3 and land 1, 2 and 4 only.
- **Target-pick cancel/pick ordering is exactly the code that regressed before.**
  The fire-after-commit ordering (callback observes the already-committed store:
  `activeTool` restored, `targetPick.active` already `false`) is the contract, not
  an implementation detail. Any change to steps 1 or 3 must keep
  `activateTargetPick`'s bypass of the tool-switch cancel path intact (documented
  in the comment at `:330-332`) — routing its field set through `buildToolReset`
  changes where the values come from, not whether `setActiveTool`'s `onCancel`
  path runs — and must keep `cancelCast`'s reset going through `buildToolReset`.
- Preserve verbatim: the "(silent drift is exactly what regressed cancelCast)"
  clause inside `buildToolReset`'s JSDoc, the first sentence of the
  `resetTransient` comment, and the tool-switch/`onCancel` comment above
  `setActiveTool`. These record regression history that the code alone does not
  express; step 1c rewrites the surrounding caller list, not these.
- `resetTransient` deliberately subsumes `resetView` (it resets pan/zoom too) so
  identity-change effects do not need to call both. Keep that property when
  step 1a rewrites it — the spread must still include `stagePosition`/`stageScale`.
- Effort split is uneven: step 1 is trivial and low risk, step 2 is small and
  low risk, step 3 is small but **medium risk**, step 4 is optional. Land step 1
  on its own even if the rest is deferred.
- Client store/effect conventions: `docs/guides/client-effects.md` (this store is
  read from identity-change effects) and
  `docs/guides/add-client-feature-module-cache-socket.md`. Beyond the MODULE.md
  edit that step 2b carries, refresh `packages/client/src/stores/MODULE.md` again
  if step 4 lands: its Gotchas entry (`:112-118`) and store inventory (`:41`)
  both describe creator ownership and the exported surface, so a file split
  invalidates them even when no export changes. See
  `docs/guides/add-module-doc.md`. Regression net is
  `packages/client/src/stores/map-canvas-store.test.ts`; follow TDD.
- Leaves 10 and 11 also edit `stores/map-canvas-store.ts`. Land this leaf's
  step 1 before leaf 10 — leaf 10 cites `resetTransient` at `:295-324` and its
  step 5 adds an `enterSurface(id)` action plus a state field that must slot into
  whatever creator step 2 leaves behind. Leaf 11 touches only the `MapTool` union
  and the export line, so it is region-disjoint and can land in any order. No
  sequencing dependency on leaves 07 or 08.
