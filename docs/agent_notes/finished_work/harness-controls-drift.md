# Harness Controls Drift

Date: 2026-05-25

## Outcome

`harness.controls.json` now documents the live wrapper slots for `verify`,
`verify:changed`, `verify:parallel`, and `.husky/pre-commit`, including the
`coverage-map` gate and pre-commit's `ratchet` gate. Generated harness controls
markdown renders the slot lists directly from the manifest.

`bun run harness:check` now parses `scripts/verify.sh` and `.husky/pre-commit`
through `scripts/harness-wrapper-slot-*.ts` and compares those live slots with
the manifest. The smoke fixture covers missing `coverage-map` from
`verify:changed` and missing `ratchet` from pre-commit.

The new wrapper-slot helpers are accounted for in the lint coverage map.

## Verification

- `bun run docs:harness-controls:check`
- `bun run harness:check`
- `bash scripts/test-generate-harness-controls.sh`
- `bash scripts/test-harness-check.sh`
- `bun run lint:ratchet`
- `bun run docs:lint-coverage-map:check`
- `bun run typecheck`
- `bun run verify:changed`
