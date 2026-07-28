# 48. `components/sheet/` is 87 flat files and a de-facto shared component library, and it is the one client surface of that size with no `MODULE.md`

Status: **Done 2026-07-27** in
[CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md) slice **C1**, merge
`6cf8c78d5`; see [Landed](./00-index.md#landed). The module doc and generated
index row landed without splitting the directory.
Theme: Orientation contract missing where the charter requires one · Area: client · Severity: low · Size: S

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`packages/client/src/components/sheet/` holds 87 files — 51 source modules and 36 test files,
14,356 lines — in a single flat directory with no subdirectories and no `MODULE.md`. It is the
largest directory in the client package by direct-child file count, documented or not — 1.6x the
next one and 2.8x the largest undocumented directory below it. Of the five client directories
immediately below it in size, four carry a doc; the exception is `packages/client/src/lib/`
(31 files, also flat, also undocumented), which is a separate gap outside this leaf's scope.
Thirty-two `*MODULE.md` files exist under `packages/client/src/`, including one for every campaign
feature folder and every homebrew entity folder, several of which are a fraction of this size.

The charter is not ambiguous about this case. `docs/module-docs.md:26-30` requires a doc for
"large feature directories with several files, tests, or subdirectories", for "component folders
that hide non-obvious data flow", and for "directories that are named in roadmap work as future
refactor targets". This directory satisfies all three: leaves 10, 14, 17, 18, 19, 20, 21, 23 and
40 of this pack all name files inside it.

What makes the gap actively costly rather than merely untidy is that both neighbouring docs point
*away* from the directory, so the trail for anyone following the documentation ends at its edge.
`hooks/character-sheet/MODULE.md:11-13` says "This module does not render the sheet UI;
`pages/character-sheet-page.tsx` and sheet components consume these hooks", deferring to
`pages/MODULE.md`. `pages/MODULE.md:12` says "Feature components, shared hooks, and server rules
stay outside this directory". Both are correct and both are complete for their own surface. The
handoff target has no doc. `MODULE-INDEX.md:37` and `:40` both carry "character sheet" in their
`Concepts:` breadcrumbs, so an agent searching for the sheet lands on exactly the two docs that
disclaim it.

Two things a doc would record are not discoverable from filenames:

**It is a shared component library, not a private one.** Five of its modules are imported from
outside the sheet feature entirely — `components/vtt/drawer/` pulls `spell-slot-pips`,
`spellcasting-constants`, `inventory-constants`, and `roll-context-menu`, and
`components/campaign/npcs/` pulls `spell-detail-dialog`. `vtt/drawer/MODULE.md` documents that it
"renders the in-VTT character sheet drawer" without mentioning that it depends on four modules
from this directory. Sixteen of the 51 source modules are imported from outside the directory;
the other thirty-five are internal. Nothing marks which is which, so any of the thirty-five reads
as safe to change and the five borrowed by other feature areas read as private.

**The desktop/mobile split is a both-trees-mount split.** `sheet-body.tsx:75-81` renders
`DesktopSheetLayout` and `MobileSheetTabs` unconditionally; `desktop-sheet-layout.tsx:33` hides
one with `hidden lg:grid` and `sheet-body.tsx:78` hides the other with `lg:hidden`. Both subtrees
mount, both run their hooks, both render their panels — at every viewport. That is a real
invariant with performance and effect-timing consequences, recorded nowhere.

## Evidence

- `packages/client/src/components/sheet/` — 87 files, all direct children, zero subdirectories;
  51 non-test source modules, 36 `*.test.tsx`/`*.test.ts` files; 14,356 total lines. No
  `MODULE.md` or `*-MODULE.md` anywhere under the path.
- Client directories ranked by direct-child file count (measured at 883d48bf; counts move as the
  tree moves): `components/sheet` 87 (no doc), `test/` 53 (doc), `components/campaign/maps` 46
  (doc), `hooks/` 41 (doc), `lib/` 31 (no doc), `components/campaign/combat` 29 (doc), `pages/` 28
  (doc), `components/character-create/steps` 28 (no doc). `components/sheet` is 2.8x the largest
  undocumented directory below it.
- `docs/module-docs.md:22` — `## Where Required`; `:26` "Large feature directories with several
  files, tests, or subdirectories"; `:27` "Shared hooks, services, or component folders that hide
  non-obvious data flow"; `:30` "Directories that are named in roadmap work as future refactor
  targets"; `:32` the only carve-out, "Do not add one for a single self-contained file".
- `packages/client/src/hooks/character-sheet/MODULE.md:11-13` — "This module does not render the
  sheet UI; `pages/character-sheet-page.tsx` and sheet components consume these hooks. The page
  composition pattern and sheet file split are documented in
  [pages/MODULE.md](../../pages/MODULE.md)."
- `packages/client/src/pages/MODULE.md:12` — "Feature components, shared hooks, and server rules
  stay outside this directory."; `:30-46` documents the sheet *wiring* layer
  (`sheet-layout.tsx`, `sheet-state.ts`, `sheet-dialogs.tsx`) in detail, all of which lives in
  `pages/character-sheet/`, not here.
- `MODULE-INDEX.md:37` and `:40` — the two indexed entries whose `Concepts:` breadcrumbs contain
  "character sheet"; neither points at `components/sheet/`.
- Cross-domain consumers outside `pages/`:
  - `packages/client/src/components/vtt/drawer/tabs/actions-tab-spells.tsx:6`, `:10` and
    `packages/client/src/components/vtt/drawer/tabs/spells-tab.tsx:7`, `:12` — `SpellSlotPips`
    and `spellcasting-constants`.
  - `packages/client/src/components/vtt/drawer/tabs/inventory-tab.tsx:10` — `inventory-constants`.
  - `packages/client/src/components/vtt/drawer/monster-stat-block-abilities.tsx:13` and
    `packages/client/src/components/vtt/drawer/tabs/stats-tab-rolls.tsx:16` — `RollContextMenu`.
  - `packages/client/src/components/campaign/npcs/monster-spellcasting-block.tsx:6` —
    `SpellDetailDialog`.
- `packages/client/src/components/vtt/drawer/MODULE.md:5` — "Renders the in-VTT character sheet
  drawer, monster stat block, cast rail, and …"; the doc never names `components/sheet/` despite
  the four imports above.
- Consumers inside `pages/`: `pages/character-sheet-page.tsx:5`,
  `pages/character-sheet/sheet-layout.tsx:6-9`, `pages/sheet-helpers.ts:18-19`,
  `pages/character-sheet/sheet-state.ts:7`, and `pages/character-sheet/sheet-dialogs.tsx:6`
  (static `AddSpellDialog`) plus five lazy dialog imports at `:15`, `:18`, `:21`, `:26`, `:31`.
- `packages/client/src/components/sheet/sheet-props.ts:17-23` — the one place a contract is
  already written down: the JSDoc explaining that `SheetSharedProps` is "the single source of
  truth for the props threaded through the character-sheet composition layer" and that the two
  layout prop types derive from it via `Omit`/`Pick`. This is exactly module-doc content, stranded
  in a file comment.
- Read-only query state inside the directory, all under `packages/client/src/components/sheet/`:
  `add-spell-dialog.tsx:163` (`trpc.srd.listSpells`), `homebrew-item-tab.tsx:197`
  (`trpc.homebrew.listCampaignEntries`), `level-up-state.ts:65` (`trpc.srd.listSubclasses`). No
  `useMutation` and no store subscription anywhere in the directory.
- Shared test seams used by the 36 co-located tests: `test/fixtures-character.js` in 14,
  `test/fixtures-spell.js` in 6, `test/fixtures-inventory.js` in 3, `@/test/render-helper.js` in
  14; the files are `packages/client/src/test/fixtures-{character,spell,inventory}.ts` and
  `render-helper.tsx`.
- `packages/client/src/components/sheet/sheet-body.tsx:75-81` — both layouts rendered
  unconditionally; `:78` wraps the mobile tree in `lg:hidden`.
- `packages/client/src/components/sheet/desktop-sheet-layout.tsx:33` — the desktop root is
  `className="mt-4 hidden gap-4 lg:grid lg:grid-cols-3"`; `:23-25` derives
  `DesktopSheetLayoutProps` as `Omit<SheetSharedProps, "campaignId" | "currentUserId"> & { stats }`
  with a comment explaining that the chat-log context is mobile-only.
- Leaves in this pack that already treat the directory as refactor surface:
  `14-sheet-dialog-state-and-props.md:53-56`, `10-client-effect-misuse.md:45-46`,
  `21-shared-constants-single-source.md:53`, `:55`, `:95`, `18-shared-class-identity.md:60`, `:83`,
  `19-weapon-and-armor-catalog.md:71`, `:74`, `:78`, `20-rules-tables-to-formulas.md:60`.

## Proposed direction

One commit. Follow `docs/guides/add-module-doc.md`.

1. Write `packages/client/src/components/sheet/MODULE.md` using the six charter sections from
   `docs/module-docs.md:41-50`, with a `Concepts:` line covering the terms someone would actually
   search — character sheet panels, ability scores, spell slots, inventory, level-up, death saves.
   The content that must be in it, per the guide's steps 7-11:
   - **Purpose** — this directory owns the sheet's presentational panels and dialogs. Name the
     three adjacent owners explicitly, since all three already point here implicitly:
     `hooks/character-sheet/` owns data and cache mutation, `pages/character-sheet/` owns wiring
     and dialog state, `components/vtt/drawer/` owns the VTT-embedded sheet and borrows from here.
   - **Data Flow** — the props path, not a file tree: `pages/character-sheet/sheet-state.ts` →
     `SheetBody` → both layouts, with `SheetSharedProps` as the single declaration point. Promote
     the `sheet-props.ts:17-23` JSDoc into this section rather than duplicating it.
   - **External Entry Points** — the sixteen modules imported from outside, split into the five
     borrowed by other feature areas (`vtt/drawer/`, `campaign/npcs/`) and the twelve consumed by
     the sheet's route layer under `pages/` — including `pages/character-sheet-page.tsx` and
     `pages/sheet-helpers.ts`, not just `pages/character-sheet/`. `spell-detail-dialog` is in both
     groups, so the two lists overlap by one and the union is sixteen. This is the section that
     carries the most value; everything not listed is internal and free to change.
   - **State Ownership** — that this directory owns no mutation state and no store slice: it
     receives callbacks and renders. The exception to name explicitly is read-only querying —
     three modules issue their own tRPC reads (`add-spell-dialog.tsx:163` for the SRD spell list,
     `homebrew-item-tab.tsx:197` for campaign homebrew items, `level-up-state.ts:65` for
     subclasses). Drawing that line is what stops the next contributor putting a mutation here
     while still explaining why a query already lives here.
   - **Test Seams** — the 36 co-located tests, `test/fixtures-character.js` (14 tests),
     `test/fixtures-spell.js` (6), and `test/fixtures-inventory.js` (3) as the shared fixtures, and
     `@/test/render-helper.js` (14).
   - **Gotchas** — the both-trees-mount desktop/mobile split (`sheet-body.tsx:75-81`,
     `desktop-sheet-layout.tsx:33`); that adding a sheet field means editing `SheetSharedProps`
     once and letting the `Omit`/`Pick` derivations propagate; and a pointer to leaf 14 for the
     known prop-threading debt, using the concrete backlog path the guide's step 11 requires
     rather than an open-ended TODO.
2. Run `bun run module:index` and include the regenerated `MODULE-INDEX.md` in the same commit
   (guide step 13). Two existing index rows advertise "character sheet"; the new row is what makes
   the search actually land on the components.

## Scope / caveats

- **The remedy is documentation, not folder extraction.** Do not split the 87 files into
  subdirectories as part of this. A speculative reorganisation would move every path cited by six
  other leaves in this pack, invalidating their evidence for no gain, and the directory's flatness
  is not itself the finding — its undocumented external surface is. If a split is ever wanted, it
  should be its own proposal, argued on its own terms, and it will be easier to argue *after* the
  doc has established which modules are entry points.
- No code changes at all. If writing the doc surfaces something that looks like a bug or a
  misplaced module, record it as a separate finding; do not fix it here.
- The doc should describe the directory as it is today, including the parts leaves 14 and 17
  propose to change. If leaf 14 or leaf 17 lands first, refresh the Data Flow / prop-vocabulary
  sections then; all three are independent and none blocks this leaf.
- Charter accuracy: `docs/module-docs.md` sets a qualitative bar ("large", "several files"), not a
  numeric one. The argument for this directory is the conjunction of size, cross-domain reuse, and
  named refactor weight — not a file count crossing a threshold, because there is no threshold.
- `packages/client/src/lib/` (31 flat files, no doc) is the other undocumented client directory
  over 28 files, and it holds `query-invalidation.ts`, `token-store.ts`, `providers.tsx`,
  `query-client.ts`, and `trpc.ts` — surfaces `docs/module-docs.md:28-29` names directly. Do not
  fold it in here; it is its own candidate and wants its own argument.
- `vtt/drawer/MODULE.md` arguably also wants a line acknowledging its four imports from here.
  That is a one-line refresh and can ride along, but it is not required and does not change the
  scope of step 1.
