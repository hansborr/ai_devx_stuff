# Zero Baseline: Script And Drift Test Rules

Status: Done
Order: 9

## Context

Script and drift test ratchets include rule families where normal lint may be
off, use different options, or already cover only part of the surface.

Rows from the 2026-05-25 snapshot:

- `ratchet/regexp-no-super-linear-backtracking-script-tests`
- `ratchet/typescript-eslint-explicit-function-return-type-script-tests`
- `ratchet/typescript-eslint-no-unsafe-assignment-script-tests`
- `ratchet/vitest-expect-expect-drift-ai-tests`
- `ratchet/vitest-expect-expect-script-tests`
- `ratchet/vitest-valid-expect-drift-ai-tests`
- `ratchet/vitest-valid-expect-script-tests`

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
- When normal lint uses different Vitest options, document the difference in
  the disposition reason.

## Definition Of Done

These rows no longer appear as undocumented zero-baseline ratchets.

## Verification

- `bun run lint:ratchet:zero-baseline`
- `bun run lint:ratchet:update`
- `bun run lint:ratchet:check-baseline`
- `bun run lint:ratchet:check-registry`
- `bun run lint -- --max-warnings=0` when promoting to normal ESLint
- Relevant script smoke if test files change
