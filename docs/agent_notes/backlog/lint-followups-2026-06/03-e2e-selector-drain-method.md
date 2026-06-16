# E2E Selector Drain — Shared Method (Umbrella For 03a-03g)

Status: Reference — shared context for sub-leaves 03a-03g; this file is
not workable on its own.
Source: ratchet floors landed by lint-review-2026-06 leaf 04; per-file
counts read from `lint-ratchet.baseline.json` on 2026-06-12.

## Debt Inventory (2026-06-12)

Columns: role = `local/e2e-prefer-role-selectors`,
nth = `playwright/no-nth-methods`,
native = `playwright/prefer-native-locators`.

| File | role | nth | native | Leaf |
| --- | ---: | ---: | ---: | --- |
| e2e/page-objects/character-sheet.po.ts | 22 | 6 | 9 | 03a |
| e2e/page-objects/spells-panel.po.ts | 19 | 5 | 10 | 03b |
| e2e/page-objects/campaigns.po.ts | 4 | 1 | 0 | 03c |
| e2e/page-objects/campaign-chat.po.ts | 3 | 0 | 3 | 03c |
| e2e/page-objects/campaign-detail.po.ts | 6 | 1 | 2 | 03c |
| e2e/page-objects/campaign-notes.po.ts | 4 | 0 | 0 | 03c |
| e2e/page-objects/campaign-npcs.po.ts | 4 | 1 | 0 | 03c |
| e2e/page-objects/campaign-settings.po.ts | 2 | 0 | 0 | 03c |
| e2e/page-objects/encounter.po.ts | 2 | 8 | 1 | 03d |
| e2e/page-objects/character-wizard.po.ts | 9 | 1 | 1 | 03d |
| e2e/page-objects/vtt-drawer.ts | 3 | 0 | 0 | 03d |
| e2e/page-objects/login.po.ts | 3 | 1 | 1 | 03e |
| e2e/page-objects/register.po.ts | 4 | 1 | 1 | 03e |
| e2e/page-objects/join.po.ts | 1 | 0 | 1 | 03e |
| e2e/page-objects/dashboard.po.ts | 0 | 1 | 0 | 03e |
| e2e/page-objects/notification.po.ts | 1 | 3 | 0 | 03e |
| e2e/helpers/auth.setup.ts | 5 | 0 | 0 | 03e |
| e2e/storage.setup.ts | 3 | 0 | 0 | 03e |
| e2e/homebrew-sharing.spec.ts | 4 | 7 | 4 | 03f |
| e2e/campaign-chat.spec.ts | 0 | 2 | 0 | 03f |
| e2e/navigation-errors.spec.ts | 1 | 0 | 1 | 03f |

Total: 172 findings. Counts move; re-read the committed baseline before
starting a sub-leaf.

## Method (applies to every 03 sub-leaf)

- Read `docs/guides/add-e2e-test.md` first. Selector preference order:
  `getByRole` -> `getByLabel` -> `getByText` -> `getByTestId` ->
  `locator(css)`; raw CSS only with a short reason.
- Replace `first()`/`last()`/`nth()` with accessible disambiguation
  (accessible name, `{ exact: true }`, `filter()`), not with an equivalent
  positional hack.
- If the component has no accessible surface to select by, prefer fixing
  the component (add the accessible name, role, label, or
  `DialogDescription`) over adding a test id. This intentionally overlaps
  `docs/agent_notes/ux-audit-2026-06-06.md` P1-9; small client edits are in
  scope for a drain leaf. Read the nearest client `MODULE.md` before
  editing components.
- Behavior must not change: each rewritten selector must resolve to the
  same element. Find consuming specs with
  `rg -l "<page-object-name>" e2e/` and run them.
- After a file reaches zero on a rule: run `bun run lint:ratchet:update`
  (the file drops out of the baseline) and remove the file from that
  rule's debt-file override set in `eslint-config/` (find it with
  `rg "e2e-prefer-role-selectors|no-nth-methods|prefer-native-locators"
  eslint-config/`) so normal lint enforces `error` there immediately.

## Shared Verification Gates

- `bun run e2e -- <consuming specs>` (local stack; the guide covers setup)
- `bun run lint -- --max-warnings=0`
- `bun run lint:ratchet` and `bun run lint:ratchet:update` (baseline only
  shrinks; `--allow-worse` is never justified by a drain)
- `bun run lint:ratchet:zero-baseline`
- `bun run verify:changed`
