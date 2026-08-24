# 57. character-sheet.test.tsx tests eleven leaf components, not a character sheet, and half of them are already tested beside their subjects

Status: Not started
Theme: test file identity · Area: client · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/client/src/components/sheet/character-sheet.test.tsx` promises, by
name, coverage of a character-sheet composition. No such component exists — the
directory has no `character-sheet.tsx`, and the file never renders a composition
root. It is a 235-line aggregate of eleven independent leaf-component describes,
a leftover from before the sheet layout was split out to
`pages/character-sheet/`. The actual composition root is `CharacterSheetContent`
in `pages/character-sheet/sheet-layout.tsx`, which has its own 482-line suite.

That costs contributors twice. Five of the eleven describes duplicate dedicated
colocated suites, so any change to `AbilityScores`, `SavingThrows`,
`SkillsList`, `CombatStats`, or `PersonalityPanel` means editing assertions in
two files — and some of those assertions are byte-for-byte copies. And the
misleading filename sends anyone looking for page-level layout coverage to the
wrong file, concealing `sheet-layout.test.tsx` as the composition authority.
Five other describes are the only coverage for live components and must
survive. The remaining `DeathSaves` describe instead keeps a superseded
read-only production component alive solely for its test, making the aggregate
claim coverage for behavior neither desktop nor mobile sheets render.

## Evidence

- `packages/client/src/components/sheet/character-sheet.test.tsx:8-18` — eleven
  leaf-component imports; nothing in the file's 235 lines renders a composition,
  and the directory contains no `character-sheet.tsx` subject. Exact commands
  `rg -c '^import .* from "\./.*\.js";$' packages/client/src/components/sheet/character-sheet.test.tsx`,
  `rg -c '^describe\(' packages/client/src/components/sheet/character-sheet.test.tsx`,
  `wc -l packages/client/src/components/sheet/character-sheet.test.tsx`, and
  `find packages/client/src/components/sheet -maxdepth 1 -name 'character-sheet.tsx' | wc -l`
  return `11`, `11`, `235`, and `0`, respectively.
- Five describes duplicate colocated suites: `AbilityScores` (`:58-69`),
  `SavingThrows` (`:71-85`), `SkillsList` (`:87-97`), `CombatStats` (`:99-120`),
  `PersonalityPanel` (`:157-172`). Exact command
  `rg -c '^describe\("(AbilityScores|SavingThrows|SkillsList|CombatStats|PersonalityPanel)"' packages/client/src/components/sheet/character-sheet.test.tsx`
  returns `5`. Their colocated counterparts:
  - `ability-scores.test.tsx` (5 describes, 20 tests; exact commands
    `rg -c '^describe\(' packages/client/src/components/sheet/ability-scores.test.tsx` and
    `rg -c '^  it\(' packages/client/src/components/sheet/ability-scores.test.tsx`
    return `5` and `20`) plus `ability-scores.roll.test.tsx:13-34`, whose
    read-only rendering describe asserts the same scores/modifiers and the
    presence of every ability.
  - `saving-throws.test.tsx:13-62` — the same `+5`/`+3`/`+2` modifier values and
    the same `Proficient`/`Not proficient` aria-label queries.
  - `skills-list.test.tsx:14-40` — same skills, proficiency dots, Athletics `+5`.
  - `combat-stats.test.tsx:13-55` — the null-stats fallback (`:51`) and the
    inspiration indicator (`:26`) repeated by the aggregate at `:109-119`.
  - `personality-panel.test.tsx:17-21, 42-45` — the cited personality strings and
    the empty-fields render-nothing assertion, verbatim.
- `packages/client/src/components/sheet/character-sheet.test.tsx:24-56,135-155,174-235`
  — five describes are sole coverage for live components: `SheetHeader`,
  `ConditionsBar`, `CurrencyPanel`, `ProficienciesPanel`, and `FeaturesPanel`.
  Exact command
  `for subject in sheet-header conditions-bar currency-panel proficiencies-panel features-panel; do rg -l "from \"\./${subject}\.js\"" packages/client/src --glob '**/*.test.*' --glob '**/*.spec.*'; done | sort | uniq -c`
  returns `5 packages/client/src/components/sheet/character-sheet.test.tsx`,
  confirming this file is the only test importing those subjects.
- `packages/client/src/components/sheet/character-sheet.test.tsx:12,122-133` —
  the aggregate imports the legacy `DeathSaves` module and is its only external
  consumer; exact command
  `rg -l 'from "\./death-saves\.js"' packages/client/src | wc -l` returns `1`.
- `packages/client/src/components/sheet/death-saves.tsx:37-60` — the legacy
  read-only `DeathSaves` component remains exported with its own private
  `SaveDots` presentation.
- `packages/client/src/components/sheet/desktop-sheet-layout.tsx:81-89` and
  `packages/client/src/components/sheet/mobile-sheet-tabs.tsx:87-95` — both live
  sheet layouts render `DeathSavesInteractive`, not the legacy component.
- `packages/client/src` — measurement: the exact command
  `rg -l 'from "\./death-saves\.js"' packages/client/src --glob '!**/*.test.*' --glob '!**/*.spec.*' | wc -l`
  returns `0` production imports of the legacy module.
- `packages/client/src/components/sheet/death-saves-interactive.tsx:3,77-145`
  — the live component uses the shared `DeathSaveDots` primitive and supplies
  both interactive and read-only presentations.
- `packages/client/src/components/sheet/death-saves-interactive.test.tsx:19-50`
  — dedicated live coverage already asserts visibility and success/failure dot
  rendering; later cases cover toggling, reset, pending gating, and CAS payloads.
- One test inside a "duplicate" describe is itself sole coverage: the
  `CombatStats` base-rendering test at `character-sheet.test.tsx:100-107`
  (`stat-ac`, `stat-initiative`, `stat-prof-bonus`, `stat-hit-dice`,
  `stat-speed`) has no colocated counterpart — exact command
  `rg -l 'stat-(ac|initiative|prof-bonus|hit-dice|speed)' packages/client/src --glob '**/*.test.*' --glob '**/*.spec.*' | wc -l`
  returns `1`, while `combat-stats.test.tsx` queries only the
  inspiration/fallback/rest-button surfaces.
- The real composition suite:
  `packages/client/src/pages/character-sheet/sheet-layout.test.tsx:16,85` —
  imports `CharacterSheetContent` and tests it across 482 lines; exact command
  `wc -l packages/client/src/pages/character-sheet/sheet-layout.test.tsx`
  returns `482`. `packages/client/src/components/sheet/MODULE.md:19-20` names
  `pages/character-sheet/sheet-layout.tsx` the composition root.

## Proposed direction

In `character-sheet.test.tsx`, delete the five describes duplicating colocated
suites (`AbilityScores`, `SavingThrows`, `SkillsList`, `CombatStats`,
`PersonalityPanel`), delete the obsolete `DeathSaves` describe and production
module, and rename the remainder (e.g. `sheet-panels.test.tsx`) so it reads as
focused coverage for the five live components without colocated tests, not as
the composition authority.

Mechanics:

1. Move the one non-duplicated test out first: port the `CombatStats`
   base-rendering assertions (`character-sheet.test.tsx:100-107`) into
   `combat-stats.test.tsx` so deleting that describe loses nothing. The other
   small deltas (per-skill `+3`/`+2` values at `:92-95`, DEX/CON/WIS modifiers
   at `:63-66`) exercise the same formatting paths the colocated suites already
   assert; dropping them is deliberate.
2. Remove the `DeathSaves` import and describe, then delete
   `death-saves.tsx`. Do not transplant its assertions: retain the dedicated
   `DeathSavesInteractive` suite and coverage of the live shared
   `DeathSaveDots` path.
3. Delete the five duplicate describes and their now-unused imports.
4. Rename the file (`sheet-panels.test.tsx` or similar). No source or doc file
   outside this audit pack references the old name: exact command
   `rg -l 'character-sheet\.test\.tsx' packages/client/src docs --glob '!docs/agent_notes/backlog/code-quality-2026-08-01/**' | wc -l`
   returns `0`. `lint-ratchet.baseline.json:1260-1262` does reference it;
   regenerate the baseline as part of the rename (the ignored
   `packages/client/tsconfig.tsbuildinfo` may also retain the old path).
5. Verify with
   `bun run test -- packages/client/src/components/sheet/sheet-panels.test.tsx`,
   `bun run test -- packages/client/src/components/sheet/combat-stats.test.tsx`,
   and
   `bun run test -- packages/client/src/components/sheet/death-saves-interactive.test.tsx`.

## Scope / caveats

- The five sole-coverage live describes (`SheetHeader`, `ConditionsBar`,
  `CurrencyPanel`, `ProficienciesPanel`, `FeaturesPanel`) must survive
  unchanged; this leaf prunes duplication and obsolete coverage, not live
  coverage.
- Do not delete or weaken `DeathSavesInteractive` coverage. The private
  `SaveDots` inside the orphaned module dies with that module; any separately
  useful dot-level coverage belongs to the live shared `DeathSaveDots`
  primitive.
- The packet's broader command
  `rg -l 'death-saves\.js' packages/client/src --glob '!**/*.test.*' --glob '!**/*.spec.*' | wc -l`
  returns one false positive because `combat-death-saves.js` contains that
  suffix. It is not a valid exact-import count; the evidence above uses the
  exact `from "./death-saves.js"` import instead.
- Out of scope: splitting `components/sheet/` (88 files, measured by exact command
  `find packages/client/src/components/sheet -maxdepth 1 -type f | wc -l`) into subdirectories or
  any `features/` package-root reorganization — the prior pack rejected the `features/` package-root reorganization and
  barred a sheet-directory split from
  [prior-pack leaf 48](../code-quality-2026-07-25/48-sheet-module-doc.md), but explicitly says a
  future split may be argued separately (`CLIENT-CLUSTER-PLAN.md` Rejected
  alternatives; `48-sheet-module-doc.md` Scope / caveats). This leaf is a
  file-local prune-and-rename and does not reopen it.
- Out of scope: writing new composition tests. `sheet-layout.test.tsx` is the
  composition authority; if page-level gaps exist they are its problem, not this
  file's.
- Splitting the remainder into five per-component files is optional follow-up,
  not part of this leaf; the single renamed file already stops the double-edit
  and misdirection costs.
