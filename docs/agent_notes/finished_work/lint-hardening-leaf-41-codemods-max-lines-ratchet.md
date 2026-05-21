# Leaf 41 Batch 1: Codemod Max-Lines Ratchet

Date: 2026-05-20

## Summary

Added `ratchet/local-max-lines-codemods`, a `local/max-lines` ratchet scoped to
`scripts/codemods/**/*.ts` with fixtures and codemod test files excluded. The
entry uses the default local source/minimal-ts parser behavior and the same
effective-line options as the existing `ratchet/local-max-lines` floor:
`{ max: 300, skipBlankLines: true, skipComments: true }`.

The initial baseline captured six current findings, one each in:

- `scripts/codemods/concurrency-guard.ts`
- `scripts/codemods/expand-barrel.ts`
- `scripts/codemods/lib/trpc-shared-schema.ts`
- `scripts/codemods/structured-logging-fix.ts`
- `scripts/codemods/trpc-shared-input.ts`
- `scripts/codemods/trpc-shared-output.ts`

No zero-finding probe was needed because the new scope produced current
baseline findings.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
