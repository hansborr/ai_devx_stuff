# 15. Two client state shapes are wider than their legal values, so invariants are enforced by hand instead of by the type

Status: **Landed 2026-07-27 on branch `feat/cq-slice-h` (merge
`d539cfdbd`)** through [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md) slice
**N1**; the plan supersedes and shrinks this leaf (L→S). Steps 1-4 landed.
**Steps 5-9, the drawer half, are dropped permanently**; revisit the nested
union only if a new drawer mode or cast variant is added, and do it first then.
Theme: Discriminated client state · Area: client · Severity: medium · Size: L

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

Two unrelated-looking client surfaces share one shape problem: the declared type
admits combinations that the code never intends to produce, so every consumer has
to re-establish the real invariant at runtime — with a guard clause in one case
and a type assertion in the other. Neither is a live defect. Both are places
where the type system is currently *not doing the job it could do*, and where a
future contributor adding an action or a branch has nothing stopping them from
producing an illegal state.

**The VTT drawer store.** `VttDrawerState` has five parallel nullable fields —
`target`, `mode`, `castingSpellId`, `castAtLevel`, `castTargetTokenId` — which
makes combinations like `mode: "placing-cast"` with `castingSpellId: null`, or
`mode: "full"` with `target: null`, fully type-representable. In practice they
cannot occur, because every action opens with an explicit early-return guard
(`if (get().target === null) return`, `if (get().mode !== "collapsed-cast-rail")
return`). That is a hand-maintained invariant with test coverage rather than a
compiler-checked one: the guards are correct today, and the type gives no help to
whoever adds the next action. One combination is not guarded at all:
`collapseForCast` requires only a non-null `target`, while the sole consumer of
the cast fields discards anything but a character target
(`in-vtt-drawer.tsx:145`), so a `"collapsed-cast-rail"` state carrying a monster
target is both representable and constructible through the store's own API, and
renders nothing. Only the call sites keep it from occurring.

**The NPC form.** `NpcFormData` carries optional `campaignId?` and `id?` next to
the seven real form fields, so one type stands in for three different things: the
editable draft, the create payload, and the update payload. The submit handler
then does the work twice — it picks a schema at runtime, builds an `input` object
two different ways, `safeParse`s it, and then **throws `result.data` away**,
calling `onSave` with the raw fields plus a re-derived `id`/`campaignId`. Because
the payload that reaches the parent is the wide optional shape rather than the
parsed one, the parent has to assert its way back to a mutation input — and those
are the only two non-test type assertions in the entire `npcs/` directory, each
carrying a `type-assertion-boundary` marker whose stated reason is literally that
the optional-field shape cannot be narrowed.

## Evidence

- `packages/client/src/stores/vtt-drawer-store.ts:9` — `type DrawerMode = "full" | "collapsed-cast-rail" | "placing-cast" | null`.
- `packages/client/src/stores/vtt-drawer-store.ts:11-18` — `VttDrawerState` with the five parallel nullable fields.
- `packages/client/src/stores/vtt-drawer-store.ts:83` — `collapseForCast`, guarded at `:84` by `if (get().target === null) return;`.
- `packages/client/src/stores/vtt-drawer-store.ts:97`, `:101`, `:105` — `setCastAtLevel`, `beginCastPlacement` and `setCastTargetTokenId`, each opening with a `if (get().mode !== ...) return;` guard. `expand` at `:109` guards on `target === null`.
- `packages/client/src/components/vtt/in-vtt-drawer.tsx:145` — `resolveCastContext` returns `null` for `target.type !== "character"`, so the cast modes a monster target can reach through `collapseForCast` render nothing.
- `packages/client/src/stores/vtt-drawer-store.test.ts` (258 lines) — already asserts these transitions; the invariant is covered, just not typed. The store itself is 138 lines.
- Blast radius: 220 `useVttDrawerStore.getState()`/`.setState()` occurrences in `packages/client/src`, but only **12 are production code** — `hooks/vtt-drawer/use-cast-placement.ts:52`/`:83`/`:86`, `use-weapon-attack.ts:89`/`:104`/`:107` and `use-monster-attack.ts:67`/`:86`/`:89`, plus `components/vtt/vtt-action-bar.tsx:67`, `components/vtt/drawer/confirm-cast-strip.tsx:262` and `components/campaign/tokens/token-context-menu.tsx:43`. All 12 invoke actions off the store; none read a state field. The remaining ~207 are in test files, plus one reset in `src/test/setup.ts` — the cost here is overwhelmingly test migration, not production rewiring (see step 8).
- 16 production selector call sites (`useVttDrawerStore((s) => …)`), split evenly: 8 read state fields (`in-vtt-drawer.tsx:208-210`, `vtt-surface.tsx:33`, `confirm-cast-strip.tsx:146-147`, `cast-rail-slot-picker.tsx:16`, `cast-rail.tsx:140`) and 8 select actions (`in-vtt-drawer.tsx:211`, `cast-rail-slot-picker.tsx:17`, `spells-tab.tsx:223`, `actions-tab-spells.tsx:110`, `cast-rail.tsx:138-139`, `map-detail-content.tsx:72`, `combat-map-content.tsx:84`).
- Tests build partial *flat* state via `useVttDrawerStore.setState({...})` at 13 sites across 8 files, and assert on `useVttDrawerStore.getState().<field>` at 53 sites across 10 files; the union of the two is 12 test files (enumerated in step 8).
- `packages/client/src/components/campaign/npcs/npc-editor.tsx:18-28` — `NpcFormData` with optional `campaignId?` and `id?` alongside the seven real fields.
- `packages/client/src/components/campaign/npcs/npc-editor.tsx:180-182` — runtime schema pick, two-way `input` construction, `safeParse`.
- `packages/client/src/components/campaign/npcs/npc-editor.tsx:189` — `onSave({ ...fields, ...(isEditing && npc ? { id: npc.id } : { campaignId }) })`: `result.data` is discarded and `id`/`campaignId` are derived a second time.
- `packages/client/src/components/campaign/npcs/npc-panel.tsx:243` — `handleSave(data: NpcFormData)`.
- `packages/client/src/components/campaign/npcs/npc-panel.tsx:252` and `:255` — `data as NpcFormData & { id: string }` and `data as NpcFormData & { campaignId: string }`, the only two non-test assertions in `npcs/`, each with a `type-assertion-boundary: interop` marker explaining that the truthy check on an optional field does not narrow.

## Proposed direction

Do the NPC change first — it is small, self-contained, and deletes two lint
markers, which makes it a good rehearsal for the larger store change.

1. **Split the NPC draft from the submit payload.** Keep `NpcFormData` (or rename
   it `NpcFormFields`) as the seven editable fields only, with no optional `id` /
   `campaignId`.
2. **Change `onSave` to take `CreateNpcInput | UpdateNpcInput`** — the parsed
   output of the two shared schemas — and have `handleSubmit` in `npc-editor.tsx`
   pass `result.data` through instead of rebuilding the object. This removes the
   double derivation of `id`/`campaignId` at `:181` and `:189`.
3. **Delete both assertions and both markers** in `npc-panel.tsx:243-257`: with a
   discriminated payload, `handleSave` branches on the presence of `id` in a way
   the compiler follows, and each branch hands the mutation an already-correct
   input.
4. **Account for the schema coercion in step 2.**
   Both schemas trim the name (`npc-inputs.ts:19`, `:38`
   `z.string().min(1).max(MAX_NAME_LENGTH).trim()`), and
   `createNpcInputSchema:20-25` applies `.default("")` / boolean defaults. The
   defaults are inert here because `defaultsFromNpc` (`npc-editor.tsx:138-149`)
   always supplies all seven fields, but the trim is live: for a name entered
   with leading or trailing whitespace, `result.data.name` differs from
   `fields.name`, so `onSave` starts receiving the trimmed value. This does not
   change what is stored — `npc.ts:102` and `:147` re-parse with the same two
   schemas server-side — so the delta is confined to the payload the client
   sends and anything reading it optimistically. Land it as a deliberate
   normalisation with a test that submits `"  Gundren  "` and asserts the
   mutation input, not as an incidental side effect.
5. **Model the drawer as a discriminated union held in one nested atom.** Define
   a `DrawerState` union keyed on `mode`: a closed state (no `target`), an open
   `"full"` state (`target`, no cast fields), a `"collapsed-cast-rail"` state
   (`castingSpellId`, `castAtLevel`), and a `"placing-cast"` state (the previous
   fields plus `castTargetTokenId`). Narrow the target on the two cast variants
   to the `{ type: "character" }` member of `DrawerTarget`: the cast surfaces are
   character-only (`in-vtt-drawer.tsx:145`), and encoding that is what stops the
   monster-target-in-cast-mode state the current `collapseForCast` guard lets
   through. **Do not put that union at the top level of the store state.**
   Zustand's `set`/`setState` merge partials
   (`vtt-drawer-store.ts:42-49` types the setter as
   `Partial<VttDrawerStore> | …` with `replace: false`), and `Partial<A | B>`
   distributes, so a top-level union still accepts `setState({ mode:
   "placing-cast" })` and merges it into a `"full"` state — exactly the illegal
   combination the change is supposed to abolish. Instead make the state a
   single-field wrapper (`interface VttDrawerState { drawer: DrawerState }`) and
   have every action replace `drawer` whole. A partial update then has to supply
   a complete, valid variant, which is what makes the bad states
   unconstructible. Preserve the devtools action names passed as `set`'s third
   argument (`"openCharacter"`, `"collapseForCast"`, …).
6. **Give the transitions explicit constructors.** Keep the actions as the only
   sanctioned writers and express each one as `next = fromX(prev, …)` returning
   a whole `DrawerState`, so the current early-return guards at `:84`, `:97`,
   `:101`, `:105` and `:109` become "this transition is not defined for that
   variant" rather than free-standing checks. Do not delete a guard until its
   variant check is genuinely doing the work.
7. **Export narrow selectors for the 8 production sites that read state fields.**
   Today they read `s.target`, `s.mode`, `s.castingSpellId`, `s.castAtLevel`,
   `s.castTargetTokenId` directly (`in-vtt-drawer.tsx:208-210`,
   `vtt-surface.tsx:33`, `confirm-cast-strip.tsx:146-147`,
   `cast-rail-slot-picker.tsx:16`, `cast-rail.tsx:140`). The other 8 of the 16
   selector call sites select *actions* (`close`, `setCastAtLevel`,
   `collapseForCast`, `expand`, `reset`), as do all 12 production
   `useVttDrawerStore.getState()` usages; those are unaffected, because actions
   stay at the top level of the store under the step 5 nested atom. Under the
   union, the cast fields exist on only some variants, so
   `s.drawer.castingSpellId` will not typecheck — supply
   `useDrawerMode`, `useDrawerTarget`, `useCastingSpellId`, `useCastAtLevel`,
   `useCastTargetTokenId` that switch on the variant and return the primitive or
   `null`. Selector-level primitives keep the per-field re-render granularity the
   flat fields have today.
8. **Migrate the tests last**, in their own commit. Eight files build partial
   flat state with `useVttDrawerStore.setState({...})`:
   `stores/vtt-drawer-store.test.ts:161`, `components/vtt/in-vtt-drawer.test.tsx:101`/`:114`,
   `drawer/cast-rail-slot-picker.test.tsx:73`/`:114`, `drawer/cast-rail.test.tsx:186`,
   `drawer/confirm-cast-strip.test.tsx:160`/`:233`/`:283`/`:344`,
   `drawer/tabs/spells-tab.test.tsx:372`, `drawer/tabs/actions-tab.test.tsx:323`
   and `hooks/vtt-drawer/use-cast-placement.test.ts:132`. Every
   `useVttDrawerStore.getState().<field>` assertion also moves to
   `.getState().drawer.<field>` — 53 of them across ten files, which pulls in
   four more (`use-weapon-attack.test.ts`, `use-monster-attack.test.ts`,
   `vtt-action-bar.test.tsx`, `token-context-menu.test.tsx`) for twelve test
   files total, and is the bulk of the diff rather than the `setState` builders.
   Give them a small test helper that constructs a valid union state rather than
   letting each test hand-assemble a partial object — that is the point of the
   change, and it should be visible in the tests.
9. **Update `packages/client/src/stores/MODULE.md`** (state-ownership table and
   the reset-contract section) per `docs/guides/add-module-doc.md`, and re-read
   `docs/guides/add-client-feature-module-cache-socket.md` before touching the
   store's consumers.

## Scope / caveats

- **Do not merge the three client stores.** `stores/MODULE.md` documents that
  `useMapCanvasStore`, `useVttDrawerStore` and `useCombatStore` are deliberately
  separate so each surface subscribes to a narrow slice without re-rendering on
  unrelated changes. That separation does not block this change — selectors
  returning primitives out of a union still give per-field granularity — but it
  does forbid "simplifying" by consolidating stores while you are in here.
- **The drawer store is not a bug fix.** The invalid combinations are prevented
  at runtime by the action guards at `:84`, `:97`, `:101`, `:105` and `:109`, and
  are covered by `vtt-drawer-store.test.ts`; the one combination the guards do
  not cover (cast mode over a monster target) renders nothing and no call site
  produces it. This is type-level tightening of an invariant currently enforced
  by hand. Do not write the commit
  message or the tests as if a defect were being repaired, and do not let the
  refactor loosen or delete a guard on the theory that "the type covers it" until
  the union genuinely makes that state unconstructible. Note that a union alone
  does **not** achieve that under Zustand — see step 5; the nested atom is the
  part that carries the guarantee, and without it this change is a rename with
  extra steps.
- **The reset contract is load-bearing.** `stores/MODULE.md` documents a
  cross-store reset invariant that runs through this store: the combat map route
  resets all three stores in one effect keyed on `map.id` / `encounter.id`; the
  map canvas uses `resetTransient` (preserving user preferences), not full
  `reset`; and logout resets the combat + canvas pair but deliberately **not** the
  drawer. Preserve all of that exactly, and update the MODULE.md tables if the
  union changes what "initial state" means. This is why the drawer half is rated
  medium risk despite the file being only 138 lines.
- Sizing is asymmetric: the NPC half is genuinely small and low-risk
  (S on its own); the drawer half carries the L. Step 7 is why: under a nested
  union the cast fields no longer exist on every variant, so the 8 production
  sites that read state fields must move onto selector helpers — on top of the
  store rewrite, twelve test files and the MODULE.md tables. The other 8 selector
  call sites and all 12 production `getState()` usages select actions and are
  unaffected, so this is not a 16-site production sweep. If the drawer work needs
  to be deferred, ship steps 1-4 on their own — they have no dependency on
  steps 5-9.
- Removing the two `type-assertion-boundary` markers changes lint-suppression
  counts; if any ratcheted rule moves, follow `docs/guides/lint-ratchet.md`, and
  see `docs/guides/local-eslint-rules.md` for the marker rules themselves.
- **Sequencing: the drawer half (steps 5-9) must land before leaf 17 step 2.**
  Both rewrite the same seam. Leaf 17 step 2 renames `use-cast-placement.ts`'s
  `dispatch` member to `begin` — not `beginCastPlacement`, a name leaf 17
  explicitly rejects because the hook already calls the store action
  `beginCastPlacement()` — touching `use-cast-placement.ts`, its co-located
  `use-cast-placement.test.ts` and `cast-rail.tsx:156`, the same hook and test
  this leaf re-points at a new state shape (`use-cast-placement.ts:52` reads
  `useVttDrawerStore.getState()` wholesale; `use-cast-placement.test.ts:132`
  builds partial flat state). Land the structural change first and rename
  afterwards, or combine them. Leaf 17 step 1 (module-private `ApplyInput` type
  renames) and its other member renames touch no file this leaf edits, so they
  are unordered relative to it; the NPC half (steps 1-4) is independent of leaf
  17 either way.
