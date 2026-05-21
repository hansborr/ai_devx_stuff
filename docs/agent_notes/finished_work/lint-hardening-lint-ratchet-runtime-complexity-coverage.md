# Lint-Ratchet Runtime Complexity Coverage

Date: 2026-05-21

## Summary

Added `ratchet/core-complexity-lint-ratchet-runtime`, a
`complexity-severity` ratchet scoped to the lint-ratchet runtime files that
remain excluded from normal `bun run lint` by the global `scripts/**/*`
ignore:

- `scripts/lint-ratchet-baseline.ts`
- `scripts/lint-ratchet-metrics.ts`
- `scripts/lint-ratchet.ts`

This is opportunistic coverage surfaced during Batch 2 review, not part of the
original Leaf 41 plan. The point was to lock the current state, not drain or
refactor existing complexity.

## Baseline

`bun run lint:ratchet:update` captured:

| File | count | maxComplexity |
| --- | ---: | ---: |
| `scripts/lint-ratchet-baseline.ts` | 5 | 44 |
| `scripts/lint-ratchet-metrics.ts` | 3 | 15 |
| `scripts/lint-ratchet.ts` | 2 | 22 |

Follow-up worth scheduling separately: `validateLintRatchetRegistry` in
`scripts/lint-ratchet-baseline.ts` is complexity 44, above the >30 review
threshold. No cleanup was done in this coverage-only commit.

## Verification

- `bun run lint:ratchet:update`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run docs:lint-coverage-map:check`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
