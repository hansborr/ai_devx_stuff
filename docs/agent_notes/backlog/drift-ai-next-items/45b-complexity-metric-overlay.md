# 45b - complexity metric overlay

Status: Parked
Track: P
Size: medium
Depends on: 39, 45a
Blocks: none

## Goal

Add a deterministic complexity-style metric overlay to the birth/current size
lens after the birth blob plumbing exists.

## Background

`hotspots` deliberately avoids a complexity lens because routine complexity
enforcement belongs to lint-ratchet. The prototype birth lens is different: it
asks whether a file arrived complex and then stayed stale or ownership-concentrated.
That still needs a concrete metric contract. Do not let "complexity" mean an
unspecified parser project or a hidden ESLint run.

## Seams to touch

- task 45a birth/current blob loader
- `scripts/drift-ai/parsed-source-cache.ts` or a local source parser, if reused
- optional simple metric helper under `scripts/drift-ai/`
- prototype advisory output from task 39
- `scripts/drift-ai/README.md`

## What to do

1. Choose and name a deterministic metric before emitting rows. Acceptable first
   slices include a small AST branch-count metric or another parser-backed local
   metric with tests. If it is not ESLint cyclomatic complexity, do not label it
   as ESLint complexity.
2. Run the same metric on the birth blob and current blob from task 45a.
3. Emit metric name/version, per-file totals, top contributing functions or
   blocks when available, then-vs-now delta, parser failures, and caveats.
4. Keep missing or unparsable blobs as degradations, not findings.
5. Preserve the task 45a evidence. Complexity is an overlay that strengthens or
   weakens the row; it is not a standalone abandonment verdict.

## Testing

- Unit tests for the chosen metric on small TS/TSX snippets.
- Overlay tests for birth-current growth, shrinkage, unchanged complexity,
  parser failure, and missing blobs.
- Rendering tests showing the metric name and caveats.

## Out of scope

- Running ESLint over historical blobs unless a later task creates a safe
  temp-source boundary and proves it is worth the cost.
- Type-checker-backed metrics.
- Default-on gates or refactor/deletion verdicts.
