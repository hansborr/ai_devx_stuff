# Leaf 41: Drift-AI Test Bug-Class Ratchets

Date: 2026-05-20

## Summary

Added four Batch 4-style third-party ratchets for the drift-ai test family:

- `ratchet/typescript-eslint-no-misused-promises-drift-ai-tests`
- `ratchet/typescript-eslint-only-throw-error-drift-ai-tests`
- `ratchet/vitest-expect-expect-drift-ai-tests`
- `ratchet/vitest-valid-expect-drift-ai-tests`

The file set is:

- `scripts/drift-ai.test.ts`
- `scripts/drift-ai/comments.test.ts`
- `scripts/drift-ai/current-inventory.test.ts`
- `scripts/drift-ai/duplicates.test.ts`
- `scripts/drift-ai/ghost-files.test.ts`
- `scripts/drift-ai/harness-freshness.test.ts`
- `scripts/drift-ai/suppressions.test.ts`

`scripts/drift-ai/scope.test.ts` remains excluded because it is already in
normal lint via the Phase 5b carve-out. The drift-ai tests use direct
`expect(...)` assertions only, so the `vitest/expect-expect` ratchet uses
`assertFunctionNames: ["expect"]`.

Type-aware script ratchets use the existing `tsconfig.scripts.json` project, so
the drift-ai tests are discoverable without widening normal ESLint coverage or
adding a drift-ai-specific tsconfig.

No drift-ai source or drift-ai test source was modified.

## Initial Baselines

All four new ratchets started at zero findings:

- `ratchet/typescript-eslint-no-misused-promises-drift-ai-tests`: 0
- `ratchet/typescript-eslint-only-throw-error-drift-ai-tests`: 0
- `ratchet/vitest-expect-expect-drift-ai-tests`: 0
- `ratchet/vitest-valid-expect-drift-ai-tests`: 0

`bun run lint:ratchet --update` wrote a total live ratchet baseline of 77
current findings across the registry.

## Exit Path

Leaf 33, Leaf 34, and Leaf 40 still own re-including the drift-ai test files in
normal lint. These ratchets hold the bug-class floor in the meantime. Drain
them together with the codemod-tests Batch 4 ratchets, then move compatible
coverage into normal lint or remove the temporary ratchets once the main ESLint
scope owns these files.

## Verification

- `bun run lint:ratchet --update`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run docs:lint-coverage-map:check`
- `bun run harness:check`
- `bun run docs:harness-controls`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bun run typecheck`
