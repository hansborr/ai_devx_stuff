# Path Policy Shell Interface

Date: 2026-05-25

## Outcome

`scripts/path-policy-query.ts` exposes the shared path-policy data through a
NUL-safe shell boundary. It reads path records from stdin and writes matching
records as NUL-delimited stdout. Supported queries cover changed ESLint and
agent-lint inputs, source relevance, format-check candidates, config/shell
surfaces, full-scan triggers, script-smoke selection, and script-smoke
deletion-sensitive paths.

No production shell callers were migrated in this leaf.

## Verification

- `bun test scripts/path-policy-query.test.ts scripts/path-policy.test.ts`
- `bunx eslint scripts/path-policy-query.ts scripts/path-policy-query-core.ts scripts/path-policy-query.test.ts`
- `bunx tsc -p tsconfig.scripts.json --noEmit`
- `bun run docs:lint-coverage-map:check -- --check-eslint-reach --staged`
- `bun run test:scripts:changed`
- `bun run verify:changed`
