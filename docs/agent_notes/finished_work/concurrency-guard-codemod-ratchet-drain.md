# Concurrency Guard Codemod Ratchet Drain

Date: 2026-05-25
Branch: `feat/autonomous-batch-iteration`

## Summary

Split `scripts/codemods/concurrency-guard.ts` into a CLI/export facade plus
focused `scripts/codemods/concurrency-guard/` modules:

- CLI parsing/path normalization
- constants and shape tables
- AST/delegate helper predicates
- raw/direct finding producers
- helper-shape classifiers
- scan/run orchestration

Flattened the two complexity findings that were in this file:

- `parseArgs` moved into token scanning plus mode finalizers.
- `patternCFinding` now delegates Pattern C target checks and missing-shape
  collection to small helpers.

## Ratchet Movement

- `ratchet/core-complexity-codemods`: `8 -> 6`
- `ratchet/local-max-lines-codemods`: `1 -> 0`
- Total `lint:ratchet` current findings: `9 -> 6`

Exit path: codemod max-lines is empty. The remaining codemod drain is the six
`ratchet/core-complexity-codemods` findings in other codemod files, split by
file.

## Verification

- `bun test scripts/codemods/concurrency-guard.test.ts`
- `bun run codemod:concurrency-guard -- --check`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bun run test:scripts:changed`
- `bun run docs:lint-coverage-map:check -- --check-eslint-reach --staged`
