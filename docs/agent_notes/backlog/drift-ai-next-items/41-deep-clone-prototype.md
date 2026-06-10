# 41 - MinHash/LSH advisory integration

Status: Done
Track: P
Size: medium
Depends on: 39, 40, 41a
Blocks: none

## Goal

Expose the task-41a MinHash/LSH candidate generator through advisory output for
deeper function clone experiments.

## Background

The benchmark and deterministic candidate-generation mechanics live in task
41a. This task is the user-facing second slice: route the measured in-tree
candidate generator through the prototype advisory contract without making it a
trusted `DriftFinding` stream.

Dolos is split into task 41b (parser/runner harness) and task 41c (advisory
integration), so this task stays focused on the in-tree engine.

## Seams to touch

- candidate generator from task 41a
- `scripts/drift-ai/near-duplicates-runner.ts`
- `scripts/drift-ai/near-duplicates-check-config.ts`
- `scripts/drift-ai/near-duplicates-config-values.ts`
- `scripts/drift-ai/near-duplicates.ts`
- prototype advisory output from task 39
- clone corpus from task 40
- `scripts/drift-ai/README.md`

## What to do

1. Feed the task-41a shortlist into the existing comparator or a small local
   comparator wrapper.
2. Keep output opt-in and advisory-shaped; do not add it to default `--check all`
   output until promotion evidence exists.
3. Carry explicit caps from task 41a plus any wall-clock or per-pair AST/token
   caps needed by comparison.
4. Emit provenance: engine/config, score, threshold,
   candidate source, caps/timeouts, and whether another engine agreed.
5. Run against the clone corpus and record the rendered advisory baseline.
6. Disclose any capped or partial run so the output cannot read as complete.

## Testing

- Corpus evaluator/rendering test.
- Runner/unit tests for timeout/cap disclosure, deterministic ordering, and
  no-candidate behavior.

## Out of scope

- Dolos in this task; use task 41b for parser/runner mechanics and task 41c for
  advisory integration. PMD-CPD, pq-gram, APTED, embeddings, and hosted APIs
  remain separate future experiments.
- Hosted embeddings on private code.
- Making prototype clone findings part of default `--check all`.
- Auto-fixing or deleting clone candidates.

## Implementation notes (done 2026-06-04)

Shipped `drift:ai clone-candidates` as a prototype advisory subcommand. It is not
a `DriftCheckId`, is not in `--check all`, and renders through
`prototype-advisory.ts` with `kind: "advisory"` and `lane: "prototype"`.

What landed:

- `scripts/drift-ai/clone-candidates-advisory.ts` builds and renders MinHash/LSH
  candidate rows. It discloses function, shingle, and candidate-pair caps from
  task 41a plus normal section display truncation.
- `scripts/drift-ai/clone-candidates-command.ts` and
  `scripts/drift-ai/clone-candidates-args.ts` wire the subcommand through the
  current-scope/config prep path. It reuses the same function inventory and
  ignore globs as `near-duplicates`, and inherits `checks.near-duplicates`
  floors/thresholds unless flags override them.
- `scripts/drift-ai/near-duplicates.ts` now exports
  `compareNearDuplicateFunctions` for precise per-pair scoring. Advisory
  `comparatorAgreed` means the existing `near-duplicates` engine selected the
  same pair, not merely that the raw score crossed the threshold.
- `scripts/drift-ai/README.md` documents the prototype subcommand.
- `docs/agent_notes/finished_work/drift-ai-minhash-advisory-integration.md`
  records the clone-corpus rendered advisory baseline.

Verification:

- `bash scripts/vitest.sh run --project=scripts scripts/drift-ai/clone-candidates-advisory.test.ts scripts/drift-ai.test.ts`
