# Drift-AI Max-Lines Drain

Date: 2026-05-25
Branch: `feat/autonomous-batch-iteration`

## Summary

Drained `ratchet/local-max-lines-drift-ai` from 2 findings to 0. The overall
`lint:ratchet` current finding count is now 29.

## Extraction

- `scripts/drift-ai.ts` is now a small CLI/export facade.
- New top-level drift-ai modules own CLI parsing (`cli-args.ts`), git changed
  scope helpers (`git-changed-scope.ts`), inventory grouping
  (`inventory-by-dir.ts`), run preparation (`prepare-run.ts`), report building
  (`report-builder.ts`), report formatting (`report-format.ts`), report/chunk
  output (`report-output.ts`, `chunks.ts`), shared public types (`types.ts`),
  and runtime orchestration (`runner.ts`).
- `scripts/drift-ai/ghost-files.ts` is now a public detector facade.
- New ghost-file modules own constants, tokenization, match classification,
  changed-scope checks, current-scope checks, bucket fallback, and finding
  message helpers.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `FORCE_VERIFY=1 bun run typecheck`
- `bun run test:scripts:changed`
- `FORCE_VERIFY=1 bun run verify:changed`
