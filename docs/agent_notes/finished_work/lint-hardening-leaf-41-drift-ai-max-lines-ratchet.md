# Leaf 41 Batch 2: Drift-AI Max-Lines Ratchet

Date: 2026-05-20

## Summary

Added `ratchet/local-max-lines-drift-ai`, a `local/max-lines` ratchet scoped to
`scripts/drift-ai.ts` and `scripts/drift-ai/**/*.ts` with drift-ai test files
and fixtures excluded. The entry mirrors the Batch 1 codemod ratchet shape:
default local source/minimal-ts parser behavior and
`{ max: 300, skipBlankLines: true, skipComments: true }`.

The initial baseline captured six current production drift-ai findings, one
each in:

- `scripts/drift-ai.ts`
- `scripts/drift-ai/config.ts`
- `scripts/drift-ai/duplicates.ts`
- `scripts/drift-ai/ghost-files.ts`
- `scripts/drift-ai/harness-freshness.ts`
- `scripts/drift-ai/suppressions.ts`

No zero-finding probe was needed because the new scope produced current
baseline findings. The drift-ai production rows in
`docs/agent_notes/backlog/lint-followups/lint-coverage-map.md` now point to the
new ratchet while leaving the standalone test and fixture rows unchanged.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
