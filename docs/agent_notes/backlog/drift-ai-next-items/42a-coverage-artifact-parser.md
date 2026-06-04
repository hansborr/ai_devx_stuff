# 42a - coverage artifact parser and labels

Status: Parked
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
