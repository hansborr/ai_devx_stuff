# 44b - test/source orphaning prototype

Status: Parked
Track: P
Size: medium
Depends on: 38, 39
Blocks: none

## Goal

Prototype source/test orphaning signals from path conventions and git co-change:
source files that churn without matching test churn.

## Background

This is noisy but useful review evidence. It should stay separate from ownership
metrics so one lens answers "who owns this?" and this one answers "did tests move
with the source?" Import-graph and coverage mapping come later.

## Seams to touch

- `scripts/drift-ai/hotspots-history.ts`
- bounded full-history collector from task 38
- source inventory helpers under `scripts/drift-ai/`
- new prototype lens modules or a separate prototype subcommand
- prototype advisory output from task 39
- `scripts/drift-ai/README.md`

## What to do

1. Add path-convention mapping first, for example `foo.ts` to `foo.test.ts`,
   `foo.spec.ts`, and `__tests__/foo.ts`.
2. Make mapping patterns configurable enough for common package layouts.
3. Emit inferred related-test paths, source churn, test churn, last source/test
   co-change, source-only commit count, and the commits/subjects behind the row.
4. Distinguish "no related test inferred" from "related test inferred but stale."
5. Use the bounded full-history collector from task 38 for caps and truncated
   history disclosure.

## Testing

- Fake git-history fixtures for co-change, source-only churn, renamed/missing
  tests, and cap disclosure.
- Path mapping fixtures for sibling tests and `__tests__` layouts.

## Out of scope

- DOA/ownership metrics; use task 44a.
- Import-graph test mapping.
- Coverage-informed mapping.
- Telling agents to "fix" or delete source rows.
