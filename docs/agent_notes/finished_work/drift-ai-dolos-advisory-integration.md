# drift:ai Dolos advisory integration

Date: 2026-06-04

Backlog task: `drift-ai-next-items/41c-dolos-advisory-integration.md`

Implemented the `drift:ai dolos-candidates` prototype subcommand, the second
clone-engine consumer of the task-39 prototype advisory contract (after
`clone-candidates`). It stays out of the `DriftFinding` stream, renders with
`kind: "advisory"`, `lane: "prototype"`, cap disclosure, and display truncation,
and is not registered in `--check all`.

The subcommand wraps the task-41b Dolos runner/parser harness:

- it feeds Dolos the same filtered source inventory the `near-duplicates` engines
  see (`nearDuplicateExcludeGlobs` over the current-scope inventory), runs in a
  temp report dir, and never writes the target repo;
- Dolos similarity is its own fragment-overlap scale, deliberately not tied to the
  near-duplicates AST threshold (`--threshold`/`--language` tune it);
- the runner's skip/failure classification drives the firewall: a missing binary
  is an UNMET `dolos engine` prerequisite (exit 0, expected absence), while a
  timeout / run-failure keeps the prerequisite satisfied and discloses the failure
  as a degradation.

## Clone corpus advisory baseline

Source: representative Dolos CSV output mapped onto clone-corpus function ids
(`scripts/drift-ai/fixtures/dolos-report/`), parsed and scored against the corpus
labels.

- precision **0.5**, recall **0.2** — 1 true positive (`sumDiagonalGrid` /
  `sumDiagonalMatrix` at 0.98), 1 false positive (the `manhattanDistance` /
  `chebyshevDistance` near-miss at 0.42), and 4 corpus clone pairs whose fragment
  scores fall below the 0.3 threshold.

Rendered baseline:

```text
drift:ai dolos-candidates (advisory, prototype lane) -- candidate signal
  Experimental candidate signal, NOT defects or verdicts. This prototype lens has no field-calibrated precision yet; treat every row as an unranked lead to confirm or discard.
  prerequisite dolos engine: ok -- dolos@2.9.3 ('dolos' on PATH); language typescript, similarity threshold 30.0%
  cap files: within limit 2000
  cap candidate pairs: within limit 50000
  cap reported pairs: within limit 200
  cap wall-clock (ms): within limit 600000

  candidate: Dolos fragment-level clone candidates
    #1 exact-clones.ts#sumDiagonalGrid:1-3 <=> exact-clones.ts#sumDiagonalMatrix:1-3
    source dolos@2.9.3 (typescript): similarity 98.0% >= threshold 30.0%; overlap 120 tokens, longest fragment 60, coverage L 98.0% / R 96.0%
    inspect: review the shared fragment before extracting common code.
    #2 near-miss-distances.ts#manhattanDistance:1-3 <=> near-miss-distances.ts#chebyshevDistance:1-3
    source dolos@2.9.3 (typescript): similarity 42.0% >= threshold 30.0%; overlap 36 tokens, longest fragment 18, coverage L 40.0% / R 39.0%
    inspect: review the shared fragment before extracting common code.
```

This is a fixture baseline, not a promotion signal: Dolos stays opt-in and
prototype-framed until a field run on real source shows acceptable precision plus
a clear repair path (the promotion criterion in
`drift-ai-next-items/01-shared-context.md`).

## Focused verification

- `bash scripts/vitest.sh run --project=scripts scripts/drift-ai/dolos-advisory.test.ts scripts/drift-ai.test.ts`
- `bun run drift:ai dolos-candidates --root scripts/drift-ai --format text` (no
  Dolos on PATH: unmet prerequisite, exit 0)
