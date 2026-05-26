# Lint Reference Readiness: Source And Smoke Callers

Completed 2026-05-25.

- `test:scripts:changed` now queries shared path-policy data for smoke test
  order, subject selection, and script-smoke-sensitive deletion fallback instead
  of maintaining parallel Bash policy tables.
- Pre-commit staged source relevance now routes through
  `source-relevant:precommit-staged`, preserving the previous lockfile-only
  skip behavior while keeping general source relevance and tracked pre-commit
  fingerprinting separate.
- Added regressions for path-policy-dependent smoke selection, code-intel server
  selection drift, config/full-scan surfaces, and broad Codex hook source
  relevance.

Verification:

- `bash scripts/test-test-scripts.sh`
- `bun test scripts/path-policy-query.test.ts scripts/path-policy.test.ts`
- `bash scripts/test-verify-metadata.sh`
- `bash scripts/test-verify-history.sh`
- `bash scripts/test-dependency-freshness.sh`
- `bun run test:scripts:changed`
- `bun run verify:changed`
