# Lint Neutral Throttle Helper

Date: 2026-05-30

Implemented `/home/node/lint-merge-debt/06-neutral-throttle-helper.md`.

Notes:

- Added `scripts/ai-hooks/throttle-state.sh` as the neutral throttle state
  helper with explicit TTL/max arguments and a shared
  `ai_throttle_release_due` predicate.
- `lint-coverage-state.sh` now only owns lint-coverage TTL/max env parsing plus
  compatibility wrappers; `lint-coverage-check.sh` calls the neutral helper with
  parsed `AI_LINT_COVERAGE_*` values.
- `ratchet-regression-check.sh` no longer sources lint-coverage state or writes
  `AI_LINT_COVERAGE_*`; it passes `AI_RATCHET_REGRESSION_*` values directly to
  the neutral helper.
- Suppressed ratchet-regression targets still advance the neutral throttle
  counter, so `AI_RATCHET_REGRESSION_MAX` can release a target for re-linting
  before TTL expiry.
- Verification run: `bash scripts/ai-hooks/test.sh`;
  `MUSI_SCRIPTS_CHANGED_FILES="scripts/ai-hooks/throttle-state.sh" bash scripts/test-scripts.sh --changed`.
