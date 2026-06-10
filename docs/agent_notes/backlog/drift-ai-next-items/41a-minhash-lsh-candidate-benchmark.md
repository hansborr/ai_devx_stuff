# 41a - MinHash/LSH candidate benchmark

Status: Done
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

## Implementation notes (done 2026-06-04)

What landed (all library/test-only; no check id, CLI flag, advisory output, or
`near-duplicates` change):

- `scripts/drift-ai/minhash-lsh.ts` — generic, deterministic MinHash + LSH
  primitives over `{ id, features }` documents. Knows nothing about functions or
  the corpus. Exposes `buildShingles` (k-gram set over a feature sequence),
  `computeSignature`/`buildSeeds` (a seeded hash family folded with a Murmur3
  `fmix32` finalizer so it stays in 32-bit integer math — no BigInt),
  `estimateSimilarity` (signature-agreement Jaccard estimate), `resolveMinHashConfig`,
  and `findLshCandidatePairs`. Defaults: `shingleSize 3`, `24 bands x 4 rows`
  (96-length signature, ~ (1/24)^(1/4) ≈ 0.45 candidate threshold). Caps:
  `maxShinglesPerDocument 4096`, `maxCandidatePairs 50000`.
- `scripts/drift-ai/clone-candidates.ts` — `generateCloneCandidates(functions, opts)`
  bridges `NearDuplicateFunction` fingerprints (reusing the existing
  `near-duplicates` extractor's `features`) to the MinHash layer, applying the
  near-duplicate size floors (minLines 8 / minTokens 45) for comparability and a
  `maxFunctions` cap (default 5000). It returns candidates plus a `truncation`
  block disclosing function/shingle/candidate-pair caps. `evaluateCloneCorpusCandidates`
  scores the shortlist against the task-40 labels.
- `scripts/drift-ai/clone-corpus.ts` — extracted a reusable, engine-agnostic
  `scoreDetectedPairsAgainstLabels` (the confusion-matrix scoring the ts-morph
  baseline already did) and exported `extractCloneCorpusNearDuplicateFunctions` +
  `cloneCorpusFunctionId` so the MinHash benchmark reuses corpus infra instead of
  re-deriving precision/recall. `evaluateCloneCorpus` output is unchanged.
- `scripts/drift-ai/feature-hash.ts` — added `hashFeature32` (the raw 32-bit FNV-1a
  value) for the MinHash seed/shingle hashing; `hashFeature` now delegates to it,
  so its base-36 output is byte-identical.
- Tests: `minhash-lsh.test.ts` (shingling, signature determinism + order-independence,
  similarity, seeds, config resolution, bucket formation, no-candidate, and all
  three caps) and `clone-candidates.test.ts` (recorded corpus baseline, shortlist
  ordering, determinism, and caps).

Recorded baseline for the MinHash candidate generator at defaults (a measurement,
not a target — update deliberately like task 40's): **precision 0.75, recall 0.6**.
It recovers the same structural clones as the ts-morph engine (exact/renamed/
reordered: 1/1 each; estimated similarity 1, 1, ~0.896) and misses extracted-helper
and semantic (0/1 each) — those diverge in statement structure and never share an
LSH band. Its one false positive is the labeled near-miss precision trap
(manhattan vs. chebyshev, est. ~0.698), which the precise ts-morph engine rejects.
So vs. the baseline engine: same recall, lower precision — the expected
recall-first, cheap-shortlist tradeoff for a candidate generator. Recall was
stable at 0.6 across shingle sizes k=2..5 (precision varied 0.6–0.75); k=3 is the
standard default and the corpus is too small to tune against.

Determinism: the hash family is seeded from a fixed string, shingle sets are
order-independent for the signature (sorted only for capped selection), and the
candidate list is sorted before return — same input yields an identical shortlist
and identical estimated similarities.

Follow-up for 41: wire `generateCloneCandidates` behind task 39's advisory
contract. The `truncation`/`caps` block is already shaped for partial-run
disclosure. A precise verifier (e.g. the ts-morph pairwise compare) over the
MinHash shortlist would recover the baseline engine's precision while keeping the
candidate generator's cheap O(n·bands) shortlisting.

### Gotcha for the next agent

The Write tool corrupted `SHINGLE_SEPARATOR = ""` / `PAIR_SEPARATOR = " "` into
NUL/SOH bytes, which made `minhash-lsh.ts` look "binary" so the formatter skipped
it. Both now use a printable `"|"`. If you change the separator the MinHash hashes
shift and the recorded baseline must be re-measured (see `pain-points-drift-ai.log`).
