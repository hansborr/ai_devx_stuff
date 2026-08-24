# 61. RollModeToggle is a 60-line combat component no production code imports

Status: Not started
Theme: dead component removal · Area: client · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/client/src/components/campaign/combat/roll-mode-toggle.tsx` is a
complete, exported, tested three-button roll-mode selector — and nothing in the
shipped client can render it. No production module imports it; its only
importer is its own co-located test. Everything around it says otherwise: the
implementation is polished, a seven-case suite exercises its interaction and
accessibility behavior, and the combat `MODULE.md` lists it as a piece
"consumed by the active encounter surface". A contributor touching combat UI
reasonably treats it as live surface — reading it, keeping it green through
refactors, updating it alongside real roll-mode changes — all maintenance work
disconnected from any shipped behavior.

## Evidence

- `packages/client/src/components/campaign/combat/roll-mode-toggle.tsx:1-60` —
  the entire file: one exported standalone component (`RollModeToggle`,
  `:13-60`) and its props interface; no other production behavior.
- Zero production imports, re-derived at the pin: `git grep` for
  `RollModeToggle` / `roll-mode-toggle` across the 389 production client
  TS/TSX files (excluding `*.test.*`, `*.spec.*`, test helpers, and
  `src/test/`) matches only the definition file itself.
- `packages/client/src/components/campaign/combat/roll-mode-toggle.test.tsx:5`
  — the sole importer anywhere in the repo: a 56-line, seven-case suite.
- `packages/client/src/components/campaign/combat/MODULE.md:64` — lists
  `roll-mode-toggle.tsx` among "focused combat UI pieces consumed by the
  active encounter surface"; `:8` ("roll-mode UI lives here") and `:83`
  ("roll-mode display") repeat the ownership claim.
- The `RollMode` *type* the component imports
  (`packages/shared/src/schemas/attack-roll-inputs.ts`) stays live in shared
  rules (`d20-roll.ts`, `attack-roll.ts`, `saving-throw.ts`); only the
  component is dead. The sheet's shipped roll-mode UI
  (`packages/client/src/components/sheet/roll-context-menu.tsx:7,46-49`) uses
  its own local `RollMode` union and does not touch this component.

## Proposed direction

Delete `packages/client/src/components/campaign/combat/roll-mode-toggle.tsx`
together with its co-located `roll-mode-toggle.test.tsx` (the test cannot
compile without the component); the stale MODULE entry is owned by
[088-client-component-module-documents-misstate.md](./088-client-component-module-documents-misstate.md).

Mechanics: one commit, two file deletions, no other edits — there is no barrel
or re-export to clean up (the zero-import measurement above covers both the
symbol and the path). `bun run verify:changed` (with the deletions staged)
confirms nothing else referenced either file.

## Scope / caveats

- **Do not touch `MODULE.md`.** The false consumption claim at `:64` and the
  purpose-line mentions at `:8`/`:83` belong to
  [088-client-component-module-documents-misstate.md](./088-client-component-module-documents-misstate.md);
  the two pieces of work explicitly partition ownership. No ordering
  dependency, but whichever lands second should reflect the other's outcome.
- Deleting the test here is deliberate, not a lane conflict: the test-quality
  review of this suite was dismissed in favor of exactly this atomic removal —
  the cases are meaningful, the component they exercise is not shipped.
- The shared `RollMode` type, the shared roll rules, and
  `roll-context-menu.tsx` are live and out of scope.
- Reviving the component by wiring it into a combat surface would be a feature
  decision, not this cleanup; git history retains the implementation if that
  is ever wanted.
