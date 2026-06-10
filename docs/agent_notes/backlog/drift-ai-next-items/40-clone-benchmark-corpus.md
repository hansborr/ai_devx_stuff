# 40 - clone benchmark corpus

Status: Done
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

## Implementation notes (done 2026-06-04)

What landed:

- `scripts/drift-ai/fixtures/clone-corpus/` — 8 labeled `.ts` files plus a
  machine-readable `labels.json`. Families: exact, renamed-variable,
  reordered-statement, extracted-helper, and same-behavior/different-structure
  ("semantic") clones, plus two non-pairs (an unrelated pair and a structural
  near-miss precision trap). All synthetic; no product source.
- `labels.json` is **engine-agnostic ground truth**: `clonePairs`/`nonPairs`
  with a per-pair `category`. Function references use
  `<corpus-relative-path>#<functionName>`.
- `scripts/drift-ai/clone-corpus.ts` — loader + evaluator. `loadCloneCorpusLabels`,
  `extractCloneCorpusFunctions`, `detectCloneCorpusPairs`, and
  `evaluateCloneCorpus` (returns precision/recall, per-category recall, detected
  pairs, and confusion-matrix cells including `flaggedNonPairs` /
  `unexpectedPairs` / `unknownFunctionRefs`). `DEFAULT_CLONE_CORPUS_DIR` points at
  the fixtures dir.
- `scripts/drift-ai/clone-corpus.test.ts` — labels-parse + validation tests and a
  recorded baseline.

Recorded baseline for the in-process ts-morph engine (defaults: minLines 8,
minTokens 45, similarity 0.85): **precision 1.0, recall 0.6**. It recovers
exact/renamed/reordered (1/1 each) and misses extracted-helper and semantic
(0/1 each) because those diverge in statement structure and land in different
comparison buckets. No false positives, including the labeled non-pair traps.
This is a measurement, not a target; the baseline test is meant to be updated
deliberately when an engine or the corpus changes.

Lint-surface plumbing (the only non-obvious part): fixture `.ts` files cannot be
type-checked (they are deliberately outside `tsconfig.scripts.json`), so the
drift-ai `**` ESLint re-include had to be re-excluded for the fixtures dir. The
existing `tsconfig.scripts.json` exclude, knip project-graph exclude, and ratchet
ignore already covered `scripts/drift-ai/fixtures/**`; this change added the
matching `eslint.config.js` global ignore (`scripts/drift-ai/fixtures/`) and a
`.prettierignore` entry, then a `lint-coverage-map.md` row so verify:changed /
pre-commit do not flag the new files as unaccounted. Downstream tasks adding more
fixtures under this dir inherit all of that.

Follow-up for 41a/41/41b/41c: score the new engine against the same labels and
compare precision/recall to this baseline. The `near-miss-distances` non-pair is
the precision trap to watch for fuzzier engines (manhattan vs. chebyshev share
most of their shape).
