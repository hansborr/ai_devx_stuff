# 245. Reject empty fixture and smoke discovery sets

Status: Landed on fix/cq-245
Theme: Require fixture and smoke discovery to reject empty subject sets · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Two discovery-backed gates interpret an empty subject population as success.
An emptied codemod fixture directory supplies no rows to `it.each`, silently
removing that codemod's regression cases. A missing or empty smoke-test tree
similarly produces no definitions, after which the generator can project
authoritative artifacts containing no registered smoke tests.

In both paths, green output can mean only that discovery found nothing. That
makes accidental directory removal or generator misconfiguration
indistinguishable from every discovered subject passing.

## Evidence

- `scripts/codemods/lib/fixture-runner.test-helper.ts:68-72` —
  `enumerateFixtures` returns the sorted child-directory names without
  asserting that the result contains a fixture.
- `scripts/codemods/concurrency-guard.test.ts:56-58,82-85` — a representative
  suite passes the enumerated names directly to `it.each`, so an empty array
  registers no fixture cases.
- `scripts/codemods` — measured with
  `rg -l 'enumerateFixtures\(' scripts/codemods --glob '*.test.ts' | wc -l`,
  which returned 4 test files. The callers are concurrency-guard,
  expand-barrel, structured-logging-fix, and the two-kind tRPC shared-schema
  suite.
- `scripts/path-policy/smoke-subject-headers.ts:28-30` — smoke discovery
  returns an empty array when `scripts/tests` is missing and also returns an
  empty array when the directory exists but contains no matching smoke files.
- `scripts/path-policy/smoke-subject-headers.ts:122-131` — collection parses
  discovered files and checks order uniqueness, but it has no non-empty
  precondition for the definition population.
- `scripts/path-policy/smoke-subject-headers.ts:167-180` — the collected
  definitions flow into both the generated TypeScript registry and the
  all-smoke-tests fixture.

## Proposed direction

Add two owner-local preconditions with subject-specific diagnostics:

1. In `enumerateFixtures`, collect and sort the child directories, then throw
   when the result is empty. Include the fixture root in the error and explain
   that an empty fixture population would make the consuming `it.each`
   vacuous. This one boundary protects all four codemod test files, including
   each tRPC fixture kind independently.
2. In `collectSmokeSubjectDefinitions`, reject zero definitions before order
   validation or output rendering. Distinguish a missing `scripts/tests` tree
   from an existing tree with no matching smoke scripts so each failure points
   to the actual ownership problem.

Add focused script tests around the boundaries. A fixture-runner helper test
should create an empty directory and assert the local diagnostic, while
retaining a positive case for sorted non-empty discovery. Extend
`smoke-subject-headers.test.ts` with separate missing-tree and empty-tree cases
and keep its existing valid-definition and per-file validation cases intact.
The tests should assert useful error text, not only that some exception was
raised.

## Scope / caveats

- Keep the diagnostics and their rationale beside the two scanners. Do not
  introduce a shared `expectDiscovered`, assertion library, manifest, or
  generalized discovery framework.
- Reconfirm at implementation time that no companion check already forces
  either exact population to be non-empty. A guard elsewhere over a different
  fixture corpus or generated artifact is not a substitute for a precondition
  at these discovery boundaries.
- Do not change fixture ordering, metadata parsing, `it.each` case behavior,
  smoke-header validation, generated output formats, or write/check-mode
  behavior. Only empty discovery changes from success to failure.
- Do not work concurrently in
  `fixture-runner.test-helper.ts` with
  [167-codemod-fixtures-duplicate-identical-before.md](./167-codemod-fixtures-duplicate-identical-before.md),
  which changes expected-directory semantics in the same helper but does not
  own discovery non-vacuity.
- [code-quality-2026-07-25/CONSTRAINTS.md](../code-quality-2026-07-25/CONSTRAINTS.md)
  (CQ25-106) already requires scanning guards to assert that they discovered
  subjects. This leaf applies that standing rule to two populations outside
  the completed lint-guard sweep.
- [code-quality-2026-07-25/65-vacuous-scanning-guards.md](../code-quality-2026-07-25/65-vacuous-scanning-guards.md)
  (CQ25-215) deliberately kept each guard's reason local and rejected a shared
  assertion helper. That remedy remains binding; only these two missing local
  preconditions are residual work.
