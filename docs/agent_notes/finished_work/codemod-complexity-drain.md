# Codemod Complexity Drain

Date: 2026-05-25
Branch: `feat/autonomous-batch-iteration`

## Summary

Drained the final six `ratchet/core-complexity-codemods` findings by flattening
codemod helper control flow without changing fixture-backed behavior:

- `scriptReplacement` now delegates script error, single-message, object-field,
  and seeded-count replacement shapes to focused helpers.
- `structured-logging-fix` CLI parsing now uses parsed flag collection plus
  mode finalizers, and run orchestration delegates check mode, target
  resolution, and rewrite-plan collection.
- `resolveInputCandidate` and `resolveOutputCandidate` now delegate already
  shared, const-schema, and inline-schema cases to small helpers.
- `trpc-shared-input` CLI parsing now mirrors the split parser shape already
  used by the output codemod.

## Ratchet Movement

- `ratchet/core-complexity-codemods`: `6 -> 0`
- Total `lint:ratchet` current findings: `6 -> 0`

Exit path: the promoted codemod complexity drain is empty.

## Verification

- `bun test scripts/codemods/structured-logging-fix.test.ts`
- `bun test scripts/codemods/trpc-shared-schema-codemod.test.ts`
- `bun run codemod:structured-logging-fix -- --check`
- `bun run codemod:trpc-shared-input -- --check`
- `bun run codemod:trpc-shared-output -- --check`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bun run test:scripts:changed`
