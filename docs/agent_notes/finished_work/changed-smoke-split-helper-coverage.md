# Changed-Smoke Split Helper Coverage

## Summary

Fixed review findings in `scripts/test-scripts.sh` for changed-smoke
selection:

- The three tRPC/shared-schema codemod smokes now use the directory subject
  `scripts/codemods/lib/` instead of only
  `scripts/codemods/lib/trpc-shared-schema.ts`, covering the split
  `trpc-shared-schema-*.ts` helper files.
- `test-ai-hooks` now includes `.codex/hooks/tidy-edited-file.sh`, so Codex
  tidy adapter edits select the hook smoke.
- `scripts/test-test-scripts.sh` now has selection regressions for a split
  tRPC shared-schema helper, the Codex tidy adapter, and existing
  `scripts/lint-ratchet/` helper-directory coverage.
- Review follow-up added direct CLI smokes for the split
  `scripts/codemods/expand-barrel/` and
  `scripts/codemods/concurrency-guard/` helper directories:
  `scripts/test-codemod-expand-barrel.sh` and
  `scripts/test-codemod-concurrency-guard.sh`.
- `scripts/test-test-scripts.sh` now also asserts direct changed-selection for
  those split helper directories and `.claude/hooks/tidy-edited-file.sh`.

Checked related split areas:

- `scripts/lint-ratchet/` was already covered by the `test-lint-ratchet`
  directory subject.
- `scripts/drift-ai/` still has no dedicated `test:scripts` smoke entry; its
  TypeScript coverage remains selected through `test:changed`.

## Verification

- `bash scripts/test-codemod-expand-barrel.sh`
- `bash scripts/test-codemod-concurrency-guard.sh`
- `bash scripts/test-test-scripts.sh`
- `bun run test:scripts:changed`
- `bun run typecheck`
- `bun run test:changed`
