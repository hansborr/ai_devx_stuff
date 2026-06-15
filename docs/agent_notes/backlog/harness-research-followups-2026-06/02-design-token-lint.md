# DL-1 - Token-aware design lint

> Proposal only - not implemented. Re-verify finding counts before promotion;
> client styling churns quickly.

## Problem

The harness research (`07-ui-design-systems-enforcement.md`) recommends gating
design-system violations *out* with token-aware lint, so an agent reuses the
system instead of inventing values. Musi has the inputs but not the gate:

- `DESIGN.md` is the authoritative design system and explicitly points at
  `packages/client/src/app.css` (Tailwind v4 `@theme`) + the `ui/` primitives.
- The `@theme` block defines the full token set (colors, fonts, radius, named
  spacing) as CSS custom properties.
- Nothing stops an agent emitting an arbitrary Tailwind value (`text-[10px]`,
  `max-w-[420px]`, `min-h-[400px]`) or a raw hex in `className`/style instead of
  a token.

This fits the repo's existing culture: there are ~20 custom ESLint rules with
teaching error messages, registered in `eslint-config/local-plugin.js`. A
design-token rule is one more "linter beats the prompt" gate.

## Current findings (re-verify before promoting)

- **~84 arbitrary Tailwind bracket values** across ~40 files — mostly
  `text-[10px]`, `max-w-[420px]`, `min-h-[400px]`, a few `max-h-[80vh]`. This is
  the real cleanup target and the strongest case for a rule.
- **~79 raw hex literals** across ~24 files — but **most are intentional
  canvas/VTT colors** (Konva drawing tools in
  `components/campaign/maps/*`, the `CONDITION_COLORS` map in
  `token-condition-icons.tsx`, token shape/HP-bar render colors). DESIGN.md
  documents these as outside the DOM `@theme` system. A naive hex ban would be
  almost entirely false positives.

The nuance matters: **the arbitrary-value rule is the high-value, low-noise
part; the hex rule is secondary and must be scoped.**

## Proposed Implementation

1. Author a local rule following the existing pattern
   (`eslint-rules/no-barrel.js` as template): `meta.docs` with
   `principle`/`repairKind`, keyed `messages`, RuleTester test colocated as
   `*.test.js`, registered in `eslint-config/local-plugin.js`.
2. **Phase 1 — arbitrary Tailwind values.** Flag bracket-syntax utilities in
   `className` string/`cva` calls (`text-[...]`, `w-[...]`, `max-w-[...]`,
   `min-h-[...]`, `bg-[#...]`). Allow the genuinely un-tokenizable forms that
   are not values — arbitrary *selectors*/properties like
   `[appearance:textfield]` and `[&::-webkit-inner-spin-button]:...`. The error
   message should name the nearest token or scale step.
3. **Phase 2 (optional) — raw hex in DOM styling only.** Restrict to
   `className`/inline `style` on DOM elements and **exclude** the canvas
   directories and the documented color-map constants (path-scoped `ignores`,
   or a co-located `eslint-disable` with reason on the intentional maps). Decide
   during promotion whether Phase 2 earns its keep given the false-positive
   surface.
4. Scope the rule to `packages/client/src/**` (add to the client config in
   `eslint-config/client-configs.js` or a dedicated flat-config entry). Drive
   it as a ratchet if the finding count is too large for one reviewable PR:
   land the rule with the current count as a no-new baseline, then drain.
5. Drain the ~84 arbitrary values to tokens / standard scale steps (or add a
   token to `@theme` when a real new value is needed). Where a value is truly
   one-off and legitimate, an explicit disable-with-reason is acceptable.

## TDD / Verification

- RuleTester drives the rule: `valid` (token utilities, allowed arbitrary
  selectors) and `invalid` (arbitrary values, in-DOM hex) cases first.
- Run `bun run lint` against the client to produce the live finding inventory;
  confirm the canvas/condition-color files are not flagged (or are explicitly
  exempted) before treating the count as the cleanup target.
- `bun run verify:changed` green after each drain slice.

## Acceptance Criteria

- A local rule flags arbitrary Tailwind values in client source with a teaching
  message that names the token/scale alternative.
- Intentional canvas/VTT colors are not false-positived (scoped out or
  explicitly exempted with a reason).
- The arbitrary-value findings are driven to zero or a committed shrinking
  baseline; `DESIGN.md`/`@theme` stays the single source of truth.

## Risks

- Over-broad matching flags legitimate arbitrary *selectors* and one-off
  responsive widths; keep the matcher tight and exempt with reasons.
- A hex ban that ignores the canvas exemption is mostly noise — gate Phase 2 on
  whether the scoping is clean.
- Cleanup churn touches many files; do it as ratcheted slices, not one mega-PR.
