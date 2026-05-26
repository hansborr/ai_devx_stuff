# Lint Ratchet Smoke Perf

Date: 2026-05-25
Branch: `feat/autonomous-batch-iteration`

## Summary

Reduced `scripts/test-lint-ratchet.sh` wall time by removing two full
real-tree ESLint collections from the smoke preflight.

The real-tree section now keeps the committed registry/baseline shape check
and generated local config/cache identity assertions. Default mode,
`--check-baseline`, `--update`, update refusal, metric growth/improvement,
cache, and parser-profile behavior remain covered by the fixture CLI runs.
The dedicated `lint:ratchet` verify lane still owns full real-tree ESLint
collection.

## Timing

- Before local timed run: `95.1s`
- Top sinks before: real `lint:ratchet` `37.8s`, real
  `lint:ratchet:check-baseline` `33.4s`, total real-tree preflight `72.5s`
- After clean timed run: `23.6s`
- `test:scripts:changed` observed `test-lint-ratchet` at `26s`; the selected
  script-smoke pacing item moved to `test-doctor-json` at `57s`.

## Verification

- `bash scripts/test-lint-ratchet.sh`
- `bun run test:scripts:changed`
- `bun run verify:changed`
