# 39. Responsive character sheets always mount both layout trees and hide one with CSS, keeping duplicate live panel state at every viewport

Status: Not started
Theme: responsive layout boundary · Area: client · Severity: high · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The character sheet implements its responsive design as two complete layout
subtrees that are both alive at once. `SheetBody` unconditionally renders
`DesktopSheetLayout` *and* `MobileSheetTabs`; Tailwind classes (`hidden lg:grid`
on the desktop root, an `lg:hidden` wrapper around the mobile tabs) make exactly
one of them visible, but CSS visibility does not prevent mounting. The precise
duplication is: both layout roots always mount; the desktop tree mounts its
**complete** panel suite at every viewport, including on a phone where it is
invisible; the mobile tree's inactive Radix tabs unmount (no `forceMount`
anywhere in `components/ui/tabs.tsx`), so the live overlap at any moment is the
full desktop suite plus whatever panels sit in the active mobile tab. Fourteen
panel component types are statically shared between the two layouts, so every
panel's hooks, local drafts, dialog state, and render work exist twice whenever
its mobile tab is active — and the two copies are independent React instances
whose local state can silently diverge when the viewport crosses the `lg`
breakpoint. The same pattern repeats one level up for the game log: a member's
`ChatPanel` is mounted desktop-side in a `hidden lg:block` wrapper *and* again
in the mobile Log tab, doubling its chat subscriptions.

This costs contributors on every sheet change: any stateful panel edit must be
reasoned about twice, test selectors are forced into `getAllBy...[0]` shapes
because single-instance queries throw on the duplicate, and the invariant is
unusual enough that the sheet `MODULE.md` carries a dedicated gotcha whose only
job is to warn people the hidden tree is still running. A structural hazard
that needs standing documentation to keep contributors safe is a hazard worth
removing.

## Evidence

- `packages/client/src/components/sheet/sheet-body.tsx:73-80` — the return
  renders `<DesktopSheetLayout {...shared} />` and `<MobileSheetTabs
  {...shared} />` unconditionally; the mobile wrapper `<div className="mt-4
  lg:hidden">` is at `:76`.
- `packages/client/src/components/sheet/desktop-sheet-layout.tsx:33` — the
  desktop root is `hidden gap-4 lg:grid lg:grid-cols-3`; the full panel suite at
  `:33-129` mounts at every viewport, CSS-hidden below `lg`.
- `packages/client/src/components/sheet/mobile-sheet-tabs.tsx:101-229` — a
  second, independently stateful arrangement of the same panels inside Radix
  `Tabs`. `packages/client/src/components/ui/tabs.tsx` contains no `forceMount`
  (zero grep hits at the pin), so inactive `TabsContent` children unmount; the
  live duplication is the desktop suite plus the active mobile tab's panels,
  not all fourteen panels twice simultaneously.
- 14 panel component types are instantiated in both layouts (re-derived at the
  pin by intersecting the two files' sheet-panel imports): `AbilityScores`,
  `CombatStats`, `CurrencyPanel`, `DeathSavesInteractive`, `EquipmentSummary`,
  `FeaturesPanel`, `HpAdjuster`, `InventoryPanel`, `PersonalityPanel`,
  `ProficienciesPanel`, `SavingThrows`, `SkillsList`, `SorceryPointsPanel`,
  `SpellsPanel`.
- `packages/client/src/pages/character-sheet/sheet-sections.tsx:48-54` —
  `SheetGameLog` wraps `ChatPanel` in `hidden lg:block` (`:50`) and is mounted
  for every member at `pages/character-sheet/sheet-layout.tsx:300`; the mobile
  Log tab mounts a second `ChatPanel` at `mobile-sheet-tabs.tsx:218-226`. A
  member on a phone with the Log tab open runs two live chat panels.
- `packages/client/src/components/sheet/MODULE.md:85-89` — a gotcha exists
  solely to warn that "CSS visibility does not prevent either subtree, its
  hooks, or its local state from mounting".
- `packages/client/src/test/setup.ts:198-199` — the jsdom `matchMedia` stub
  always returns `matches: false`.
- `packages/client/src/pages/character-sheet/sheet-layout.test.tsx:117-188` uses duplicate-tolerant `getAllBy...[0]!` and `.length).toBeGreaterThan(0)` assertions throughout. This avoids single-instance assumptions, but is not proof that every control is duplicated: with the default mobile Stats tab active, Stats controls such as `dm-edit-scores` are duplicated, while controls in inactive mobile tabs—for example Short Rest at `:130`—exist only in the always-mounted desktop tree.
- `e2e/mobile-nav.spec.ts:6` — the mobile e2e suite pins a 375×812 viewport.

## Proposed direction

Select one layout through a browser-media boundary; reject the alternative of
one panel tree with responsive placement. The two layouts are not the same tree
with different CSS: desktop is a 3-column grid while mobile regroups the same
panels into Radix tabs (`SkillsList` sits in desktop column 3 but in the mobile
Stats tab), so single-tree placement would force a CSS-only tab reimplementation
with per-panel responsive classes — strictly worse to copy from than a clean
boundary. Ordered plan (three slices for the L size):

1. **The viewport hook.** Add a small hook in `packages/client/src/hooks/`
   (e.g. `useMediaQuery(query)` or a dedicated `useIsDesktopSheet()`) built on
   `useSyncExternalStore` subscribing to
   `window.matchMedia("(min-width: 1024px)")` — Tailwind v4's default `lg`
   breakpoint; `packages/client/src/app.css`'s `@theme` block overrides no
   breakpoints. `useSyncExternalStore` over an external browser API satisfies
   [`docs/guides/client-effects.md`](../../../guides/client-effects.md)
   (external-system sync, no setState-in-effect). No such hook exists in the
   client today (zero `useSyncExternalStore`/`useMediaQuery` hits at the pin).
   Land with unit tests, including an injection seam or stub override so tests
   can exercise both `matches` values.
2. **The `SheetBody` boundary.** Replace the render-both return
   (`sheet-body.tsx:73-80`) with a conditional that mounts exactly one of
   `DesktopSheetLayout` or `MobileSheetTabs`, and strip the now-dead responsive
   classes: `hidden lg:grid` on the desktop root
   (`desktop-sheet-layout.tsx:33`) and the `lg:hidden` wrapper
   (`sheet-body.tsx:76`). In the same slice, tighten
   `sheet-layout.test.tsx`'s `getAllBy...[0]` / `length > 0` assertions to
   single-instance `getBy` forms — the conversion is the built-in regression
   tripwire: it fails if any duplicate mount survives. Because the jsdom
   `matchMedia` stub always reports `matches: false` (`setup.ts:198-199`),
   default unit renders become mobile-only; use the slice-1 seam to keep
   explicit desktop-layout coverage.
3. **The chat boundary, docs, and e2e.** Apply the same hook to the sibling
   dual mount: `SheetGameLog` (`sheet-sections.tsx:50`) versus the mobile Log
   tab, so `ChatPanel` and its chat subscriptions exist once per viewport.
   Replace the sheet `MODULE.md` dual-mount gotcha (`:85-89`) with
   documentation of the media boundary, stating the deliberate trade: crossing
   `lg` now remounts the layout and resets panel-local state, replacing silent
   cross-breakpoint divergence. Verify `e2e/mobile-nav.spec.ts` still passes
   at its pinned 375px viewport, and add a desktop-viewport sheet check (read
   [`docs/guides/add-e2e-test.md`](../../../guides/add-e2e-test.md) first).

Throughout: preserve `SheetSharedProps` and the `Omit`/`Pick`-derived layout
prop types unchanged, and do not touch panel internals. Focused test runs:
`bun run test -- packages/client/src/pages/character-sheet/sheet-layout.test.tsx`
and `bun run e2e -- e2e/mobile-nav.spec.ts`.

## Scope / caveats

- **Out of scope:** context or directory reorganization, panel-level refactors,
  and any change to the `SheetSharedProps` contract. The MODULE.md refresh
  touches only the dual-mount gotcha; its other invariants (the
  `SheetSharedProps` single-source field rule, the no-sheet-wide-read-only-prop
  rule, and the `SheetCampaignMember` prop-shape rule at `MODULE.md:90-116`)
  stay untouched.
- **Test-coverage risk is the sharpest edge.** After the boundary lands, the
  always-`matches: false` stub means unit tests render only the mobile tree by
  default; without the slice-1 seam (or per-test stub override), desktop panels
  silently lose all unit coverage while their assertions keep passing against
  mobile instances.
- **Breakpoint crossing becomes a remount.** In-progress panel-local drafts and
  open dialogs are discarded when the viewport crosses `lg`. This is the
  accepted trade (it replaces silent state divergence between two live copies)
  but it must be intentional and documented in the refreshed MODULE.md, not an
  accident. Relatedly, a wrong initial `matchMedia` snapshot would flash the
  wrong layout on first paint — read the live value synchronously in the
  hook's `getSnapshot`.
- **Both dual-mount sites or neither.** Missing one of the two (`SheetBody`
  layouts vs `SheetGameLog`/Log-tab `ChatPanel`), or leaving stale
  `hidden`/`lg:*` classes behind, reintroduces hidden double work after the
  MODULE gotcha that warned about it has been deleted.
- **Prior pack (CQ25-117):** the landed 2026-07-25 cluster — leaf
  [`48-sheet-module-doc.md`](../code-quality-2026-07-25/48-sheet-module-doc.md),
  slice C1 — is do-not-reopen, but what landed there was the `MODULE.md`
  *documentation* of the dual-mount invariant, not a decision to keep it; that
  leaf explicitly instructs recording code problems it surfaces as separate
  findings rather than fixing them in place (`48-sheet-module-doc.md:167`).
  Replacing the gotcha here is doc-follows-code, not a reopen.
- **Same-file coordination:** [192-expose-level-up-history-already-returned.md](./192-expose-level-up-history-already-returned.md) also edits `SheetBody`, `desktop-sheet-layout.tsx`, and `mobile-sheet-tabs.tsx` to add the history panel. There is no semantic dependency, but avoid concurrent edits.
