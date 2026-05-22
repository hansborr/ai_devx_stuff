# Pre-Commit Perf Leaf 5: Run-Meta History

Landed on `feature/lint-hardening-pre-commit-perf-exploration`.

## What Changed

- Added `musi_persist_run_meta_history "$LOG_DIR" "$HISTORY_DIR"` in
  `scripts/verify-metadata.sh`.
- `.husky/pre-commit` and `scripts/verify.sh` now persist
  `$LOG_DIR/run-meta.json` after wrapper metadata is combined on success,
  normal failure, and signal/timeout paths.
- History writes go to
  `${MUSI_VERIFY_HISTORY_DIR:-/tmp/musi-verify-history}` using
  `<unix-ts>-<mode>-<exit_code>.json`, where the timestamp is derived from
  `wrapper.start_time`.
- Retention keeps the newest `${MUSI_VERIFY_HISTORY_LIMIT:-50}` JSON files.
- History write/read/retention failures warn to stderr and do not change
  verify or pre-commit exit semantics.
- Added `scripts/verify-history.sh` and `bun run verify:history`; default
  output is newest-first with `--limit N` support.
- Added `scripts/test-verify-history.sh` and wired it into
  `scripts/test-scripts.sh`.
- Added `verify-wrapper/verify-history` to `harness.controls.json` and
  regenerated `docs/generated/harness-controls.md`.

## Verification

- `bun run lint -- --max-warnings=0`
- `bun run lint:shell`
- `bun run lint:config-sensors`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-verify.sh`
- `bash scripts/test-verify-logs.sh`
- `bash scripts/test-verify-history.sh`
- Manual smoke: `bash scripts/verify.sh --changed` hit the default 240s
  watchdog while in script smokes and wrote
  `/tmp/musi-verify-history/1779422937-serial-verify-changed-124.json`.
  `bun run verify:history -- --limit 20` listed that archived failure row.
- Final gate: `MUSI_INTERACTIVE_TIMEOUT=900 bun run verify:changed` passed in
  382s with the expected soft-budget warning and wrote
  `/tmp/musi-verify-history/1779423218-serial-verify-changed-0.json`.
