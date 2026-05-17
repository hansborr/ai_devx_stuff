# Design Direction

Stable visual rules for the client. Exact tokens live in
`packages/client/src/app.css`; this file captures intent and guardrails, not
every component variant.

## Identity

- The product should read as **dark fantasy / parchment**, not generic SaaS.
- Dark charcoal surfaces carry most layouts; parchment is a highlight surface
  for emphasis, not the default background.
- Gold is the primary accent. Reserve red and green for stateful feedback
  rather than general decoration.

## Current Typography

- **Sans** — `Inter Variable` for body copy and dense UI text.
- **Serif** — `Cinzel Variable` for headings and title moments.
- **Mono** — `JetBrains Mono` for numbers, rolls, codes, and compact labels.

## Current Theme Tokens

These are the stable anchors implemented in `app.css`:

- Backgrounds: deep charcoal base, slightly lighter surface and elevated
  layers.
- Parchment: warm off-white and muted parchment variants for contrast panels.
- Primary accent: gold plus a brighter hover state.
- Text: light foreground on dark surfaces, dark foreground on parchment.
- Borders: warm, subdued lines rather than cool gray dividers.
- Semantics: dedicated destructive, success, and warning tokens.

## UI Rules

- Prefer shadcn/ui and Radix primitives, themed through CSS custom properties,
  over one-off bespoke controls.
- Keep corners modest and borders warm; avoid overly rounded, glossy, or neon
  treatments.
- Use parchment selectively for sheets, stat blocks, and standout detail
  panels. Most chrome should stay on the dark surface stack.
- Motion should communicate state changes or spatial transitions, not decorate
  static content.

## Layout Rules

- Dense desktop layouts are fine, but mobile needs explicit stacking or tabbing
  rather than hoping the desktop version collapses cleanly.
- Keep major page content within a readable centered column; avoid full-width
  sprawl unless the feature genuinely needs canvas space.
- Loading states should match the eventual layout shape so page transitions
  stay legible.

## When Updating The Theme

1. Change tokens in `packages/client/src/app.css` first.
2. Update this file only when the stable design language changes, not for every
   one-off page tweak.
3. If a new surface needs to break the rules above, document why before
   proliferating a second visual system.
