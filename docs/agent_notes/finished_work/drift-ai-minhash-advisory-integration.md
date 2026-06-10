# drift:ai MinHash advisory integration

Date: 2026-06-04

Backlog task: `drift-ai-next-items/41-deep-clone-prototype.md`

Implemented the `drift:ai clone-candidates` prototype subcommand. It stays out of
the `DriftFinding` stream and renders through the task-39 prototype advisory
contract with `kind: "advisory"`, `lane: "prototype"`, cap disclosure, display
truncation, and no default `--check all` registration.

The subcommand reuses the `near-duplicates` ts-morph function inventory and
target config floors. It feeds the task-41a MinHash/LSH shortlist into a precise
pair scorer, then records whether the existing `near-duplicates` engine selected
the same pair. The distinction matters: the corpus near-miss pair has a raw
ts-morph score above the threshold but is not selected by the engine because the
promoted engine's bucket gates reject it.

## Clone corpus advisory baseline

Command used:

```sh
bun -e 'import { buildCloneCandidateAdvisory, formatCloneCandidateAdvisoryText } from "./scripts/drift-ai/clone-candidates-advisory.ts"; import { extractCloneCorpusNearDuplicateFunctions } from "./scripts/drift-ai/clone-corpus.ts"; console.log(formatCloneCandidateAdvisoryText(buildCloneCandidateAdvisory({ functions: extractCloneCorpusNearDuplicateFunctions(), top: 10 })));'
```

Rendered baseline:

```text
drift:ai clone-candidates (advisory, prototype lane) -- candidate signal
  Experimental candidate signal, NOT defects or verdicts. This prototype lens has no field-calibrated precision yet; treat every row as an unranked lead to confirm or discard.
  cap functions: within limit 5000
  cap shingles per function: within limit 4096
  cap candidate pairs: within limit 50000

  candidate: MinHash/LSH function clone candidates
    #1 exact-clones.ts:8-19 sumDiagonalGrid <=> exact-clones.ts:21-32 sumDiagonalMatrix
    source minhash-lsh: estimate 100.0%; config shingle 3, bands 24 x rows 4, signature 96
    comparator ts-morph: agreed yes; similarity 100.0% >= threshold 85.0%; score 12.00; selected by engine
    inspect: compare both functions before extracting shared flow.
    #2 renamed-clones.ts:9-21 totalForInvoice <=> renamed-clones.ts:23-35 totalForLedger
    source minhash-lsh: estimate 100.0%; config shingle 3, bands 24 x rows 4, signature 96
    comparator ts-morph: agreed yes; similarity 100.0% >= threshold 85.0%; score 13.00; selected by engine
    inspect: compare both functions before extracting shared flow.
    #3 reordered-left.ts:14-24 buildDispatchPayload <=> reordered-right.ts:13-23 makeDispatchPayload
    source minhash-lsh: estimate 89.6%; config shingle 3, bands 24 x rows 4, signature 96
    comparator ts-morph: agreed yes; similarity 98.5% >= threshold 85.0%; score 10.84; selected by engine
    inspect: compare both functions before extracting shared flow.
    #4 near-miss-distances.ts:10-19 manhattanDistance <=> near-miss-distances.ts:21-30 chebyshevDistance
    source minhash-lsh: estimate 69.8%; config shingle 3, bands 24 x rows 4, signature 96
    comparator ts-morph: agreed no; similarity 87.3% >= threshold 85.0%; score 8.73; not selected by engine
    inspect: compare both functions before extracting shared flow.
```

Focused verification:

- `bash scripts/vitest.sh run --project=scripts scripts/drift-ai/clone-candidates-advisory.test.ts scripts/drift-ai.test.ts`
