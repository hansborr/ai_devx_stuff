# Leaf 24: TanStack Query prefer-query-options

Status: Resolved (adopted at `error`, commit `d4bc777f`, on
`feature/lint-hardening-review-followup`)
Sources:

- `docs/agent_notes/backlog/lint-hardening/06-tanstack-query-plugin.md`
- `docs/agent_notes/finished_work/lint-hardening-leaf-6-tanstack-query-inventory.md`
- `docs/agent_notes/backlog/lint-hardening/evaluation-verdicts.md`

## Resolution

`@tanstack/query/prefer-query-options` is enabled at `error` in
`eslint.config.js` (commit `d4bc777f`). The lone callsite gap surfaced
during the inventory — drawer test cache seeds — was migrated to
`trpc.*.queryOptions(...)` in commit `9320011a` so the rule lands
clean (no warning-only state, no broad disables).

## Problem

The recommended `@tanstack/eslint-plugin-query` client slice landed, but the
strict-only `@tanstack/query/prefer-query-options` rule was explicitly left
open for a separate inventory. The old leaf expected it might be a net win
because Musi's tRPC client already exposes `trpc.*.queryOptions(...)` and
`mutationOptions(...)` helpers.

## Scope

Evaluate only `@tanstack/query/prefer-query-options` under
`packages/client/**/*.{ts,tsx}`. Do not broaden the Query plugin surface or
change established tRPC option helpers unless the rule inventory proves a
specific bug-prevention benefit.

## Candidate Work

- Re-run a current inventory with the installed TanStack Query plugin and the
  strict rule enabled in a throwaway config.
- Classify findings into inline query-option objects, tRPC helper-compatible
  rewrites, false positives around generated tRPC wrappers, and pure style
  churn.
- If findings are real and mechanical, rewrite the focused sites and promote
  the rule at `error`.
- If the rule cannot understand Musi's tRPC helpers, defer or reject with an
  explicit verdict instead of adding broad disables.

## Exit Criteria

- `@tanstack/query/prefer-query-options` has an adopt/defer/reject verdict.
- Any adopted rule is clean under the normal lint gate with no warning-only
  migration state.
- Any caveat is recorded in the verdict register.

## Verification

- `bun run lint -- --max-warnings=0`
- Targeted client tests for rewritten hooks or query option builders
- `bun run test:changed`
- `bun run verify:changed`
