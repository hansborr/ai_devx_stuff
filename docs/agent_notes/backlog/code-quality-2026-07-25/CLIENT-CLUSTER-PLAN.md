# CLIENT-CLUSTER-PLAN. The ten client leaves: scheduling plan

Status: **All 15 slices landed. 7 landed in merge `6cf8c78d5` (C1, C2, C3, C4,
V1, V2, O1); the remaining 8 (N1, Q1, Q2, Q3, F1, F2, X1, O2) landed on
`feat/cq-slice-h` in merge `d539cfdbd`.** See [Slices](#slices), whose `State`
column is the authority. The
[index reconciliation](#index-reconciliation-applied-2026-07-27) this plan
carried was applied after the first landing.

Originally planned as: **one architectural leaf, four bounded cleanups, one doc,
and four drops; leaf 10 is re-scoped from an architecture fix to a maintenance fix**.
Supersedes the `## Proposed direction` of leaves
[08](./08-form-field-primitive-and-placement.md),
[09](./09-map-canvas-store-decomposition.md),
[10](./10-client-effect-misuse.md),
[12](./12-campaign-context-prop-drilling.md),
[13](./13-client-shell-duplication.md),
[14](./14-sheet-dialog-state-and-props.md),
[15](./15-client-discriminated-state.md),
[16](./16-client-query-layer.md),
[17](./17-client-hook-naming.md) and
[48](./48-sheet-module-doc.md).

Date: 2026-07-26 · Area: client · Source leaves: 08, 09, 10, 12, 13, 14, 15, 16,
17, 48 (leaf 11 landed 2026-07-26)

Cross-model planning session: `consult codex` (own subagents across component/state
architecture, React idiom, type modelling, migration risk and reader ergonomics,
synthesized) and `consult cursor` (Grok, "step back — is this package's structure
right, and would you reorganise it differently?"). Both were asked the same
question independently. **They split on the single biggest call — store
ownership** — and that ruling, with its reasons, is in
[Ruling: store ownership](#ruling-store-ownership). Every count and anchor below
was re-measured against `313b6dfe` (`main`); the leaves' evidence is pinned to
`883d48bf` and some anchors have moved (`map-canvas-store.ts` is 645 lines, not
620, after leaf 11 landed).

## Verdict

**`packages/client` is structured correctly. Nine of these ten leaves are not
architecture; they are local hygiene against a sound shape. Exactly one leaf —
12 — names a concept the package genuinely does not own.**

The cluster poses three questions. Two of them answer "no change".

**1. Is the layer-first root axis (`pages` / `components` / `hooks` / `stores` /
`lib` / `routes`) wrong, given that the character sheet is spread across three of
them?** No. Both consults rejected a `features/` reorganisation independently and
so do I. The split is documented and deliberate
(`packages/client/src/pages/MODULE.md:12`), the campaign tree under
`components/campaign/` is already feature-shaped with a `MODULE.md` per feature,
and `components/homebrew/` is the working proof that the axis scales: it is
feature-shaped, it has a documented admission threshold for its `shared/` folder
(`components/homebrew/shared/MODULE.md:20-21`), and none of the ten leaves
reports a placement defect inside it. A package-wide move would rewrite every
path cited by six leaves in this pack and all 32 client `MODULE.md` files for a
navigation gain that leaf 48 buys for one commit.

**2. Are the three module-scoped Zustand singletons the wrong ownership model?**
Yes, strictly speaking — and the migration off them is still the wrong thing to
schedule. See [Ruling: store ownership](#ruling-store-ownership).

**3. Is there an unowned concept?** Yes, one: **campaign viewer identity**. It is
derived three times from two different predicates, one of which the server does
not use, and then converted back into the role type the permission layer wanted
in the first place. That is leaf 12, and it is the only architectural leaf here.

So: **ten leaves → one architectural leaf (12), four bounded cleanups (08, 09
step 1, 15's NPC half, 16), one doc (48), one re-scoped maintenance leaf (10),
and four things that leave the schedule (13, 14's grouping, 15's drawer half, most
of 17).** The index's five-leaf serial chain `09 step 1 → 10 → 13 → 12` collapses
to a single two-link edge; see [Dependency edges](#dependency-edges).

### Ruling: store ownership

The consults split here, and it is the only place they contradicted each other
outright.

- **Codex: instance the stores per surface.** Split canvas *preferences* from
  canvas *session* state, convert all three stores to vanilla factories behind
  providers keyed on map/encounter identity, thread the `StoreApi` into the
  non-React canvas handler modules, and the reset effects — and leaf 10's stale
  frame — cease to exist rather than being moved. It laid this out as five
  slices (B1–B5) with a real dependency graph.
- **Cursor: keep the singletons.** Preference survival across surface change is
  the reason they are module-scoped; only one VTT surface is live at a time, so
  instance isolation buys nothing; and the blast radius (canvas input, tool
  handlers, logout, the test substrate) makes it a multi-session programme to fix
  a timing symptom nobody has reported.

**Call: keep the singletons in this pack. Adopt codex's diagnosis, reject its
schedule, and take exactly one no-regret step from it.**

The diagnosis is right: state whose lifetime is a surface, stored at module
scope, is a lifetime mismatch, and every symptom in leaves 09, 10 and 15's drawer
half is downstream of it. Cursor's first counter-argument is not decisive —
codex answers it by splitting preferences out, which is a real answer. What is
decisive is cost against evidenced payoff:

- **Cost, measured.** `useMapCanvasStore` has 454 references across 37 files (22
  non-test); `useVttDrawerStore` 269 across 36 (20 non-test); `useCombatStore` 56
  across 14. The hard seam is not React: `packages/client/src/hooks/canvas-input/tool-handlers.ts`
  reaches the canvas store through `useMapCanvasStore.getState()` at 20+ sites
  from a pointer-dispatch pipeline that is not a component, and
  `packages/client/src/hooks/auth-context.tsx:21-24` calls full `reset()` on two
  stores from outside React on logout. Both have to be re-plumbed or the
  migration leaves a module-level "current store" register, which is a singleton
  with extra steps.
- **Payoff, measured.** One possibly-invisible stale commit on surface switch,
  which leaf 10 itself declines to call a proven visible flash, plus
  maintainability. No user-visible defect. No bug report.
- **Risk shape.** The migration lands in the code with the recorded regression
  history — `map-canvas-store.ts:279-280` ("silent drift is exactly what
  regressed cancelCast") and the fire-after-commit ordering contract at
  `:241-259`.
- **Sizing.** Codex's own plan is five slices, at least three of them large.
  That is a programme, not a pack leaf, and this pack's charter is "one leaf =
  one coherent piece of work"
  ([How to use this pack](./00-index.md#how-to-use-this-pack)).

**The one step adopted from codex: the concept boundary inside the canvas store
is *lifetime*, not tool family.** `resetTransient` (`map-canvas-store.ts:320-349`)
preserves five user preferences across a surface change — `gridVisible` and
`cellSizePx` by omission, and `drawing.strokeColor`, `drawing.strokeWidth`,
`template.sizeFt` by hand-copying them out of the transient objects (`:339-342`).
Those three hand-copies are the entire drift hazard, and there are more sites than
leaf 09 counts: the stroke pair is re-stated at `buildToolReset:291-292`,
`resetTransient:339-340`, `clearDrawing:481-482` and `activateTargetPick:557-558`,
and `sizeFt` at `buildToolReset:294`, `resetTransient:342`, `clearTemplate:528`
and `activateTargetPick:560` — eight hand-copies over two preferences, in a file
whose own JSDoc records that this exact field set has already drifted once.
Slice **C2** collapses the six in the reset paths down to the two inside
`buildToolReset`; the remaining two (`clearDrawing`, `clearTemplate`) are per-tool
clears that a lifetime split would delete outright.
Separating them structurally — so nothing has to remember to preserve anything —
is the split worth doing, and it is also the prerequisite for instancing if that
is ever taken up. It is *not* scheduled here (see slice **C2**, which does the
cheap version), but it is the recorded direction and it supersedes leaf 09's
step 2.

**Revisit the instancing migration only if:** a visible stale frame is
reproduced on the Konva surface; or two VTT surfaces become simultaneously
mountable; or a fourth store joins the hand-enforced reset set. Until then the
answer to "how do I keep the stores in step across a surface change" is slice
**C3**, one owner for the store set.

## Corrections to the leaves, verified

Six load-bearing claims in the leaves do not survive checking. Each was
re-verified against `313b6dfe` before adoption.

**1. Leaf 10's `useLayoutEffect` remedy proves the wrong property (codex).** Its
step 4 proposes a test that "mounts the surface over a deliberately dirtied store
and asserts the store is already clean when RTL's `render()` returns". That
asserts layout effects flushed — which is true by construction — not that no
stale frame was committed. The descendants have already read the pre-reset
snapshot during render, and `map-canvas.tsx` forwards that snapshot into Konva
`<Stage>` props. The layout effect narrows the window (React re-renders before
paint) and is still worth one word, but it is not a proof and must not be sold as
the endpoint. This is why the read-gate escalation (step 5) is dropped rather
than held in reserve: it adds a store field and a slice-hook parameter to chase a
symptom that has never been demonstrated.

**2. Leaf 10's deep-link argument is false in the current UI (codex; verified).**
Its caveat forbids resetting in a navigation handler because that "misses deep
links and browser back/forward". There are no deep links to a map or encounter
surface: the selection is component-local `useState` —
`components/campaign/maps/maps-panel.tsx:89` (`selectedMapId`) and
`components/campaign/encounters/encounters-panel.tsx:97` (`selectedEncounterId`)
— never a route param. The leaf's *own* evidence says this. The conclusion (the
reset belongs where the surface observes its identity) is still right; the stated
reason is not, and a future reader should not act on it.

**3. Leaf 08's "strict subset" claim is false as written (codex; verified).**
`HomebrewTextFieldProps` is a props-shape subset of `FormFieldProps`, but the
rendered DOM is not: `form-field.tsx:40` emits `name={name ?? id}` while
`homebrew-text-field.tsx:31` emits `name={name}`, so an omitted `name` produces
different markup. The one live caller passes an explicit `name="name"`
(`homebrew-core-fields.tsx:37`), so the migration the leaf proposes is safe — but
it is safe because of the caller, not because the components are interchangeable.

**4. Leaf 15's narrowing explanation is wrong, and so is the production comment
it quotes (codex; verified).** The `type-assertion-boundary: interop` block at
`components/campaign/npcs/npc-panel.tsx:245-251` states that "the `if (data.id)`
truthy check doesn't refine `data.id` from `string | undefined` to `string` in TS
(only `if (data.id !== undefined)` would)". That is not why the cast is needed —
truthy narrowing on `string | undefined` does refine the *property*. What it does
not do is turn `data` into an intersection type. The distinction matters for the
fix: with the payload split, the branch must be `if ("id" in data)`, which does
narrow a union — `createNpcInputSchema` requires `campaignId` and forbids `id`,
`updateNpcInputSchema` requires `id` and forbids `campaignId`, both `.strict()`
(`packages/shared/src/schemas/npc-inputs.ts:16`, `:35`) — and not a truthy check
on a property. The inaccurate comment is leaf-45 material; delete it with the
cast.

**5. Leaf 12 does not subsume leaf 13 or leaf 14 (both consults, independently).**
The viewer provider removes `isDm` plumbing. It does not share canvas chrome and
it does not touch the sheet's dialog `useState` pairs. Note, though, that
`SheetSharedProps` carries three viewer-shaped members —
`campaignId`, `currentUserId`, `canDmEditStats`
(`components/sheet/sheet-props.ts`) — so there *is* a seam where 12 could shrink
14. It is deliberately not taken: see
[Rejected alternatives](#rejected-alternatives--why).

**6. Leaf 09's stated problem is not the one that can regress behaviour
(cursor).** The `:299-301` header does say the creators were split by line count,
but the defect with a recorded regression behind it is the unlinked reset field
set. Re-grouping `createViewActions` fixes readability and nothing else. It is
kept only because it is free once the file is open.

**Counts re-measured and holding.** 41 `readonly isDm` declarations across 28
non-test files (leaf 12); nine `function str(` definitions under
`components/homebrew/` (leaf 08); 51 `space-y-2`/`Label`/`Input` triples across
22 files (leaf 08); 17 `useCallback` wrappers plus one closing `useMemo` in
`lib/query-invalidation.ts` (179 lines) (leaf 16); five module-private
`interface ApplyInput` declarations under `hooks/vtt-drawer/` (leaf 17); 27 lines
carrying whole-word `pid` across 6 non-test files (leaf 17); 87 files under
`components/sheet/` with no `MODULE.md` (leaf 48).

**One cross-leaf fact neither leaf records.**
`ratchet/local-no-effect-misuse-client` holds exactly two entries:
`components/sheet/dm-editable-score.tsx` and `hooks/use-debounced-cursor-list.ts`
(one finding each). Leaf 10 step 1 removes the first; leaf 16 step 4 deletes the
file behind the second. **Together they empty the ratchet.** Whichever lands
second should check whether `bun run lint:ratchet:zero-baseline` is the right
follow-up rather than another `--update`. `use-debounced-cursor-list.ts` is also
one of five entries in `ratchet/react-hooks-set-state-in-effect-client`, so
slice **Q3** moves both floors.

## Leaf disposition

| Leaf | Call | Reason |
|---|---|---|
| **08** | **Shrink** → F1, F2 | Steps 1-5 are real and cheap: one `str`, three renamed `numStr` contracts, one broken `parseStringArray` collision, two file moves, one a11y gap. Steps 6 (the ~49-site sweep) and 7 (loose-root regrouping) are **dropped permanently** — the leaf itself declines to count step 6 in its size, and step 7 is file-size hygiene with no finding behind it. |
| **09** | **Shrink to step 1 (+ step 2 as a free rider)** → C2 | The four unlinked reset sites are the whole risk story. Step 3 (`fireAfterCommit` reshape) is **dropped**: medium risk against a documented narrowing hazard, for call-site readability, and the leaf itself says to skip it if the distinction is unclear. Step 4 (file split) **dropped** — and if the file is ever split, split it by *lifetime*, not by tool family (see the ruling). |
| **10** | **Keep, re-scoped from architecture to maintenance** → C3, C4 | Steps 1-3 stand. Step 4 keeps `useLayoutEffect` (one word, strictly better) but loses the test that claims to prove no stale frame. Step 5 (read gate) **dropped** — do not build it; if the frame is ever proven visible, the answer is store instancing, not a stamp. Step 6 (derive combat selection) **dropped**: selection is not a total derivation in either direction (stage click clears only the token, tracker click sets only the participant, context menu sets both, and unlinked participants exist). |
| **12** | **Keep — the one architectural leaf** → V1, V2 | Two of three derivations use a predicate the server does not (`campaign-detail-page.tsx:204`, `sheet-state.ts:40` on `ownerId`; `campaign-card.tsx:23` on `role`, which is the correct one). Adopt codex's two additions: keep `isOwner` as a separate fact, and retire the client-local `CampaignRole` (`lib/drawer-perms.ts:3`) in favour of shared `CampaignMemberRole` (`packages/shared/src/schemas/campaign.ts:9-10`). The `campaignId` sweep stays deferred, as the leaf already says. |
| **13** | **Drop** | `components/vtt/MODULE.md:15-18` already names `VttSurface` as the shared tabletop shell; the residue is ~55 lines of chrome across two callers, and the leaf's own governing constraint ("two call sites do not earn a configurable shell") is the rule that stops it. Codex dropped it outright; cursor called the panel half optional. One unit survives as an opportunistic tidy — see O1. |
| **14** | **Drop as a session** | Steps 5-7 (grouping `SheetDialogState`, renaming `s`/`d`) are one file, no defect, and carry a real dep-array identity hazard the leaf documents at length. Both consults declined to schedule it. Steps 1-2 and 4 survive as an opportunistic XS bundle (O2); step 3 moves into F2, which is already moving that file. |
| **15** | **Split: keep the NPC half, drop the drawer half** → N1 | Steps 1-4 delete two real `type-assertion-boundary` markers and one inaccurate justification comment: ship them. Steps 5-9 are correct modelling — the nested-atom analysis of Zustand's merging `set` (`vtt-drawer-store.ts:42-49`) is right — against an invariant that is already guarded (`:84`, `:97`, `:101`, `:105`, `:109`) and already tested, whose one unguarded combination renders nothing. Twelve test files and eight production selector sites is too much for compile-time insurance. Revisit when a new drawer mode or cast variant is added — do the union *first* at that point. |
| **16** | **Keep, split three ways** → Q1, Q2, Q3 | All three parts survive but they share nothing. Codex wanted step 1 dropped ("establishes no ownership boundary"); cursor called it the best part. Kept: the three-places-per-entry bookkeeping is a measured, evidenced hazard and the acceptance check is mechanical (`test/mock-query-invalidation.ts` must still compile unchanged). |
| **17** | **Shrink to steps 1-2** → X1 | Five module-private interfaces all named `ApplyInput` with unrelated members, plus a member called `dispatch` that is not a reducer dispatch. One XS commit pair, zero call-site churn for step 1. Step 3 **dropped** (the leaf calls it optional and lowest-value). Step 5 **dropped** (runtime risk against `?? 0` defaults for a cosmetic gain). Step 6 **dropped** (renaming socket-subscribed invalidation hooks for readability). Step 7 (`pid`/`p`/`m`) **moves to leaf 46**, which owns pure renames. |
| **48** | **Keep as-is, schedule first** → C1 | Doc-only, one commit, no dependency, and it is the orientation contract for the largest directory in the package. Adopt codex's refinement: document the stable external entry points versus private implementation, not an exhaustive 51-module inventory. |

## Slices

Fifteen slices. Each is one agent session; several are well under one. All are
independently landable except where the [dependency edges](#dependency-edges) say
otherwise.

| # | State | Scope | Done criteria | Verification |
|---|---|---|---|---|
| **C1** | **Landed** `6cf8c78d5` | **`components/sheet/MODULE.md` (S, leaf 48).** Write the doc per `docs/guides/add-module-doc.md` and the six charter sections at `docs/module-docs.md:41-50`. Carry the `sheet-props.ts` JSDoc into Data Flow rather than duplicating it, name the both-layouts-mount invariant (`sheet-body.tsx` renders `DesktopSheetLayout` and `MobileSheetTabs` unconditionally, one hidden by `lg:hidden` and the other by `hidden lg:grid`) as a Gotcha, and split External Entry Points into the five modules borrowed by `components/vtt/drawer/` and `components/campaign/npcs/` versus the rest consumed under `pages/`. Do **not** create subdirectories. | `packages/client/src/components/sheet/MODULE.md` exists; `MODULE-INDEX.md` carries a row for it; no file under `components/sheet/` changed | `bun run module:index` then `bun run module:index:check` |
| **C2** | **Landed** `6cf8c78d5` | **Canvas transient reset field set (S, leaf 09 steps 1-2).** Route `resetTransient` (`map-canvas-store.ts:320-349`) and `activateTargetPick` (`:541-571`) through `buildToolReset` (`:282-297`), as `{ ...buildToolReset(s, "select"), stagePosition: {x:0,y:0}, stageScale: 1 }` and `{ ...buildToolReset(s, "target-pick"), targetPick: {…} }`. Rewrite `buildToolReset`'s JSDoc (`:274-281`) to name all four callers, keeping the "(silent drift is exactly what regressed cancelCast)" clause **verbatim**, and keep the first sentence of the `resetTransient` comment (`:321-324`) and the tool-switch comment above `setActiveTool` (`:355-357`) verbatim. Second commit: move `selectToken`, `setActiveTool`, `toggleGrid`, `setCellSizePx`, `setPendingTokenCell` out of `createViewActions` into a creator named for what they are, rewrite the `:299-301` header, and update `stores/MODULE.md:112-118` in the same commit. Write the four-entry-point reset test **first**. | All four reset paths call `buildToolReset` (`grep -c "buildToolReset(" packages/client/src/stores/map-canvas-store.ts` returns 5 — one definition, four calls); `map-canvas-store.test.ts` asserts `setActiveTool`, `cancelCast`, `resetTransient` and `activateTargetPick` clear the same fields and preserve `strokeColor`/`strokeWidth`/`sizeFt`; `stores/MODULE.md` no longer says the creator seams exist to satisfy the line-count lint | `bun run test -- packages/client/src/stores/map-canvas-store.test.ts` |
| **C3** | **Landed** `6cf8c78d5` | **One owner for the surface-reset store set (M, leaf 10 steps 2-3-4).** Create `packages/client/src/components/campaign/combat/combat-map-bridges.test.tsx` covering both selection directions, then delete `isSyncingRef` and its `queueMicrotask` release from `combat-map-bridges.ts:12-41`. Extract one `useSurfaceReset(...)` owning the store set, with per-surface differences as explicit options, and route all three call sites through it (`maps/map-detail-content.tsx:73-76`, `combat/combat-map-content.tsx:86-90`, `encounters/encounter-detail-view.tsx:228-230`). Use `useLayoutEffect`. Give the encounter site the component-level coverage it lacks. Rewrite `stores/MODULE.md:63-84`, whose "enforced by hand at the call site" wording describes the shape being replaced, plus the maps and combat `MODULE.md` files. **Do not** write a test that claims to prove no stale frame, and **do not** build the `enterSurface` read gate. | `grep -rn "resetTransient()" packages/client/src \| grep -v '\.test\.'` names exactly one source module — the new hook (today it names `map-detail-content.tsx:74` and `combat-map-content.tsx:87`, plus a prose mention in `stores/MODULE.md:71` that this slice rewrites); `combat-map-bridges.ts` contains no `useRef` and no `queueMicrotask`; the encounter reset has a test that fails if the call is deleted; `stores/MODULE.md` names the hook as the owner | `bun run test -- packages/client/src/components/campaign/maps/map-detail-view.test.tsx packages/client/src/components/campaign/combat/combat-map-panel.test.tsx packages/client/src/components/campaign/encounters/encounter-detail-view.test.tsx packages/client/src/components/campaign/combat/combat-map-bridges.test.tsx` |
| **C4** | **Landed** `6cf8c78d5` | **Inline-edit sync effect (XS, leaf 10 step 1).** Add two cases to `dm-editable-score.test.tsx` — a re-render with a changed `score` while not editing (display follows the prop), and entering edit after a prop change (the input seeds from the new score) — then delete the effect at `dm-editable-score.tsx:31-33`. `enterEdit` (`:60`) already re-seeds. Do **not** extract a shared `useInlineEdit`/`useFieldEditor` hook. | `dm-editable-score.tsx` has exactly one `useEffect` (the focus/select one); the file is gone from `ratchet/local-no-effect-misuse-client` and `ratchet/react-hooks-set-state-in-effect-client` in the regenerated baseline | `bun run test -- packages/client/src/components/sheet/dm-editable-score.test.tsx` then `bun run lint:ratchet` (expect improvement-below-floor per `docs/guides/lint-ratchet.md`) then `bun run lint:ratchet:update`, committing the regenerated `lint-ratchet.baseline.json`. Do not hand-edit the baseline. |
| **V1** | **Landed** `6cf8c78d5` | **Campaign viewer predicate (M, leaf 12 steps 1-4).** Add `campaignViewer(campaign, userId)` in `packages/client/src/lib/`, returning `{ userId, role, isDm, isOwner }` with `role` typed as shared `CampaignMemberRole` and `isDm` derived *from* `role`. Accept a `CampaignDetail` (role from `members.find(...)`, per `packages/server/src/routers/campaign.ts:84-96`) or a `CampaignSummary` (role from `campaign.role`, per `:104-115`). Land with tests and no call-site changes, then repoint the three derivations one commit each. Replace `lib/drawer-perms.ts:3`'s local `CampaignRole` with the shared type. Move and rename `sheet-state.ts`'s `useCampaignContext` to `useCampaignViewer` — do not add a second adjacent hook — carrying `canRoll` and `sheet-state.test.ts`'s cases with it. Regression guard: a unit test seeding a non-owner `dm` member and an owner who is not a member. | `grep -rn "ownerId" packages/client/src --include='*.ts' --include='*.tsx' \| grep -v '\.test\.'` shows no hit under `pages/` or `components/` (today: `campaign-detail-page.tsx:204`, `sheet-state.ts:40`); `grep -rn "type CampaignRole" packages/client/src` returns 0, down from 2 (the declaration at `lib/drawer-perms.ts:3` and the type import at `components/vtt/vtt-surface.tsx:5`); `campaignViewer` is the only producer of `isDm` in the three repointed files; `useCampaignContext` no longer exists | `bun run test -- packages/client/src/pages/campaign-detail-page.test.tsx packages/client/src/pages/character-sheet/sheet-state.test.ts packages/client/src/components/campaign/settings/campaign-card.test.tsx packages/client/src/lib/drawer-perms.test.ts` then `bun run typecheck` |
| **V2** | **Landed** `6cf8c78d5` | **Viewer provider and the role prop (M, leaf 12 steps 5-7).** Replace `role={isDm ? "dm" : "player"}` at `maps/map-detail-content.tsx:95` and `combat/combat-map-content.tsx:136` with the viewer's `role`. Add a campaign-viewer provider at the campaign-detail composition root, named so it cannot be confused with `useCampaignViewer`. Delete `isDm` from the six pure forwarders first (`map-detail-view.tsx`, `map-canvas-overlays.tsx`, `combat-map-panel.tsx`, `combat-map-header.tsx`, `encounters/encounter-detail-view.tsx`, `combat/initiative-tracker/initiative-row.tsx`), then work outward one file per commit. Prove the Konva context bridge with one test *before* converting any `<Stage>`-hosted consumer, and stop at the canvas boundary if explicit props are judged worth more than three deleted declarations. Do **not** fold in `campaignId`. Update the maps, combat and pages `MODULE.md` files. | No file declares `isDm` without reading it (the six forwarders above); `grep -rn "readonly isDm" packages/client/src \| grep -v '\.test\.' \| wc -l` is strictly below 41; `grep -rn "readonly campaignId" packages/client/src \| grep -v '\.test\.' \| wc -l` is unchanged at 42; a test renders a `<Stage>`-hosted consumer under the provider | `bun run test -- packages/client/src/components/campaign/maps/map-detail-view.test.tsx packages/client/src/components/campaign/combat/combat-map-panel.test.tsx packages/client/src/components/campaign/encounters/encounter-detail-view.test.tsx packages/client/src/pages/campaign-detail-page.test.tsx` then `bun run typecheck` and `bun run module:index:check` |
| **N1** | **Landed** (`feat/cq-slice-h`, merge `d539cfdbd`) | **NPC draft versus submit payload (S, leaf 15 steps 1-4).** Narrow `NpcFormData` (`npc-editor.tsx:18-28`) to the seven editable fields. Change `onSave` to take `CreateNpcInput \| UpdateNpcInput` and pass `result.data` through instead of rebuilding the object. Branch with `"id" in data`, not a truthy property check (see correction 4). Delete both assertions and both markers at `npc-panel.tsx:243-257`, including the inaccurate justification comment. Land the schema trim as a deliberate normalisation with a test submitting `"  Gundren  "`. | `grep -c "type-assertion-boundary" packages/client/src/components/campaign/npcs/npc-panel.tsx` returns 0, down from 2; `NpcFormData` has no optional `id` or `campaignId`; a test asserts the trimmed name reaches the mutation | `bun run test -- packages/client/src/components/campaign/npcs/npc-editor.test.tsx packages/client/src/components/campaign/npcs/npc-panel.test.tsx` then `bun run lint:ratchet` and `bun run typecheck` |
| **Q1** | **Landed** (`feat/cq-slice-h`, merge `d539cfdbd`) | **Collapse `query-invalidation.ts` (S, leaf 16 step 1).** One `useMemo` over `[trpc, queryClient]` returning an object of plain closures; delete the seventeen `useCallback` wrappers and the closing `useMemo`'s seventeen-identifier dependency array. Exported keys and call signatures must not change. Carry the `invalidateInvitePreview` JSDoc verbatim. Do **not** build a descriptor map plus a generic binder. | `grep -c useCallback packages/client/src/lib/query-invalidation.ts` returns 0, down from 18 (17 wrappers plus the import); `packages/client/src/test/mock-query-invalidation.ts` compiles unchanged; the file is materially shorter than 179 lines | `bun run typecheck` then `bun run test -- packages/client/src/hooks/use-map-layer-mutations.test.tsx packages/client/src/components/campaign/maps/map-detail-mutations.test.tsx packages/client/src/components/campaign/combat/combat-map-mutations.test.tsx packages/client/src/components/campaign/tokens/map-token-mutations.test.tsx packages/client/src/components/campaign/chat/chat-panel.test.tsx` |
| **Q2** | **Landed** (`feat/cq-slice-h`, merge `d539cfdbd`) | **Character-create input seam (S, leaf 16 steps 5-6).** Move `buildBoostMap`, `buildProficiencies`, `optionalString`, `buildBoostedScores`, `buildSpells` and `buildCreateInput` out of `pages/character-create-page.tsx` into a module beside `components/character-create/wizard-state.ts`, and add the co-located unit test. Do **not** land the move without the test — the test is the payoff. Do **not** "simplify" the `Common` language injection; it is SRD behaviour (`docs/guides/change-rules-logic.md`). | `pages/character-create-page.tsx` contains no `build*` helper. **Landing-time evidence (`e66cfd75c`, in merge `d539cfdbd`):** the new test exercised `buildCreateInput` directly, including the client-side `Common` injection. Leaf 55 later superseded that behaviour: `133edc7fd` removed the injection after server ownership landed, and the current test asserts that universal starting languages are server-derived. | `bun run test -- packages/client/src/components/character-create/wizard-state.test.ts packages/client/src/pages/character-create-page.test.tsx` plus the new test file |
| **Q3** | **Landed** (`feat/cq-slice-h`, merge `d539cfdbd`) | **Infinite-query migration (M, leaf 16 steps 2-4).** Write the ~10-line `useDebouncedValue` with its own test (it does not exist today). Convert `components/compendium/magic-item-list.tsx` to `infiniteQueryOptions` following `components/campaign/notes/notes-panel.tsx:240` and `hooks/character-sheet/use-inventory.ts:40`, then `components/campaign/npcs/monster-tab.tsx`, then delete `hooks/use-debounced-cursor-list.ts` and its test. Swap the `hooks/MODULE.md:51` row. Re-test the `PaginatedResultList` wiring: accumulation, `isFetching` vs `isLoading`, reset-on-filter-change. | `hooks/use-debounced-cursor-list.ts` is gone; `useDebouncedValue` exists with a test; `hooks/MODULE.md` lists it | `bun run test -- packages/client/src/components/compendium/magic-item-list.test.tsx packages/client/src/components/campaign/npcs/monster-tab.test.tsx` then `bun run lint:ratchet` — **this slice empties `ratchet/local-no-effect-misuse-client` if C4 has landed; check `bun run lint:ratchet:zero-baseline` before reaching for `--update`**. It also moves a *second* floor: routing both cursor lists through one `makeCursorListQuery` helper deletes the `mock-trpc-magic-item.ts#queryFn <=> mock-trpc-monster.ts#queryFn` identity, so `bun scripts/sensor-near-duplicates.ts --check-baseline` fails stale until `--update` regenerates `sensor-near-duplicates.baseline.json`. That is an improvement below the floor, not an admission — no `--admit`, no hand edit. |
| **F1** | **Landed** (`feat/cq-slice-h`, merge `d539cfdbd`) | **Homebrew form-data helpers (M, leaf 08 steps 1-3).** Hoist one `str(value: unknown): string` into `components/homebrew/shared/` and delete the nine local copies (including the `v`-parameter variant in `monster-form-data.ts`). Rename the three `numStr` contracts apart by behaviour and hoist only the two-consumer one; `numOnly` (item) and `numWithFallback` (monster) stay in their entity folders per `homebrew/shared/MODULE.md:20-21`. Rename the `parseStringArray` collision in place, by contract, in both directions. **Do not collapse the `numStr` variants** — they differ in whether a string is passed through, dropped, or replaced, and collapsing them silently changes form defaults. Add the missing per-variant coverage *before* renaming. | `grep -rn "function str(" packages/client/src/components/homebrew` returns exactly one hit, under `shared/` (today: 9); `grep -rn "numStr" packages/client/src/components/homebrew` returns 0, down from 31 lines (the replacement names `numOrStr`/`numOnly`/`numWithFallback` do not contain the substring); `grep -rn "parseStringArray" packages/client/src/components/homebrew` returns 0, down from 7; `homebrew/shared/MODULE.md` lists the two promoted helpers | `bun run test -- packages/client/src/components/homebrew/class/class-form-data.test.ts packages/client/src/components/homebrew/subclass/subclass-form-data.test.ts packages/client/src/components/homebrew/item/item-form-data.test.ts packages/client/src/components/homebrew/monster/monster-form-data.test.ts packages/client/src/components/homebrew/background/background-form-data.test.ts packages/client/src/components/homebrew/species/species-form-data.test.ts packages/client/src/components/homebrew/spell/spell-form-data.test.ts packages/client/src/components/homebrew/magic-item/magic-item-form-data.test.ts` |
| **F2** | **Landed** (`feat/cq-slice-h`, merge `d539cfdbd`) | **Placement and the labeled-field a11y contract (M, leaf 08 steps 4-5 + leaf 14 step 3).** Move `campaign/settings/delete-confirm-dialog.tsx` and its test to `components/common/`, update the four panel imports, and amend `campaign/settings/MODULE.md:3`. Move `pages/sheet-helpers.ts` and its test into `pages/character-sheet/` **and rename its terse locals in the same commit** (`pc` → `primaryClass`, `sc` → `spellcasting`, `inv` → `inventory`, `mod`/`m` → `primaryAbilityMod`/`classAbilityMod`) — doing both at once is what dissolves the 08↔14 sequencing edge. Then add `role="alert"` to `form-field-error.tsx:7`, make `placeholder` optional on `FormFieldProps`, delete `homebrew-text-field.tsx` and repoint `homebrew-core-fields.tsx:37` (safe because that caller passes an explicit `name` — see correction 3), and repoint the three `PasswordField` call sites in `settings-page.tsx`. Test the a11y contract before moving any call site. **Do not** hoist `FormFieldError`; **do not** widen `FormField` into a polymorphic control renderer; **do not** start on the ~49 hand-rolled triples. | `components/campaign/settings/` no longer contains `delete-confirm-dialog.tsx`; `pages/sheet-helpers.ts` no longer exists; `grep -rn "HomebrewTextField" packages/client/src` returns 0, down from 13 (`HomebrewTextareaField` does not match); `form-field-error.tsx` carries `role="alert"`; `form-field.test.tsx` covers the omitted-placeholder case and the three a11y attributes | `bun run test -- packages/client/src/components/common/form-field.test.tsx packages/client/src/components/homebrew/shared/homebrew-core-fields.test.tsx packages/client/src/pages/settings-page.test.tsx packages/client/src/pages/character-sheet/sheet-helpers.test.ts packages/client/src/components/campaign/notes/notes-panel.test.tsx packages/client/src/components/campaign/npcs/npc-panel.test.tsx` then `bun run module:index:check` |
| **X1** | **Landed** (`feat/cq-slice-h`, merge `d539cfdbd`) | **vtt-drawer type and verb renames (XS, leaf 17 steps 1-2 + step 4).** Rename the five module-private `interface ApplyInput` declarations apart (`WeaponAttackInput`, `FeatureUseInput`, `ConfirmCastInput`, `MonsterHpAdjustmentInput`, `DropConcentrationInput`) — zero call-site churn. Then `useMonsterHpUpdate`'s `apply` → `adjustHp` (not `setMonsterHp`: it applies a mode-keyed adjustment with clamping) and `useCastPlacement`'s `dispatch` → `begin` (not `beginCastPlacement`: the hook *calls* the store action of that name and does strictly more). Rename in test and implementation together. Add `useMonsterAttack` to the entry-point list in `hooks/vtt-drawer/MODULE.md`. Leave the other five `apply` members alone. | `grep -rn "interface ApplyInput" packages/client/src` returns 0, down from 5; `grep -rn '\.dispatch\b' packages/client/src` returns 0, down from 1 (`components/vtt/drawer/cast-rail.tsx:156`); `hooks/vtt-drawer/MODULE.md` names `useMonsterAttack` | `bun run test -- packages/client/src/hooks/vtt-drawer/use-cast-placement.test.ts packages/client/src/components/vtt/drawer/monster-hp-control-strip.test.tsx packages/client/src/components/vtt/drawer/cast-rail.test.tsx packages/client/src/components/vtt/drawer/monster-stat-block-drawer.test.tsx` then `bun run typecheck` |
| **O1** | **Landed** `6cf8c78d5` | **Opportunistic: token context-menu state protocol (XS, leaf 13 step 1).** Only for an agent already editing `map-detail-content.tsx` or `combat-map-content.tsx`. Move the duplicated `ContextMenuState` interface plus its `useState`/`open`/`close`/`anchorProps` into a parameterless `useTokenContextMenu()` beside `TokenContextMenu` in `components/campaign/tokens/`. Each caller keeps its own `handleContextMenu`. Do **not** extract `<MapCanvasFrame>`, the panel primitives, or `handleTokenMoved`. | `grep -rn "interface ContextMenuState" packages/client/src` returns exactly one definition, down from 2 | `bun run test -- packages/client/src/components/campaign/maps/map-detail-view.test.tsx packages/client/src/components/campaign/combat/combat-map-panel.test.tsx` |
| **O2** | **Landed** (`feat/cq-slice-h`, merge `d539cfdbd`) | **Opportunistic: sheet dialog micro-tidies (XS, leaf 14 steps 1-2 and 4).** Collapse `HpDialogMount` into `HpDialogSection` in `encounter-detail-view.tsx`; drop the `const store = useCombatStore;` alias in `useHpDialogHandler` and call `useCombatStore.getState()` at the two use sites, removing `store` from the dep array; move `LevelUpBody`'s 24-line re-destructure into its signature. **Preserve verbatim** the `expectedStatsVersion` comment inside `useHpDialogHandler` and change nothing in its mutation payload (`docs/CONCURRENCY.md`). Do **not** group the 24 props and do **not** touch `SheetDialogState`. | `HpDialogMount` no longer exists; `grep -c "const store = useCombatStore;" packages/client/src/components/campaign/encounters/encounter-detail-view.tsx` returns 0, down from 1; `level-up-dialog-body.tsx` destructures in the parameter position; no test file changed | `bun run test -- packages/client/src/components/campaign/encounters/encounter-detail-view.test.tsx packages/client/src/components/sheet/level-up-dialog.test.tsx` |

### First landing outcome

Merge `6cf8c78d5` landed C1, C2, C3, C4, V1, V2 and O1. That closes leaves
48, 09, 10, 12 and 13; the last closes because O1 landed and every other
leaf-13 step is deliberately dropped. At that point N1, Q1, Q2, Q3, F1, F2,
X1 and O2 were the named remainder; merge `d539cfdbd` later landed all eight
and finished the cluster.

**C3's review found and reproduced a real ordering regression.** Moving surface
resets to layout-effect timing meant a participant selected before mount could
be read during render, cleared by `useSurfaceReset`, and then replayed by the
later selection-sync effect. The resulting state had `selectedTokenId` still
set while `selectedParticipantId` was `null`, exactly the cross-store desync
`stores/MODULE.md` calls the highest-risk failure mode. Two of six reviewers
had dissented before the fix round. Commit `e19f558c6` added the seeded
component regression first, reproduced it, and fixed it by having
`useSelectionSync` subscribe to `selectedParticipantId` only as a re-run
trigger while re-reading the combat store inside the effect body. Commit
`1f12e369a` documents why both halves are load-bearing at the site.

**V1's authorization correction is right and currently unobservable.**
`assertCampaignDm` keys only on `CampaignMember.role`, never on campaign
ownership, so a non-owner DM must gain the client affordances and a bare owner
must lose them. All three panelists independently re-derived that result. The
affected population is empty in data the application can currently produce:
campaign creation is the only production writer of `role: "dm"` and writes it
for the creator; invite acceptance writes `role: "player"`; there is no
role-promotion endpoint. The seeded resolver tests remain the honest guard.
This is an authorization-alignment correction, not a live security or behaviour
change; every mutation still checks server authorization.

**The documentation review repaired three false MODULE claims.** The maps doc
had put tRPC invalidation outside its directory, while `maps-panel.tsx` and
`map-detail-mutations.ts` own it. The stores doc said the stores coupled only
through `useSurfaceReset` and said preferences survived every reset; both were
false. Two claims were inherited. The branch itself made one worse by replacing
a vaguer true statement with a sharper false one. That result sharpens the
pack-wide documentation criterion: editing a factual claim makes the whole
claim review-owned, not only the changed words.

**The whole-tree straggler sweep was clean.** All three panelists independently
confirmed it across `packages/`, `scripts/` and e2e. Keep the standing sweep
criterion; this landing is another case where it produced a useful negative
result rather than bureaucracy.

**Four review remedies are closed-declined, not pending:** converting the
remaining `isDm` half-boundaries in `InitiativeTracker`'s Next Turn control and
`MapCanvas` token dragging (the props drive real boundary behaviour, all values
come from one scope read, and V2 permits stopping short); renaming
`useCampaignViewerScope`; regrouping `createToolAndSelectionActions`; and adding
a `role: null` drawer pin already covered by `drawer-perms.test.ts`.

### Dependency edges

Before this plan's reconciliation, the index recorded
`09 step 1 → 10 → 13 → 12`, `08 ↔ 13/14`, `14 → 17`,
`15's drawer half → 17 step 2`, `11 ↔ 12`. **Four of those five edges dissolve
under this plan** — not because the leaves were wrong about file overlap, but
because the work on the other end of each edge is dropped or merged. The index
now publishes the slice edges below.

- **`C2 → C3` (soft, real).** C3's `useSurfaceReset` calls `resetTransient`; C2
  rewrites its body. Nothing is semantically blocked, but landing C2 first keeps
  the reset semantics settled while C3 moves the call sites. This is the index's
  `09 step 1 → 10` edge, and it survives.
- **`V1 → V2` (hard).** V2 consumes the resolver V1 introduces.
- **`C3 → V2` (soft, file-level).** Both edit `map-detail-content.tsx` and
  `combat-map-content.tsx`. C3 changes hook wiring, V2 deletes props; running
  them concurrently guarantees a rebase in those two files. The index's
  `10 → 13 → 12` chain becomes `C3 → V2` once leaf 13 leaves the schedule.
- **`F2` absorbs leaf 14 step 3**, so the `08 ↔ 14` edge is gone: the move and
  the rename are one commit.
- **`14 → 17` is gone** — leaf 17 step 7 (the `pid` sweep over
  `encounter-detail-view.tsx`) moves to leaf 46, and X1 touches no file O2
  touches.
- **`15's drawer half → 17 step 2` is gone** — the drawer union is dropped, so
  X1's `dispatch` → `begin` rename has nothing to wait for.
- **`11 ↔ 12` is dead** — leaf 11 landed on 2026-07-26.
- **`Q3` and `C4` interact only through the lint ratchet** (they hold the two
  entries in `ratchet/local-no-effect-misuse-client`), not through any source
  file. Either order; the second one to land makes the ratchet empty.
- **Everything else is parallel.** C1, C2, C4, V1, N1, Q1, Q2, Q3, F1 and X1 have
  no edges at all. F2 should follow F1 only because both open the homebrew tree.

### Index reconciliation (applied 2026-07-27)

**Done.** The first landing applied all four items below. They remain here as the
record of what changed and why; do not re-apply them.

1. `00-index.md`, "How to use this pack": replace the client dependency line
   (`09 step 1→10→13→12, 08↔13/14, 14→17, 15's drawer half→17 step 2, 11↔12`)
   with this plan's edges, and point at this file.
2. `00-index.md`, [Leaves](./00-index.md#leaves): point the rows for 08, 09, 10,
   12, 13, 14, 15, 16, 17 and 48 at this plan, and re-size them — 08 L→M, 12
   stays L (two slices), 13 → dropped-with-an-opportunistic-remainder, 14 →
   dropped-with-an-opportunistic-remainder, 15 L→S (NPC half only), 17 M→XS.
3. Each of the ten leaves: add a Status pointer to this plan and record which of
   its steps are dropped permanently (08.6, 08.7, 09.3, 09.4, 10.5, 10.6, 13 in
   full bar step 1, 14.5-14.7, 15.5-15.9, 17.3, 17.5, 17.6), so they are not
   re-scheduled from the leaf.
4. `17-client-hook-naming.md` step 7 and `46-naming-renames.md`: move the
   `pid`/`p`/`m`/`hpPid`/`targetPid` sweep into leaf 46 with its evidence.

## Operational risks

- **C3 is the slice most likely to be over-built.** The temptation is to keep
  going until the stale frame is provably gone. It cannot be proved gone with a
  layout effect (correction 1), and the read gate is dropped. If a test seems to
  demand the read gate, that is the signal to stop and record the frame as a
  known, unreproduced symptom — not to build it.
- **C2 must not change where `activateTargetPick`'s field values come from in a
  way that changes *whether* `setActiveTool`'s `onCancel` path runs.** The bypass
  is deliberate and documented in the comment above `setActiveTool`; routing the
  field set through `buildToolReset` changes the source of the values, not the
  control flow. The existing `confirmTargetPick`/`cancelTargetPick` guard tests
  are the net.
- **C4 moves a ratchet floor down.** That is an *improvement below the floor*,
  which fails `bun run lint:ratchet` by design. Run `lint:ratchet:update` and
  commit the regenerated baseline; no `--allow-worse`, no debt-log entry, and
  never a hand edit (`docs/guides/lint-ratchet.md`).
- **V1 changes a predicate, and the change is invisible on current data.** Owner
  and sole `dm` member coincide for every campaign the app can create
  (`packages/server/src/routers/campaign.ts` is the only production writer of
  `role: "dm"`), so the honest regression guard is the seeded unit test, not an
  e2e. Do **not** write V1 or V2 as a security fix: the client flag only chooses
  which affordances render and every DM-gated mutation is re-checked by
  `assertCampaignDm`.
- **V2's Konva hop is a property of the installed react-konva version.** Prove
  the context bridge with a test before converting any `<Stage>`-hosted consumer,
  and keep the props if explicit-prop testability is judged worth more.
- **F1 is a correctness hazard disguised as a rename.** The three `numStr`
  variants differ in behaviour. Add per-variant coverage before touching them and
  verify each call site against its current output.
- **F2 changes rendered DOM** — added `aria-invalid`/`aria-describedby`, error
  element ids, and a `name` attribute defaulting to `id` that the old homebrew
  and settings markup never emitted. Check e2e page-object selectors per
  `docs/guides/add-e2e-test.md`.
- **Q3 changes loading-state and reset timing**, not data. The observable
  difference lands in `PaginatedResultList`; re-test accumulation, `isFetching`
  versus `isLoading`, and reset-on-filter-change explicitly.
- **Q1's acceptance check is a compile, not a test.**
  `packages/client/src/test/mock-query-invalidation.ts` type-mirrors the module
  via `typeof`; if it still compiles unchanged, the exported shape survived.
- **N1's schema trim is live behaviour.** `"  Gundren  "` starts reaching the
  mutation trimmed. Land it as a deliberate normalisation with its own test, not
  as a side effect.
- **Do not merge the three stores** while working in `stores/`
  (`stores/MODULE.md:17-19`), and do not add server-derived or URL-addressable
  state to any of them (`docs/architecture-plan.md:116`).
- **`stores/MODULE.md:11-12` cites architecture decision #16 at
  "lines 95-96"; it is now at `docs/architecture-plan.md:116`.** Fix the anchor
  in whichever of C2 or C3 edits that doc.

## Second landing outcome — review dispositions

The N1/Q1/Q2/Q3/F1/F2/X1/O2 branch was reviewed before landing. Two of the seven
findings changed a decision this plan had already made; both are recorded here
rather than folded silently into a commit.

- **The `Common` language rule stayed client-owned for Q2, then leaf 55 moved it
  server-side.** The review was right on the landing-time facts: at
  `d539cfdbd`, `components/character-create/create-character-input.ts` was the
  only writer of `{ type: "language", name: "Common" }`, and the server's
  `deriveProficiencies`
  (`packages/server/src/services/character-create-helpers.ts`) derived class
  saving throws, armour, weapons and tools plus background skills and tool —
  never a language — so `character.create` called directly produced a character
  without Common, contradicting the SRD ("Every player character knows Common",
  SRD 5.2.1 *Languages*). It was nonetheless not Q2's to fix: Q2's charter
  forbade touching the injection, and moving ownership required the shared-rules,
  server-boundary and backfill work recorded in leaf 55. That follow-up is now
  closed: `0d97cfa3a` defined the shared rule, `50cfd2479` enforced it on the
  server, `bc39286cc` backfilled existing characters, and `133edc7fd` removed
  the redundant client injection. The current `buildCreateInput` test asserts
  that universal starting languages are server-derived.
- **O2's "change nothing in its mutation payload" constraint was overridden, with
  evidence.** The constraint exists to stop an unmotivated payload edit during a
  micro-tidy, and it held for the alias removal. But `useHpDialogHandler` took
  its target `id` from a fresh `useCombatStore.getState().hpDialogParticipantId`
  read while taking `expectedVersion`, `expectedStatsVersion` and the HP result
  from the participant argument, so the two could describe different rows. A
  seeded test in `encounter-detail-view.test.tsx` reproduces it: the payload goes
  out as participant-3's id carrying participant-2's `expectedVersion` and HP.
  The payload now reads `id: participant.id`; the `expectedStatsVersion` comment
  is preserved verbatim and the concurrency tokens are unchanged in shape
  (`docs/CONCURRENCY.md`). Closing the dialog moved to `HpDialogSection`, which
  owns the store subscription.

### Pre-merge panel — dispositions and charter divergences

A five-model panel reviewed the branch before merge. One P0 and five accepted
P2s changed the branch; three findings were rejected and three deferred with
owners (leaves 55, 56, 57). The divergences from charter are recorded here
rather than folded silently into a commit.

- **Q3 shipped without its schema half, and the client substrate structurally
  could not see it.** `@trpc/tanstack-react-query` merges `direction` into every
  infinite-query request, including the first page. `listMonstersInputSchema`
  and `listMagicItemsInputSchema` are `.strict()` and declared no `direction`,
  so every call was rejected — `BAD_REQUEST` on the compendium magic-item list,
  the NPC monster tab, and adding a monster to an encounter, rendered silently
  as `PaginatedResultList`'s empty state. Only two of five panelists caught it;
  the adjudicator confirmed it as HTTP 400 through `app.inject` before ruling.
  Q3's charter named only client files, so fixing it meant editing
  `packages/shared` from a client slice. **Lesson for the pack's slice
  convention: any slice that changes which tRPC calling convention a procedure
  is consumed by must name the shared input schema in its done criteria.** The
  client mock graph never parses input, so no client test can cover this — the
  coverage lives in shared schema tests plus real transport tests.
- **Q3's `isFetching` rule was propagated to the three lists outside its
  charter.** The slice moved two lists to gating Load more on `isFetching` and
  documented the rule on `PaginatedResultList`, but the three untouched
  controls (campaign notes, the sheet inventory panel, the VTT drawer inventory
  tab) carried the identical hazard, and the note lived where only the two
  already-correct lists could reach it. Leaving it split would have meant the
  branch asserting a rule it did not apply. Both untouched surfaces had zero
  Load more coverage, so both fixes were driven by a new failing test.
  `isFetchingMore` was renamed to `isFetching` through the inventory chain, and
  the rationale moved to `hooks/MODULE.md`. This is a deliberate widening of
  Q3's file list.
- **F2's a11y contract was applied to three controls it did not name.** The two
  compendium search boxes were placeholder-only, and the NPC editor's name error
  was neither announced nor associated with its input. F2's charter listed
  specific call sites, but shipping an a11y slice that leaves adjacent controls
  unnamed defeats its point. The NPC name field now goes through the shared
  `FormField`. F2's "do **not** hoist `FormFieldError`" and "do **not** start on
  the ~49 hand-rolled triples" constraints were **kept** — the review's request
  to make `FormField` consume `FormFieldError` was rejected as exactly that
  forbidden hoist, since the dependency runs `homebrew/shared/` → `common/`.
- **O2 additionally keyed the HP dialog by participant.** Beyond the payload fix
  already recorded above, `HpAdjustmentDialog` holds `mode`/`amount` in local
  state and was rendered without a key, so a retarget while open carried the
  amount typed for the previous participant into an Apply against the next one.
  One line, one test, same defect class as the payload fix.
- **F1's non-finite guards were scope creep, and are kept.** The extra
  `Number.isFinite` checks on `numOnly`/`spd` go beyond "rename the three
  contracts apart", but they are fixes, they are tested, and JSON cannot carry
  `NaN` so nothing observable changes.

Three findings were **rejected**. The `FormField`/`FormFieldError` duplication
is real but narrow (they are the only two error elements carrying an `id`) and
unifying it is the hoist F2 forbids. The claim that the `promote-to-normal-lint`
`exitPath` at `lint-ratchet-config.ts` is a dead pointer is wrong — this plan
predicted and tracked that exact ratchet drain at three places — though the plan
**poses** the promotion question without answering it, and refuting the claim
turned up a genuinely dead `exitPath` elsewhere (leaf 57). The claim that the
row-identity pagination tests are hollow does not hold: `isLoading` requires
`isPending`, which is false once page 1 is cached, so the skeleton branch is
structurally unreachable during `fetchNextPage`.

**Answered — promoted, 2026-07-27.** The question the plan posed was whether
`local/no-effect-misuse` should become a normal-lint rule once this cluster
drained `ratchet/local-no-effect-misuse-client` to zero, which is what the plan
predicted at Q3's verification line. **The ruling is promotion**, taken as
`docs/guides/lint-ratchet.md`'s default outcome for a drained ratchet rather
than as a new policy: the rule encodes a permanent decision rule (effects
synchronize React with external systems), the client scope is fully covered by
normal ESLint, and a zero baseline that stays a ratchet only defers the same
verdict while letting a new finding land in a baseline instead of failing
`bun run lint`.

What that ruling changed:

- `eslint-config/client-configs.js` sets `"local/no-effect-misuse": "error"` on
  the ratchet's exact scope (`clientSourceFiles` less
  `clientTestAndHelperSourceFiles`), at `error` rather than `warn` for the
  reason `docs/guides/lint-ratchet.md` gives — the post-edit tidy hook runs
  `eslint --fix --no-warn-ignored`, so a `warn` can be missed in the edit loop.
- `harness.controls.json` re-points the `lint/local/no-effect-misuse` control's
  invocation at `bun run lint`; `docs/generated/harness-controls.md` and the
  client row of `docs/generated/lint-coverage-map.md` follow.
- The registry entry's `zeroBaselineDisposition` reason now records that
  promotion is done and names the exact retirement sequence, so the `exitPath`
  points at an answered question rather than an open one.

**The retirement was deferred on the comparison ref, not the code — and has
since been done.** Dropping the baseline id made
`lint:ratchet:check-debt-accounting` fail: it accepts a `retirement` record only
when the retired id is *already empty in the merge-base baseline*, and that base
comes from `origin/main`. The drain landed on local `main` (`97f2d5084`, in the
`feat/cq-slice-h` merge `d539cfdbd`) but `origin/main` was 60 commits behind it
and its baseline still carried one finding for this ratchet, so the removal read
as an unaccounted dropped floor. The gate was right on its own terms; the input
was stale.

**Retired on `feat/cq-client-followups` (2026-07-28)**, once `origin/main`
reached `c104b310b` — which has `97f2d5084` as an ancestor and an empty
(`items: {}`) baseline entry for this ratchet, so the accounting input is no
longer stale. The order matters and the earlier note here had it backwards:
`--retire-ratchet` refuses while the id is still registered, because it retires
an *orphaned* baseline entry (`tools/lint-ratchet/src/governance/retire-update.ts`
returns no orphan scope when the registry still contains the id). The sequence
actually run, matching `docs/guides/lint-ratchet.md`:

1. delete the registry entry from `scripts/lint-ratchet/lint-ratchet-config.ts`;
2. `bun run lint:ratchet:update -- --retire-ratchet ratchet/local-no-effect-misuse-client`
   — the normal-lint coverage probe passed and a non-debt retirement record was
   appended to `lint-ratchet.debt-log.jsonl`;
3. drop the `ratchet/local-no-effect-misuse-client` control from
   `harness.controls.json`;
4. regenerate `lint:restricted-disable-rules` and `docs:harness-controls`.

Nothing about the promotion waited on that: the rule already failed `bun run lint`.

The earlier "dead pointer" finding above stands as rejected on its own terms —
the `exitPath` resolved to a real file that tracked the drain — but the weaker
sibling it named (a path can resolve without the document owning a decision) was
live for this entry until now.

## Rejected alternatives — why

| Rejected | Why |
|---|---|
| **A feature-first package root (`features/character-sheet/…`)** | Both consults rejected it independently. The layer split is documented (`pages/MODULE.md:12`), `components/campaign/` is already feature-shaped with a doc per feature, and `components/homebrew/` shows the axis scaling with an explicit shared-folder admission rule. The move rewrites every path cited by six leaves and all 32 client `MODULE.md` files to buy what leaf 48 buys in one commit. |
| **Per-surface Zustand store instances behind providers (codex's Move 1)** | The diagnosis is right and the schedule is not. Measured cost: 454/269/56 references across 37/36/14 files, plus a non-React seam (`hooks/canvas-input/tool-handlers.ts` reaches the canvas store through `getState()` from pointer dispatch) and a logout path outside React (`hooks/auth-context.tsx:21-24`). Measured payoff: one unproven stale frame plus maintainability. Codex's own plan is five slices, three of them large — a programme, not a pack leaf. Recorded as the target shape with explicit revisit triggers. |
| **Splitting `map-canvas-store.ts` by tool family (leaf 09 step 4)** | If it is ever split, the concept boundary is *lifetime* — the five preserved preferences versus the surface-transient rest — not measure/fog/drawing/template. A tool-family split leaves the drift hazard exactly where it is and adds four modules. |
| **`useLayoutEffect` sold as the fix for the stale frame, with a test to match (leaf 10 step 4)** | The proposed test asserts that RTL flushed layout effects, which is true by construction. Descendants have already read the pre-reset snapshot during render and `map-canvas.tsx` forwards it into Konva `<Stage>` props. Keep the layout effect (one word, strictly better); drop the claim and the test. |
| **The `enterSurface(id)` read gate (leaf 10 step 5)** | A store field plus a slice-hook parameter, held in reserve for a symptom that has never been demonstrated. If the frame is ever proven visible on Konva, the proportional answer is store instancing, not a stamp — and building the gate first makes that migration harder, not easier. |
| **Deriving the combat token selection from `selectedParticipantId` (leaf 10 step 6)** | Not a total derivation in either direction: a stage click clears only the token, a tracker click sets only the participant, a context menu sets both, and unlinked participants and unlinked tokens both exist. `selectedTokenId` is also read by the non-combat map surface. |
| **`<MapCanvasFrame>` and the two panel primitives (leaf 13 steps 2, 6)** | `components/vtt/MODULE.md:15-18` already assigns the shared tabletop shell to `VttSurface`. What is left is ~55 lines of chrome across exactly two callers, which is the leaf's own stop condition ("two call sites do not earn a configurable shell"). Codex dropped the leaf outright; cursor called the panel half optional. The one option-free unit survives as O1. |
| **Grouping `SheetDialogState` by dialog and renaming `s`/`d` (leaf 14 steps 5-6)** | One file, no defect, and a documented dep-array identity hazard: listing a per-render group literal in a `useCallback` dep array churns two callbacks and the props they feed. Both consults declined to schedule it. |
| **Replacing `SheetSharedProps` with context — including using leaf 12's provider to remove its three viewer members** | `sheet-props.ts`'s JSDoc records it as the single declaration point from which both layout prop types derive via `Omit`/`Pick`, so a new sheet field is declared once and TypeScript propagates the requirement. Context hides that fan-out instead of removing it, and the sheet route has no campaign-detail ancestor to provide from. The three viewer-shaped members are real overlap and still not worth breaking the derivation for. |
| **The nested-atom drawer union (leaf 15 steps 5-9)** | The modelling is correct — `Partial<A \| B>` distributes, so a top-level union under Zustand's merging `set` (`vtt-drawer-store.ts:42-49`) still admits the illegal states, and only the nested atom carries the guarantee. But the invariant is already guarded at five sites and covered by a 258-line suite, the one unguarded combination renders nothing and no call site produces it, and the price is twelve test files plus eight production selector sites. Both consults declined to schedule it standalone. Revisit when a new drawer mode or cast variant is added — and then do the union first. |
| **Dropping the `query-invalidation` collapse (codex's call on leaf 16 step 1)** | Codex's objection is that it establishes no ownership or correctness boundary. True, and not the bar: the file is 179 lines of two-layer memoization where one layer does the work, adding an invalidation is a three-place edit, and forgetting the third leaves a silently stale entry. The acceptance check is mechanical. Cursor called it the best part of the leaf; kept. |
| **A descriptor map plus a generic binder for `query-invalidation.ts`** | The seventeen operations span six shapes (zero-arg, one-arg over five different key names, `removeQueries`, `infiniteQueryFilter`, two multi-filter entries, one optional-argument branch). A descriptor general enough plus the mapped type to keep each key's parameter list intact is longer than the closures it replaces. |
| **Renaming the four `realtime-invalidation.ts` hooks (leaf 17 step 6)** | Six call sites of pure rename churn across socket-subscribed cache invalidation, for readability, with `docs/guides/add-client-feature-module-cache-socket.md` in the loop. Non-zero risk, no finding. |
| **Dropping `useSpellSlots`/`useSorceryPoints`'s unread parameters (leaf 17 step 5)** | The only item in leaf 17 with runtime risk: it is behaviour-preserving only if the echoed values reach all four read sites by another route in the same commit, and the `?? 0` defaults are load-bearing because `character.stats` is optional. Cosmetic gain, real hazard. |
| **The `pid` → `participantId` sweep as part of leaf 17** | It is a pure rename across six files with two camel-cased carriers the obvious regex misses. Leaf 46 owns pure renames; moving it there is what removes the `14 → 17` sequencing edge. |
| **Converting the ~49 hand-rolled `Label`→`Input` triples (leaf 08 step 6)** | The leaf deliberately excludes it from its own size estimate, and ~32 of the 83 labeled blocks pair `Label` with `Select`/`Textarea`/`Checkbox`, which one `Input`-shaped primitive cannot absorb. If it is ever wanted it is a separate commit series after F2, not part of it. |
| **Hoisting `numOnly`, `numWithFallback` or either `parseStringArray` into `homebrew/shared/`** | Each has exactly one consumer, and `homebrew/shared/MODULE.md:20-21` sets a two-consumer admission threshold. Renaming in place is the complete fix; this plan does not get to relax that folder's own rule. |
| **Splitting `components/sheet/` into subdirectories as part of leaf 48** | It would move every path cited by six other leaves in this pack for no gain, and the flatness is not the finding — the undocumented external surface is. Argue a split separately, and after the doc has established which modules are entry points. |

## Historical review — `feat/cq-client-followups` round 2

**Historical: this round's branch has since landed** (merge `c5985d1da`). The
findings below are the record of why round three existed, not open work — the
Branch A ones are closed, and the two freshness ones are
[leaf 63](./63-character-assignment-cross-client-freshness.md).

Branch `feat/cq-client-followups` (`c104b310b..d007f508f`) was complete, committed
and gate-green but unmerged at the time. A second review round found the first
fix round incomplete. Full findings: Codex consult, priority-tagged with citations.

Round 1 raised one P1 and three P2s; the four fix commits (`94d676084`,
`9ad06761b`, `fe7f7f27c`, `d007f508f`) addressed them. Round 2's verdict was *not
mergeable*, on two counts plus two follow-ons:

- **[P1] Assignment freshness is still confined to the mutating tab.** The fix
  invalidates both sides of the swap in that tab's `QueryClient`
  (`members-panel.tsx:104`), but the server emits only `campaign:updated` after
  assignment (`routers/campaign.ts:261`, `:295`), an open sheet listens only for
  `character:updated` (`hooks/realtime-invalidation.ts:183`), and an unlinked
  sheet is not in the campaign room at all. Assign from tab B and tab A keeps
  `campaignId: null` and local-only rolls until an incidental refetch. The
  reported symptom is fixed; the defect is still reachable through ordinary
  multi-tab/multi-device use.
- **[P2] The identity-as-capability defect moved into inventory.** The layout
  still passes raw `linkedCampaignId` to inventory (`sheet-layout.tsx:236`); any
  non-null value presents a Homebrew tab (`add-item-dialog.tsx:189`) that requests
  campaign entries the server gates on membership (`homebrew-campaign.ts:113`). A
  nonmember on a public linked sheet gets a guaranteed authorization failure —
  a fourth member-only affordance, not a server-authorized mutation path.
- **[P2] Campaign deletion is another uncovered writer of the sole identity.**
  Deleting a campaign cascades `CampaignMember` (`schema.prisma:1156`), flipping
  every surviving assigned character's mapped `campaignId` to `null`, but the
  client delete path invalidates no character (`campaign-settings-panel.tsx:130`)
  and the server sends no character freshness event (`routers/campaign.ts:214`).
- **[P2] The replacement tests still do not pin their claimed boundaries.** The
  assignment tests never cover an old-character → new-character swap
  (`members-panel.test.tsx:208`), so a regression retaining old-character
  invalidation only for explicit unassign passes. The roll spy observes only
  `useAbilityRoll` (`sheet-layout.test.tsx:166`) while weapon and ability hooks are
  independent calls (`sheet-state.ts:121`), so changing only `useWeaponRoll` to
  receive `undefined` survives; the comment's claim that the spy covers inventory
  and DM callbacks is wrong — those are wired outside that seam.

Confirmed sound and needing no further work: the delayed campaign link is the
right tradeoff over an instantly-404ing one; the deliberately raw server-authorized
paths (presence, socket invalidation, dice, DM stat mutations, inventory read/write)
are each genuinely re-checked server-side; and the ratchet retirement in
`d007f508f` is internally consistent — registry, baseline, harness control and
generated docs agree, normal lint still enforces `local/no-effect-misuse` as an
error, and delisting it from `ratchet-restricted-disable-rules.generated.js` is the
generator's design (`generate-restricted-disable-rules.ts:11`), not an accident.

**Design question for the owner, before a third fix round.** The reviewer accepts
the conceptual model — `character.campaignId` as sole association, membership as a
viewer-specific capability — but judges the implementation drift-prone: two optional
strings distributed by hand to each consumer, with the inventory miss as evidence
that the next consumer will be missed too. Proposed instead: a discriminated sheet
campaign context (`unlinked | resolving | nonmember | member-with-role`) that makes
each consumer's requirement explicit at the type level. That is a larger change than
the remaining fixes and should be decided before, not after, round three.

## Decided — design panel, 2026-07-28

Three panelists (Opus 5, Fable 5, GPT/Codex with its own six internal angles)
answered the question independently against the live tree. The owner adjudicated
the panel. Decisions below are binding on round three.

**Adopt the discriminated context — but the union is not the enforcement.** All
three panelists converged, unprompted, on a point the round-2 proposal did not
make: a union whose consumers destructure back to a bare `string` reproduces the
exact defect it is meant to prevent. The inventory miss happened because
`campaignId` and `memberCampaignId` are both `string | undefined`
(`sheet-layout.tsx:111,124`) — mutually assignable, so the wrong grab compiles
silently. Codex's consumer-inventory angle put it flatly: *a union without narrow
consumer props is ceremony.* So the enforcement lives in the **consumer prop
types**, not in the discriminant:

- Member-capability consumers — `SheetCampaignLink`, `SheetGameLog`,
  `SheetSharedProps`' mobile-Log gate, and inventory → `AddItemDialog` →
  `HomebrewItemTab` — take the narrowed member variant, not a string.
- Identity consumers with a server backstop — presence, the character socket,
  both roll hooks and `useDmStatsCallbacks` — keep a plain optional id via one
  centralized projection. Do **not** brand these: presence and character-socket
  room access are re-checked by `campaign-room-handler.ts`, while campaign roll
  and DM stat/HP operations are re-checked by `character-auth.ts`. Branding them
  buys casts at the socket edge for nothing.
- `useRollPermission` takes the whole context: unlinked rolls are viewer-local
  UI with no request or shared record, while linked rolls require character
  ownership or a resolved DM membership.
- `isCampaignDm` is the third direct projection for DM-only stat affordances.

The acceptance test for the change is mechanical: after it,
`buildInventoryProps(character.id, linkedCampaignId, …)` (`sheet-layout.tsx:236`)
must fail to compile. The round-2 defect becomes a `tsc` failure rather than a
documented promise.

**Five states, discriminant `status`.** `unlinked | resolving | nonmember | error
| member`, with `role` (the shared `"dm" | "player"`) and `userId` carried only on
`member`. The fifth state is Codex's, and it is a correctness point rather than a
naming one: `campaign.get` returns `NOT_FOUND` for both nonmembership and a
missing campaign (`routers/campaign.ts:145-168`), while a transport failure is not
evidence of nonmembership. Two constraints keep it from being speculative — `error`
must render **identically** to `resolving` and `nonmember` (fail closed, no new UI,
no loading flash the sheet does not have today), and cached `member` must **not** be
demoted when a background refetch fails. Pin both with tests.

**No React context provider, and no effect.** `SheetSharedProps` stays the single
declaration point propagated through both simultaneously-mounted responsive trees;
the earlier rejection at line 591 of this file stands and this change does not
reopen it — it changes the type of one member and leaves the `Omit`/`Pick`
derivation working unchanged. Every value here is derived from query results, so it
is computed during render per `docs/guides/client-effects.md`. A round-three
implementation that reaches for `useEffect` to maintain this context is wrong and
should be rejected on sight.

**Round three is two branches, and the split is not the one round 2 assumed.**

- **Branch A (client typing, on top of `feat/cq-client-followups`).** The
  discriminated context, the inventory member-gate absorbed into it, the
  members-panel old→new swap test, and the sheet roll-seam test rewritten to pin
  `useWeaponRoll` as well as `useAbilityRoll` (`sheet-state.ts:121-122` are two
  independent calls, so today's spy proves nothing about the other). ~4 commits.
- **Branch B (socket association freshness, new leaf).** The multi-tab P1 and the
  campaign-deletion cascade are **not** client-shape problems and no context type
  helps them. `campaign-room-handler.ts:99` is the server's only `socket.join`, so
  an unlinked sheet is in no room that could carry the message. The mechanism is a
  new user-targeted `character:associationChanged` event rather than widening
  `character:updated` (which requires `campaignId` and is campaign-room scoped,
  `socket-events.ts:63-68`); `broadcast-registry.ts:186-200` already supports
  global user-filtered delivery. Emitted after persistence per ADR-0003.

Branch A must not claim to fix freshness, and Branch B must not be folded into it —
all three panelists independently said mixing them is what would make round three
unlandable.

**Noted for a separate leaf, not for round three** — filed 2026-07-30 as
[leaf 66](./66-sheet-owner-capability-gate.md), which re-scopes it to the whole
sheet and to affordance rather than authorization. `InventoryPanel` renders the
Add button and per-row Edit/Delete with no owner gate at all
(`inventory-panel.tsx:197-235`; `buildInventoryProps` passes the mutation callbacks
unconditionally). The round-2 Homebrew finding is the narrow half of this: a
nonmember on a public sheet is offered the whole mutation surface, and the Homebrew
tab is merely the one *guaranteed* to fail rather than merely refused. Same defect
class, wider than the typing change, and it should not be quietly absorbed.

## Implemented — Branch A (landed, merge `c5985d1da`)

`feat/cq-client-followups` implements the Branch A decision above. The
discriminated sheet context is enforced at member-capability prop boundaries;
inventory Homebrew access consumes that capability; the old→new and rapid
none→old→new assignment invalidation cases are pinned; both roll hooks receive
the authoritative link; and `resolving`, `nonmember` and `error` are compared
through the rendered layout. The route search identity is removed.

This closes the Branch A findings recorded in the historical round-two section.
It does **not** close association freshness as a class: the multi-tab/device
assignment case and campaign-deletion cascade remain Branch B work under the
user-targeted `character:associationChanged` design, now filed as
[leaf 63](./63-character-assignment-cross-client-freshness.md).
