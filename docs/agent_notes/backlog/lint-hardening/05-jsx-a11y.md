# Leaf 5: jsx-a11y For Client JSX

Status: Landed 2026-05-16
Depends on: Leaf 1 (zero-warning gate)
Related: Leaf 13 (`eslint-plugin-react`), Leaf 14 (broadened `react-hooks`)

Dependency detail: this leaf relies on Leaf 1's deterministic warning
behavior. Inventory can happen before Leaf 1 with a throwaway config, but
committed jsx-a11y rules should not land as long-lived `warn` rules that
contributors must notice manually.

## Problem

The client renders many interactive surfaces (sheets, menus, command palettes,
character sheets, encounter builder) but has no JSX accessibility lint. AI-
generated React routinely ships clickable `div` elements, unlabeled controls,
missing `alt`, invalid ARIA, and event handlers on non-interactive roles
without any local signal.

This is the highest-leverage piece of the original React lint surface because
`eslint-plugin-jsx-a11y` rules are tightly scoped to a single concern
(accessibility) and have clean diagnostics. The other two pieces of the
original leaf — `eslint-plugin-react` (style/noise risk) and broadened
`react-hooks@7+` (cleanup-heavy) — moved to Leaves 13 and 14 so they can be
evaluated independently.

## Rule Goals

- `eslint-plugin-jsx-a11y` recommended flat config scoped to client
  `packages/client/**/*.tsx`.
- Configure `settings: { "jsx-a11y": { components: ... } }` so the rules
  understand Musi's component library (`Button`, `IconButton`, `Label`,
  `Link`, anchor wrappers, etc.). Without the mapping, accessibility rules can
  silently no-op on Musi primitives.
- Keep e2e/Playwright code out of scope; jsx-a11y has no purpose there.

## Possible Outcomes

- **Adopt recommended (expected default).** Recommended is well-scoped; this
  is the leaf where wholesale adoption is most justified.
- **Adopt subset.** If a small number of rules misfire on Musi component
  patterns even after the `components` mapping, drop those specific rules.
- **Reject.** Unlikely. If chosen, document a specific failure mode in this
  leaf — for example, "Tooltip primitives produce too many false
  no-static-element-interactions" — before parking.

## Rollout

1. Install `eslint-plugin-jsx-a11y`. Add a scoped config block under
   `packages/client/**/*.tsx`. The plugin's flat shareable configs do not set
   `files`; add the client scope explicitly.
2. Populate the `components` mapping for known Musi primitives.
3. Run as inventory; categorise findings into real bugs (fix), reasonable
   intent (single-line scoped disable with `-- <reason>`), and rule-fit
   issues (drop the rule from the subset).
4. Promote to `error` once the inventory is empty or every remaining site
   has a reasoned disable.
5. Add the chosen rule set to `docs/ai-harness.md`.

## Adaptation Policy

Real accessibility findings should be fixed in code; this is the leaf where
"fix the code, not the rule" applies most strongly. If a recommended rule
fires repeatedly on intentional Musi patterns and the fix would harm the
design, scope the rule down — that is signal about rule fit, not a reason to
sprinkle disables across the codebase. Record any rejected, deferred,
subset-adopted, or full-adoption-with-caveats rule in
`evaluation-verdicts.md`.

## Verification

- `bun run lint -- --max-warnings=0` while iterating.
- `bun run verify:changed`.
- A small Playwright/axe pass over hot client routes is a useful sanity check
  after the first cleanup, but is not part of the lint gate.
- If any recommended rule is rejected, deferred, subset-adopted, or fully
  adopted with caveats/scoped exceptions, append a row to
  `evaluation-verdicts.md` before closing the leaf.

## Implementation Result

Landed on 2026-05-16 with the full `eslint-plugin-jsx-a11y` recommended flat
config scoped to `packages/client/**/*.tsx` and all enabled rules promoted to
`error`.

- Component mapping covers Musi primitives that directly render native
  controls: `Button`, `Input`, `Label`, `SelectTrigger`, `TabsTrigger`, and
  `Textarea`. `Link`, `MobileNavLink`, and `SheetBackLink` are intentionally
  not globally mapped as anchors.
- TanStack Router `Link` is recognized by `anchor-is-valid` through the rule
  option `{ components: ["Link"], specialLink: ["to"] }`; the intended
  `settings["jsx-a11y"].linkComponents` entry is also recorded, but plugin
  6.10.2 does not consume that setting.
- The 58-finding Pass 1 inventory was cleaned to 0 findings. Cleanup fixed
  labels/groups, keyboard support for interactive elements, non-modal
  autofocus, and the lucide `Link` icon alias. Initiative rows now render as
  native list items with a first-in-tab-order overlay select button instead of
  a `role="button"` row container.
- Scoped line disables remain only for accepted modal primary-input autofocus,
  test-only canvas DOM stand-ins, and the notification popover `role="list"`
  Safari/VoiceOver workaround. `CardTitle` now renders `children` explicitly
  and does not need a jsx-a11y disable.

Inventory and Pass 2 details are in
`docs/agent_notes/finished_work/lint-hardening-leaf-5-jsx-a11y-inventory.md`.

## References

- [eslint-plugin-jsx-a11y](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y)
- Component-mapping syntax: `settings: { "jsx-a11y": { components: ... } }`.
