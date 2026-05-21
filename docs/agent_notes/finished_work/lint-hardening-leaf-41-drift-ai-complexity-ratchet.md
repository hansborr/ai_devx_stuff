# Leaf 41 Batch 7: Drift-AI Core Complexity Ratchet

Date: 2026-05-20

## Summary

Added `ratchet/core-complexity-drift-ai`, the drift-ai mirror for Batch 6's
first core complexity ratchet. The ratchet covers `scripts/drift-ai.ts` and
`scripts/drift-ai/**/*.ts` with the same test and fixture ignores as
`ratchet/local-max-lines-drift-ai`.

The initial baseline captured 10 current complexity findings across 5 drift-ai
production files:

- `scripts/drift-ai.ts`: 4
- `scripts/drift-ai/comments.ts`: 1
- `scripts/drift-ai/duplicates.ts`: 1
- `scripts/drift-ai/ghost-files.ts`: 2
- `scripts/drift-ai/suppressions.ts`: 2

The ratchet uses `parserProfile: "minimal-ts"`,
`source: { kind: "core" }`, and `ruleOptions: [{ max: 10 }]`. The `max: 10`
option mirrors both `eslint.config.js` and the Batch 6 codemod ratchet.

No zero-finding probe was needed because the chosen scope produced current
baseline findings, and the baseline is the matched-file proof.

EXIT PATH: drain the drift-ai complexity findings to zero in Leaves 32/33/34.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bun run typecheck`
