# Phase-1 hotspot addendum — lane 05 (client)

Status: Dispatch material — not a schedulable note

Lane-00 signals for your scope (full map: `working/hotspots.md`):

- **Character sheet / VTT drawer / map-canvas state** is your top cluster
  (history + size + clones agree). Sheet components: 79 pinned-range
  touches; character-sheet pages: 64. `sheet-layout.tsx` has 18 revisions
  and **8 fix/revert commits**. Drift evidence: desktop/mobile layout
  duplication, sheet↔VTT weapon and saving-throw parallels, duplicated
  spell-tab behavior. Literal groups: 161 touch sheet components, 73 the
  VTT drawer, 64 its tabs. `map-canvas-store.ts` is the client's longest
  hand-authored source at 626 lines; `rest-dialog.tsx` and
  `level-up-helpers.tsx` both exceed 330.
- **Campaign maps / combat / encounters** is cluster two: several of the
  triage queue's first items are paired map/combat implementations (detail
  content, headers, editor dialogs, map overlays). These pairs sit on
  interaction-heavy behavior — compare them closely, unlike the formulaic
  clones below. `encounter-detail-view.tsx` 384 lines,
  `add-participant-dialog.tsx` 348.
- **Homebrew forms + character-create**: parallel class/subclass form data
  and fields, repeated collection/entry dialogs, overlaps with campaign
  settings; character-create steps touched by 77 literal groups; monster
  form fields/data 478 and 441 lines. Structural evidence only — treat as
  second-tier.
- `packages/client/src/routes/`: 62 of 80 endpoints in the client Dolos
  top 40, but these are small formulaic route declarations — a
  consistency/API-shape sweep, not a design-defect hunt.

Weighting: sheet/VTT/map-canvas first, campaign maps/combat/encounters
second, homebrew/character-create third, routes as a light consistency
pass.
