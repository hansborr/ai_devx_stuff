# Zero Baseline: Custom Rule Test And Regex Rows

Status: Done
Order: 10

## Context

Custom-rule tests use ESLint `RuleTester`, which is valid, but some
`eslint-rules/*.test.js` files carry ratcheted lint exceptions. This leaf also
holds the single lint-coverage-map regex row from the snapshot so the
zero-baseline lifecycle tasks cover every row without creating a one-row task.

Rows from the 2026-05-25 snapshot:

- `ratchet/core-no-magic-numbers-eslint-rules`
- `ratchet/regexp-no-unused-capturing-group-eslint-rules`
- `ratchet/regexp-no-unused-capturing-group-lint-coverage-map-check`
- `ratchet/regexp-no-useless-non-capturing-group-eslint-rules`
- `ratchet/vitest-no-commented-out-tests-eslint-rules-tests`
- `ratchet/vitest-no-conditional-expect-eslint-rules-tests`

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
- Triage `ratchet/regexp-no-unused-capturing-group-lint-coverage-map-check`
  first. If it needs more than a narrow lifecycle disposition, split it into
  its own task or fold it into `28-lint-coverage-map-readiness.md`.
- Where `RuleTester` or lint-fixture data makes an exception intentional,
  document the reason in the disposition metadata.

## Definition Of Done

These rows no longer appear as undocumented zero-baseline ratchets, and custom
rule test exceptions are either removed or documented.

## Verification

- `bun run lint:ratchet:zero-baseline`
- `bun run lint:ratchet:update`
- `bun run lint:ratchet:check-baseline`
- `bun run lint:ratchet:check-registry`
- `bun run vitest run --project=eslint-rules`
- `bun run lint -- --max-warnings=0` when promoting to normal ESLint
