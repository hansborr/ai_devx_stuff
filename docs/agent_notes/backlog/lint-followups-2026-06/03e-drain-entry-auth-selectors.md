# Drain Selector Debt: Entry, Auth, And Setup Surfaces

Status: Done (2026-06-12, landed in "feat(e2e): drain entry, auth, and
setup surface selector ratchet debt")
Order: 03e
Source: per-file baseline counts, 2026-06-12. Read
`03-e2e-selector-drain-method.md` first.

## Context

Seven small entry-surface files carry 26 findings:

- `e2e/page-objects/login.po.ts` (3 role, 1 nth, 1 native)
- `e2e/page-objects/register.po.ts` (4 role, 1 nth, 1 native)
- `e2e/page-objects/join.po.ts` (1 role, 1 native)
- `e2e/page-objects/dashboard.po.ts` (1 nth)
- `e2e/page-objects/notification.po.ts` (1 role, 3 nth)
- `e2e/helpers/auth.setup.ts` (5 role)
- `e2e/storage.setup.ts` (3 role)

The two setup files run before every suite, so a selector regression here
breaks everything — keep rewrites conservative and verify with the full
suite, not just the entry specs.

## Scope

- Rewrite every flagged selector per the umbrella method. Auth forms
  should select by label (`getByLabel("Email")` etc.) per the e2e guide's
  form rules; notification items by accessible name/text, not position.
- Drain all seven to zero, update the baseline, remove them from the
  debt-file override sets.

## Definition Of Done

All seven files are out of the baseline for every selector ratchet, and
the full e2e suite passes (setup files gate everything).

## Verification

Umbrella gates, but run the full `bun run e2e` once because
`auth.setup.ts` / `storage.setup.ts` are global setup.

## Notes (2026-06-12)

- No client component edits were needed: `FormField` already wires
  `Label htmlFor` -> `Input id`, so every `#email`/`#password`/`#displayName`
  locator became `getByLabel("Email")` / `getByLabel("Password")` /
  `getByLabel("Display Name")` directly.
- `expectError` in login/register dropped `.first()` by filtering
  `getByRole("alert")` on the expected text (field errors and the server
  error both render `role="alert"`, so position was masking ambiguity).
  The assertion is now `toBeVisible()` on the content-filtered alert
  rather than `toContainText` on the first alert; the only consumers
  (auth-smoke) pass regexes that the filter applies identically.
- `clickFirstNotification()` was renamed to `clickNotification(title)`
  per this leaf's "by accessible name/text, not position" rule; the one
  consumer (notifications.spec.ts) now passes "New member joined".
- `expectPopoverOpen`'s `.first()` existed because
  `getByText("Notifications")` substring-matches "No notifications yet";
  the popover heading role query removes the ambiguity.
- `dashboard.clickCharacterCard`'s `.first()` was redundant:
  `expectCharacterExists` already used the same locator strictly, and
  consuming specs use unique generated names.
- `expectUnreadDot` and `clickNotification(title)` are now
  strict-single-match; current specs call them with exactly one matching
  notification present. If a future spec needs "at least one unread" or
  has duplicate titles, scope by notification title / add further
  filtering instead of reintroducing `.first()`.
- Surprise: dropping `.first()` from `getByLabel("Unread")` failed at
  first — non-exact `getByLabel` substring-matches the bell's
  "Notifications (1 unread)" aria-label. `{ exact: true }` (the umbrella's
  preferred disambiguation) fixes it; `expectNoUnreadDots` got the same
  treatment so both dot assertions ignore the bell.
- `eslint-rules/e2e-selector-config.test.js` pinned `auth.setup.ts` as its
  representative role-debt file; repointed that case at
  `navigation-errors.spec.ts` (the remaining role+native debt file) and
  added a case asserting drained files are back at `error`. 03g will
  rework these tests when the override sets retire.
- Editor-only TS2729 diagnostics on the class-field locator pattern in
  other POs are noise: `tsconfig.e2e.json` sets
  `useDefineForClassFields: false`, under which the pattern is legal;
  the LSP associates e2e files with a different tsconfig.
