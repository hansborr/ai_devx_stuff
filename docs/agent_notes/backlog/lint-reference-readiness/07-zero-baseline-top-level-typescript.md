# Zero Baseline: Top-Level TypeScript Rules

Status: Done
Order: 7

## Context

Some top-level script ratchets are zero-baseline but involve type-aware rules
or rule coverage that is mixed across the script surface.

Rows from the 2026-05-25 snapshot:

- `ratchet/typescript-eslint-no-unsafe-argument-top-level-scripts`
- `ratchet/typescript-eslint-require-await-script-singletons`
- `ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts`
- `ratchet/typescript-eslint-unbound-method-top-level-scripts`

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

## Definition Of Done

These rows no longer appear as undocumented zero-baseline ratchets.

## Verification

- `bun run lint:ratchet:zero-baseline`
- `bun run lint:ratchet:update`
- `bun run lint:ratchet:check-baseline`
- `bun run lint:ratchet:check-registry`
- `bun run lint -- --max-warnings=0` when promoting to normal ESLint
