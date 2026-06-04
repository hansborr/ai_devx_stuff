# 32 - commented-out code blocks check

Status: Parked
Track: C
Size: small-medium
Depends on: none
Blocks: none

## Goal

Add an opt-in check for consecutive comment regions that look like commented-out
TypeScript/JavaScript code.

## Background

The live `comments` check is a comment-ratio sensor: it flags files where
comments crowd out code. This is a different refactor-residue signal from the
brainstorm: a tombstoned code block left in comments. Label it as
commented-out code, not dead code.

## Seams to touch

- `scripts/drift-ai/line-scanner.ts`
- `scripts/drift-ai/comments.ts` only for reusable scanning helpers, if useful
- `scripts/drift-ai/parsed-source-cache.ts` or direct TypeScript parsing
- new `scripts/drift-ai/commented-out-code*.ts` modules
- `scripts/drift-ai/check-metadata.ts`
- `scripts/drift-ai/check-registry.ts`
- `scripts/drift-ai/types.ts`
- `scripts/drift-ai/README.md`

## What to do

1. Add a new opt-in check id, likely `commented-out-code`.
2. Collect consecutive pure-comment regions above a configurable minimum line
   count. Ignore ordinary one-line comments and doc comments with prose.
3. Strip comment delimiters into a candidate source snippet and parse it as
   TypeScript/JavaScript. Prefer "parseable code-shaped block" over regex-only
   detection.
4. Emit the file/range, line count, parser result, and a short snippet hash or
   first-line preview. Do not emit the whole block in text output.
5. Keep findings report-only and evidence-framed; the row says the block appears
   to be commented-out code, not that it is unreachable or safe to delete.

## Testing

- Fixture tests for line comments, block comments, mixed comment styles, prose
  comments, JSDoc, code-shaped snippets, and unparsable snippets.
- Config parsing tests for the minimum consecutive-line threshold.
- A focused smoke with `--scope current --check commented-out-code --format text`
  when feasible.

## Out of scope

- Calling code dead or safe to remove.
- Auto-removing commented blocks.
- Detecting commented-out non-JS languages in the first slice.
