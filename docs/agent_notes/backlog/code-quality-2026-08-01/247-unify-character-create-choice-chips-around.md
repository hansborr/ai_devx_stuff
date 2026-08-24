# 247. Unify character-create choice chips around pressed-state semantics

Status: Not started
Theme: Unify character-create choice chips and restore pressed-state semantics · Area: client · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Character creation maintains three implementations of the same selectable-chip
interaction. Class skills, languages, and spells separately coordinate
selected styling, selection caps, disabled state, focus treatment, guarded
activation, and labels.

The copies have already diverged semantically. Spell choices expose their
selection through `aria-pressed`, while class skills and languages communicate
it only through color and border classes. Screen-reader users therefore cannot
determine which skills or languages are selected, including automatic disabled
choices, and any interaction or accessibility correction must be repeated
across three branches.

## Evidence

- `packages/client/src/components/character-create/steps/proficiencies-step.tsx:103-134`
  — class-skill chips independently compute selected and disabled state,
  guard their click handler, and select focus, border, background, cursor, and
  opacity classes, but provide no `aria-pressed`.
- `packages/client/src/components/character-create/steps/proficiencies-step.tsx:154-183`
  — language chips repeat the same button, activation, selected-style, focus,
  and disabled branches, again without a pressed-state attribute.
- `packages/client/src/components/character-create/steps/spell-selection-step.tsx:34-63`
  — `SpellOptionButton` implements the corresponding selected, capped,
  disabled, guarded-click, and style behavior while exposing `isSelected`
  through `aria-pressed`.
- `packages/client/src/components/character-create/steps/proficiencies-step.test.tsx:101-112`
  — the language-selection test observes state only by checking that the
  button's class string contains `border-primary`.
- `packages/client/src/components/character-create/steps/spell-selection-step.test.tsx:52-61`
  — the parallel spell test asserts `aria-pressed="true"` after activation,
  demonstrating the semantic difference between the copies.

## Proposed direction

Extract a focused choice-chip primitive within the character-create component
boundary. Give it explicit `pressed`, `disabled`, and activation inputs plus
children. It should own `type="button"`, `aria-pressed`, native disabled state,
guarded activation, the shared focus ring, and the common selected, available,
and disabled visual branches.

Migrate class skills, languages, and spell choices onto that primitive.
Callers continue to derive domain state:

- Class skills retain the maximum selection count, background-proficiency
  detection, and `"(background)"` label.
- Languages retain the universal-language set, default-language behavior, and
  `"(default)"` label.
- Spells retain cantrip and level-one caps, spell names, and concentration
  badges.

Pass pressed and disabled independently. Background skills and universal
languages remain disabled but expose their automatic selection as pressed.
Selected ordinary skills and spells remain activatable at their caps so users
can deselect them, while unselected choices at the cap remain disabled.
Preserve any contextual muted appearance for automatic choices without moving
their domain rules into the primitive.

Replace class-name assertions with semantic interaction coverage. Test
`aria-pressed` before and after skill and language activation, automatic
background and universal choices as pressed-and-disabled, blocked activation
of disabled choices, and deselection of an already selected choice at its cap.
Retain spell coverage for concentration badges and pressed state so all three
callers prove the shared contract without duplicating its implementation tests.

## Scope / caveats

- Keep selection caps, `toggleInList` and `toggleSpell`, domain labels,
  universal-language derivation, background-proficiency rules, spell grouping,
  and spell badges in their current callers.
- Preserve background-skill and universal-language disabled behavior while
  adding their semantic selected state. Do not make disabled automatic choices
  interactive.
- Do not generalize this into a repository-wide button, toggle, or form-control
  framework. The extraction is limited to the three character-create chip
  consumers evidenced here.
- Keep this work separate from
  [238-share-class-and-subclass-caster-selection-fields.md](./238-share-class-and-subclass-caster-selection-fields.md).
  That leaf extracts homebrew select presentation and normalization; it does
  not own character-create pressed buttons, and no ordering is required.
