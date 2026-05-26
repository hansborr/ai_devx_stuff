# Zero Baseline: Type Assertion Boundary

Status: Done
Order: 5

## Context

`ratchet/local-type-assertion-boundary` is a broad zero-baseline ratchet over
the main application surface. Its lifecycle decision is too large to bury in a
mixed zero-baseline batch.

## Decision Rule

Keep as ratchet-only. Do not promote to normal ESLint or retire. Add
`zeroBaselineDisposition` metadata: use `intentional-ratchet-only` if this file
family is deliberately outside normal ESLint, or `narrow-floor` if the ratchet
is intentionally scoped differently than normal lint.

If the audit shows the row is now `normal-error` with equivalent options, remove
the ratchet instead — it is redundant.

## Scope

- Re-run `bun run lint:ratchet:zero-baseline`.
- Add `zeroBaselineDisposition` using the decision rule above.
- Do not attempt a broad type-assertion cleanup in this task.

## Definition Of Done

`ratchet/local-type-assertion-boundary` has a lifecycle disposition or has been
promoted/retired.

## Verification

- `bun run lint:ratchet:zero-baseline`
- `bun run lint:ratchet:update`
- `bun run lint:ratchet:check-baseline`
- `bun run lint:ratchet:check-registry`
- `bun run lint -- --max-warnings=0` when promoting to normal ESLint
