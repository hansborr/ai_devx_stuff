# Zero Baseline: Strict Boolean Shared

Status: Done
Order: 6

## Context

`ratchet/strict-boolean-expressions-shared` is a broad zero-baseline ratchet
for `@typescript-eslint/strict-boolean-expressions` in shared code. It should
be decided as its own lifecycle task.

## Decision Rule

Keep as ratchet-only. Do not promote to normal ESLint or retire. Add
`zeroBaselineDisposition` metadata: use `intentional-ratchet-only` if shared
code deliberately stays outside normal ESLint for this rule, or
`temporary-ratchet-only` if promotion is blocked by a specific issue (record
the blocker and exit path).

If the audit shows the row is now `normal-error` with equivalent options, remove
the ratchet instead — it is redundant.

## Scope

- Re-run `bun run lint:ratchet:zero-baseline`.
- Add `zeroBaselineDisposition` using the decision rule above.
- Do not attempt a package-wide rule rollout.

## Definition Of Done

`ratchet/strict-boolean-expressions-shared` has a lifecycle disposition or has
been promoted/retired.

## Verification

- `bun run lint:ratchet:zero-baseline`
- `bun run lint:ratchet:update`
- `bun run lint:ratchet:check-baseline`
- `bun run lint:ratchet:check-registry`
- `bun run lint -- --max-warnings=0` when promoting to normal ESLint
