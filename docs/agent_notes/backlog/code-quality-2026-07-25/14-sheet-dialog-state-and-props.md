# 14. Character-sheet dialog wiring is flattened into seven loose state pairs and 24-prop pass-throughs

Status: Open only as [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md) slice
**O2** plus step 3's rider in **F2**. The plan drops this as a scheduled
session: **steps 5-7 are dropped permanently**, while steps 1, 2 and 4 form the
XS opportunistic remainder and step 3 is merged into F2.
Theme: Sheet dialog state and prop plumbing · Area: client · Severity: low · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

The character-sheet route models every dialog's state as a flat, independent
`useState` pair and then hand-carries each pair down to whichever slot needs it.
Nothing is broken — this is component-local state with no external
synchronisation — but the flattening has three compounding costs. Six dialogs
are already mounted off these pairs, and all three costs bite the moment someone
adds a seventh:

1. **`useSheetDialogState` returns 14 keys.** Seven `useState` calls flattened
   into one interface of seven value/setter pairs. The consumer destructures the
   seven setters off the hook result but leaves the seven values accessed as
   `d.levelUpOpen` / `d.restType` / `d.selectedSpell` at the JSX sites, so the
   file reads with two different access styles for the same object. `s` and `d`
   are the two largest locals in the file and neither name says anything.
2. **Prop lists grow linearly with dialogs.** `<SheetBody>` receives 24 props and
   `SheetBody` destructures all 24 only to re-spread them into
   `DesktopSheetLayout` / `MobileSheetTabs` via a shared `SheetSharedProps` type
   (the destructure does earn one thing: it lets the re-spread add the
   null-narrowed `stats`). `LevelUpBody` declares 24 props, takes them as a
   single `props` object, then immediately re-destructures all 24 in the body —
   an indirection that buys nothing, since the destructure could have sat in the
   signature.
3. **Micro-components split without a seam.** `HpDialogMount` exists solely to
   read two store selectors and `find` a participant before handing off to
   `HpDialogSection`, which does a null-guard and renders one dialog. Neither is
   exported, neither is referenced elsewhere, neither has a test — so the split
   buys no testability seam and no reuse. Collapsed, they are ~35 lines, well
   under the repo's 100-line `max-lines-per-function` ratchet, so the size rule
   did not force it either.

Alongside these, `sheet-helpers.ts` uses one- and two-letter locals for values
whose types are the whole point (`pc` for a `CharacterClass`, `sc` for
spellcasting-derived output, `inv` for the inventory hook result, `m` next to
`mod` for two different ability modifiers in the same function). `sc` in
particular collides with the `sc-` subclass-id prefix used in the client test
fixtures, so grepping for it is noisy.

## Evidence

- `packages/client/src/pages/character-sheet/sheet-layout.tsx:34-48` — `interface SheetDialogState` with 14 keys (7 value/setter pairs).
- `packages/client/src/pages/character-sheet/sheet-layout.tsx:51-74` — `useSheetDialogState`, exactly 7 `useState` calls returned flattened.
- `packages/client/src/pages/character-sheet/sheet-layout.tsx:118` — `const s = useSheetState(character, campaignId);`
- `packages/client/src/pages/character-sheet/sheet-layout.tsx:126-135` — `const d = useSheetDialogState();` followed by a destructure of the seven setters only; the seven values stay accessed as `d.<name>` at the JSX sites.
- `packages/client/src/pages/character-sheet/sheet-layout.tsx:202`, `:250`, `:258`, `:269` — the four dialog slots (`LevelUpDialogSlot`, `RestDialogs`, `SpellDialogs`, `WeaponMasterySlot`), each taking open/setOpen or value/setValue as separate props. Between them, `packages/client/src/pages/character-sheet/sheet-dialogs.tsx:54`, `:102`, `:136`, `:186`, `:197`, `:221` mount six dialogs (`RestDialog`, `LevelUpDialog`, `WeaponMasteryDialog`, `SpellDetailDialog`, `CastSpellDialog`, `AddSpellDialog`).
- `packages/client/src/pages/character-sheet/sheet-layout.tsx:142`, `:152`, `:169`, `:171`, `:183`, `:199`, `:232-234`, `:237-239` — seven of the setters are also consumed outside the four slots, and `:146` / `:154` list two of them in `useCallback` dep arrays.
- `packages/client/src/pages/character-sheet/sheet-layout.tsx:216` — `<SheetBody>` call site; it is passed 24 props.
- `packages/client/src/components/sheet/sheet-body.tsx:11-35` — `SheetBody` destructures all 24 members of `SheetSharedProps` only to re-spread them into `DesktopSheetLayout` / `MobileSheetTabs`.
- `packages/client/src/components/sheet/level-up-dialog-body.tsx:11-35` — `LevelUpBodyProps` with precisely 24 members.
- `packages/client/src/components/sheet/level-up-dialog-body.tsx:38-63` — `props` taken whole at `:38`, then all 24 re-destructured at `:39-63`; the only local work is `knownMetamagicIds` at `:65`. File is 114 lines and routes onto exactly five children (`ClassSelector`, `SubclassStep`, `HpOptions`, `AsiStep`, `MetamagicStep`).
- `packages/client/src/components/sheet/level-up-dialog.tsx:128` — the only caller of `LevelUpBody`.
- `packages/client/src/components/campaign/encounters/encounter-detail-view.tsx:308-326` — `HpDialogMount`: two `useCombatStore` selectors plus a `participants.find`.
- `packages/client/src/components/campaign/encounters/encounter-detail-view.tsx:328-358` — `HpDialogSection`: a null-guard plus `HpAdjustmentDialog`.
- `packages/client/src/components/campaign/encounters/encounter-detail-view.tsx:154-180` — `useHpDialogHandler` aliases the hook object itself at `:158` (`const store = useCombatStore;`, not `.getState()` or a slice) and then lists `store` in the dep array at `:179`, a pseudo-dependency that only exists because a module-level import was pulled into component scope. This is the only such alias in the client; `token-context-menu.tsx:43`, `map-detail-content.tsx:61` and `combat-map-content.tsx:70` all alias a *value*, correctly.
- `packages/client/src/pages/sheet-helpers.ts:83-84` — `const pc = character.classes[0]`, used as `pc.classId, pc.subclassId`, inside a function whose other parameter is `character: CharacterDetail`.
- `packages/client/src/pages/sheet-helpers.ts:88` and `:95` — `mod` and `m`, two different ability modifiers in the same function.
- `packages/client/src/pages/sheet-helpers.ts:111` — `inv: ReturnType<typeof useInventory>`; the body dereferences `inv.` 13 times.
- `packages/client/src/pages/sheet-helpers.ts:150` — `const sc = getSpellcastingDerived(character, lookups);`
- `packages/client/src/test/fixtures-srd.ts:262` and `packages/client/src/test/mock-trpc.tsx:93` — the colliding `sc-champion` / `sc-battlemaster` subclass ids and an `sc` subclass-filter variable.

## Proposed direction

Order matters: the cheap mechanical wins go first so the larger sheet-layout
change lands against a quieter diff.

1. **Collapse `HpDialogMount` into `HpDialogSection`** in
   `encounter-detail-view.tsx`. One component that reads the two selectors, finds
   the participant, null-guards, and renders `HpAdjustmentDialog`. ~35 lines, no
   behaviour change, no test changes.
2. **Drop the `const store = useCombatStore;` alias** in `useHpDialogHandler` and
   call `useCombatStore.getState()` directly at the two use sites, removing
   `store` from the `useCallback` dep array (the remaining deps are
   `encounterId` and `mutations.updateParticipant`).
3. **Rename the terse locals in `sheet-helpers.ts`**: `pc` → `primaryClass`,
   `sc` → `spellcasting` (or `spellcastingDerived`), `inv` → `inventory`, and the
   `mod` / `m` pair → `primaryAbilityMod` / `classAbilityMod`. Pure rename, one
   commit, no exported names change.
4. **Move `LevelUpBody`'s destructure into its signature.** That is the whole
   change: delete `props` at `:38` and the 24-line re-destructure at `:39-63`,
   and destructure in the parameter position instead. One file, no call-site
   edit, no behaviour change.
   **Do not group the 24 props into sub-objects.** `LevelUpBodyProps` has exactly
   one call site (`level-up-dialog.tsx:128`) which passes 24 members straight off
   one `useLevelUpState` result, and the props do not partition cleanly —
   `character` feeds `HpOptions`, `AsiStep` and `MetamagicStep`, and
   `cannotLeaveMessage` is rendered by `LevelUpBody` itself, not by any child.
   Grouping would force the single caller to assemble five object literals per
   render, add a nesting layer to every read, and remove no props. The evidenced
   defect is the redundant re-destructure, and only that should be fixed.
5. **Group `SheetDialogState` by dialog** rather than by field: replace the seven
   flat pairs with per-dialog objects (`levelUp: { open, setOpen }`,
   `rest: { open, setOpen, type, setType }`, `spells: { addOpen, setAddOpen,
   selected, setSelected, casting, setCasting }`, `mastery: { open, setOpen }`),
   and pass each group whole into its slot at `:202`, `:250`, `:258`, `:269`.
   This is what collapses the slot prop lists.
   Grouping is justified here and not in step 4 because each group has exactly
   one consumer that takes it whole, so four call sites get shorter and nothing
   has to be re-assembled at the boundary. None of the four slots in
   `sheet-dialogs.tsx` is wrapped in `memo`, so the new per-render group
   identities cost nothing there.
6. **Rename `s` and `d`** to `sheet` and `dialogs` in the same commit as step 5,
   and settle on one access style — read values off the grouped objects rather
   than mixing destructured setters with `d.<value>` reads.
   The four slots are not the whole edit surface: seven setters are also read
   outside them, at `:142`, `:152`, `:169`, `:171`, `:183`, `:199`, `:232-234`
   and `:237-239`, and each of those reads becomes `dialogs.<group>.<setter>`.
   In the two `useCallback` dep arrays (`:146`, `:154`) keep listing the
   individual setter (`dialogs.levelUp.setOpen`), never the group object:
   `useState` setters are stable across renders, the group literal is not, and
   listing the group would give `handleLevelUpConfirm` and `selectSpell` a fresh
   identity every render and churn `spellsProps` into `SheetBody`.
7. Leave `SheetBody`'s 24-prop `SheetSharedProps` alone unless step 5 naturally
   shrinks it; see caveats.

## Scope / caveats

- **Do not flatten `SheetBody` / `SheetSharedProps` into a context or a store.**
  The 24 props are a deliberate shared type consumed by both
  `DesktopSheetLayout` and `MobileSheetTabs`; replacing it with context would
  hide that fan-out behind an implicit dependency and is far larger than the
  evidenced defect. Do not justify keeping it by re-render granularity: there is
  none to preserve. `sheet-body.tsx:47-73` builds a fresh `shared` object every
  render and spreads it into both layouts, and neither layout is wrapped in
  `memo`, so both re-render whenever `SheetBody` does. Grouping props (step 5)
  is in scope; changing the *mechanism* by which they reach the layouts is not.
- **Do not promote sheet dialog state into Zustand.**
  `packages/client/src/stores/MODULE.md:7` scopes that directory to "the live
  Zustand stores that drive the combat-map VTT surface"; this is component-local
  sheet dialog state with no cross-surface consumer, so it does not belong there.
- The `HpDialogMount` collapse is in `components/campaign/encounters/`, not the
  sheet directory. It is grouped here because it is the same failure mode
  (dialog wiring split for no seam), but steps 1-2 can be split into their own
  commit or their own leaf without affecting steps 3-7.
- **Preserve verbatim** the comment at `encounter-detail-view.tsx:164-166`
  explaining why character participants need `expectedStatsVersion` while
  monster/NPC participants need only `participant.version` — that is an
  optimistic-concurrency invariant TypeScript cannot express. See
  `docs/CONCURRENCY.md` and `docs/guides/add-race-sensitive-mutation.md` before
  touching anything inside `useHpDialogHandler`'s mutation payload; step 2 must
  change only the `store` alias, not the payload.
- Behaviour must not change in any step. TDD applies as regression discipline:
  the existing sheet and encounter tests should stay green untouched (import-path
  edits aside); if a test has to change, the step went too far.
- If `max-lines-per-function` or any other ratcheted rule shifts as a result of
  collapsing or grouping, follow `docs/guides/lint-ratchet.md` rather than adding
  a suppression.
- **Sequencing: land this leaf before leaf 17.** The two touch the same files.
  Leaf 17 step 7 renames `m` → `mutations` at `encounter-detail-view.tsx:85` and
  `p` → `participant` at `:324`/`:329` — the `p` prop lives on
  `HpDialogSection`, which step 1 here deletes as a boundary: `:324` is the
  intermediate `<HpDialogSection p={hpParticipant} …>` render inside
  `HpDialogMount`, and both it and the `HpDialogMount` declaration at `:308`
  disappear in the collapse, while the mount at `:299` survives, rewritten to
  render the merged component directly. Leaf 17 step 5 also rewrites
  `sheet-layout.tsx:167`/`:247`/`:261`, which steps 5-6 here re-shape (`:261` is
  the `SpellDialogs` prop list). Do the structural change (this leaf) first, then
  the vocabulary sweep (leaf 17) against the settled shape, or combine steps 1-2
  here with leaf 17 step 7 into one commit.
- **Sequencing with leaf 08.** Step 3 renames locals inside
  `pages/sheet-helpers.ts`, which leaf 08 step 4b moves to
  `pages/character-sheet/sheet-helpers.ts`. Land this rename first, or do the
  move first and re-point step 3's evidence anchors (`:83-84`, `:88`, `:95`,
  `:111`, `:150`) to the new path.
