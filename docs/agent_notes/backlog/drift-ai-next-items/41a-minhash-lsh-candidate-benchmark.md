# 41a - MinHash/LSH candidate benchmark

Status: Parked
Track: P
Size: small-medium
Depends on: 40
Blocks: 41

## Goal

Build and benchmark a deterministic in-tree MinHash/LSH candidate generator
against the clone corpus, without adding CLI output or changing
`near-duplicates` yet.

## Background

The original deep-clone task hid two different outputs: candidate-generation
research and user-facing advisory integration. This first slice answers whether
MinHash/LSH over normalized token or AST shingles produces a useful shortlist
before it is wired into any drift report.

## Seams to touch

- `scripts/drift-ai/near-duplicates-runner.ts`, only for reusable function
  inventory helpers
- `scripts/drift-ai/near-duplicates-fingerprint.ts`, only for normalized feature
  reuse
- new focused MinHash/LSH helper modules under `scripts/drift-ai/`
- clone corpus from task 40
- focused tests under `scripts/drift-ai/`

## What to do

1. Implement a deterministic candidate generator over normalized token or AST
   shingles.
2. Keep it library/test-only. Do not register a check id, CLI flag, or advisory
   output in this task.
3. Add explicit in-memory caps for function count, shingle count, and candidate
   pair count so later output can disclose partial runs.
4. Run the candidate generator against the clone corpus and record stable
   precision/recall-style counts for the shortlist.
5. Preserve deterministic ordering so later advisory integration can render
   repeatable rows.

## Testing

- Unit tests for shingling, hash/signature determinism, bucket formation, caps,
  and no-candidate behavior.
- Corpus evaluator test proving the candidate shortlist baseline is stable.

## Out of scope

- CLI or report output.
- Changing the live `near-duplicates` check.
- Dolos, PMD-CPD, APTED, pq-gram, SimHash, or embeddings.
