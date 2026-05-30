# Lint Extract Lint-Coverage Hook Tests

Date: 2026-05-30

Implemented `/home/node/lint-merge-debt/08b-extract-lint-coverage-throttle-hook-tests.md`.

Notes:

- Added `scripts/ai-hooks/test-lint-coverage.sh`: the lint-coverage hook fixture,
  neutral throttle helper checks, lint-coverage throttle e2e checks, and
  read-only throttle probe moved out of `scripts/ai-hooks/test.sh` into a
  standalone focused script.
- The focused script sources `test-support.sh`, `common.sh`, `throttle-state.sh`,
  and `lint-coverage-state.sh`; the old aggregate had already sourced
  `common.sh`, which is required by the neutral throttle helper.
- `scripts/ai-hooks/test.sh` now invokes the focused script with stdout
  redirected to `/dev/null`, preserving the aggregate's single
  `ai-hooks tests passed` success line and failure exit-code behavior.
- Changed-test selection: added `scripts/ai-hooks/test-lint-coverage.sh` to the
  `test-ai-hooks` subject list and bumped the `scripts/path-policy-smoke-subjects.ts`
  `local/max-lines` data-table cap from 387 to 389.
- No production hook behavior changed.

Verification: `bash scripts/ai-hooks/test-lint-coverage.sh`,
`bash scripts/ai-hooks/test.sh`, `bash scripts/test-test-scripts.sh`,
`bash scripts/vitest.sh run --passWithNoTests scripts/path-policy.test.ts`,
`bun run lint:shell`, `bun run docs:lint-coverage-map:check`,
`bun run typecheck`, and direct `shellcheck --severity=warning
scripts/ai-hooks/test-lint-coverage.sh`. Final staged gate:
`bun run verify:changed`.
