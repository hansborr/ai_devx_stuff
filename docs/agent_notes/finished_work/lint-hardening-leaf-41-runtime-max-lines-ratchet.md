# Leaf 41 Batch 3: Runtime Max-Lines Ratchet

Date: 2026-05-20

## Summary

Added `ratchet/local-max-lines-runtime`, a `local/max-lines` ratchet scoped to
the Leaf 39 ratchet/harness runtime production scripts:

- `scripts/harness-check.ts`
- `scripts/lint-agent.ts`
- `scripts/lint-ratchet-baseline.ts`
- `scripts/lint-ratchet.ts`

The entry uses explicit file literals, excludes sibling script test files, and
mirrors the Batch 1 codemod and Batch 2 drift-ai shape: default local
source/minimal-ts parser behavior and
`{ max: 300, skipBlankLines: true, skipComments: true }`.

The initial baseline captured three current runtime findings, one each in:

- `scripts/harness-check.ts`
- `scripts/lint-ratchet-baseline.ts`
- `scripts/lint-ratchet.ts`

`scripts/lint-agent.ts` is in scope and currently has no `local/max-lines`
finding. No zero-finding probe was needed because the new scope produced
current baseline findings. The Leaf 39 production rows in
`docs/agent_notes/backlog/lint-followups/lint-coverage-map.md` now point to the
new ratchet while leaving the test row unchanged. The ratchet and harness smoke
fixtures were kept in parity with the copied live registry/manifest shape.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
