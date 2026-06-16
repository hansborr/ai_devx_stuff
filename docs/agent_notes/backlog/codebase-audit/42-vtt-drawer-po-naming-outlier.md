# 42. vtt-drawer page object is the lone e2e page-object file that omits the `*.po.ts` naming convention

Status: Done — renamed `vtt-drawer.ts` -> `vtt-drawer.po.ts` (git mv, history preserved), updated the lone importer in `e2e/encounter-combat.spec.ts`, and documented the `<surface>.po.ts` / `<Surface>PO` convention in `add-e2e-test.md` step 1. Optional drift-sensor structural guard deferred (left as optional in the leaf).
Theme: e2e page-object naming consistency · Area: tooling · Severity: low · Size: XS

Source: codebase maintainability/onboarding audit 2026-06-13 (lens: testing-ergonomics); evidence independently re-verified. · Confidence: high

## Problem
Every e2e page object in `e2e/page-objects/` is named `<surface>.po.ts` and exports a `<Surface>PO` class — 17 of them — except `vtt-drawer.ts`, which drops the `.po.ts` suffix yet still exports `class VttDrawerPO`. A new developer who learns the pattern from the directory listing (or who greps `*.po.ts` to find a page object to extend) will skip or fail to find this one, and the single import that references it reads differently from every other page-object import in the suite. The convention is enforced only by imitation: `docs/guides/add-e2e-test.md` tells you to put page objects in `e2e/page-objects/` but never states the `*.po.ts` filename rule, so the outlier looks like a legitimate alternative rather than a mistake.

## Evidence
- `e2e/page-objects/` — directory listing shows 17 `*.po.ts` files (`campaign-chat.po.ts`, `campaign-detail.po.ts`, `campaign-notes.po.ts`, `campaign-npcs.po.ts`, `campaign-settings.po.ts`, `campaigns.po.ts`, `character-sheet.po.ts`, `character-wizard.po.ts`, `dashboard.po.ts`, `encounter.po.ts`, `homebrew.po.ts`, `join.po.ts`, `login.po.ts`, `mobile-nav.po.ts`, `notification.po.ts`, `register.po.ts`, `spells-panel.po.ts`) plus the sole outlier `vtt-drawer.ts` (verified).
- `e2e/page-objects/vtt-drawer.ts:20` — `export class VttDrawerPO {`; the class name matches the `*PO` convention even though the filename does not.
- `e2e/encounter-combat.spec.ts:25-26` — adjacent imports make the inconsistency stark: `import { EncounterPO } from "./page-objects/encounter.po.js";` (line 25, with the `.po.` infix) versus `import { VttDrawerPO } from "./page-objects/vtt-drawer.js";` (line 26, without it). This is the only page-object import in the entire e2e suite lacking the `.po.` infix — every other spec import (e.g. `notifications.spec.ts:11-12`, `navigation-errors.spec.ts:3-5`, `inventory.spec.ts:4-6`) uses `.po.js`.
- `docs/guides/add-e2e-test.md:5` — step 1 says "Add or extend the page object for the surface in `e2e/page-objects/`" but never states the `<surface>.po.ts` filename convention; nothing else in the guide mentions it.
- `scripts/drift/locator-usage.ts:34,37` — the drift selector sensor globs `DEFAULT_ROOT = "e2e"` by `SOURCE_EXTENSIONS = new Set([".ts", ".tsx"])`, i.e. by file extension, not by `.po.ts` suffix. So `vtt-drawer.ts` is currently scanned and not missed; the risk is purely a future suffix-based check/generator plus the present newcomer inconsistency.

## Proposed direction
Rename the file to `e2e/page-objects/vtt-drawer.po.ts` and update the single importer, then document the convention so the next person does not have to reverse-engineer it from the directory.

1. `git mv e2e/page-objects/vtt-drawer.ts e2e/page-objects/vtt-drawer.po.ts` (a rename, not new logic — preserves history and the `VttDrawerPO` export unchanged).
2. Update the lone import at `e2e/encounter-combat.spec.ts:26` to `from "./page-objects/vtt-drawer.po.js"`. Confirm with `bun run code:intel -- dependents` (or `rg "vtt-drawer"` under `e2e/`) that this is the only reference before and after — current evidence shows exactly one.
3. TDD-aware: there is no behavioral change, so no new unit assertion is meaningful; the guard is the suite itself. Run the spec that uses it — `bun run e2e` scoped to `encounter-combat.spec.ts` (or the narrow Playwright command from `add-e2e-test.md:37`) — to confirm the import resolves. If a cheap structural guard is wanted, the natural home is the drift sensor in `scripts/drift/locator-usage.ts`: add a unit test asserting every file directly under `e2e/page-objects/` matches `*.po.ts`, paired with a one-line note. That converts the convention from "enforced by imitation" to "enforced by a test" and would have caught this outlier. Treat that guard as optional within this XS; the rename + doc line is the core.
4. Add one sentence to `docs/guides/add-e2e-test.md` step 1 (`:5`): page objects are named `<surface>.po.ts` and export a `<Surface>PO` class. This is the discoverability fix that stops the trap recurring.

No package-flow (shared -> server -> client) ordering applies — this is entirely under `e2e/` and `scripts/drift/`.

## Scope / caveats
- Touch only `e2e/page-objects/vtt-drawer.ts` (rename), its single importer `e2e/encounter-combat.spec.ts:26`, the one doc line in `docs/guides/add-e2e-test.md`, and — if the optional guard is taken — `scripts/drift/locator-usage.ts`'s test. Do not rename or restructure the other 17 page objects (they already conform) and do not touch the `VttDrawerPO` class body or its `getByTestId("vtt-drawer-*")` selectors.
- This is a naming/discoverability consistency finding, not a duplication or dead-code finding — the file is live (imported and exercised by `encounter-combat.spec.ts`), so it is outside the drift-ai-findings near-duplicate/dead-code track. It is distinct from the agent-friction harness leaves (this is a human-onboarding/test-suite consistency fix, not agent-test ergonomics) and from the storybook component-catalog and lint-debt items.
- Low risk and low urgency: the drift sensor globs by extension (`locator-usage.ts:37`), so nothing is currently being missed; the value is preventing a newcomer dead-end and pre-empting any future `*.po.ts`-suffix enforcement or page-object scaffolder from treating this file as out of band. Sequence it whenever an e2e change is already in flight to fold the rename into a related branch; it has no dependencies.
