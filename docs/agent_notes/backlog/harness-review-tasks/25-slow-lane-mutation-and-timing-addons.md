# 25 - Slow-lane mutation and timing add-ons

Status: Parked
Track: Dg (diagnostics)
Size: medium
Depends on: 24
Blocks: none

## Goal

Extend the scheduled slow lane with optional timing summaries and mutation-test
signal, still report-only.

## Background

The basic lane should prove artifact value before collecting more expensive
evidence. Once task 24 is stable, timing trends and mutation-test summaries can
help spot slow drift and weak tests without making the main verification loop
heavier.

## Seams to touch

- The scheduled harness-audit workflow from task 24
- `scripts/harness-audit.ts`, if it should aggregate the new data
- `docs/ai-harness.md`
- `docs/agent_notes/backlog/mutation-testing-stryker.md`, if mutation testing
  is still the canonical deferred plan

## What to do

1. Add elapsed-time capture for each slow-lane command and include it in the
   artifact.
2. Add a mutation-test step only if the repo has a stable command by then; if
   not, leave a documented placeholder tied to the mutation-testing backlog.
3. Ensure expensive steps have explicit timeouts and are easy to disable.
4. Render timing and mutation data as trend evidence, not pass/fail verdicts.
5. Keep the workflow artifact bounded so a bad run does not flood the UI.

## Testing

- Run the slow-lane command locally with timing enabled.
- If mutation testing is wired, run the smallest supported mutation scope and
  document the expected runtime.
- Validate the workflow syntax after edits.

## Out of scope

- Mutation score gates.
- Adding mutation testing to `verify`, pre-commit, or Stop hooks.
- Historical trend storage beyond the single workflow artifact.
