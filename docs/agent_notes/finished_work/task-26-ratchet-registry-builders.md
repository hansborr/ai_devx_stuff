# Task 26 - Ratchet Registry Builders

Refactored repeated lint ratchet families into typed registry builders:

- core complexity
- core no-magic-numbers
- local max-lines
- local type-assertion-boundary
- regexp no-unused-capturing-group
- vitest valid-expect

The registry call sites still spell out `id`, `files`, `ignores`, parser
profile when variable, and `zeroBaselineDisposition`. A pre/post JSON snapshot
of exported `lintRatchets` had no diff, so the runtime registry entries stayed
unchanged.

Verification:

- `./node_modules/.bin/eslint --max-warnings=0 --no-warn-ignored scripts/lint-ratchet-config.ts scripts/lint-ratchet-registry-builders.ts scripts/path-policy-smoke-subjects.ts scripts/test-lint-ratchet.sh scripts/test-harness-check.sh tsconfig.scripts.json`
- `bun run lint:ratchet:check-registry`
- `bun test scripts/lint-ratchet-baseline.test.ts scripts/lint-ratchet-check-registry.test.ts scripts/path-policy-query.test.ts`
- `bun run scripts/lint-coverage-map-check.ts -- --check-eslint-reach --staged`
- `bun run verify:changed`
