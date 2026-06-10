# 42b - coverage and unused-export correlation

Status: Done
Track: P
Size: medium
Depends on: 39, 40b, 42a, 42c
Blocks: none

## Goal

Overlay parsed coverage evidence onto static `unused-exports` reachability rows
without running tests by default.

## Background

Static reachability and runtime coverage answer different questions. A symbol can
be statically referenced but unexecuted in a run, or statically unreferenced but
covered through dynamic behavior. This task adds the correlation only after task
42a has a parser and labeled artifact evidence, and task 42c has proven the
standalone advisory rendering route.

## Seams to touch

- coverage parser output from task 42a
- coverage advisory rendering precedent from task 42c
- dead-code FP-trap corpus from task 40b
- `scripts/drift-ai/knip-unused-exports.ts`
- `scripts/drift-ai/knip-unused-exports-check.ts`
- prototype advisory output from task 39
- `scripts/drift-ai/README.md`

## What to do

1. Match coverage file/range/function evidence to `unused-exports` rows where
   location data is available.
2. Emit static category, static provenance, artifact label/path, hit count, and
   whether coverage was absent, present, or unavailable for that symbol/range.
3. Keep "uncovered" and "unused" separate in the text. The row is stronger
   evidence when both agree, not a deletion verdict.
4. Preserve per-artifact distinctions. Do not silently union unit/e2e/prod
   coverage into one bitmap.
5. Disclose unmatched symbols, missing locations, source-map mismatch, and parser
   limitations.
6. Calibrate against the dead-code FP-trap corpus so barrel, dynamic-import,
   test-only, framework-entry, and reflection cases stay visibly caveated.

## Testing

- Overlay tests with reachable/unreachable and covered/uncovered combinations.
- Fixture tests for multiple artifact labels and missing location metadata.
- Regression tests that covered dynamic usage does not get called dead.

## Out of scope

- Running tests or coverage commands.
- Coverage gates or score thresholds.
- Reimplementing static reachability beyond the live `unused-exports` adapter.

## Implementation notes (done 2026-06-04)

Shipped as the `coverage-unused-exports` prototype-lane advisory subcommand.

**Design fork resolved: consume-don't-run on both inputs.** Coverage already had
to be supplied as an artifact (42a/42c), so rather than re-wire knip's
config-discovery / install-detection / skip machinery into a non-CheckPlugin
subcommand, the static half is also supplied: the operator runs
`knip --reporter json --include exports,types,enumMembers,namespaceMembers` and
passes the file via `--unused-exports-report <path>`. The subcommand REUSES the
live adapter's parser (`parseKnipUnusedExports`) — no new reachability engine — so
"reimplementing static reachability" stays out of scope. This keeps the whole
surface pure IO + a pure correlation core (no subprocess, fully deterministic
tests). Running knip live remains a possible future enhancement if maintainers
want an out-of-the-box surface.

New modules under `scripts/drift-ai/`:

- `coverage-unused-correlation.ts` — pure core. `correlateCoverageUnusedExports`
  overlays each `UnusedExportSymbol` onto each `CoverageArtifactEvidence`. Per
  artifact it produces a `covered` / `uncovered` / `unavailable` state (matched by
  exact path, then a unique `/`-boundary path-suffix fallback for source-map
  mismatch, then function-decl-line / function-range / DA-line matching). Runs are
  **never unioned**: the row keeps a per-artifact array and a cross-artifact
  agreement summary (`covered-but-unused` = the strongest static-FP lead,
  `uncovered-and-unused` = both signals agree, `coverage-unavailable`). Every row
  carries `CORRELATION_STANDING_CAVEAT`, which enumerates the task-40b trap
  families so a row never reads as a deletion verdict. An optional
  `caveatLabeler` seam lets the corpus test attach trap labels.
- `coverage-unused-correlation-advisory.ts` — builds/formats the task-39 prototype
  advisory (`kind: "advisory"`, `lane: "prototype"`, no `findings`, no WARN/FIX).
  Discloses report/coverage prerequisites, the `--top` display cap, and
  degradations (missing locations, unmatched files, suffix matches, lcov-only/
  line-only precision, coverage parse notes).
- `coverage-unused-correlation-args.ts` / `coverage-unused-correlation-command.ts`
  — `--unused-exports-report`, `--top`, `--config`, `--format`, `--output`;
  resolves repo root, loads config, reads `coverage.artifacts`, reads+parses the
  knip report (absent / unreadable / parse-failed are disclosed report statuses,
  not errors), correlates, renders.
- Wired into `runner.ts` as a non-`--check all` subcommand.

Fixture: `fixtures/unused-exports/knip-report.json` (references the
`fixtures/coverage/**` source paths). Tests:
`coverage-unused-correlation.test.ts` (full state matrix, per-artifact distinction,
missing location, suffix match, ordering/stats, and a task-40b corpus calibration
that proves trap labels survive and no row collapses a trap into deadness),
`coverage-unused-correlation-advisory.test.ts` (envelope/firewall, prerequisites,
caps, degradations, row text), `coverage-unused-correlation-command.test.ts` (CLI
smoke through `runDriftAi` with the fixtures).

Verification:

- `bunx vitest run scripts/drift-ai/coverage-unused-correlation.test.ts scripts/drift-ai/coverage-unused-correlation-advisory.test.ts scripts/drift-ai/coverage-unused-correlation-command.test.ts --config scripts/vitest.config.ts`
- `bunx tsc -p tsconfig.scripts.json --noEmit`
- `bun run lint:ratchet` (0 regressions) and ESLint on the new modules
- `bun scripts/drift-ai.ts coverage-unused-exports --config <fixture> --unused-exports-report fixtures/unused-exports/knip-report.json`

README and `lint-coverage-map.md` document the subcommand and register the new
modules/fixture. Stays prototype-lane (opt-in, advisory-shaped); no promotion to a
check id without field-precision evidence.
