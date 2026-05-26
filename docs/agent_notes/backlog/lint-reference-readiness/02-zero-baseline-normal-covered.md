# Zero Baseline: Normal-Covered Rows

Status: Done
Order: 2

## Context

The 2026-05-25 zero-baseline audit reports rows where normal lint already
covers the rule at `error`. These should usually be removed or narrowed before
harder lifecycle decisions.

Rows from the snapshot:

- `ratchet/local-max-lines`
- `ratchet/local-max-lines-lint-coverage-map-check`
- `ratchet/local-max-lines-lint-rule-docs`
- `ratchet/simple-import-sort-imports-top-level-scripts`
- `ratchet/typescript-eslint-no-misused-promises-drift-ai-tests`
- `ratchet/typescript-eslint-no-misused-promises-script-tests`
- `ratchet/typescript-eslint-only-throw-error-drift-ai-tests`
- `ratchet/typescript-eslint-only-throw-error-script-tests`

## Decision Rule

If the audit reports `normal-error` with equivalent options for a row, the
ratchet is redundant — remove the registry entry and update the baseline.

If a row's normal-lint coverage turns out to be non-equivalent (different
options, narrower file set), keep the ratchet and add `zeroBaselineDisposition`
with the appropriate kind instead.

## Scope

- Re-run `bun run lint:ratchet:zero-baseline` before editing.
- Confirm each row is still normal-lint covered with equivalent enough
  rule/options for the same file surface.
- Remove redundant ratchets where normal lint is the owner.
- Add `zeroBaselineDisposition` only when a row's coverage turns out to be
  non-equivalent on closer inspection.

## Definition Of Done

The audit no longer reports these rows as undocumented zero-baseline ratchets,
or each remaining row has a precise ratchet-only disposition.

## Verification

- `bun run lint:ratchet:zero-baseline`
- `bun run lint:ratchet:update`
- `bun run lint:ratchet:check-baseline`
- `bun run lint:ratchet:check-registry`
- `bun run lint -- --max-warnings=0`
