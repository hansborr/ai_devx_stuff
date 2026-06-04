# 41c - Dolos advisory integration

Status: Parked
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
