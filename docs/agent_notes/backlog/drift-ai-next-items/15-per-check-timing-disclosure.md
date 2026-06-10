# 15 - per-check timing and cost disclosure

Status: Done
Track: Dg
Size: small-medium
Depends on: none
Blocks: none

## Implementation notes (done 2026-06-04)

- `scripts/drift-ai/report-builder.ts` now owns the timing: an injectable
  `Clock` seam (`() => number`, default `performance.now()`) is read start+end
  around each dispatched check inside `buildReport`'s loop, including the
  not-implemented and preflight-skip branches, so a skip's cheapness is visible.
  `buildReport` takes the clock as an optional 5th argument; `runner.ts` is
  unchanged and uses the real default.
- `scripts/drift-ai/types.ts`: added optional `DriftReport.checkTimings`
  (`CheckTiming[]`, one `{ check, durationMs }` per dispatched check in run order)
  and `DriftReport.totalDurationMs` (sum of the rounded per-check durations, so
  the total adds up exactly). Durations are whole milliseconds, floored at zero.
- Bumped `DRIFT_SCHEMA_VERSION` 3 -> 4 following the v3 precedent: the fields are
  additive/optional, so a tolerant reader ignores them and a strict reader must
  accept v4. All in-repo consumers pin the symbol, not the literal.
- `scripts/drift-ai/report-format.ts`: text adds a `timing:` line under the
  summary; JSON inserts `checkTimings`/`totalDurationMs` between `summary` and
  `findings`, only when present (a hand-built v3-shaped report still renders).
- Evidence only: timing never gates, sorts, or alters severity/finding order.
- Tests in `scripts/drift-ai.test.ts` use a deterministic `sequenceClock`:
  per-check durations + total in text and JSON, and a skipped-check timing row.
- Left room for the task-11 diagnostics projection to pick up the same per-check
  duration later (optional field, not coupled here).
- README `scripts/drift-ai/README.md` documents the timing fields as evidence.

## Goal

Surface per-check wall-clock in the `drift:ai` report as evidence, so the
default-on vs opt-in decision for each check can be made from cost data rather
than guesswork.

## Background

The check set has grown past a dozen ids plus subcommands, and some adapters are
slow on this monorepo (knip in particular). Nothing in the report shows how long
each check took, so "should this be default-on?" is decided without cost evidence.
This is evidence, not a gate: timing never changes exit code, severity, or finding
order.

## Seams to touch

- `scripts/drift-ai/check-plugin.ts`, if timing belongs in the shared check runner
- `scripts/drift-ai/report-builder.ts` to record elapsed time around each run
- `scripts/drift-ai/types.ts` for an optional per-check duration field
- `scripts/drift-ai/report-format.ts` for text and JSON rendering
- focused tests beside the changed files
- `scripts/drift-ai/README.md`

## What to do

1. Record elapsed wall-clock per check in the shared runner, including for skipped
   checks so a skip's cheapness is visible.
2. Add the duration additively to the report types. If this bumps
   `DRIFT_SCHEMA_VERSION`, follow the v3 precedent deliberately: update
   version-pinning tests/consumers, and document that tolerant readers can ignore
   the optional field but strict readers must accept the new version.
3. Render durations in both text and JSON, plus a run total.
4. Keep it evidence-only: never gate, sort, or alter severity by timing.
5. Use an injectable clock seam so timing is deterministic in tests.
6. Leave room to project the same per-check duration into the task-11 diagnostics
   envelope later, without coupling this task to it.

## Testing

- Faked-clock tests proving durations render in text and JSON and the total adds
  up.
- A skipped-check timing test.

## Out of scope

- A timing budget gate or threshold.
- Historical timing trends (a slow-lane add-on, not this).
- Per-file or per-finding microbenchmarks.
