# 41c - Dolos advisory integration

Status: Done
Track: P
Size: medium
Depends on: 39, 40, 41b
Blocks: none

## Goal

Expose Dolos rows through the prototype advisory contract after the parser and
runner harness from task 41b exists.

## Background

Dolos is useful as an external fragment-level clone engine, but wiring a new
tool, parser, caps, corpus baseline, and user-facing output in one session is too
large. Task 41b owns parser/runner mechanics; this task owns the advisory surface.

## Seams to touch

- Dolos parser/runner helpers from task 41b
- prototype advisory output from task 39
- clone corpus from task 40
- `scripts/drift-ai/runner.ts`
- `scripts/drift-ai/subcommand-args.ts`, if a new subcommand needs shared args
- `scripts/drift-ai/README.md`

## What to do

1. Choose the smallest CLI surface that keeps Dolos prototype-framed. A separate
   advisory subcommand is preferred over adding Dolos rows to the main
   `DriftFinding` stream.
2. Render Dolos candidates with engine name/version when available, language
   mode, score/threshold, file ranges, candidate source, caps, and degradations.
3. Keep the engine opt-in. Do not add Dolos to default output or `--check all`.
4. Use task 41b's skip/failure classifications so missing Dolos is an expected
   absence, not a finding.
5. Compare rendered rows against the clone corpus and record the first advisory
   baseline.

## Testing

- Advisory rendering tests for populated, empty, missing-tool, failed-run, and
  capped runs.
- CLI smoke with a fake or fixture-backed Dolos runner.
- Corpus evaluator test proving the rendered baseline is stable.

## Out of scope

- Vendoring Dolos.
- Promoting Dolos to a check id.
- Hosted APIs or embeddings.
- Auto-fixing clone candidates.

## Implementation notes (2026-06-04)

Landed as a new `dolos-candidates` prototype advisory subcommand, mirroring the
`clone-candidates` (MinHash/LSH) shape so both clone engines share the task-39
firewall and the shared subcommand arg parser.

- `scripts/drift-ai/dolos-advisory.ts` — turns a `DolosRunnerResult` (task 41b)
  into a `PrototypeAdvisory`:
  - success rows carry engine name/`@version`, language mode, score-vs-threshold,
    full-file ranges, and overlap/longest-fragment/coverage metrics, with an
    `inspect:` next step;
  - caps surface the file, candidate-pair, reported-pair, and wall-clock-timeout
    bounds plus display truncation; missing line-count sources become a
    `degraded:` line. The wall-clock cap is Dolos-specific — it is the only clone
    subcommand with a real subprocess timeout (the others run in-process);
  - failures use 41b's skip/failure classification, each with one canonical
    disclosure: `tool-unavailable` is an UNMET `dolos engine` prerequisite,
    `timeout` is a HIT wall-clock cap, and `run-failed` is a degradation.
    `timeout`/`run-failed` keep the prerequisite satisfied (Dolos was present).
    Every path exits 0.
- `scripts/drift-ai/dolos-candidates-args.ts` — `--root/--top/--language/`
  `--threshold/--max-files/--max-candidate-pairs/--max-reported-pairs/--dolos-bin`
  plus universal `--format/--output/--config`. Dolos threshold/language are its
  own fragment-overlap scale, deliberately not tied to near-duplicates.
- `scripts/drift-ai/dolos-candidates-command.ts` — `prepareCurrentRun` +
  `nearDuplicateExcludeGlobs` so Dolos sees the same filtered inventory; injects a
  `DolosRunner` for tests. Wired into `runner.ts` (`RunOptions.dolos`,
  `dolos-candidates` case), `cli-args.ts` usage, and the README.

### First advisory baseline (clone corpus)

Recorded by `dolos-advisory.test.ts` "keeps the rendered clone-corpus baseline
aligned with the measured evaluator", using the representative `fixtures/
dolos-report` output mapped onto clone-corpus function ids:

- precision **0.5**, recall **0.2** (1 true positive at 0.98, 1 false positive —
  the `manhattanDistance`/`chebyshevDistance` near-miss at 0.42 — and 4 corpus
  clone pairs the fragment scores leave below the 0.3 threshold).

This stays opt-in and candidate-framed; it does not clear the promotion bar in
`01-shared-context.md` (a labeled/field precision run + clear repair path +
bounded disclosed cost). Dolos remains a prototype lens until a field run shows
acceptable precision on real source.
