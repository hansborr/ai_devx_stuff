# A11Y-1 - Runtime a11y checks (axe-core) in Playwright e2e

> Proposal only - not implemented.

## Problem

The harness research (`07-ui-design-systems-enforcement.md`) recommends two
layers of accessibility: static `jsx-a11y` *and* a runtime axe pass, because the
static linter cannot see computed contrast, focus order, ARIA wired across
components, or dynamically rendered state.

Musi has the static layer only: `eslint-plugin-jsx-a11y` (recommended config +
component mappings) is enabled on `packages/client/**/*.tsx` in
`eslint-config/client-configs.js`. There is **no runtime a11y check** — the
Playwright e2e suite (`e2e/`, with page objects) asserts behavior but never runs
axe against a rendered page.

## Proposed Implementation

1. Add `@axe-core/playwright` as a dev dependency (respect the `bunfig.toml`
   cooldown).
2. Add a small, focused a11y smoke — not an audit of every page. Suggested
   coverage: the login/register pages, the character sheet, and one campaign/VTT
   view. Reuse existing page objects to navigate to a stable rendered state,
   then run `AxeBuilder` and assert no violations above a chosen impact level.
3. Start at `serious`/`critical` impact as the failing threshold to avoid
   drowning in minor/contrast noise on day one; tighten later. If the first run
   surfaces a backlog of existing violations, land the check against a known
   baseline (allowlist current violation ids per page) and drain, mirroring the
   repo's ratchet philosophy.
4. Keep it inside the existing e2e project so it runs in the `e2e` CI job, not
   on the per-commit path. Tag or group the a11y assertions so they can be run
   in isolation while iterating.

## TDD / Verification

- Write the axe assertion for one page first; confirm it passes on a clean state
  and fails when a known a11y defect is introduced (e.g. a button with no
  accessible name).
- Run the focused e2e locally (`bun run` the relevant Playwright command) before
  wiring into CI.
- Confirm the new check does not materially slow the e2e job; a11y scans are
  fast but navigation is not free.

## Acceptance Criteria

- `@axe-core/playwright` runs against at least 3-4 key rendered views in the e2e
  suite, asserting no violations above the chosen impact threshold.
- Any pre-existing violations are either fixed or captured in an explicit,
  documented baseline with a drain plan — not silently ignored.
- The static `jsx-a11y` gate is unchanged; runtime is additive.

## Risks

- A full-strength axe pass on an existing app usually surfaces real debt; manage
  it with an impact threshold + baseline rather than weakening the check.
- Flaky navigation makes a11y assertions look flaky — anchor scans to stable
  states via existing page objects.
- Contrast violations may overlap with DL-1's token work; coordinate so fixes
  land once.
