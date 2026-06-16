# Drain Selector Debt: character-sheet.po.ts

Status: Done (2026-06-12, landed in "feat(e2e): drain character-sheet.po.ts
selector ratchet debt")
Order: 03a
Source: per-file baseline counts, 2026-06-12. Read
`03-e2e-selector-drain-method.md` first.

## Context

`e2e/page-objects/character-sheet.po.ts` is the largest single selector
debt file: 37 findings (22 role, 6 nth, 9 native). It backs the character
sheet, data-integrity, and inventory flows, so its selectors run on most
e2e sessions; the sheet UI is also the surface the 2026-06-06 UX audit
flagged for missing accessible semantics (chip toggles without
`aria-pressed`), so expect some component-side fixes rather than pure
selector rewrites.

## Scope

- Rewrite every flagged selector in
  `e2e/page-objects/character-sheet.po.ts` per the umbrella method.
- Where the sheet UI lacks an accessible handle, add it in the client
  component (label, role, accessible name) instead of a test id; keep such
  edits minimal and read the nearest client `MODULE.md` first.
- Drain the file to zero on all three rules, update the baseline, and
  remove it from the debt-file override sets.

## Definition Of Done

`character-sheet.po.ts` no longer appears in `lint-ratchet.baseline.json`
for any selector ratchet, normal lint enforces all three rules on it, and
every consuming spec passes.

## Verification

Umbrella gates, with consuming specs found via
`rg -l "character-sheet.po" e2e/` (expect at least
`character-sheet.spec.ts`, `character-data-integrity.spec.ts`,
`inventory.spec.ts`).

## Notes (2026-06-12)

- All 37 findings drained; baseline shrank 172 -> 135 and the file left
  all three debt override sets. Consuming specs (`character-sheet`,
  `character-data-integrity`, `inventory`, plus `spell-rest`) pass: 31/31.
- Surprise: the sheet mounts the desktop layout and the mobile stats tab
  together, so save/skill rows exist twice in the DOM — the old `.first()`
  calls were load-bearing. Replaced with `filter({ visible: true })`
  (sanctioned `filter()` disambiguation, not positional).
- `getCurrentHp` now reads `aria-valuenow` off the "Hit points"
  progressbar; the old `.font-mono` span scrape was ambiguous with the
  amount input (also `.font-mono`).
- Component a11y fixes (in scope per umbrella, unit-tested):
  `sheet-header.tsx` is now `<section aria-label="Character summary">`
  (scopes the species-badge assertion); `inventory-item-row.tsx` details
  region got `aria-label "<item> details"` (scopes Delete/Yes buttons).
- Codex review: no P0/P1. Accepted P2: `expectSpeciesBadge` would
  strict-fail for a character literally named like its species (header
  contains both h1 name and badge). E2e names are uniqueName()-generated,
  and the alternatives are banned positional selectors or invalid ARIA
  (aria-label on a generic-role badge), so left as-is.
