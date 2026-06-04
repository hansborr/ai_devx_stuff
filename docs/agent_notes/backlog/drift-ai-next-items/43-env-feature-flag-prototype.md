# 43 - env and feature-flag advisory integration

Status: Parked
Track: P
Size: small-medium
Depends on: 39, 43a
Blocks: none

## Goal

Expose the task-43a env/define evaluator through prototype advisory output for
stale-branch review candidates.

## Background

The brainstorm recommends a generic env matrix first and provider metadata
later. Task 43a isolates the risky inventory/evaluator work. This task is the
user-facing slice: render explicit, matrix-backed branch predictions as
advisory candidates, not findings.

## Seams to touch

- env/define evaluator from task 43a
- `scripts/drift-ai/` prototype advisory modules or chosen subcommand
- `scripts/drift-ai/config.ts` only for exposing task-43a assumptions if not
  already done there
- prototype advisory output from task 39
- `scripts/drift-ai/README.md`

## What to do

1. Choose the smallest CLI surface that makes the env/define matrix explicit to
   the operator.
2. Reuse the task-43a evaluator; do not re-derive AST or expression logic here.
3. Emit the condition, assumed value source, predicted dead/alive branch, and
   whether a bundler/minifier would be expected to erase it.
4. Keep provider-specific systems like LaunchDarkly, Unleash, Piranha, and
   Harness cleanup as follow-ups unless metadata is supplied explicitly.
5. Route rows through the prototype advisory contract from task 39. Label them as
   candidates, not defects, and do not emit `DriftFinding` warnings.

## Testing

- Advisory rendering tests for predicted-live, predicted-dead, unknown, and
  no-config skip/candidate behavior.
- CLI smoke with a fixture-backed evaluator.

## Out of scope

- Calling hosted flag APIs.
- Mutating source or deleting branches.
- Default-on findings.
