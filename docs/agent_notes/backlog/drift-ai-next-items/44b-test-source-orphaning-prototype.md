# 44b - test/source orphaning prototype

Status: Done
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

## Notes

Implemented `bun run drift:ai test-orphaning` as a prototype advisory subcommand,
sibling to task 44a's `ownership`. It reuses the task-38 bounded full-history
collector and the task-39 prototype advisory contract; the ownership/DOA question
stays in 44a and this lens answers "did the tests move with the source?"

Path-convention mapping lives in `test-orphaning-mapping.ts`: `{dir}/{name}/{ext}`
templates expand a source into candidate test paths, with sibling `*.test`/`*.spec`
and `__tests__/` defaults plus repeatable `--test-pattern` (must include `{name}`).
`isTestPath`/`parseSourceParts` exclude test files, `.d.ts` declarations, and
non-code paths from the source set by exact directory-segment match.

Output splits into two advisory sections so requirement #4 is visible structurally
rather than as a row field: "source files with no inferred test" and "source files
whose tests lag source churn". Rows emit inferred test paths, source/test churn,
last source/test/co-change dates, source-only commit count, source commits since
the last co-change, an `orphanScore` (`sourceOnlyCommits / sourceChurn`), recent
subjects, and a `git log --oneline -- <source> <tests>` inspect command. A source
whose tests co-changed every time appears in neither section. `--min-source-commits`
(default 2) is the churn floor. Bounded-history caps, scanned range, rename caveat,
mapping patterns, and the filter floor are all disclosed in text and JSON.

Known limitation (intentional, see Out of scope): detection is path-convention
only, so a source tested through the import graph rather than a sibling file (e.g.
`scripts/drift-ai/runner.ts`, covered by per-subcommand command tests) reads as
"no inferred test". The candidate framing and evidence shape make these leads, not
verdicts. Import-graph and coverage-informed mapping remain future work.

Files: `test-orphaning-{types,mapping,analysis,format,advisory,args,command}.ts`
plus `test-orphaning-{mapping,advisory,command}.test.ts`; wired into `runner.ts`
`runPrototypeSubcommand`; documented in `scripts/drift-ai/README.md`.
