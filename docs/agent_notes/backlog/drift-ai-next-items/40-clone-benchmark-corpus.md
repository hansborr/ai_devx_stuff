# 40 - clone benchmark corpus

Status: Parked
Track: P
Size: medium
Depends on: none
Blocks: 41a, 41, 41b, 41c

## Goal

Create a labeled fixture corpus for clone-detection experiments so future
engines can be compared before being promoted.

## Background

`near-duplicates` has a portable `ts-morph` engine and optional `similarity-ts`.
The backlog still proposes Dolos, PMD-CPD, APTED, MinHash/LSH, pq-gram, and
embedding-assisted retrieval. Those should not be added blindly; a small corpus
is the first reusable investment.

## Seams to touch

- `scripts/drift-ai/fixtures/clone-corpus/` or a similarly named directory
- tests or a small evaluator under `scripts/drift-ai/`
- `scripts/drift-ai/README.md`, only if documenting prototype evaluation.

## What to do

1. Add labeled TS/TSX fixture files covering:
   - exact clones;
   - renamed-variable clones;
   - extracted-helper clones;
   - reordered-statement clones;
   - same-behavior but different-structure examples;
   - known non-clones.
2. Include a machine-readable labels file mapping expected clone pairs and
   non-pairs.
3. Add a tiny evaluator or test helper that can run the current `ts-morph`
   engine against the corpus and report precision/recall-style counts.
4. Keep fixtures small enough for fast tests.

## Testing

- Focused tests that the corpus labels parse and the current engine has a stable
  baseline result.

## Out of scope

- Adding a new clone engine.
- Setting a hard quality gate across all future engines.
- Using private or real product source as fixture content.
- Dead-code false-positive traps; use task 40b.
