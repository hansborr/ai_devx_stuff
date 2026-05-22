# Pre-commit Vitest JSON Sidecar Leaf 3

Date: 2026-05-21
Branch: `feature/lint-hardening-pre-commit-perf-exploration`

## Summary

Pre-commit now runs `bun run test:changed --reporter=dot` by default. The
Vitest JSON timing sidecar is opt-in for pre-commit via
`MUSI_CAPTURE_TEST_TIMINGS=1`, which adds the existing
`--reporter=json --outputFile.json="$LOG_DIR/test-timings.json"` arguments.

Manual verify is unchanged: `scripts/verify.sh` still requests the JSON
sidecar for both full and changed verify runs because that path has diagnostic
value.

## Rationale

Measured full-suite runs showed about 10s of overhead for the per-commit JSON
sidecar (`dot+json 118.90s` vs `dot-only 107.90s`, with a 2.08 MB timings
file). The sidecar is still useful for manual diagnostics, but it is not worth
paying on every commit by default.

`verify:logs slow-tests` behavior is unchanged. After a pre-commit-only run
without `MUSI_CAPTURE_TEST_TIMINGS=1`, it will print the existing
missing-sidecar guidance by design.

## Coverage

`scripts/test-dependency-freshness.sh` now proves both pre-commit branches:

- default pre-commit run-meta records a dot-only `test:changed` command and no
  `--reporter=json`;
- `MUSI_CAPTURE_TEST_TIMINGS=1` pre-commit run-meta records the JSON reporter
  and `test-timings.json` output file.

The existing `scripts/test-verify.sh` assertions for manual verify JSON timing
capture stayed unchanged.

## Verification

- `bun run lint -- --max-warnings=0` — passed
- `bun run lint:shell` — passed
- `bun run lint:config-sensors` — passed
- `bun run lint:ratchet` — passed with zero regressions
- `bun run lint:ratchet:check-baseline` — passed
- `bash scripts/test-verify.sh` — passed
- `bash scripts/test-dependency-freshness.sh` — passed
- `bash scripts/test-verify-logs.sh` — passed
- `MUSI_INTERACTIVE_TIMEOUT=900 bun run verify:changed` — passed in 430s with
  the expected soft-budget warning only; the manual verify timing sidecar was
  present at `/tmp/musi-pre-commit-logs/test-timings.json`.
