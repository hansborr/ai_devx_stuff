# local/type-assertion-boundary Batch 3c

Completed: 2026-05-19
Scope: Leaf 07 script-side ratchet drain, batch 3c

## Result

Drained the remaining targeted script-side findings in this batch. The cold
`lint:ratchet` run reports 97 current findings after clearing
`node_modules/.cache/eslint-ratchet`.

This is one lower than the promoted target of 98 because the
`scripts/harness-check.ts` chained assertion has two nested `TSAsExpression`
nodes, and the new approved boundary comment covers both.

## Files

- `scripts/db-status.ts`: replaced the database connection catch cast with
  `err instanceof Error` narrowing and `String(err)` fallback.
- `scripts/logs-audit.ts`: removed the redundant `as unknown` from
  `parseJsonLine`; the function return annotation preserves the call-site
  `unknown` boundary.
- `scripts/harness-check.ts`: kept the existing manual array/object guard and
  labeled the `RawControl[]` chained cast as `interop`, because the file has no
  existing Zod schema for `RawControl` and downstream validators check fields.
- `packages/server/scripts/pgexec.ts`: labeled the `pg` multi-statement result
  assertion as `framework`, matching the surrounding driver-runtime rationale.

## Verification

- `bun run lint:fix`
- `rm -rf node_modules/.cache/eslint-ratchet && bun run lint:ratchet`
- `bun run typecheck`
- `bun run test:changed`
- `git diff --check`
