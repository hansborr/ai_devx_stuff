# Lint Extract Cache Hook Tests

Date: 2026-05-30

Implemented `/home/node/lint-merge-debt/08e-extract-cache-hook-tests.md`.

Notes:

- Added `scripts/ai-hooks/test-cache.sh` as the focused cache smoke suite.
  It owns cache-bypass command matching, cache state init, bun marker
  validation, worktree fingerprint shape, failure-summary flaky-note behavior,
  and Claude/Codex bun cache-bypass/post-hook marker checks.
- `scripts/ai-hooks/test.sh` remains the aggregate runner and invokes the
  focused script with stdout redirected to `/dev/null`.
- The old aggregate sourced `cache.sh` partly to define `AI_GIT_STATE_DIR` for
  commit guidance tests. After extraction, the aggregate now initializes that
  git state directory directly and keeps commit-timeout/output-filter coverage
  local.
- Added `scripts/ai-hooks/test-cache.sh` to the `test-ai-hooks` smoke subject
  list.

Verification:

- `bash scripts/ai-hooks/test-cache.sh`
- `bash scripts/ai-hooks/test.sh`
- `MUSI_SCRIPTS_CHANGED_FILES='scripts/ai-hooks/test-cache.sh' MUSI_SCRIPTS_RUNNER=true MUSI_SCRIPTS_CONCURRENCY=1 bash scripts/test-scripts.sh --changed`
- `bash scripts/test-test-scripts.sh`
- `bun test scripts/path-policy.test.ts scripts/path-policy-query.test.ts`
- `shellcheck --severity=warning scripts/ai-hooks/test-cache.sh`
