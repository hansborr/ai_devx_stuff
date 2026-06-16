# Drain Selector Debt: Spec Files

Status: Done (2026-06-12, landed in "feat(e2e): drain spec-file selector
debt and retire override sets")
Order: 03f
Source: per-file baseline counts, 2026-06-12. Read
`03-e2e-selector-drain-method.md` first.

## Context

Three spec files carry the last 19 findings:

- `e2e/homebrew-sharing.spec.ts` (4 role, 7 nth, 4 native) — the largest
  inline-selector spec; per the e2e guide, repeated selectors belong in a
  page object, so part of this drain is moving homebrew selectors into a
  page object rather than rewriting them in place.
- `e2e/campaign-chat.spec.ts` (2 nth)
- `e2e/navigation-errors.spec.ts` (1 role, 1 native)

## Scope

- For `homebrew-sharing.spec.ts`: extract a `homebrew.po.ts` page object
  (or extend an existing one) with accessible selectors, then drain the
  spec through it. New page-object code must be born clean — it gets
  normal-lint `error` immediately.
- Rewrite the remaining flagged selectors in the two small specs in place.
- Drain all three to zero, update the baseline, remove them from the
  debt-file override sets.

## Definition Of Done

No spec file appears in the baseline for any selector ratchet; the three
specs pass.

## Verification

Umbrella gates plus `bun run e2e -- e2e/homebrew-sharing.spec.ts
e2e/campaign-chat.spec.ts e2e/navigation-errors.spec.ts`.

## Notes (2026-06-12)

- New `e2e/page-objects/homebrew.po.ts` covers both the homebrew index and
  the collection detail surface; born clean (no raw locators, no nth).
- The dual create-button ambiguity ("Create Collection" / "Add Entry"
  repeat in empty states) reused the campaigns-page precedent: page-header
  scope test ids (`homebrew-page-actions`, `collection-page-header`) on the
  two pages, with the same comment explaining why.
- The old `.last()` pick of the imported collection card had no accessible
  replacement by design: an imported collection keeps the original's name,
  author, and (clamped-private) visibility, so the cards are identical in
  the a11y tree. `HomebrewPO.openCollectionCopy` disambiguates by link
  href against the original's captured route path instead of position.
- Surprise: role queries (`getByRole("link")`) matched nothing right after
  import because the closing Radix dialog still aria-hid the page, while
  the testid card count (DOM, not a11y tree) already saw both cards.
  `importCollection` now waits for the dialog to hide, and
  `openCollectionCopy` web-first-waits on the link count before snapshotting
  hrefs with `.all()`.
- `campaign-chat.spec.ts` author-name `.first()` masked transcript-wide
  ambiguity; new `CampaignChatPO.expectMessageAuthor(text, author)` scopes
  the author assertion to the message item (per-message testid) instead.
- All three debt-file override sets emptied with this leaf, so the arrays
  and their `off` blocks were removed from `eslint-config/` (ESLint flat
  config rejects empty `files` arrays), and
  `eslint-rules/e2e-selector-config.test.js`'s suppression cases became
  drained-at-error cases — the rework 03e's notes deferred to 03g landed
  here instead because the sets ceased to exist.
- `lint:ratchet:zero-baseline` requires a `zeroBaselineDisposition` once a
  ratchet hits zero: the three selector ratchets now carry
  `promote-to-normal-lint` with `exitPath` pointing at 03g. Overrides and
  the config tests are already handled here, so 03g's remaining work is:
  retire the three ratchet entries from
  `scripts/lint-ratchet/lint-ratchet-config.ts`, refresh the stale
  "outside ratcheted debt-file overrides" wording in
  `docs/agent_notes/lint-coverage-map.md`, decide whether `drift:e2e`'s
  `debtFileCount` field retires (see next bullet), and record the verdict
  in `evaluation-verdicts.md`.
- Surprise: `scripts/drift/locator-usage.ts` imported
  `e2ePreferRoleSelectorDebtFiles` at runtime, and every verify gate missed
  the break — typecheck trusted the stale hand-written declarations in
  `scripts/eslint-config-shared-policy.d.ts`, and the sensor's tests inject
  `debtFileCount` instead of calling `loadDebtFileCount()`. Caught by the
  post-implementation subagent review running `bun run drift:e2e` directly.
  The sensor now hardcodes a drained count of 0 and the stale declarations
  are gone; the sensor also confirms zero raw `.locator(` calls remain
  under `e2e/**`.
