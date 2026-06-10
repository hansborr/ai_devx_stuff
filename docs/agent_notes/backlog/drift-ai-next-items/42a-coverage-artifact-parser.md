# 42a - coverage artifact parser and labels

Status: Done
Track: P
Size: small-medium
Depends on: none
Blocks: 42b, 42c

## Goal

Parse one coverage artifact format into structured, labeled evidence without
running tests, emitting advisory output, or correlating to static reachability.

## Background

Coverage artifacts answer "was this range executed in this run?", not "is this
code dead?" The original task bundled parser/config work with standalone
advisory rendering. Keep this first slice library/test-only so the format and
labels are solid before any user-facing output or static reachability overlay is
added.

## Seams to touch

- new `scripts/drift-ai/coverage-*.ts` parser modules
- `scripts/drift-ai/config.ts` and config parsing for artifact paths/labels
- focused parser/config tests

## What to do

1. Consume artifacts by default; do not run coverage commands implicitly.
2. Support one artifact format first, likely `coverage-final.json` or `lcov.info`.
3. Let config label artifact sources, for example unit/e2e/smoke/prod.
4. Do not merge artifact sources silently; return per-artifact evidence.
5. Return artifact path, configured label, timestamp if available, file/range or
   function, hit count, parser format, and parse/degradation notes.
6. Keep deterministic ordering and explicit parse-failure records so later
   renderers can disclose partial evidence.
7. Do not register a check id, subcommand, or advisory output in this task.

## Testing

- Fixture parser tests for the chosen artifact format.
- Config parsing tests for artifact paths and labels.
- Tests for multiple artifacts, parse failures, deterministic ordering, and
  per-artifact separation.

## Out of scope

- Running tests or coverage commands.
- CLI/report output; use task 42c.
- Correlating coverage with `unused-exports`.
- Treating uncovered code as dead.
- Coverage gates or score thresholds.

## Implementation notes (done 2026-06-04)

Library/test-only slice, no check id / subcommand / advisory output (those are
42c). Format chosen first: **lcov (`.info`)** - line-oriented, stable, and the
format Bun emits natively (`bun test --coverage --coverage-reporter=lcov`).
Istanbul `coverage-final.json` is intentionally deferred.

New modules under `scripts/drift-ai/`:

- `coverage-types.ts` - evidence shape: `CoverageArtifactEvidence` (per-artifact,
  never merged) -> `CoverageFileEvidence` -> per-function (name/line/optional
  endLine/hits) and per-line (line/hits) evidence, plus LF/LH/FNF/FNH summary
  counts and `CoverageParseNote` degradation records.
- `coverage-lcov.ts` / `coverage-lcov-values.ts` - `parseLcov(content)`. Parses
  SF/FN/FNDA/DA + summary records; records (does not throw on)
  malformed/out-of-order records, missing `end_of_record`, empty SF,
  FNDA-without-FN, invalid numeric domains, and duplicate name-based function
  declarations. Branch records (BRDA/BRF/BRH) and TN are recognized and skipped.
  Deterministic ordering: files by path, functions by line then name, lines by
  line; notes in encounter order. Three-field `FN:<start>,<end>,<name>` captures
  a function range (`endLine`). Summary counts use the artifact's own
  LF/LH/FNF/FNH when present, else derive from records.
- `coverage-artifacts.ts` - `detectCoverageFormat` (`.info` -> lcov),
  `buildCoverageArtifactEvidence` (pure: routes by format, handles
  empty/unsupported), and `readCoverageArtifacts` (the consume-don't-run IO
  boundary: resolves paths under repo root, stats for an ISO mtime timestamp,
  reads, records read failures as evidence, preserves config order, no merging).
- `coverage-config.ts` - `parseCoverageConfig`. Parses the new top-level
  `coverage` config block (`{ artifacts: [{ path, label }] }`); labels are free
  text (unit/e2e/smoke/prod); paths are normalized but not containment-checked
  (a CI artifact may live outside the repo, and it is read, never written).

Config wiring: `DriftAiCoverageConfig`/`DriftAiCoverageArtifactConfig` types in
`config.ts`, `coverage` field on `DriftAiConfig`, default `{ artifacts: [] }` in
`config-defaults.ts`, parse + allowed-key in `config-parsing.ts`.

Tests: `coverage-lcov.test.ts`, `coverage-artifacts.test.ts`,
`coverage-config.test.ts`; fixtures under `fixtures/coverage/*.lcov.info`
(`unit`, `e2e`, `malformed`). The example/README and 42c will surface this once
the advisory surface exists. `.info` fixtures are outside the coverage-map
tracked-extension scope; the 8 `.ts` modules are registered there as a single
prototype-lane row.
