# 55 - field-run calibration cadence

Status: Done
Track: G
Size: small
Depends on: 15 optional
Blocks: none

## Outcome (2026-06-05)

Added the calibration cadence/template and first focused Musi baseline in
`docs/agent_notes/finished_work/drift-ai-field-run-calibration.md`, linked from
`scripts/drift-ai/README.md`. The baseline command was:

```sh
bun run drift:ai --scope current --root scripts/drift-ai --check duplicates --check ghost-files --check comments --format json
```

It scanned 316 `scripts/drift-ai` files with auto-loaded `drift-ai.config.json`,
reported 0 `duplicates`, 1 `ghost-files`, and 0 `comments` findings, and recorded
per-check timing (`duplicates` 1262ms, `ghost-files` 215ms, `comments` 1ms,
1478ms total).

Manual review classified the lone `ghost-files` row
(`env-define-evaluation.ts` <-> `env-define-evaluator.ts`) as an intentional
role split from task 43a, not a true suspicious sibling. Filed the parked tuning
follow-up at `docs/agent_notes/backlog/drift-ai-ghost-files-agent-noun-pairs.md`.

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
