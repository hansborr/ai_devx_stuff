# Lint Process Review Fixes

## Summary

Fixed the review gaps from `8ed1a7e5` against
`/tmp/lint-process-improvements-plan.md`:

- `local/type-assertion-boundary` now only accepts JSX trailing boundary
  comments when the comment is immediately after the JSX expression container
  (or immediately after the cast inside the container), preventing a later prop
  comment from justifying the cast.
- zero-to-nonzero ratchet baseline update warnings now include per-path finding
  counts.
- `lint:ratchet:check-registry` now checks `harness.controls.json` when present
  and reports `missing-harness-ratchet` with the same actionable manifest next
  steps as `harness:check`.

## Verification

- `FORCE_VERIFY=1 bun run test -- --project=eslint-rules type-assertion-boundary.test.js`
- `FORCE_VERIFY=1 bun run test -- scripts/lint-ratchet-baseline.test.ts scripts/lint-ratchet-check-registry.test.ts`
- `bun run lint:ratchet:check-registry`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bash scripts/test-lint-ratchet.sh`
- `bun run lint:ratchet`
- `git diff --check HEAD`
- `bun run verify:changed`

## Follow-Up Notes

Pain points encountered during the fix were appended to `/tmp/pain_points.md`.
