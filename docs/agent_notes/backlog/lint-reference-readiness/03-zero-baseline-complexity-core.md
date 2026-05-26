# Zero Baseline: Complexity And Core Script Rules

Status: Done
Order: 3

## Context

Several zero-baseline ratchets cover implementation complexity or core script
rules. They need lifecycle decisions before registry builders or run grouping
can simplify the ratchet set.

Rows from the 2026-05-25 snapshot:

- `ratchet/core-complexity-codemods`
- `ratchet/core-complexity-drift-ai`
- `ratchet/core-complexity-eslint-rules`
- `ratchet/core-complexity-lint-ratchet-runtime`
- `ratchet/core-complexity-top-level-scripts`
- `ratchet/core-no-magic-numbers-top-level-scripts`
- `ratchet/core-preserve-caught-error-top-level-scripts`

## Decision Rule

Keep all rows as ratchet-only. Do not promote to normal ESLint or retire.
Add `zeroBaselineDisposition` metadata to each row: use `intentional-ratchet-only`
when the file family is outside normal ESLint, `narrow-floor` when the ratchet
uses different options or scope than normal lint, or `temporary-ratchet-only`
when a specific blocker prevents promotion (record the blocker and exit path).

If the audit shows a row is now `normal-error` with equivalent options, remove
the ratchet instead — it is redundant.

## Scope

- Re-run the zero-baseline audit before editing.
- Add `zeroBaselineDisposition` to each row using the decision rule above.
- Avoid broad cleanup refactors unless a row can be removed with a small,
  reviewable change.

## Definition Of Done

These rows no longer appear as undocumented zero-baseline ratchets.

## Verification

- `bun run lint:ratchet:zero-baseline`
- `bun run lint:ratchet:update`
- `bun run lint:ratchet:check-baseline`
- `bun run lint:ratchet:check-registry`
- `bun run lint -- --max-warnings=0` when promoting to normal ESLint
