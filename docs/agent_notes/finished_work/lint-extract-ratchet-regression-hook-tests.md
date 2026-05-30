# Lint Extract Ratchet-Regression Hook Tests

Date: 2026-05-30

Implemented `/home/node/lint-merge-debt/08a-extract-ratchet-regression-hook-tests.md`
— the first narrow extraction from the monolithic `scripts/ai-hooks/test.sh`.

Notes:

- Added `scripts/ai-hooks/test-support.sh`: a sourced helper holding the generic
  assertions shared across the ai-hooks shell suites (`fail`, `assert_contains`,
  `assert_not_contains`, `assert_hook_json`, `assert_hook_continue_json`).
  Removed those five inline definitions from `test.sh` and sourced the helper.
- Added `scripts/ai-hooks/test-ratchet-regression.sh`: the ratchet-regression
  block moved verbatim with its own bootstrap (own `TMP_ROOT`+trap, test-git-env
  clearing, `REPO_ROOT`). Runs standalone; the aggregate `test.sh` invokes it
  with stdout redirected to `/dev/null`, preserving the single
  `ai-hooks tests passed` line and exit-code semantics. No production hook
  behavior changed. `test.sh` dropped 2863 → 2448 lines.
- The `ai_throttle_would_emit` probe block stayed in `test.sh`: it exercises
  `throttle-state.sh`, not the ratchet hook.
- Changed-test selection: added both new test files to the `test-ai-hooks`
  subject list in `scripts/path-policy-smoke-subjects.ts`; that tipped the
  file's documented `local/max-lines` growth cap (385 → 387,
  `ratchetExcluded: true`) in `eslint-config/shared-policy.js`.
- Pre-existing gap (not fixed here, kept out of scope): the production hook
  `scripts/ai-hooks/ratchet-regression-check.sh` and `edited-paths.sh` are not
  in any `test-ai-hooks` subject list, so changes to them do not select the
  ai-hooks smoke. Worth a follow-up if changed-test coverage of those hooks
  matters.
- For 08b–08e: reuse `test-support.sh`; extract each hook block into its own
  `test-<hook>.sh` sourcing it, invoke from `test.sh` with stdout suppressed,
  and register the new file in the `test-ai-hooks` subjects.

Verification: `bash scripts/ai-hooks/test-ratchet-regression.sh`,
`bash scripts/ai-hooks/test.sh`, `bash scripts/test-test-scripts.sh`,
`bun run lint:shell`, `bun run lint:changed`,
`bun run docs:lint-coverage-map:check`, `vitest run scripts/path-policy.test.ts`,
`tsc -p tsconfig.scripts.json --noEmit`.
