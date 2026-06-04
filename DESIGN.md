---
version: alpha
name: Musi
description: >-
  Dark-fantasy design system for Musi, a D&D 5.5E virtual tabletop and campaign
  manager — deep charcoal surfaces, warm parchment text, a single gold accent,
  and an engraved Cinzel display face. Dark theme only.
colors:
  # Backgrounds & surfaces
  background: "#16181D"
  surface: "#1F2228"
  elevated: "#282C33"
  card: "#1F2228"
  card-foreground: "#EBE7E0"
  popover: "#282C33"
  popover-foreground: "#EBE7E0"
  # Brand & accent (gold)
  primary: "#E2B236"
  primary-hover: "#EDC55E"
  primary-foreground: "#372E25"
  ring: "#E2B236"
  # Parchment & text
  foreground: "#EBE7E0"
  parchment: "#E8DDC9"
  parchment-muted: "#CFC3AF"
  parchment-foreground: "#372E25"
  muted-foreground: "#A39C8F"
  # Neutral roles
  secondary: "#282C33"
  secondary-foreground: "#EBE7E0"
  muted: "#282C33"
  accent: "#282C33"
  accent-foreground: "#EBE7E0"
  border: "#494236"
  input: "#494236"
  # Semantic
  destructive: "#D22D2D"
  destructive-foreground: "#FFFFFF"
  success: "#39AC60"
  warning: "#E8BA30"
typography:
  display:
    fontFamily: "Cinzel Variable"
    fontSize: 30px
    fontWeight: "700"
    lineHeight: 36px
    letterSpacing: -0.025em
  heading:
    fontFamily: "Cinzel Variable"
    fontSize: 20px
    fontWeight: "600"
    lineHeight: 28px
  card-title:
    fontFamily: "Cinzel Variable"
    fontSize: 24px
    fontWeight: "600"
    lineHeight: 24px
    letterSpacing: -0.025em
  body:
    fontFamily: "Inter Variable"
    fontSize: 14px
    fontWeight: "400"
    lineHeight: 20px
  label:
    fontFamily: "Inter Variable"
    fontSize: 12px
    fontWeight: "600"
    lineHeight: 16px
  mono:
    fontFamily: "JetBrains Mono"
    fontSize: 14px
    fontWeight: "400"
    lineHeight: 20px
rounded:
  DEFAULT: 0.375rem
  full: 9999px
spacing:
  unit: 4px
  control-gap: 8px
  card-gap: 6px
  card-padding: 24px
  input-padding-x: 12px
  button-padding-x: 16px
components:
  button-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.DEFAULT}"
    height: 40px
    padding: 8px 16px
  button-default-hover:
    backgroundColor: "{colors.primary-hover}"
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.destructive-foreground}"
    rounded: "{rounded.DEFAULT}"
    height: 40px
    padding: 8px 16px
  button-outline:
    backgroundColor: transparent
    textColor: "{colors.foreground}"
    rounded: "{rounded.DEFAULT}"
    height: 40px
    padding: 8px 16px
  button-outline-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.DEFAULT}"
    height: 40px
    padding: 8px 16px
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.foreground}"
    rounded: "{rounded.DEFAULT}"
    height: 40px
  button-ghost-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
  button-link:
    backgroundColor: transparent
    textColor: "{colors.primary}"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.DEFAULT}"
    padding: "{spacing.card-padding}"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.DEFAULT}"
    height: 40px
    padding: 8px 12px
  textarea:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.DEFAULT}"
    padding: 8px 12px
  badge-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: 2px 10px
  badge-default-hover:
    backgroundColor: "{colors.primary-hover}"
  badge-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.full}"
    padding: 2px 10px
  badge-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.destructive-foreground}"
    rounded: "{rounded.full}"
    padding: 2px 10px
  badge-outline:
    backgroundColor: transparent
    textColor: "{colors.foreground}"
    rounded: "{rounded.full}"
    padding: 2px 10px
---

# Musi — Design System

A dark‑fantasy design system for **Musi**, a D&D 5.5E virtual tabletop and campaign manager.
The aesthetic is a candle‑lit gaming table: deep charcoal surfaces, warm **parchment** text, a
single **gold** accent, and an engraved **Cinzel** display face for titles. Body copy is clean and
modern (Inter); dice math and code use JetBrains Mono.

> **Source of truth:** `packages/client/src/app.css` (Tailwind v4 `@theme`) and the primitives in
> `packages/client/src/components/ui/`. The front‑matter tokens above mirror that theme; the `colors`
> hex are exact sRGB conversions of the source HSL. The prose tables below also list the original HSL
> for reference.

---

## Overview

- **Mood:** dark fantasy, tabletop, focused. Low‑light "screen in a dim room" feel.
- **Audience:** D&D 5.5E players and DMs running live sessions and managing campaigns.
- **Wordmark:** "Musi" in Cinzel, bold, tight tracking, rendered in the gold primary
  (`font-serif text-3xl font-bold tracking-tight text-primary`).
- **Accent discipline:** exactly one accent (gold). Everything else is neutral charcoal or
  parchment so the gold reads as "interactive / important."
- **Theme:** dark only — there is no light theme. Tokens are tuned for legibility over dim,
  occasionally photographic, backdrops.

---

## Colors

Dark theme only. Neutrals are blue‑leaning charcoal (hue 220); text and warm tokens are
parchment (hue ~38). The gold primary (hue 43) is the lone brand hue. HSL is the source form in
`app.css`; the front‑matter `colors` block carries the exact hex equivalents.

### Backgrounds & surfaces

| Token        | HSL                | Hex       | Role                   |
| ------------ | ------------------ | --------- | ---------------------- |
| `background` | `hsl(220 15% 10%)` | `#16181D` | App canvas, page body  |
| `surface`    | `hsl(220 12% 14%)` | `#1F2228` | Panels, sidebars       |
| `elevated`   | `hsl(220 12% 18%)` | `#282C33` | Raised surfaces, menus |
| `card`       | `hsl(220 12% 14%)` | `#1F2228` | Card background        |
| `popover`    | `hsl(220 12% 18%)` | `#282C33` | Popovers, dropdowns    |

### Brand & accent

| Token                | HSL               | Hex       | Role                                             |
| -------------------- | ----------------- | --------- | ------------------------------------------------ |
| `primary`            | `hsl(43 75% 55%)` | `#E2B236` | Gold accent — primary buttons, links, focus ring |
| `primary-hover`      | `hsl(43 80% 65%)` | `#EDC55E` | Hover state for primary                          |
| `primary-foreground` | `hsl(30 20% 18%)` | `#372E25` | Text on gold (dark brown)                        |
| `ring`               | `hsl(43 75% 55%)` | `#E2B236` | Focus ring (matches gold)                        |

### Parchment & text

| Token                  | HSL               | Hex       | Role                               |
| ---------------------- | ----------------- | --------- | ---------------------------------- |
| `foreground`           | `hsl(38 20% 90%)` | `#EBE7E0` | Default body text (warm off‑white) |
| `parchment`            | `hsl(38 40% 85%)` | `#E8DDC9` | Parchment fills / accents          |
| `parchment-muted`      | `hsl(38 25% 75%)` | `#CFC3AF` | Softer parchment                   |
| `parchment-foreground` | `hsl(30 20% 18%)` | `#372E25` | Text on parchment                  |
| `muted-foreground`     | `hsl(38 10% 60%)` | `#A39C8F` | Secondary / helper text            |

### Neutral roles

| Token                  | HSL                | Hex       | Role                                    |
| ---------------------- | ------------------ | --------- | --------------------------------------- |
| `secondary`            | `hsl(220 12% 18%)` | `#282C33` | Secondary buttons/badges                |
| `secondary-foreground` | `hsl(38 20% 90%)`  | `#EBE7E0` | Text on secondary                       |
| `muted`                | `hsl(220 12% 18%)` | `#282C33` | Muted fills                             |
| `accent`               | `hsl(220 12% 18%)` | `#282C33` | Menu/hover backgrounds                  |
| `accent-foreground`    | `hsl(38 20% 90%)`  | `#EBE7E0` | Text on accent                          |
| `border`               | `hsl(38 15% 25%)`  | `#494236` | Warm borders (subtle, parchment‑tinted) |
| `input`                | `hsl(38 15% 25%)`  | `#494236` | Input borders                           |

### Semantic

| Token                    | HSL                | Hex       | Role                            |
| ------------------------ | ------------------ | --------- | ------------------------------- |
| `destructive`            | `hsl(0 65% 50%)`   | `#D22D2D` | Errors, delete                  |
| `destructive-foreground` | `hsl(0 0% 100%)`   | `#FFFFFF` | Text on destructive             |
| `success`                | `hsl(140 50% 45%)` | `#39AC60` | Success / saved                 |
| `warning`                | `hsl(45 80% 55%)`  | `#E8BA30` | Warnings (amber, near the gold) |

---

## Typography

| Role               | Family              | Token          | Usage                                                                               |
| ------------------ | ------------------- | -------------- | ----------------------------------------------------------------------------------- |
| Display / headings | **Cinzel Variable** | `--font-serif` | Page titles, card titles, the "Musi" wordmark. Engraved Roman‑capital fantasy feel. |
| Body / UI          | **Inter Variable**  | `--font-sans`  | Default for `body` and all UI text.                                                 |
| Mono               | **JetBrains Mono**  | `--font-mono`  | Dice formulas, stat blocks, code.                                                   |

**Observed scale** (Tailwind utilities in use; maps to the `typography` tokens above):

- Page title (`display`) — `font-serif text-3xl font-bold tracking-tight` (≈30px)
- Section heading (`heading`) — `font-serif text-xl font-semibold` (≈20px)
- Card title (`card-title`) — `text-2xl font-semibold leading-none tracking-tight` (often `font-serif` in dense cards)
- Card description / helper — `text-sm text-muted-foreground`
- Body / controls (`body`) — `text-sm`
- Badge / micro‑label (`label`) — `text-xs font-semibold`

Headings lead with Cinzel; body and controls stay on Inter for legibility.

---

## Layout

Spacing follows **Tailwind's default 4px scale** (`spacing.unit`); the design system does not
define a bespoke grid or custom spacing tokens in `@theme`. Layout is composed with flex/grid
utilities over that scale. Observed primitives:

- Cards pad at `p-6` (24px, `spacing.card-padding`) with `space-y-1.5` (6px, `spacing.card-gap`)
  header rhythm.
- Interactive controls use `gap-2` (8px, `spacing.control-gap`) between icon and label.
- Inputs and buttons share `py-2` vertical padding; inputs use `px-3` (12px), buttons `px-4` (16px).

---

## Elevation & Depth

Depth is conveyed mostly by **background steps, not shadows**:
`surface` (`#1F2228`) → `elevated` / `popover` (`#282C33`). Cards carry a single soft `shadow-sm`;
there are no heavy or layered shadows. Menus, dropdowns, dialogs, and sheets sit on the
`popover` / `elevated` tone so they read as lifted off the `background` canvas.

---

## Shapes

- **Radius:** `--radius: 0.375rem` (6px, `rounded.DEFAULT`). Applied as `rounded-[var(--radius)]`
  across buttons, cards, inputs, and textareas. Badges are fully rounded (`rounded-full`,
  `rounded.full`, pill).
- **Borders:** 1px `border` everywhere; the global base layer sets every element's border color to
  the warm `border` token (`#494236`), so hairlines read parchment‑tinted, not gray.

---

## Components

All primitives live in `packages/client/src/components/ui/` and compose the tokens above. Variant
logic uses `class-variance-authority` (CVA).

### Interaction states

- **Focus:** `focus-visible:ring-2 ring-ring ring-offset-2 ring-offset-background` — a 2px gold ring
  offset from the surface. Consistent across buttons, inputs, badges.
- **Disabled:** `opacity-50` + `pointer-events-none` (buttons) / `cursor-not-allowed` (inputs).
- **Hover:** primary → `primary-hover` (lighter gold); neutral surfaces → `accent`; subtle fills use
  an alpha drop (e.g. `secondary/80`, `destructive/90`).
- **Transitions:** `transition-colors` on interactive elements; color‑only, no motion flourish.

### Button

Base: `inline-flex items-center justify-center gap-2 rounded-[var(--radius)] text-sm font-medium
transition-colors` + gold focus ring + `disabled:opacity-50`. Icons auto‑size to `size-4`.

| Variant       | Style                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| `default`     | `bg-primary text-primary-foreground hover:bg-primary-hover` — solid gold (primary CTA) |
| `destructive` | `bg-destructive text-destructive-foreground hover:bg-destructive/90`                   |
| `outline`     | `border border-border bg-transparent hover:bg-accent hover:text-accent-foreground`     |
| `secondary`   | `bg-secondary text-secondary-foreground hover:bg-secondary/80`                         |
| `ghost`       | transparent → `hover:bg-accent hover:text-accent-foreground`                           |
| `link`        | `text-primary underline-offset-4 hover:underline`                                      |

| Size      | Style                |
| --------- | -------------------- |
| `default` | `h-10 px-4 py-2`     |
| `sm`      | `h-9 px-3`           |
| `lg`      | `h-11 px-8`          |
| `icon`    | `h-10 w-10` (square) |

### Card

Container: `rounded-[var(--radius)] border border-border bg-card text-card-foreground shadow-sm`.

Anatomy (each part is its own component):

- `CardHeader` — `flex flex-col space-y-1.5 p-6`
- `CardTitle` — `text-2xl font-semibold leading-none tracking-tight` (commonly `font-serif`)
- `CardDescription` — `text-sm text-muted-foreground`
- `CardContent` — `p-6 pt-0`
- `CardFooter` — `flex items-center p-6 pt-0`

### Input

`h-10 w-full rounded-[var(--radius)] border border-input bg-background px-3 py-2 text-sm
text-foreground` with `placeholder:text-muted-foreground`, gold focus ring, and
`disabled:opacity-50 disabled:cursor-not-allowed`.

### Textarea

Same recipe as Input but height‑auto (no fixed `h-10`): `w-full rounded-[var(--radius)] border
border-input bg-background px-3 py-2 text-sm text-foreground` + focus ring + disabled states.

### Badge

Pill: `inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold
transition-colors` + focus ring.

| Variant       | Style                                                                |
| ------------- | -------------------------------------------------------------------- |
| `default`     | `bg-primary text-primary-foreground hover:bg-primary-hover` (gold)   |
| `secondary`   | `bg-secondary text-secondary-foreground hover:bg-secondary/80`       |
| `destructive` | `bg-destructive text-destructive-foreground hover:bg-destructive/80` |
| `outline`     | transparent, `text-foreground` (border only)                         |

### Other primitives (Radix‑based)

`Dialog`, `Sheet`, `Popover`, `Select`, `Tabs`, `ScrollArea`, `Separator`, `Label` — all themed on
`popover`/`elevated` backgrounds with the warm `border` and gold focus ring, consistent with the
tokens above.

---

## Do's and Don'ts

**Do**

- Keep exactly one accent: gold (`primary`) for interactive / important elements; everything else
  neutral charcoal or parchment.
- Lead headings and the wordmark with Cinzel (`font-serif`); keep body and UI text on Inter.
- Use `rounded-[var(--radius)]` (6px) for buttons, cards, inputs, textareas; reserve `rounded-full`
  for badges/pills.
- Convey depth with the `surface → elevated → popover` tonal steps and a single `shadow-sm`.
- Apply the gold focus ring (`focus-visible:ring-2 ring-ring ring-offset-2`) to every interactive
  element.
- Source token values from `packages/client/src/app.css` (`@theme`) — treat it as canonical and let
  this file mirror it.
- Maintain WCAG AA contrast (≥ 4.5:1 for normal text) for any new token pairing; a formal contrast
  audit of the existing pairs is tracked as deferred work.

**Don't**

- Don't introduce a second accent hue. `warning` amber sits deliberately near the gold — it signals
  warnings, not a primary CTA.
- Don't add motion flourishes; transitions are `transition-colors` only (color, no movement). Honor
  `prefers-reduced-motion` for any future animation.
- Don't hardcode hex in DOM components — use the theme tokens.
- Don't treat the prose hex as authoritative over HSL; `app.css` HSL is the source, now mirrored by
  the exact front‑matter hex.
- Don't unify the Konva canvas colors with the `@theme` tokens by default — they're intentionally
  punchier over photographic maps (see **Canvas / VTT colors**).

---

## Canvas / VTT colors

The battlemap is a **Konva canvas**, not the DOM, so these colors live outside the `@theme` token
system and the front‑matter above. They're drawn as raw hex/`rgba` straight from **Tailwind's default
palette** (e.g. `#f59e0b` = amber‑500, `#22c55e` = green‑500), chosen for high saturation and
legibility over arbitrary map artwork rather than to match the warm UI tokens. Documented here so
they're an explicit, owned part of the system — not an accident.

> Sources: `components/campaign/maps/`, `components/campaign/tokens/`, `components/vtt/`, and
> `stores/map-canvas-store.ts`.

### Map & grid

| Element                 | Value                    | Tailwind    | Notes                                                             |
| ----------------------- | ------------------------ | ----------- | ----------------------------------------------------------------- |
| Grid lines              | `rgba(255,255,255,0.12)` | white @ 12% | `map-canvas-grid.tsx`                                             |
| Freehand draw (default) | `#ffffff`, width `2`     | white       | DM drawing tool default; user‑recolorable (`map-canvas-store.ts`) |

### Token rendering (`token-shape.tsx`)

| State            | Value                   | Tailwind    | Meaning                        |
| ---------------- | ----------------------- | ----------- | ------------------------------ |
| Default outline  | `rgba(255,255,255,0.3)` | white @ 30% | Resting token border           |
| Label text       | `#ffffff`               | white       | Token name/initials            |
| **Selected**     | `#f59e0b`               | amber‑500   | Currently selected token       |
| **Current turn** | `#22d3ee`               | cyan‑400    | Whose turn it is in initiative |

### Token identity palette (`token-form-fields.tsx`)

Assignable per‑token colors so players/NPCs read apart at a glance. Default `#6366f1` (indigo‑500).

| Swatch    | Tailwind  |     | Swatch    | Tailwind             |
| --------- | --------- | --- | --------- | -------------------- |
| `#ef4444` | red‑500   |     | `#a855f7` | purple‑500           |
| `#22c55e` | green‑500 |     | `#ec4899` | pink‑500             |
| `#f59e0b` | amber‑500 |     | `#14b8a6` | teal‑500             |
| `#3b82f6` | blue‑500  |     | `#6366f1` | indigo‑500 (default) |

### HP bar (`token-hp-bar.tsx`)

| Part                | Value             | Tailwind    |
| ------------------- | ----------------- | ----------- |
| Track               | `rgba(0,0,0,0.5)` | black @ 50% |
| Healthy fill        | `#22c55e`         | green‑500   |
| Low fill (≤ 50% HP) | `#ef4444`         | red‑500     |

### Condition markers (`token-condition-icons.tsx`)

Each D&D condition gets a fixed marker color; glyph fill `#ffffff`, fallback `#6b7280` (gray‑500).

| Condition               | Color                | Condition   | Color               |
| ----------------------- | -------------------- | ----------- | ------------------- |
| blinded / incapacitated | `#6b7280` gray‑500   | poisoned    | `#22c55e` green‑500 |
| charmed                 | `#ec4899` pink‑500   | prone       | `#f59e0b` amber‑500 |
| deafened                | `#9ca3af` gray‑400   | restrained  | `#3b82f6` blue‑500  |
| exhaustion              | `#f97316` orange‑500 | stunned     | `#fbbf24` amber‑400 |
| frightened              | `#a855f7` purple‑500 | invisible   | `#a3e635` lime‑400  |
| grappled                | `#eab308` yellow‑500 | petrified   | `#78716c` stone‑500 |
| paralyzed               | `#dc2626` red‑600    | unconscious | `#1f2937` gray‑800  |

### Overlays

| Overlay                                        | Element          | Value                           |
| ---------------------------------------------- | ---------------- | ------------------------------- |
| Measurement ruler (`measurement-overlay.tsx`)  | line + endpoints | `#facc15` (yellow‑400)          |
|                                                | label bg         | `rgba(0,0,0,0.65)`              |
| Spell / area template (`template-overlay.tsx`) | cell fill        | `rgba(245,158,11,0.25)` (amber) |
|                                                | cell stroke      | `rgba(245,158,11,0.5)`          |
|                                                | label bg         | `rgba(0,0,0,0.65)`              |
| Targeting (`target-pick-overlay.tsx`)          | valid fill       | `rgba(34,197,94,0.18)` (green)  |
|                                                | valid stroke     | `rgba(34,197,94,0.55)`          |
|                                                | hover stroke     | `#22c55e` (green‑500)           |

### Implicit canvas semantics

Across overlays a small color language has emerged, worth keeping consistent as the VTT grows:

- **Amber** (`#f59e0b` / `245,158,11`) → selection, spell templates, the _prone_ condition.
- **Cyan** (`#22d3ee`) → the active turn.
- **Green** (`#22c55e`) → healthy HP, valid targets, _poisoned_.
- **Red** (`#ef4444` / `#dc2626`) → low HP, _paralyzed_.
- **Yellow** (`#facc15`) → measurement.

### Divergence to be aware of

These canvas colors are **independent of the `@theme` tokens**, and semantic overlaps don't line up:
canvas "healthy/valid" green is `#22c55e` while the UI `success` token is `#39AC60`; canvas
selection/template amber is `#f59e0b` while the UI `warning` token is `#E8BA30`. That's a deliberate
trade‑off (canvas needs punchy colors over photographic maps), not a bug — but if you ever want the
two surfaces unified, this section is the full inventory to reconcile.

---

## Quick reference

```
Canvas       #16181D   charcoal
Panel        #1F2228   surface / card
Raised       #282C33   elevated / popover
Accent       #E2B236   gold (primary)
Text         #EBE7E0   parchment foreground
Muted text   #A39C8F
Border       #494236   warm hairline
Radius       6px
Display      Cinzel · Body Inter · Mono JetBrains Mono
```
