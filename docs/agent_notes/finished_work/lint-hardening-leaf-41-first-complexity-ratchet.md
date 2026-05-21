# Leaf 41 Batch 6: First Core Complexity Ratchet

Date: 2026-05-20

## Summary

Added `ratchet/core-complexity-codemods`, the first live ratchet entry using
Batch 5's `source: { kind: "core" }` infrastructure. The ratchet covers
`scripts/codemods/**/*.ts` with the same test and fixture ignores as
`ratchet/local-max-lines-codemods`.

The probe measured both candidate script families with temporary
`complexity` core ratchets, `parserProfile: "minimal-ts"`, and
`ruleOptions: [{ max: 10 }]`:

- Codemods: 24 messages across 6 files.
- Drift-AI: 10 messages across 5 files.

Codemods won the higher-count comparison, so only
`ratchet/core-complexity-codemods` shipped. The `max: 10` option mirrors the
normal-lint convention in `eslint.config.js`:
`complexity: ["error", { max: 10 }]`.

The initial baseline captured 24 current complexity findings across 6 codemod
production files:

- `scripts/codemods/concurrency-guard.ts`: 2
- `scripts/codemods/expand-barrel.ts`: 8
- `scripts/codemods/lib/trpc-shared-schema.ts`: 7
- `scripts/codemods/structured-logging-fix.ts`: 3
- `scripts/codemods/trpc-shared-input.ts`: 2
- `scripts/codemods/trpc-shared-output.ts`: 2

No zero-finding probe was needed because the chosen scope produced current
baseline findings, and the baseline is the matched-file proof.

EXIT PATH: drain the codemod complexity findings to zero in Leaves 36 and 37.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bun run typecheck`
