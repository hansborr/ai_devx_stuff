# 55 - field-run calibration cadence

Status: Parked
Track: G
Size: small
Depends on: 15 optional
Blocks: none

## Goal

Add a repeatable field-run calibration note/template for `drift:ai` checks so
default-on and promotion decisions use recorded precision/noise/cost evidence.

## Background

The shared context already says prototype lenses graduate only with evidence, but
there is no small task that captures that evidence in a consistent format. The
current-scope ghost-files noise in task 33 is an example: field reports are what
separate useful detector tuning from speculative thresholds.

This is useful even before task 15 adds per-check timing. If task 15 has landed,
include timing in the calibration record; otherwise record wall-clock manually or
leave cost as qualitative.

## Seams to touch

- a template or example under `docs/agent_notes/finished_work/` or
  `docs/agent_notes/backlog/drift-ai-next-items/`
- `scripts/drift-ai/README.md`, only if documenting the cadence is useful for
  operators
- no code unless the implementer adds a tiny helper script after finding a real
  repeated need

## What to do

1. Define a short calibration record format:
   - command, repo/commit, date, config source, scope, checks, and roots;
   - findings by check;
   - manually reviewed true/false/uncertain counts where sampled;
   - top false-positive classes;
   - cost/timing if available;
   - recommended action: keep opt-in, tune, promote, demote, or split follow-up.
2. Run at least one baseline against Musi current scope with a focused command
   that avoids making slow whole-repo knip the only proof.
3. Link any new detector-tuning follow-ups back to the calibration record.
4. Keep the task docs-only unless a repeated mechanical step clearly deserves a
   helper.

## Testing

- Docs-only: `git diff --check`.
- If a helper script is added, add focused script tests.

## Out of scope

- Promoting any check to default-on in the same task.
- Running hosted/private-code scans.
- Creating a dashboard.
