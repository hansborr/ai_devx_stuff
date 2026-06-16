# Drain Selector Debt: spells-panel.po.ts

Status: Done (2026-06-12, landed in "feat(e2e): drain spells-panel.po.ts
selector ratchet debt")
Order: 03b
Source: per-file baseline counts, 2026-06-12. Read
`03-e2e-selector-drain-method.md` first.

## Context

`e2e/page-objects/spells-panel.po.ts` carries 34 findings (19 role, 5 nth,
10 native) — the second-largest file and the largest
`prefer-native-locators` pool. The spells panel includes list rows, slot
counters, and the cast/prepare controls; nth-based row selection is the
main hazard to replace with name-based disambiguation.

## Scope

- Rewrite every flagged selector in `e2e/page-objects/spells-panel.po.ts`
  per the umbrella method.
- Spell rows should be selected by spell name (role + accessible name or
  `filter({ hasText })` with exact matching), never by position; if rows
  have no accessible name, fix the row component.
- Drain to zero on all three rules, update the baseline, and remove the
  file from the debt-file override sets.

## Definition Of Done

`spells-panel.po.ts` is out of the baseline for all selector ratchets,
normal lint enforces the rules on it, and consuming specs pass.

## Verification

Umbrella gates, with consuming specs found via
`rg -l "spells-panel.po" e2e/` (expect at least `spell-rest.spec.ts`).

## Notes (2026-06-12)

- All 34 findings drained; baseline shrank 135 -> 101 and the file left
  all three debt override sets. `spell-rest.spec.ts` (sole consumer)
  passes 8/8.
- The "first available spell" flows were inherently positional, so they
  became name-deterministic per this leaf's scope note: `addSpell`,
  `prepareSpell`, and `castSpell` now take the spell name and the spec
  passes seeded SRD names (Acid Splash, Magic Missile; wizard character,
  and the dialog's class filter defaults to the character's class). The
  parent-traversal name scrape disappeared entirely.
- Component fix (unit-tested): add-spell-dialog Add buttons had identical
  "Add" accessible names — now "Add <spell>" / "<spell> already known".
- `^addSpell$` joined the playwright/expect-expect assertFunctionPatterns
  (same convention as performShortRest/prepareSpell: PO methods that
  assert internally).
- Codex review: no P0/P1; its P2 (substring spell-name collisions, e.g.
  Invisibility vs Greater Invisibility) was fixed by anchoring the
  checkbox name regex, filtering cast rows on the exact spell-name
  button, and exact-matching the post-add visibility check.
- The old `[data-testid^="cast-"]` selector never matched `ritual-cast-`
  buttons; the rewrite keeps that exclusion via
  `name: "Cast", exact: true`.
- `eslint-rules/e2e-selector-config.test.js` pinned spells-panel.po.ts as
  its "all three debt kinds" exemplar; switched to
  `e2e/homebrew-sharing.spec.ts` (drains last, in 03f). Heads-up for 03e
  and 03f: the other two exemplars (`auth.setup.ts`, role-only;
  `campaign-chat.spec.ts`, nth-only) drain there and the test needs the
  same treatment — 03g retires the whole suppression mechanism and should
  delete the debt-file tests outright.
