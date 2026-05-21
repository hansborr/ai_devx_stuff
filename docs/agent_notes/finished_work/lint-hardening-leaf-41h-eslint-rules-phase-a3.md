# Leaf 41h: eslint-rules Phase A.3

Date: 2026-05-21

## Scope

Extended the Phase A.2 implementation-only block for `eslint-rules/*.js`,
still ignoring `eslint-rules/*.test.js`, with the strict-tier generic subset:

- `simple-import-sort/imports`
- `simple-import-sort/exports`
- `eslint-comments/require-description` with `{ ignore: [] }`
- `eslint-comments/no-aggregating-enable`
- `eslint-comments/no-duplicate-disable`
- `eslint-comments/no-unlimited-disable`
- `eslint-comments/no-unused-disable`
- `local/no-llm-artifacts`
- `local/no-swallowed-errors`
- `local/no-async-array-callbacks`

The block reuses the existing `eslintComments`, `simpleImportSort`, and
`localPlugin` imports. No rule implementation source files were changed.

## Deferred

- Domain/path-specific `local/*`: `concurrency-guard`,
  `no-broadcast-in-transaction`, `socket-registry-broadcasts`,
  `strict-shared-schemas`, `strict-trpc-input`, `structured-logging`,
  `test-file-location`, tRPC schema rules, and
  `e2e-prefer-role-selectors` remain package/path-specific, not a broad
  eslint-rules implementation floor.
- `local/no-explicit-any`: remains type-aware and would break the Phase A.2
  non-type-aware boundary.
- `local/no-barrel`: remains barrel-pattern-specific and not relevant to
  single-file rule modules.
- `local/type-assertion-boundary`: remains type-aware.
- `local/max-lines`: already covered by the Phase A.2 block.
- `eslint-rules/*.test.js`: still excluded from this implementation-only
  block; rule tests remain covered by the Phase B Vitest/recommended-JS floor.

## Verification

The post-change probe re-ran `bun run lint -- --max-warnings=0` and produced
zero findings on `eslint-rules/*.js`. No ratchet was added.

`bunx eslint --print-config eslint-rules/concurrency-guard.test.js` confirmed
`simple-import-sort/imports` is absent from the rule-test config, so Phase A.3
did not pull `eslint-rules/*.test.js` into scope.

## Exit Path

Remaining domain/path-specific local rules plus `local/no-explicit-any` and
`local/no-barrel` stay deferred as deeper per-rule work. They are not promoted
as broad-shallow follow-ons by this leaf.
