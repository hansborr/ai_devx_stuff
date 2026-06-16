# Drain Selector Debt: Encounter, Wizard, And VTT Page Objects

Status: Done (2026-06-12, landed in "feat(e2e): drain encounter, wizard,
and vtt page-object selector debt")
Order: 03d
Source: per-file baseline counts, 2026-06-12. Read
`03-e2e-selector-drain-method.md` first.

## Context

Three combat/creation page objects carry 25 findings:

- `e2e/page-objects/encounter.po.ts` (2 role, 8 nth, 1 native) — the
  largest `no-nth-methods` pool; initiative rows are selected by position.
- `e2e/page-objects/character-wizard.po.ts` (9 role, 1 nth, 1 native)
- `e2e/page-objects/vtt-drawer.ts` (3 role)

Positional initiative-row selection is exactly the selector family that
breaks when combat features change. Rows should be addressed by combatant
name. Coordination note: `backlog/ux-audit-2026-06-p0/` leaves touch the
initiative tracker and the creation wizard; if those land first, re-verify
counts — they may add accessible structure that makes this drain cheaper.

## Scope

- Rewrite every flagged selector in the three files per the umbrella
  method; initiative rows by combatant accessible name (the row already
  exposes `aria-current` for the active combatant — extend, don't bypass).
- Drain to zero, update the baseline, remove the files from the debt-file
  override sets.

## Definition Of Done

All three files are out of the baseline for every selector ratchet, and
consuming specs pass.

## Verification

Umbrella gates, with consuming specs found via
`rg -l "encounter.po|character-wizard.po|vtt-drawer" e2e/` (expect at
least `encounter-combat.spec.ts`, `character-create.spec.ts`,
`wizard-validation.spec.ts`).

## Notes (2026-06-12)

- All 25 findings drained across the three files; baseline shrank
  70 -> 45. Consumers are wider than the leaf guessed: five specs
  (encounter-combat, wizard-validation, character-create,
  character-data-integrity, inventory); 43/43 passed.
- The encounter.po.ts nth pool was mostly dead code, not positional
  initiative rows: the participant-level attack/spell/HP dialog helpers
  ("Attack with <participant>" etc.) had no spec call sites and no
  matching client surface — combat actions are drawer-scoped now
  ("Attack with <weapon>", "Cast <spell>"). Deleted rather than
  rewritten; initiative assertions already keyed on combatant name.
- `expectCombatLogEntry` asserts containment on a new
  `data-testid="combat-log"` (panel keeps `role="log"`): the modal VTT
  drawer aria-hides the panel so role lookups cannot reach it, and
  identical entries can repeat. The cantrip spec's log assertion was
  dropped outright — the old page-wide text match only ever hit the
  drawer's own spell button, and the drawer cantrip path
  (`castSpell.cast`) only posts chat when the cast persists.
- `openMySheetFromDropdown` now selects by accessible menuitem name
  instead of `data-token-id` CSS. The action bar's `accessibleName`
  appends the token label when it differs from the character name, and
  numbers remaining collisions ("Thorin (1)", "Thorin (2)") because
  token labels are not unique; both behaviors are unit-tested.
- Manual ability-score inputs gained `aria-label="<Ability> score"`
  (component fix preferred over a test id, per the umbrella method);
  wizard boost selects resolve by combobox name; the Konva canvas is
  located via its `role="presentation"` container instead of
  `.konvajs-content` CSS.
- Codex review: one P2 — same-character tokens with identical labels
  collapsed to one accessible name; fixed with the ordinal suffixes
  above. All other judgment calls (dead helper deletion, dropped cantrip
  assertion, test-id justification, lowercase state badge) were
  confirmed against source.
