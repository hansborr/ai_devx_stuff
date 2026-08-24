# 152. Separate the reusable path-policy query engine from Musi's generated smoke registry

Status: Not started
Theme: portable policy query engine · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The path-policy query core looks like a reusable policy evaluator, but it is
closed over Musi's concrete `PATH_POLICY`, filesystem-backed smoke discovery,
and generated smoke-subject registry. Importing the core for any query therefore
loads repository-specific policy and smoke data even though only two of its 22
query names consume smoke-registry and discovery data.

The generated-registry dependency is transitive, not direct. `PATH_POLICY`
embeds the registry as policy data, while the smoke-name module imports the same
registry and scans `scripts/tests` at module initialization. Merely injecting
`SCRIPT_SMOKE_TEST_NAMES`, or memoizing its current constant, would leave the
policy-side registry edge intact.

This coupling makes the apparent engine/data boundary unsuitable for reuse in
another harness. It also gives non-smoke callers an unnecessary generated-data
and filesystem-discovery dependency, and forces tests of discovery behavior to
change the process working directory and reload modules.

The smoke metadata boundary also has two correctness owners. Header generation
and fixture validation parse the same `# smoke-subjects:` syntax independently,
while changed-mode selection and fixture coverage separately implement the same
exact-path-or-trailing-slash-directory match. A syntax or normalization change
can therefore let fixture validation approve metadata that the query engine
interprets differently, undermining the check intended to prove that a copied
fixture input selects its smoke.

## Evidence

- `scripts/path-policy/path-policy-query-core.ts:1-3` imports the concrete
  `PATH_POLICY` and import-time `SCRIPT_SMOKE_TEST_NAMES`; only the
  `smoke-test-files.ts` predicates are policy-neutral.
- `scripts/path-policy/path-policy-query-core.ts:5-28` declares 22 query names.
  The exact commands
  `sed -n '5,28p' scripts/path-policy/path-policy-query-core.ts | rg -c '^  "'`
  and
  `rg -c '^  ("script-smoke-test-names"|"script-smoke-tests"):' scripts/path-policy/path-policy-query-core.ts`
  return 22 query names and 2 smoke-data-consuming handlers, respectively.
  `deletion-class:script-smoke-sensitive` is smoke-related but uses only policy
  selectors.
- `scripts/path-policy/path-policy-query-core.ts:125-129` privately implements
  normalized exact-path and trailing-slash-prefix smoke-subject matching.
- `scripts/path-policy/path-policy-query-core.ts:133-153` reads smoke subjects
  from `PATH_POLICY`, iterates the discovered names, and performs the
  `test-harness-check` freshness-name check; `:159-202` eagerly constructs every
  handler around the concrete policy.
- `scripts/path-policy/path-policy.ts:10-13,68-70,244-246` imports the generated
  registry and embeds it in both the `PathPolicy` type and `PATH_POLICY`, forming
  one transitive registry edge into the query core.
- `scripts/path-policy/path-policy-smoke-subjects.ts:1-22` forms the second
  transitive edge: it imports the generated registry, resolves
  `process.cwd()/scripts/tests`, calls `readdirSync`, and exports the result of
  discovery immediately at module initialization.
- `scripts/path-policy/path-policy-smoke-subjects-data.ts:1-5` identifies the
  registry as generated and currently declares its own `ScriptSmokeSubjects`
  type. The exact commands
  `wc -l scripts/path-policy/path-policy-smoke-subjects-data.ts` and
  `rg -c '^  "[^"]+": \[$' scripts/path-policy/path-policy-smoke-subjects-data.ts`
  return 913 physical lines and 53 top-level subject entries at the audit pin.
- `scripts/path-policy/smoke-subject-headers.ts:33-49` — the generator owns
  subject tokenization plus non-empty and repo-relative POSIX validation.
- `scripts/path-policy/fixture-shell-dependencies.ts:40-42` — fixture
  validation declares its own smoke-subject header regex rather than consuming
  the generator's parser.
- `scripts/path-policy/fixture-shell-dependencies.ts:106-111` — fixture
  validation independently tokenizes smoke subjects with weaker validation.
- `scripts/path-policy/fixture-shell-dependencies.ts:151-161` — fixture
  coverage hand-copies the query selector's exact-or-directory semantics and
  claims parity in a comment without sharing the implementation.
- `scripts/path-policy/path-policy.test.ts:301-325` explains and implements the
  current `process.chdir` plus `vi.resetModules` choreography needed to rerun
  module-private, import-time discovery; `:338-377` pins curated order, dropping
  undiscovered curated names, sorted extras, and deduplication.
- `scripts/path-policy/path-policy-query.ts:3-9` imports the core's public
  exports, while `scripts/format-changed.sh:9`,
  `scripts/test-scripts.sh:70`, and
  `scripts/lib/verify-metadata.sh:483-501` consume the CLI entrypoint. These are
  compatibility boundaries for the split.
- `scripts/path-policy/MODULE.md:52-54` requires every newly imported module to
  appear in the relevant generated-surface `triggerPaths` and `fixturePaths`;
  `:85-87` records that this directory feeds changed-file classification for
  the commit gate.

## Proposed direction

1. Extract `scripts/path-policy/path-policy-query-engine.ts` as a pure engine
   containing selector matching, query-name handling, the 22 handlers, and the
   parse/format helpers. Give it a factory such as
   `createPathPolicyQueryHandlers({ policy, smokeTestNames, smokeSubjects })`,
   with smoke dependencies supplied as lazy providers. Its only local runtime
   dependency should be the pure predicates in `smoke-test-files.ts`; its
   query-facing policy and structural smoke-subject types must not require a
   Musi module. Document the copy contract plainly: bring a `PathPolicy` value
   and smoke providers; the engine has zero Musi imports.

   At the same boundary, make smoke-subject parsing and matching shared
   vocabulary in the policy-neutral `smoke-test-files.ts` surface. Export one
   line parser that distinguishes non-header lines from `# smoke-subjects:`
   lines and returns their tokens, plus one matcher that normalizes comparable
   paths and applies the exact-or-trailing-slash-directory rule. The generator,
   fixture validator, and extracted query engine must consume those functions
   rather than retain private regex/tokenization or prefix implementations.
   Keep the generator's source-path, line-number, non-empty, and repo-relative
   POSIX diagnostics as its stronger layer above the neutral parser.

2. Cut both registry edges. Remove `scriptSmoke.subjects` from `PathPolicy` and
   `PATH_POLICY` in `path-policy.ts`. Move
   `ScriptSmokeSubjects = Readonly<Record<string, readonly string[]>>` to a
   non-generated module and change the emitter in
   `smoke-subject-headers.ts:138-156` so the generated registry satisfies that
   type instead of owning it. Do not hand-edit
   `path-policy-smoke-subjects-data.ts`; regenerate it with
   `bun run test:scripts:subjects` and check it with
   `bun run test:scripts:subjects:check`.

3. Land this leaf after H15 and keep `path-policy-query-core.ts` as the thin
   Musi adapter. It must re-export the exact current API—
   `PATH_POLICY_QUERY_NAMES`, `isPathPolicyQueryName`, `queryPathPolicy`,
   `parsePathPolicyInput`, and `formatPathPolicyOutput`—while wiring the engine
   to `PATH_POLICY`, the smoke-subject registry, and the memoized smoke-name
   provider H15 lands. Do not replace H15's discovery seam with a
   directory-parameterized function here. Preserve the current ordering and
   fallback contract: curated names first, undiscovered curated names dropped,
   extras appended in sorted order, and all curated subject names returned when
   the tests directory is absent.

4. Add engine-level tests using injected policy and smoke values while retaining
   the CLI compatibility coverage. Add parser and matcher cases for whitespace,
   non-header lines, exact files, normalized paths, trailing-slash directories,
   and false sibling-prefix matches; retain generator-specific diagnostic tests
   and fixture-selection parity cases. Refresh `scripts/path-policy/MODULE.md`,
   regenerate smoke subjects because the new engine joins the CLI import
   closure, and update every applicable `harness.controls.json`
   `triggerPaths`/`fixturePaths` entry. The focused validation surface is
   `bun run test:scripts:file -- scripts/path-policy/path-policy-query.test.ts`,
   `bun run test:scripts:file -- scripts/path-policy/path-policy.test.ts`,
   `bun run test:scripts:file -- scripts/path-policy/smoke-test-files.test.ts scripts/path-policy/smoke-subject-headers.test.ts scripts/path-policy/fixture-shell-dependencies.test.ts`,
   `bash scripts/tests/test-test-scripts.sh`,
   `bash scripts/tests/test-harness-check.sh`, and `bun run harness:check`.

## Scope / caveats

- This is a dependency and ownership refactor, not a change to selectors, query
  names, query results, CLI framing, subject syntax, path normalization, or the
  shell consumers of `path-policy-query.ts`.
- This leaf must follow, not supersede, H15 in
  [HARNESS-CLUSTER-PLAN.md](../code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md).
  H15 owns lazy/memoized discovery and remains Open and blocked on 27-PLAN slice
  27.3. Once H15 lands, consume its provider without revisiting that discovery
  API. H15's dead `directoryPrefixSubjects.sourceRelevant`, duplicated
  excluded-directory data, and `matchesFormatCheckCandidate` decision remain
  outside this leaf; H15 itself should update the status text in
  [31-harness-shared-helpers.md](../code-quality-2026-07-25/31-harness-shared-helpers.md),
  [49-path-policy-fixture-analyzer.md](../code-quality-2026-07-25/49-path-policy-fixture-analyzer.md),
  and [00-index.md](../code-quality-2026-07-25/00-index.md).
- The separate discovery-test-choreography cleanup has no authored leaf in this
  pack. If revived independently, land it first or in the same lane and reuse
  its directory-parameterized discovery function as this engine's provider;
  otherwise leave that test-only rewrite out of this leaf.
- Fixture work is limited to replacing the validator's duplicate
  smoke-subject parser and matcher with the shared vocabulary.
  [151-fixture-copies-parsed-grouped-two.md](./151-fixture-copies-parsed-grouped-two.md)
  owns the broader fixture copy-model rewrite; do not absorb its parsing,
  grouping, or copy-closure changes here.
- `CQ25-119` in
  [code-quality-2026-07-25/31-harness-shared-helpers.md](../code-quality-2026-07-25/31-harness-shared-helpers.md)
  centralized smoke-file predicates and path normalization. It did not
  centralize smoke-subject header parsing or subject matching; preserve its
  distinct smoke-test filename semantics while extending the shared vocabulary.
- Do not fold in broader smoke-test choreography or discovery-test rewrites.
  The injected discovery seam may support that work later without making it
  part of this change.
- Path-policy queries feed changed-scope lint, test selection, and smoke
  dispatch. Preserve direct-before-extra ordering and every predicate exactly:
  drift here can false-green the gate rather than failing locally.
- Treat generated-surface registration as mandatory. A missing engine or shared
  vocabulary path can leave smoke coverage stale even when the TypeScript
  refactor itself is correct.
