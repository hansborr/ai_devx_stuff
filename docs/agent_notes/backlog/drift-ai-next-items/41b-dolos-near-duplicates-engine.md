# 41b - Dolos parser and runner harness

Status: Done
Track: P
Size: small-medium
Depends on: 40
Blocks: 41c

## Goal

Build the Dolos tool-resolution, runner, and output-parser harness without
adding user-facing drift output yet.

## Background

The brainstorm marked Dolos as a strong prototype candidate: it supports
TypeScript, uses tree-sitter and winnowing, and can emit fragment-level evidence.
The original Dolos task was too large for one clean session because it combined
binary resolution, process execution, parsing, caps, corpus evaluation, and
advisory rendering. This first slice proves the mechanics and parser against
fixtures; task 41c owns the advisory output.

## Seams to touch

- `scripts/drift-ai/near-duplicates-runner.ts`, only for shared inventory shape
- `scripts/drift-ai/tool-bin.ts` or a Dolos-specific binary resolver
- clone corpus from task 40
- new Dolos parser/runner fixtures under `scripts/drift-ai/fixtures/`

## What to do

1. Detect Dolos on PATH or through an explicit runner option. Missing Dolos is an
   expected absence; do not vendor or require it.
2. Build a runner that accepts the same filtered source inventory shape used by
   existing near-duplicate engines.
3. Parse representative Dolos output into structured candidate pairs with engine
   name/version when available, language mode, score/threshold, and file ranges.
4. Add runner-level caps for wall-clock, file count, candidate count, and
   reported pairs.
5. Compare parsed fake/fixture output against the clone corpus labels so task 41c
   has a baseline harness.
6. Keep this task library/test-only. Do not add CLI output, check ids, or
   advisory rendering here.

## Testing

- Runner tests for PATH/config resolution, missing-tool skip, failed run, cap
  disclosure, and deterministic ordering.
- Parser fixtures for representative Dolos output.
- Corpus evaluator test that records the first Dolos baseline from fake/fixture
  rows.

## Notes

Implemented as a library/test-only Dolos harness:

- shared the existing near-duplicates filtered source inventory through
  `collectNearDuplicateSourceFiles`;
- added Dolos CSV/version parsing, fixture report files, clone-corpus scoring,
  and candidate/report cap disclosure;
- added an optional subprocess runner that detects Dolos with `--version`, uses a
  temp report directory, handles missing tools/failures/timeouts, and caps the
  filtered file inventory before invoking Dolos.

## Out of scope

- Vendoring Dolos.
- CLI/report output; use task 41c.
- Making external clone engines default-on.
- Hosted APIs or embeddings.
- Auto-fixing or deleting clone candidates.
