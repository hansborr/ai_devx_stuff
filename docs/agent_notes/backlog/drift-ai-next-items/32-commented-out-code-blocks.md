# 32 - commented-out code blocks check

Status: Done
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

## Implementation notes (Done 2026-06-04)

Landed as the opt-in `commented-out-code` check (`runByDefault: false`).

- New modules: `commented-out-code.ts` (single-pass region detector + runner),
  `commented-out-code-check.ts` (plugin), `commented-out-code-check-config.ts`
  (config metadata/parse), `commented-out-code-config-values.ts` (pure default-value
  leaf so the metadata registry's value closure never reaches ts-morph — enforced by
  `check-metadata.test.ts`), and `commented-out-code.test.ts`.
- Detection: reuses `line-scanner.ts` to thread string/block-comment state across
  lines, groups consecutive **pure-comment** lines (stripping a leading ` * ` JSDoc
  decoration from block-comment bodies), and flags a run of `>= minLines` (default
  3, floor 2) only when the stripped snippet **parses with zero `ts` parse
  diagnostics AND contains at least one operative construct** (declaration,
  control-flow, call, assignment, import/export, etc.). Bare-identifier/literal-only
  blocks and unbalanced fragments are not flagged — precision over recall.
- Finding carries the line range + count + first operative construct in the message,
  and `details.{startLine,endLine,lineCount,construct,snippetHash,preview}`. The whole
  block is never dumped to text output; `preview` is the truncated first line.
- Config: `checks.commented-out-code.{minLines,excludePrefixes}`. Honors
  `excludePrefixes` and skips `.d.ts` / non-source files.
- Registered in `check-metadata.ts` + `check-registry.ts`; `DriftCheckId` and
  `DriftAiChecksConfig` extended; README table row + section added; example config
  + lint-coverage-map updated. `--check` usage assertion in `drift-ai.test.ts`
  refreshed.
- Verified: `bun run verify:changed` green; CLI smoke flags a commented-out block
  and leaves an adjacent prose block alone.

A natural follow-up (not done here, deliberately): allow a configurable tolerance
for a few parse-error lines to raise recall on real-world fragments. Held back to
keep the first slice high-precision until field reports justify it.
