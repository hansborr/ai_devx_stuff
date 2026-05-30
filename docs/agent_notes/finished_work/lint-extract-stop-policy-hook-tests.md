# Extract stop-policy hook tests

Completed issue 08d from `/home/node/lint-merge-debt`.

- Added `scripts/ai-hooks/test-stop-policy.sh` as the focused stop-policy smoke
  suite.
- Updated `scripts/ai-hooks/test.sh` to invoke the focused script while keeping
  generic cache marker and fingerprint coverage in the aggregate.
- Added the focused script to script-smoke changed-test subjects and collapsed
  Codex hook subjects to the directory-prefix selector.

Verification:

- `bash scripts/ai-hooks/test-stop-policy.sh`
- `bash scripts/ai-hooks/test.sh`
- `MUSI_SCRIPTS_CHANGED_FILES='scripts/ai-hooks/test-stop-policy.sh' MUSI_SCRIPTS_RUNNER=true MUSI_SCRIPTS_CONCURRENCY=1 bash scripts/test-scripts.sh --changed`
- `bun test scripts/path-policy.test.ts scripts/path-policy-query.test.ts`
- `bash scripts/test-test-scripts.sh`
