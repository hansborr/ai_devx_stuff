---
title: Storybook / component catalog for ui primitives
status: parked
date: 2026-06-01
source: surfaced during the 2026-06-01 design-system review (DESIGN.md / Claude Design export)
---

# Storybook (Component Catalog)

A living gallery for the client UI primitives. Surfaced while exporting the
design system to `DESIGN.md`: the design tokens and primitives are clean and
well-factored, but there's no rendered catalog to view variants, states, and
theming in one place.

Parked deliberately — it's tooling overhead, not product, and a small team can
ship without it. Promote when the component surface grows enough that
"what does the `outline` button look like disabled?" stops being answerable by
memory, or when onboarding a designer/contributor who needs a visual reference.

## Scope

- Stand up Storybook (or a lighter catalog — e.g. Ladle) against
  `packages/client`, wired to the Tailwind v4 theme so stories render with the
  real `@theme` tokens and fonts (Cinzel / Inter / JetBrains Mono).
- Stories for the 13 primitives in `packages/client/src/components/ui/`:
  `button`, `badge`, `card`, `input`, `textarea`, `label`, `dialog`, `popover`,
  `select`, `sheet`, `tabs`, `scroll-area`, `separator`.
- Cover every CVA variant + size and the key states (hover, focus-visible ring,
  disabled). `button` (6 variants × 4 sizes) and `badge` (4 variants) are the
  obvious first wins.
- A "tokens" / foundations page rendering the color, typography, radius, and
  elevation scales straight from `DESIGN.md`.

## Why It Matters (and why later)

- **For:** catches visual regressions, documents the system for new
  contributors, and is the natural home for the accessibility work (contrast
  + reduced-motion) flagged alongside this review.
- **Against (for now):** maintenance cost, build/CI surface, and story drift if
  not enforced. Not worth it until the component count or team size justifies
  it.

## Notes / Cross-references

- `DESIGN.md` (repo root) — exported design system; the foundations page should
  mirror it.
- The canvas/VTT colors documented in `DESIGN.md` are **not** DOM components and
  are out of scope for Storybook (Konva canvas, not React DOM).
- Deferred companion work from the same review: a WCAG contrast audit of the
  token pairs and `prefers-reduced-motion` handling — both could ride along once
  a catalog exists.
