# Zero Baseline: Script-Family Max Lines

Status: Done
Order: 4

## Context

Several `local/max-lines` ratchets are now zero-baseline but are not simply
covered by normal lint. They overlap with the later shared max-lines policy
work, but their lifecycle status can be decided first.

Rows from the 2026-05-25 snapshot:

- `ratchet/local-max-lines-code-intel`
- `ratchet/local-max-lines-codemods`
- `ratchet/local-max-lines-drift-ai`
- `ratchet/local-max-lines-generate-harness-controls`
- `ratchet/local-max-lines-logs-audit`
- `ratchet/local-max-lines-runtime`

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
- If a row needs shared large-file policy data before it can move, document
  that blocker and link `24-eslint-max-lines-policy.md`.

## Definition Of Done

These max-lines rows no longer appear as undocumented zero-baseline ratchets.

## Verification

- `bun run lint:ratchet:zero-baseline`
- `bun run lint:ratchet:update`
- `bun run lint:ratchet:check-baseline`
- `bun run lint:ratchet:check-registry`
- `bun run lint -- --max-warnings=0` when promoting to normal ESLint
