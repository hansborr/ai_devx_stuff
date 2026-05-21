# Top-Level Scripts Complexity Severity

Date: 2026-05-21

## Summary

Converted `ratchet/core-complexity-top-level-scripts` from `message-count` to
`complexity-severity`, closing the Batch 2 review gap where the Leaf 38
top-level scripts ratchet was the lone core `complexity` holdout after the
codemods, drift-ai, eslint-rules, and runtime complexity ratchets had severity
payloads.

The registry guard invariant is now satisfied: every core `complexity`
ratchet uses `complexity-severity`.

## Baseline

`bun run lint:ratchet:update` refreshed only
`ratchet/core-complexity-top-level-scripts`. Direct ESLint audit with the
generated ratchet config matched the updater exactly:

| File | count | maxComplexity |
| --- | ---: | ---: |
| `scripts/db-status.ts` | 0 | n/a |
| `scripts/harness-emit-envelope.ts` | 0 | n/a |
| `scripts/sensor-blob-size.test.ts` | 0 | n/a |
| `scripts/sensor-blob-size.ts` | 1 | 11 |

No function exceeded complexity 30. The only tracked function is
`parseArgs` in `scripts/sensor-blob-size.ts` at complexity 11.

## Verification

- `bun run lint:ratchet:update`
- direct ESLint audit with the generated ratchet config
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run docs:lint-coverage-map:check`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
