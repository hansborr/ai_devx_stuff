# Zero Baseline: Codemod Test Rules

Status: Done
Order: 8

## Context

Codemod test ratchets are zero-baseline but often sit outside normal lint
coverage or use different test-rule options. Decide their lifecycle separately
from application lint policy.

Rows from the 2026-05-25 snapshot:

- `ratchet/typescript-eslint-no-misused-promises-codemod-tests`
- `ratchet/typescript-eslint-only-throw-error-codemod-tests`
- `ratchet/vitest-expect-expect-codemod-tests`
- `ratchet/vitest-valid-expect-codemod-tests`

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
- Keep RuleTester/custom-rule test policy out of this task; that is covered by
  `10-zero-baseline-custom-rule-tests.md`.

## Definition Of Done

These codemod test rows no longer appear as undocumented zero-baseline
ratchets.

## Verification

- `bun run lint:ratchet:zero-baseline`
- `bun run lint:ratchet:update`
- `bun run lint:ratchet:check-baseline`
- `bun run lint:ratchet:check-registry`
- `bun run lint -- --max-warnings=0` when promoting to normal ESLint
- Relevant codemod test smoke if test files change
