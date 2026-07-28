# 17. Client hook and prop APIs carry no domain meaning, so MODULE.md has to carry it instead

Status: Open under [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md) slice
**X1**; the plan supersedes and shrinks this leaf (M→XS). Steps 1, 2 and the
step-4 doc rider remain. **Steps 3, 5 and 6 are dropped permanently. Step 7 has
moved to leaf 46**, whose server/comments plan accepted it and ruled it
opportunistic-only, not scheduled.
Theme: Client vocabulary · Area: client · Severity: low · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

Across the client hooks and the encounter/combat components, the public surface
of a module frequently does not say what the module does. The signature is
correct but content-free, so the meaning has been pushed into prose docs, into
the caller's local variable names, or into nothing at all. Four instances,
one cause:

**Content-free verbs in `hooks/vtt-drawer/`.** Six sibling hooks all return a
member called `apply`, and a seventh returns `dispatch`. `apply` means "swing a
weapon", "spend a feature use", "adjust monster HP by damage/heal/temp-HP mode",
"resolve a monster attack", "drop concentration", and "cast the spell" depending
on which file you are in; five of the six also declare their own module-private
`interface ApplyInput`, all five with entirely unrelated members, while
`useMonsterAttack` has no input or result interface at all — its `apply` takes a
`StructuredMonsterAction` directly and the hook's return type is inferred.
`dispatch` in `use-cast-placement.ts` means "begin cast placement" and has
nothing to do with a reducer. One directory therefore uses two verbs for seven
distinct domain operations, and `vtt-drawer/MODULE.md` has to spell out in prose
what each hook does — because the API surface cannot.

The severity is bounded by how the members are consumed: six of the seven call
sites already bind the hook result to a domain-named local (`weaponAttack.apply`,
`featureUse.apply`, `drop.apply`, `monsterAttack.apply`, `cast.apply`,
`placement.dispatch`), so the reader does get the noun. Only
`monster-hp-control-strip.tsx:20` destructures the bare member. The real,
unqualified defects are therefore the five colliding `ApplyInput` declarations,
the misleading `dispatch`, and — for readers of the hook files themselves — the
declaration sites. A blanket noun-prefixed rename would fix the declaration and
break the call sites (`weaponAttack.beginWeaponAttack`); see the direction.

**Hooks that take state they never read.** `useSpellSlots(characterId, slots)`
accepts `slots`, never touches it, and returns it untouched. `useSorceryPoints`
does the same with two numbers. Every other hook in
`hooks/character-sheet/` takes `characterId` only, so these two are the lone
outliers against an otherwise consistent convention — and the values they echo
come straight off the same `character` object the caller already holds.

**`use*Socket` hooks return `void` while `useSocket` one directory over returns
the socket.** The four hooks in `realtime-invalidation.ts` are named for
connection but do invalidation; they subscribe and invalidate and return
nothing. The name collides conceptually with `use-socket.ts`, which does return
the handle, and the test setup carries an explanatory comment because the
distinction is not visible from the names.

**The `pid`/`p`/`m` rename finding no longer belongs to this leaf.** The client
cluster moved it to [leaf 46](./46-naming-renames.md), which owns pure renames.
Its evidence and verification moved with it; do not schedule it from here.

Individually each is cosmetic. Together they are why a reader of this area has
to open the implementation, or the MODULE.md, to answer questions the names
should have answered.

## Evidence

- `packages/client/src/hooks/vtt-drawer/use-weapon-attack.ts:30`,
  `use-feature-use.ts:14`, `use-drop-concentration.ts:13` (optional input),
  `use-monster-hp-update.ts:17`, `use-monster-attack.ts:64`,
  `use-confirm-cast.ts:19` — `apply` in **six** hooks. Return sites:
  `use-monster-hp-update.ts:68`, `use-weapon-attack.ts:114`,
  `use-monster-attack.ts:96`, `use-confirm-cast.ts:133`, `use-feature-use.ts:55`,
  `use-drop-concentration.ts:63`.
- `packages/client/src/hooks/vtt-drawer/use-weapon-attack.ts:25`,
  `use-feature-use.ts:8`, `use-confirm-cast.ts:9`, `use-monster-hp-update.ts:10`,
  `use-drop-concentration.ts:8` — five unrelated module-private
  `interface ApplyInput` declarations (`{weaponItemId}`,
  `{characterFeatureId}`, a six-field cast payload,
  `{participant, mode, amount}`, `{onSuccess?}`). `use-monster-attack.ts`
  declares none: only `interface UseMonsterAttackArgs` (`:28`), and
  `useMonsterAttack` (`:34-38`) has no return-type annotation — its result
  object is returned inline at `:96`.
- `packages/client/src/hooks/vtt-drawer/use-cast-placement.ts:36`
  `readonly dispatch: () => void`, returned as the hook's sole member at `:91`.
- `packages/client/src/stores/vtt-drawer-store.ts:26` — the store action already
  named `beginCastPlacement`. `use-cast-placement.ts:58`, `:68`, `:75`, `:79`
  **call** that action; the hook member additionally drives
  `canvas.setTemplateSize` / `setActiveTool` / `activateTargetPick`
  (`:56-57`, `:80-88`), so it is a strictly larger operation than the store
  action of that name.
- Call-site binding of the seven members — six qualified, one bare:
  `components/vtt/drawer/tabs/actions-tab.tsx:47,64` (`weaponAttack.apply`),
  `tabs/features-tab.tsx:34,50` (`featureUse.apply`),
  `cast-rail.tsx:47,66` (`drop.apply`), `cast-rail.tsx:146,156`
  (`placement.dispatch`), `confirm-cast-strip.tsx:41,180` (`cast.apply`),
  `monster-stat-block-drawer.tsx:133,151-165` (`monsterAttack.apply`), and
  `monster-hp-control-strip.tsx:20` — `const { apply, isPending } = useMonsterHpUpdate(...)`,
  the only bare destructure.
- `packages/client/src/hooks/vtt-drawer/use-monster-hp-update.ts:46-66` — the
  member named `apply` early-returns on non-positive amounts and on null
  `currentHp`/`maxHp`, then runs `applyHpAdjustment({ mode, amount, currentHp,
  maxHp, tempHp })` (`@musi/shared/rules/combat.js`) and writes the **derived**
  `currentHp`/`tempHp`. It never assigns a caller-supplied HP value.
- `packages/client/src/hooks/vtt-drawer/MODULE.md:33-38`, `:51-98` — entry-point
  list plus per-hook prose describing behaviour the member names omit. The
  entry-point list omits `useMonsterAttack` (it appears only in State Ownership
  at `:71`) even though `components/vtt/drawer/monster-stat-block-drawer.tsx:6`
  imports it and `:133`, `:151`, `:157`, `:163`, `:165` consume it.
- `packages/client/src/hooks/character-sheet/use-spell-slots.ts:8`
  `UseSpellSlotsResult`, `:25-27` signature takes `slots`, `:88` returns it
  unread.
- `packages/client/src/hooks/character-sheet/use-sorcery-points.ts:8`
  `UseSorceryPointsResult`, `:31-34` takes both numbers, `:64-65` echoes both.
- `packages/client/src/hooks/character-sheet/use-weapon-masteries.ts:15`,
  `use-rest.ts:24`, `use-inventory.ts:35`, `use-character-stats.ts:99`,
  `use-character-spells.ts:29`, `use-character-personality.ts:14`,
  `use-character-level-up.ts:13` — every sibling takes `characterId` only.
- `packages/client/src/pages/character-sheet/sheet-state.ts:93` passes
  `character.spellSlots`; `:96-99` passes `character.stats?.sorceryPoints ?? 0`.
- `packages/client/src/pages/character-sheet/sheet-layout.tsx:167` and `:261`
  forward `s.spellSlotData`, `:247` forwards `s.sorceryPoints`; none of the three
  reads an echoed value. The reads are two layers down: `slotHook.slots` at
  `pages/character-sheet/sheet-dialogs.tsx:203` and `pages/sheet-helpers.ts:184`;
  `props.sorceryPoints.sorceryPoints` / `.sorceryPointsMax` at
  `components/sheet/desktop-sheet-layout.tsx:100`, `:103`, `:104` and
  `components/sheet/mobile-sheet-tabs.tsx:195`, `:198`, `:199`. Both layouts
  already source the slot list straight from `character.spellSlots`
  (`desktop-sheet-layout.tsx:106`, `mobile-sheet-tabs.tsx:201`).
- `packages/client/src/components/sheet/sheet-props.ts:50`
  `sorceryPoints?: UseSorceryPointsResult` — the prop type both layouts derive
  from (`desktop-sheet-layout.tsx:23`, `mobile-sheet-tabs.tsx:27`), so dropping
  the echoed fields from the hook result changes this shared interface too.
- `packages/client/src/hooks/realtime-invalidation.ts:55`, `:87`, `:134`, `:172`
  — four `use*Socket` hooks declared `: void`;
  `packages/client/src/hooks/use-socket.ts:5` `useSocket(): SocketContextValue`
  returns the handle.
- `packages/client/src/hooks/realtime-invalidation.ts:35`
  `useRealtimeInvalidationSubscription(enabled, subscribe, onConnect)` with
  **four** callers — `:84` `invalidateCampaign`, `:131` `handleReconnect`, `:169`
  `invalidateMap`, `:203` (character sheet) — feeding
  `useSocketReconnection(isConnected && enabled, guardedConnect)` at `:52`.
- Six production call sites in six files:
  `components/campaign/combat/combat-map-panel.tsx:56`,
  `components/campaign/encounters/encounters-panel.tsx:94`,
  `components/campaign/maps/map-detail-view.tsx:70`,
  `components/vtt/vtt-surface.tsx:35`, `pages/campaign-detail-page.tsx:228`,
  `pages/character-sheet/sheet-layout.tsx:114`.
- Doc references to update: `packages/client/src/hooks/MODULE.md:38-41` and
  `packages/client/src/hooks/character-sheet/MODULE.md:23`, `:38`.
- The transferred `pid`/`p`/`m` evidence now lives in
  [leaf 46](./46-naming-renames.md), re-resolved against the client landing
  rather than copied from this leaf's `883d48bf` anchors.

## Proposed direction

1. **Rename the colliding types first.** Each `ApplyInput` is module-private, so
   this is a zero-call-site-churn commit with no behaviour surface at all:
   `WeaponAttackInput` (`use-weapon-attack.ts:25`), `FeatureUseInput`
   (`use-feature-use.ts:8`), `ConfirmCastInput` (`use-confirm-cast.ts:9`),
   `MonsterHpAdjustmentInput` (`use-monster-hp-update.ts:10`) and
   `DropConcentrationInput` (`use-drop-concentration.ts:8`). `useMonsterAttack`
   is not part of this step — it has no `ApplyInput` to rename. This is the part
   of the finding that is unambiguously worth doing.
2. **Rename only the two members whose names are actively wrong**, one commit
   each:
   - `useMonsterHpUpdate`'s `apply` → **`adjustHp`**. Do **not** call it
     `setMonsterHp`: it does not set HP, it applies a mode-keyed
     damage/heal/temp-HP adjustment with clamping and two early returns
     (`use-monster-hp-update.ts:46-66`). It is also the one hook whose member is
     destructured bare (`monster-hp-control-strip.tsx:20`), so the rename lands
     exactly where a reader currently sees nothing.
   - `useCastPlacement`'s `dispatch` → **`begin`**. `dispatch` reads as a reducer
     dispatch and is not one. Do **not** call it `beginCastPlacement`: the hook
     *calls* `useVttDrawerStore.getState().beginCastPlacement()` at
     `use-cast-placement.ts:58`/`:68`/`:75`/`:79` while also driving the canvas
     tool and target-pick, so reusing the store action's name makes two different
     operations look identical — and it stutters at `cast-rail.tsx:156`
     (`placement.beginCastPlacement`).
3. **Leave the other five members alone, or rename them to bare verbs — never to
   noun-prefixed ones.** `weaponAttack.apply`, `featureUse.apply`, `drop.apply`,
   `monsterAttack.apply` and `cast.apply` already read with the noun supplied by
   the local. `weaponAttack.beginWeaponAttack` / `featureUse.consumeFeatureUse` /
   `monsterAttack.resolveMonsterAttack` are worse than the status quo. If the
   directory wants one convention, pick a bare verb per hook once
   (`weaponAttack.attack`, `featureUse.consume`, `monsterAttack.resolve`,
   `cast.confirm`, `drop.drop`) and apply it in a single commit — but this is the
   optional, lowest-value part of the leaf and it is fine to stop after step 2.
   `useMonsterAttack` is the cheapest of these: its return type is inferred
   (`use-monster-attack.ts:34-38`, object literal returned inline at `:96`), so
   `apply` → `resolve` touches only the `const apply` binding at `:64`, that
   inline return, and the call sites/mocks — there is no result interface to
   update.
4. Update `packages/client/src/hooks/vtt-drawer/MODULE.md` in the same series —
   its prose names the current API. Add `useMonsterAttack` to the External Entry
   Points list at `:33-38` while there; the drawer consumes it like the other
   six. Follow `docs/guides/add-module-doc.md`.
5. Drop the unread parameters from `useSpellSlots` and `useSorceryPoints` so they
   take `characterId` only, matching all seven siblings, and give the echoed
   values another route to their four read sites: `slotHook.slots` at
   `pages/character-sheet/sheet-dialogs.tsx:203` and `pages/sheet-helpers.ts:184`,
   and `props.sorceryPoints.sorceryPoints`/`.sorceryPointsMax` at
   `components/sheet/desktop-sheet-layout.tsx:100`,`:103`,`:104` and
   `components/sheet/mobile-sheet-tabs.tsx:195`,`:198`,`:199`. The cheapest route
   is to re-bundle in `sheet-state.ts:93`/`:96-99` —
   `{ ...useSpellSlots(character.id), slots: character.spellSlots }` and the same
   shape for the two sorcery-point scalars — which leaves `SheetSharedProps`
   (`components/sheet/sheet-props.ts:50`) and both layout prop types untouched.
   Threading the scalars as separate props instead means changing
   `SheetSharedProps`, `DesktopSheetLayoutProps` and `MobileSheetTabsProps` as
   well. Preserve the `?? 0` defaults verbatim at every new read site.
6. Rename the four hooks in `realtime-invalidation.ts` to say what they do
   (`useCampaignRealtimeInvalidation` and siblings), update the six call sites,
   and rename `useRealtimeInvalidationSubscription`'s `onConnect` parameter to
   describe the reconnect-invalidation role it actually plays for its four
   callers. Update `hooks/MODULE.md:38-41` and
   `hooks/character-sheet/MODULE.md:23`/`:38` in the same commit.
7. **Transferred, not scheduled here.** Leaf 46 now owns the `pid` →
   `participantId`, `p` → `participant`, `m` → `mutations`, `hpPid` and
   `targetPid` sweep. Its server/comments plan rules the sweep
   opportunistic-only.

## Scope / caveats

- **Do not rename the `useFeatureUse` callback to `useFeature`.** A returned
  member named `use*` reads as a React hook and will be treated as one by the
  react-hooks lint rules when it is called from event handlers or conditionals.
  If step 3 is taken at all, `consume` / `spendFeatureUse` are safe; anything
  starting `use` is not. The other suggested names are safe.
- **Do not prepend the hook's noun to its returned member.** Six of the seven
  call sites bind the hook result to a domain-named local, so a noun-prefixed
  member stutters at every one of them. This is why step 3 exists and why step 2
  is deliberately limited to two hooks.
- Step 5 is the only item with runtime risk. It is behaviour-preserving only if
  the echoed values reach all four read sites by another route in the same
  commit; the `?? 0` defaults are load-bearing (`character.stats` is optional).
- Steps 1-3, 6 and 7 are pure renames with no behaviour change, but step 6
  touches socket-subscribed cache invalidation — read
  `docs/guides/add-client-feature-module-cache-socket.md` before starting, and do
  not take the opportunity to change subscription or reconnect semantics while
  renaming.
- Every renamed hook has a co-located test (seven in `vtt-drawer/` alone); rename
  in the test and the implementation together so the suite never goes red between
  commits. `monster-hp-control-strip.test.tsx:40`,
  `monster-stat-block-drawer.test.tsx:124`, `tabs/actions-tab.test.tsx:112` and
  `tabs/features-tab.test.tsx:77` mock these hooks by member name and must move
  with steps 2-3.
- **Sequencing — land leaf 14 before step 7.** Leaf 14 restructures exactly the
  lines step 7 renames in
  `components/campaign/encounters/encounter-detail-view.tsx`: `HpDialogMount`
  (`:308-326`), `HpDialogSection` (`:328-359`) and `useHpDialogHandler`
  (`:154-180`) cover the `hpPid`, `p={hpParticipant}` and `m:` sites listed in the
  evidence. Renaming first guarantees a conflict; do leaf 14's structural change,
  then sweep the vocabulary.
- **Sequencing — land leaf 15 before step 2's `useCastPlacement` rename.** Leaf 15
  replaces the flat `vtt-drawer-store` fields with a discriminated union and
  rewrites the transitions this hook drives (`beginCastPlacement`,
  `setCastTargetTokenId`, `expand`) plus `use-cast-placement.test.ts`. Rename the
  member after the union lands, not before.
- Steps 1-3, 5, 6 and 7 are otherwise independent of each other and can be split
  across branches.
