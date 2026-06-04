# 15 - per-check timing and cost disclosure

Status: Parked
Track: Dg
Size: small-medium
Depends on: none
Blocks: none

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
