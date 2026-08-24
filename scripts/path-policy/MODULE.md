# path-policy module

Concepts: fixture copy sets, sandbox closure, smoke subjects, changed-file path policy

## Purpose

This directory owns three harness concerns: changed-file classification, smoke
subject selection, and static analysis of the copy sets assembled
by hand-written smoke tests.

It does not own the manifest closure validator in
[`scripts/harness/fixture-closure-check.ts`](../harness/fixture-closure-check.ts).
That validator compares declared generated-surface paths with import closure;
this directory reads smoke-test shell and does not update
`harness.controls.json`.

## Data Flow

The query entry reads `PATH_POLICY` and the generated smoke-subject map to answer
changed-file classification requests. Both query selection and generator
discovery use the distinct basename and repo-path predicates plus path
normalization owned by `smoke-test-files.ts`. Its `single-segment-glob`
selectors use the star-only matcher documented in
[`segment-pattern.ts`](./segment-pattern.ts). The generator takes the other
direction: `projectSmokeSubjectOutputs` first runs the fixture analyzer as a
precondition, then parses smoke headers and projects the two generated subject
artifacts.

Within that precondition, scoped shell input is resolved through helper calls,
loop bindings, copy expressions, and seed statements; those contributions form
the sandbox model, with seeding annotations applied during its construction.
Copy expressions and loop bindings share the fixture glob-shape predicate, and
literal basename expansion delegates to the shell-oriented compiler in
[`segment-pattern.ts`](./segment-pattern.ts).
The completed model feeds smoke metadata and both closure checks: shell-source
groups are derived from direct `.sh` copies into each sandbox's `scripts/`
tree, while static-import closure consumes the broader sandbox facts. The
sequencing, composition, and diagnostic-order contract remains in
[`fixture-sandbox-model.ts`](./fixture-sandbox-model.ts), and the analyzer's
enforcement axes and exclusions remain documented in
[`fixture-shell-dependencies.ts`](./fixture-shell-dependencies.ts), while the
annotation vocabulary remains at
[`fixture-seeding-annotations.ts`](./fixture-seeding-annotations.ts).

## External Entry Points

- `scripts/path-policy/path-policy-query.ts` is the command entry used by gate
  and verification wrappers.
- `bun run test:scripts:subjects` and `bun run test:scripts:subjects:check` write
  or check the smoke-subject outputs through `generate-smoke-subjects.ts`.
- `bun run harness:skills:refresh` and `bun run harness:skills:check` project the
  same outputs with generated smoke-source overrides through
  [`generate-skill-artifacts.ts`](../harness/generate-skill-artifacts.ts).
- `validateFixtureShellDependencies` in
  [`fixture-shell-dependencies.ts`](./fixture-shell-dependencies.ts) is the
  fixture analyzer's sole external API. Its precondition call lives in
  [`smoke-subject-headers.ts`](./smoke-subject-headers.ts).

The remaining `fixture-*.ts` exports are internal seams. A new imported module
must also be represented in the relevant generated-surface `triggerPaths` and
will be derived into the fixture copy projection; only non-import runtime files
belong in reasoned `fixtureExtras` records in `harness.controls.json`.

## State Ownership

The fixture analyzer owns no persistent state or output artifact; it reports
copy-set drift by throwing. The subject-map side owns the generated
`path-policy-smoke-subjects-data.ts` and
`scripts/fixtures/test-scripts/all-smoke-tests.txt` outputs projected by
`smoke-subject-headers.ts`.

## Test Seams

- `fixture-shell-dependencies.test.ts` covers the analyzer boundary, including
  shell and import closure.
- `fixture-helper-calls.test.ts` covers helper-call composition directly.
- `segment-pattern.test.ts` pins the shared segment-pattern dialect contracts.
- `smoke-test-files.test.ts` pins both smoke-file meanings and path normalization.
- `smoke-subject-headers.test.ts`, `path-policy-query.test.ts`, and
  `path-policy.test.ts` cover subject generation and changed-file policy.
- Run a focused file with `bun run test:scripts:file -- <file>`; generated
  subject drift is checked with `bun run test:scripts:subjects:check`.

## Gotchas

- The supported sandbox seeding forms and scope-plus-root keying rule are source
  contracts in [`fixture-sandbox-model.ts`](./fixture-sandbox-model.ts); keep
  changes aligned with that header.
- The `# fixture-closure:` annotation vocabulary, placement rules, and stale
  annotation failure are defined in
  [`fixture-seeding-annotations.ts`](./fixture-seeding-annotations.ts).
- Entry selection has a deliberate path-based blind spot documented, with its
  live example, in [`fixture-import-closure.ts`](./fixture-import-closure.ts).
- Changed-file selectors and fixture shell analysis intentionally use different
  segment-pattern dialects. Read [`segment-pattern.ts`](./segment-pattern.ts)
  before changing either language; fixture brackets remain a JavaScript RegExp
  approximation rather than exact shell semantics.
- `scripts/path-policy/` feeds changed-file classification for
  `verify:changed` and pre-commit. Run `bun run harness:check` before committing
  changes here.
