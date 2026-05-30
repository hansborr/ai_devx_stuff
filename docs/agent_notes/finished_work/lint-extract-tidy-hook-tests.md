# Lint Extract Tidy Hook Tests

Date: 2026-05-30

Implemented `/home/node/lint-merge-debt/08c-extract-tidy-hook-tests.md`.

Notes:

- Added `scripts/ai-hooks/test-tidy.sh`: the entire `tidy-edited-file` hook test
  family (fixture repo setup, pinned prettier/eslint stubs, the `run_tidy_hook` /
  `tidy_context` / `tidy_payload_for_file` / `tidy_relative_path` helpers, and all
  tidy assertions) moved verbatim out of `scripts/ai-hooks/test.sh` into a
  standalone focused script.
- The block was fully self-contained — it uses no `ai_*` helpers, so the focused
  script only sources `test-support.sh` (plus the shared `test-git-env.sh`
  bootstrap). `TIDY_REPO_TMP` and `HOOK_FIXTURE_REPO_ROOT` were referenced only
  inside the block, so the now-unused `TIDY_REPO_TMP` definition and its trap
  reference were dropped from `test.sh`.
- `scripts/ai-hooks/test.sh` now invokes the focused script with stdout
  redirected to `/dev/null`, preserving the aggregate's single
  `ai-hooks tests passed` success line and failure exit-code behavior.
- Changed-test selection: added `scripts/ai-hooks/test-tidy.sh` to the
  `test-ai-hooks` subject list in `scripts/path-policy-smoke-subjects.ts`. The
  `local/max-lines` data-table cap (389, `ratchetExcluded: true`) was left
  unchanged — the file sits exactly at 389 effective lines
  (`skipBlankLines`/`skipComments`) and ESLint still passes, so no cap loosening
  was warranted.
- No production hook behavior changed.

Verification: `bash scripts/ai-hooks/test-tidy.sh`,
`bash scripts/ai-hooks/test.sh`, `bash scripts/test-test-scripts.sh`,
`bash scripts/vitest.sh run --passWithNoTests scripts/path-policy.test.ts`,
`bun run lint:shell`, `bun run docs:lint-coverage-map:check`,
`tsc -p tsconfig.scripts.json --noEmit`, and direct
`shellcheck --severity=warning scripts/ai-hooks/test-tidy.sh`. Final staged gate:
`bun run verify:changed` (OK, 166s).

Follow-on tasks 08d (stop-policy) / 08e (cache): reuse `test-support.sh`, extract
each hook block into its own `test-<hook>.sh` that sources it and is invoked from
`test.sh` with stdout suppressed, and add the new file to the `test-ai-hooks`
subject list. Note the smoke-subjects cap is now exactly met (389 effective
lines), so the next subject addition will need a `path-policy-smoke-subjects.ts`
`local/max-lines` cap bump in `eslint-config/shared-policy.js`.
