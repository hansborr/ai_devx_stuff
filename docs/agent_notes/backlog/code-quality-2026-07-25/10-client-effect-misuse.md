# 10. Effects are the glue holding VTT store state to route identity, so each map/encounter switch commits one stale frame

Status: **Done 2026-07-27** in
[CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md) slices **C3 and C4**, merge
`6cf8c78d5`; see [Landed](./00-index.md#landed). Steps 1-3 landed and step 4
landed as layout-effect timing without the false no-stale-frame proof. **Steps
5 and 6 are dropped permanently.** Review reproduced and fixed a reset-versus-
selection-sync ordering regression; the store re-read now documented inside
`useSelectionSync` is load-bearing.
Theme: Client effect-as-glue · Area: client · Severity: medium · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

The VTT surfaces keep their transient state (pan/zoom, selection, drawing draft, drawer,
combat panel) in module-scoped Zustand singletons created once per module load. Because
those stores outlive every component that reads them, "the map I am looking at changed"
has to be pushed into them by hand — and today that push is a `useEffect` keyed on the
new identity. Effects run after commit, so on every map or encounter switch the children
commit once against the *previous* surface's pan, zoom and selected token before the reset
lands. Whether the browser paints that commit depends on scheduling, so treat it as a
committed stale frame rather than a proven visible flash; the reset is unconditionally
one commit late either way.

The reset itself is reproduced in three places with three different store sets. Adding a
new *field* to the canvas store is a single edit — `resetTransient`
(`map-canvas-store.ts:295-324`) owns the projection and `stores/MODULE.md:83-84` tells you
to classify each new slice as transient or preserved. What is hand-maintained is which
*stores* each surface clears: `stores/MODULE.md:65-66` states the boundary is "enforced by
hand at the call site, not by the stores themselves". Two of the three sites are pinned by
component tests; the encounter-only site is not, so a fourth store — or a new store that
needs surface-scoped clearing — is three separate edits with coverage for two of them.

The same "effect as glue" habit shows up twice more in the same neighbourhood. In
`combat-map-bridges.ts` an effect mirrors `combat-store.selectedParticipantId` into
`map-canvas-store.selectToken`, with an `isSyncingRef` re-entrancy guard and a
`queueMicrotask` release — but the guard is dead: the only caller of the guarded reverse
path is a user context-menu handler, and no DOM event can be dispatched inside a
synchronous-set/microtask-clear window. It is complexity defending against a loop that no
longer exists. And in the character sheet, two hand-rolled inline-edit hooks duplicate the
same `isEditing`/`localValue`/`isCommitting`/`isCancelling` protocol, one of which
(`dm-editable-score.tsx`) resynchronises local state from a prop inside an effect — the
textbook adjust-state-in-an-effect anti-pattern, and one of only two entries currently
holding the `ratchet/local-no-effect-misuse-client` baseline open.

The underlying cause is shared: state that logically belongs to a *surface instance* is
stored globally (or duplicated locally), and effects are used to reconcile it after the
fact instead of deriving it or resetting it at the transition.

## Evidence

- `packages/client/src/components/campaign/encounters/encounter-detail-view.tsx:228-230` — `useEffect(() => { useCombatStore.getState().reset(); }, [encounterId])`.
- `packages/client/src/components/campaign/maps/map-detail-content.tsx:73-76` — effect calling `resetTransient()` + `resetDrawer()`, deps `[map.id, resetTransient, resetDrawer]`.
- `packages/client/src/components/campaign/combat/combat-map-content.tsx:86-90` — the same effect plus `resetCombat()`, deps `[map.id, encounter.id, ...]`. Three call sites, three different store sets.
- `packages/client/src/stores/MODULE.md:63-84` — the documented reset contract: the per-surface boundary is "enforced by hand at the call site, not by the stores themselves", and the canvas paths deliberately use `resetTransient` rather than full `reset`.
- `packages/client/src/stores/map-canvas-store.ts:295-324` — `resetTransient` deliberately preserves persistent preferences (`gridVisible`, `cellSizePx`, stroke colour/width, template `sizeFt`); any "what should a fresh surface read" fallback is this projection, not `INITIAL_STATE`. Its semantics are pinned by `packages/client/src/stores/map-canvas-store.test.ts:321-395`.
- `packages/client/src/components/campaign/maps/map-detail-view.test.tsx:128-146` and `packages/client/src/components/campaign/combat/combat-map-panel.test.tsx:106-144` — spy on `resetTransient`/`resetDrawer`/`resetCombat` and assert the set fires again on identity change. `packages/client/src/components/campaign/encounters/encounter-detail-view.test.tsx` has no equivalent: its only use of the combat store is a `reset()` in `beforeEach` (`:23`), so nothing fails if that call site's reset is dropped or falls out of step.
- `packages/client/src/components/campaign/combat/combat-map-bridges.ts:12-41` — `useSelectionSync`: `isSyncingRef` (:16), the participant→token effect (:18-28) with `queueMicrotask` release (:24-26), guarded reverse path `syncTokenToParticipant` (:30-38).
- `packages/client/src/components/campaign/combat/combat-map-content.tsx:101` — the only caller of `syncTokenToParticipant` anywhere, inside `handleContextMenu`, a user-event handler. `combat-map-bridges.ts` has no spec, so nothing calls it from a test either — which is why the dead guard was never noticed.
- `packages/client/src/components/campaign/maps/map-detail-content.tsx:135`, `map-canvas.tsx:128`, `use-map-canvas-handlers.ts:64`, `components/campaign/tokens/token-sidebar.tsx:10` — `selectedTokenId` is also consumed on the non-combat map surface, so it is not combat-only state.
- `packages/client/src/components/sheet/dm-editable-score.tsx:13-66` — `useInlineEdit`; `:31-33` is `useEffect(() => { if (!isEditing) setLocalValue(String(score)); }, [score, isEditing])`. The non-editing branch renders the `score` prop directly (`:147`); `localValue` is read only inside the editing branch (`:102`). `enterEdit` already re-seeds from `score` at `:60-63`.
- `packages/client/src/components/sheet/dm-editable-score.test.tsx` — 101 lines, no re-render with a changed `score` prop anywhere, so nothing currently covers the behaviour the sync effect exists for.
- `packages/client/src/components/sheet/personality-panel.tsx:23-76` — `useFieldEditor`, the same protocol with no sync effect; it re-seeds `localValue` inside `enterEdit` at `:70-73`, and its non-editing branch likewise renders the `value` prop (`:136`).
- `lint-ratchet.baseline.json:310-334` — `ratchet/local-no-effect-misuse-client` currently holds exactly two entries, `dm-editable-score.tsx` (:326-329) and `use-debounced-cursor-list.ts` (:330-333), one finding each.
- `packages/client/src/components/campaign/maps/maps-panel.tsx:89`/`:94` — the selected map is local component state, not a route param, so `MapDetailContent` unmounts on "back". The stale first frame therefore happens mostly on *re-entry* over a still-dirty singleton (the stores outlive the unmount) rather than on an in-place id swap; same defect, same fix.
- `packages/client/src/stores/map-canvas-store.ts:602` (`const useMapCanvasStore = create<MapCanvasStore>()(...)`, with `reset` at `:611`), `combat-store.ts:40`, `vtt-drawer-store.ts:121` — every `reset`/`resetTransient` action hangs off a module-level `create()` singleton shared by all subscribers; there is no per-surface store instance to reset, which is what rules out both the `key`-remount fix and any render-phase reset.

## Proposed direction

1. Delete the sync effect in `dm-editable-score.tsx:31-33` and re-seed `localValue` from
   `score` inside `enterEdit` (which already does exactly that at `:60-63`), matching
   `personality-panel.tsx`'s shape. This is safe because the non-editing branch renders the
   `score` prop directly (`:147`) and `localValue` is only read inside the editing branch
   (`:102`), so an external score change is already reflected without the effect. TDD:
   `dm-editable-score.test.tsx` has no prop-change case today — add one that re-renders with
   a new `score` while not editing (display follows the prop) and one that enters edit after
   a prop change (the input seeds from the new score), then delete the effect. Removing it
   zeroes this file's `ratchet/local-no-effect-misuse-client` findings, so `bun run
   lint:ratchet` then fails as an *improvement below the floor*
   (`docs/guides/lint-ratchet.md:90-95`); run `bun run lint:ratchet:update` to move the
   committed floor down (`:273-277`) and commit the regenerated `lint-ratchet.baseline.json`
   alongside the fix. Do not hand-edit the baseline — `docs/guides/lint-ratchet.md:83`
   forbids it. This is a strict improvement: no `--allow-worse`, no
   `lint-ratchet.debt-log.jsonl` entry. Ship this first; it is independent of everything
   below.
2. Delete `isSyncingRef` and its `queueMicrotask` release from
   `combat-map-bridges.ts:12-41`, leaving `syncTokenToParticipant` as a plain callback.
   `combat-map-bridges.ts` has no spec today: create
   `packages/client/src/components/campaign/combat/combat-map-bridges.test.tsx` and cover
   both directions before deleting the guard — selecting a participant selects the mapped
   token, and a context-menu on a linked token selects its participant — so the removed
   guard is covered by behaviour rather than by inspection.
3. Extract one `useSurfaceReset(...)` helper (co-located with the VTT stores or in
   `packages/client/src/components/campaign/maps/`) that owns the full store set, and have
   all three call sites — `encounter-detail-view.tsx`, `map-detail-content.tsx`,
   `combat-map-content.tsx` — go through it, so adding a store to the surface-change
   boundary means editing one place. Keep the per-surface differences as explicit options
   rather than silently resetting combat state on the plain map surface. Give the
   encounter-only site the component-level coverage it lacks while you are there. This moves
   the boundary that `stores/MODULE.md:63-84` currently describes as "enforced by hand at
   the call site", so rewrite that section in the same change: the hand-enforcement wording
   is a description of today's shape, not a rule to preserve, and leaving it in place would
   send the next reader to three call sites that no longer exist.
4. Move the reset off the post-commit path **without writing to the stores during render**
   (see the first caveat). Make `useSurfaceReset` a `useLayoutEffect`: layout effects flush
   synchronously after commit and before the browser paints, so the stale values are never
   presented, while the store write still happens outside the render phase. Cover it with a
   test that mounts the surface over a deliberately dirtied store and asserts the store is
   already clean when RTL's `render()` returns (RTL flushes layout effects synchronously),
   plus a test that an id change re-runs the full reset set.
5. If step 4 turns out not to be enough — the most plausible gap is the Konva side, where
   `<Stage>` draws imperatively on its own schedule rather than on React's commit —
   escalate from gating the *write* to gating the *read*: stamp `map-canvas-store` with the
   surface id it currently holds (an `enterSurface(id)` action), and have the existing slice
   hooks (`map-detail-store-hooks.ts` and the combat equivalent) take the current id and
   yield the post-`resetTransient` projection whenever the stamp does not match. That makes
   a stale read structurally impossible rather than merely early, at the cost of one store
   field and one parameter on the slice hooks. Do not do this speculatively; do it only if
   step 4's test cannot be made to hold.
6. Only after 4 (and 5, if needed) lands, narrow `useSelectionSync` so the combat surface
   *derives* the selected token from `selectedParticipantId` at read time instead of
   mirroring it into `map-canvas-store`.

## Scope / caveats

- **Never call a store `reset()` during render — including via a `useRef` sentinel that
  resets before returning children.** `useMapCanvasStore`, `useCombatStore` and
  `useVttDrawerStore` are module-level `create()` singletons (`stores/MODULE.md`) with other
  live subscribers, so a render-phase `set` updates components *other* than the one
  rendering; and React may double-invoke or abandon a render (StrictMode, concurrent
  rendering), which would leave the singletons reset for a render that never commits. React
  only sanctions setting state during render for the rendering component's *own local*
  state. Use the layout-effect shape (step 4), or the read-gate (step 5) if that is not
  enough.
- **Do not "just `key` the subtree on map/encounter id".** It does not work here:
  `useCombatStore`, `useMapCanvasStore` and `useVttDrawerStore` are module-level `create()`
  singletons, so remounting the subtree leaves their state entirely untouched. Remounting
  buys nothing and costs a full canvas teardown.
- **Do not "reset in the navigation handler" either, on its own.** It misses deep links and
  browser back/forward, which reach the surface without passing through any in-app
  navigation handler. The identity-change check has to live where the surface observes the
  identity, i.e. step 4.
- **Do not justify this work as a lint fix.** `ratchet/local-no-effect-misuse-client` flags
  only `dm-editable-score.tsx` and `use-debounced-cursor-list.ts`; the row in
  `docs/guides/client-effects.md:20` about resetting state on a prop change is about *local
  component state*, whereas the surface-reset effects reset external module-scoped
  singletons — closer to the guide's sanctioned external-system sync (`:10-12`). The
  justification for steps 3-6 is the stale committed frame and the hand-enforced store set,
  not a rule violation. Re-read `docs/guides/client-effects.md` before writing the
  replacement so the fix does not trade one flagged pattern for another.
- **Do not delete `selectedTokenId` in favour of `selectedParticipantId`.** It is read by
  the non-combat map surface (`map-detail-content.tsx:135`, `map-canvas.tsx:128`,
  `use-map-canvas-handlers.ts:64`, `token-sidebar.tsx`). Any derivation must be scoped to
  the combat surface only.
- Step 1 is genuinely separable from steps 2-6: it lives in the character sheet, not the
  VTT, and shares only the anti-pattern. If this leaf needs splitting, split there — the
  shared `useInlineEdit`/`useFieldEditor` hook extraction (which needs a `parse`/`format`
  seam, because `dm-editable-score` parses and clamps to `MIN/MAX_ABILITY_SCORE` and clears
  `isCommitting` synchronously while `personality-panel` commits a string and clears in a
  `queueMicrotask`) is a separate follow-up and should not be bundled in.
- Focus/blur/commit ordering around the `isCommitting`/`isCancelling` guards is fiddly and
  easy to regress. Follow TDD strictly here; the commit-on-blur-vs-cancel-on-Escape race is
  the thing that breaks.
- Update `packages/client/src/components/campaign/maps/MODULE.md` and
  `packages/client/src/components/campaign/combat/MODULE.md` alongside the
  `packages/client/src/stores/MODULE.md` rewrite in step 3; see
  `docs/guides/add-module-doc.md`. Client cache/socket interactions on these surfaces are
  covered by `docs/guides/add-client-feature-module-cache-socket.md`.
- Sequencing: **leaf 12** (viewer-identity props) and **leaf 13** (canvas-shell extraction)
  both rewrite `map-detail-content.tsx` and `combat-map-content.tsx` — the same two files
  this leaf's steps 3-5 change. Land this leaf's step 3/4 first (it changes hook wiring, not
  JSX shape), then leaf 13's shell extraction, then leaf 12's prop removal; any other order
  produces conflicts in those two files.
- If step 5 becomes necessary, it lands *before* leaf 13's `<MapCanvasFrame>` extraction:
  the slice-hook signature change is easier to make in two explicit call sites than through
  a freshly extracted shared component.
