# Lint Fix Dist Preflight Parity

Status: Parked
Source: Subagent review of lint-review-2026-06 leaf 02 on 2026-06-12.

## Context

Leaf 02 added a missing-dist preflight to `scripts/lint.sh` and
`scripts/lint-changed.sh` so verify consumers fail with an actionable
`bun run typecheck` prerequisite diagnostic on fresh checkouts.

`package.json` still defines `lint:fix` as a direct `eslint . --fix ...`
command. That keeps its existing ESLint-only repair behavior, but it also
means `bun run lint:fix` can still bypass the missing-dist diagnostic and
surface raw type-aware parser/project-service failures.

## Scope

- Decide whether `lint:fix` should remain ESLint-only with its own small
  preflight wrapper, or intentionally become the composite `scripts/lint.sh`
  path with `--fix` forwarded only to ESLint.
- Preserve the current repair ergonomics unless there is a deliberate reason
  to run ShellCheck/config sensors during `lint:fix`.
- Add script smoke coverage for the chosen path.

## Verification

- Fresh-checkout or temporarily missing `packages/{shared,server}/dist` run of
  `bun run lint:fix` shows the same `bun run typecheck` prerequisite diagnostic.
- `bun run verify:changed`
