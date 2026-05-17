# Leaf 15: Assertion Failure Quality

Status: Landed (2026-05-16); helpers built and current Zod parse-result
boolean assertion sites migrated; lint rule deferred.
Depends on: Leaf 3 inventory useful but not required

## Problem

Tests that assert only boolean result state produce poor failure output. The
main Musi example is `expect(schema.safeParse(value).success).toBe(true)`,
which hides parse data or issues that would explain the failure.

## Candidate Helpers Or Rules

- Prefer `expectParseSuccess(schema.safeParse(value))` over boolean success
  checks.
- Prefer `expectParseFailure(...)` for invalid Zod cases, so the failure output
  shows unexpected parsed data or issues.
- Prefer `await expect(promise).rejects...` over boolean flags around thrown
  errors.
- Avoid `expect(result.ok).toBe(true)` where a richer helper exists.

## Rollout

1. Start with test helpers and a codemod-friendly migration.
2. Inventory current boolean result-state assertions.
3. Migrate a focused package or rule area first.
4. Add a local lint rule only after the helper pattern proves useful and false
   positives are understood.

## Implementation Result

- Added `expectParseSuccess` and `expectParseFailure` at
  `packages/shared/src/test/parse-helpers.ts`, with focused helper coverage in
  `packages/shared/src/test/parse-helpers.test.ts`.
- Exported the shared test helper subpath as `@musi/shared/test/*.js` so
  server and client tests can import it through the package boundary.
- Migrated the current branch's confirmed Zod parse-result boolean assertions:
  679 sites across 35 test files (652 shared, 3 server, 24 client). This
  includes 647 direct or captured `.safeParse(...).success` assertions plus 32
  `validateHomebrewData(...).success` assertions that return the same Zod parse
  result shape.
- Added the helpers to the existing `vitest/expect-expect`
  `assertFunctionNames` allowlist so helper-only validation tests still count
  as assertions.
- No local lint rule was added; enforcement remains deferred until the helper
  pattern has had a soak period.

## Open Question

If Leaf 3's Vitest plugin catches enough false-positive assertion patterns, keep
this leaf focused on Musi-specific Zod/result helpers rather than broad generic
expectation linting.

## Verification

- Targeted tests for new assertion helpers.
- Package tests covering migrated assertions.
- `bun run vitest run --project=eslint-rules` if a local lint rule is later
  added.
- `bun run verify:changed`
