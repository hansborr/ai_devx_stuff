# 152. Separate the reusable path-policy query engine from Musi's generated smoke registry

Status: Landed on fix/cq-152
Theme: portable policy query engine · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

Re-validated 2026-09-03 against `eecef70bc`. Every Evidence pin was
re-resolved and the premise still holds in full; corrected pins are inline
below. The movers were **not** `64a7fac64` (H13/H14) — every audit pin still
resolved exactly at that merge. The main movers are `a5c87e3b5` (MODULE.md),
`17b322cc2` (`fixture-shell-dependencies.ts`), and `da8d1c712` / `4ed9ee44f`
(`path-policy-query-core.ts`), plus `b6fddccdf`/`f20293389`, which split
`verify-metadata.sh` away entirely.

> **Dispatch gate satisfied:** H15 landed in merge `e288e33eb` (2026-09-04), and this lane was cut from `3b1737a7c`, which already carries it.

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

- `scripts/path-policy/path-policy-query-core.ts:1-8` imports the concrete
  `PATH_POLICY` (`:1`) and import-time `SCRIPT_SMOKE_TEST_NAMES` (`:2`). The
  policy-neutral imports are `matchStarOnlySegmentPattern` (`:3`) and the
  `smoke-test-files.ts` group at `:4-8`, which brings a predicate, the shared
  `normalizePath`, and `SMOKE_METADATA_FRESHNESS_TEST_NAME` — neutral of
  `PATH_POLICY`, but the literal `"test-harness-check"`
  (`smoke-test-files.ts:22`), so exactly the class of hardcoded Musi-ism this
  leaf objects to.
- `scripts/path-policy/path-policy-query-core.ts:10-33` declares 22 query names.
  The exact commands
  `sed -n '11,32p' scripts/path-policy/path-policy-query-core.ts | rg -c '^  "'`
  and
  `rg -c '^  ("script-smoke-test-names"|"script-smoke-tests"):' scripts/path-policy/path-policy-query-core.ts`
  return 22 query names and 2 smoke-data-consuming handlers, respectively.
  `deletion-class:script-smoke-sensitive` is smoke-related but uses only policy
  selectors.
- `scripts/path-policy/path-policy-query-core.ts:121-125` privately implements
  normalized exact-path and trailing-slash-prefix smoke-subject matching.
- `scripts/path-policy/path-policy-query-core.ts:127-148` reads smoke subjects
  from `PATH_POLICY`, iterates the discovered names, and performs the
  `test-harness-check` freshness-name check (whose name is owned by
  `smoke-test-files.ts:22` since `da8d1c712`, 2026-08-17, in leaf 220's lane —
  H14 did not move the freshness name — it stayed a file-local `const` in
  `path-policy-query-core.ts` until then); `:153-196` eagerly constructs every
  handler around the concrete policy, including the fourth
  `SCRIPT_SMOKE_TEST_NAMES` read at `:193`.
- `scripts/path-policy/path-policy.ts:13-16,72-74,254-256` imports the generated
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
  returned 913 physical lines and 53 top-level subject entries at the audit pin;
  at `eecef70bc` they return **1139 and 59**. Net growth is monotone in
  practice, though 18 of the 205 non-merge commits touching the file shrank it.
- `scripts/path-policy/smoke-subject-headers.ts:32-49` — the generator owns
  subject tokenization plus non-empty and repo-relative POSIX validation.
- `scripts/path-policy/fixture-shell-dependencies.ts:28` — fixture
  validation declares its own smoke-subject header regex rather than consuming
  the generator's parser.
- `scripts/path-policy/fixture-shell-dependencies.ts:30-36` — fixture
  validation independently tokenizes smoke subjects with weaker validation.
- `scripts/path-policy/fixture-shell-dependencies.ts:75-86` — fixture
  coverage hand-copies the query selector's exact-or-directory semantics and
  claims parity in a comment (`:75-79`) without sharing the implementation.
- **The two copies are already structurally divergent — the parity the comment
  claims is upheld by callers, not by the code.** `isCoveredBySubject`
  (`:80-86`) omits the `normalizePath` call that `matchesSmokeSubject` applies
  at `path-policy-query-core.ts:122`, and the analyzer's tokenizer at `:33`
  omits the `.filter(Boolean)` that `smoke-subject-headers.ts:37` applies.
  Neither bites today, and neither is fenced against biting tomorrow: every
  path reaching `isCoveredBySubject` is normalised upstream before it gets
  there, and the extra `""` token that a subject-less `# smoke-subjects:`
  header yields (the trigger is **not** padding — `.trim()` runs before the
  split) is inert inside `isCoveredBySubject`, because a copied path is never
  `""` and `""` fails the `endsWith("/")` test, so `{""}` and `{}` return
  byte-identical results. This is a live parity hazard for the *next*
  normalisation or syntax change, which is the reason to share one
  implementation — not an active mismatch today.
- `scripts/path-policy/path-policy.test.ts:317-352` explains and implements the
  current `process.chdir` plus `vi.resetModules` choreography needed to rerun
  module-private, import-time discovery; `:354-455` pins curated order, dropping
  undiscovered curated names, sorted extras, deduplication, the basename regex
  anchors, and both branches of the absent-directory fallback.
- `scripts/path-policy/path-policy-query.ts:3-9` imports the core's public
  exports, while `scripts/format-changed.sh:9` (invoked at `:74`),
  `scripts/test-scripts.sh:70` (invoked at `:78`), and
  `scripts/lib/verify-path-policy.sh:41-66` consume the CLI entrypoint (the
  resolver `musi_path_policy_query_script` at `:41-58`, then the
  `bun … "$query"` invocation at `:66`). These are compatibility boundaries for
  the split. The last pin used to read
  `scripts/lib/verify-metadata.sh:483-501`; `b6fddccdf` and `f20293389` split
  that file, leaving a 74-line aggregator that sources the path-policy half at
  `:70-71`.
- `scripts/path-policy/MODULE.md:59-62` requires every newly imported module to
  appear in the relevant generated-surface `triggerPaths`, and says the module
  is then *derived* into the fixture copy projection — `fixturePaths` no longer
  exists (removed by `a5c87e3b5`; `harness.controls.json` has zero of them),
  and only non-import runtime files belong in reasoned `fixtureExtras` records.
  `:98-100` records that this directory feeds changed-file classification for
  the commit gate.

## Proposed direction

1. Extract `scripts/path-policy/path-policy-query-engine.ts` as a pure engine
   containing selector matching, query-name handling, the 22 handlers, and the
   parse/format helpers. Give it a factory such as
   `createPathPolicyQueryHandlers({ policy, smokeTestNames, smokeSubjects })`,
   with smoke dependencies supplied as lazy providers. Its only local runtime
   dependencies are the star-only segment dialect in `segment-pattern.ts` and
   the pure predicates in `smoke-test-files.ts`, both policy-neutral; its
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
   `smoke-subject-headers.ts:161-180` (`renderSmokeSubjectsData`) so the
   generated registry satisfies that type instead of owning it. Do not hand-edit
   `path-policy-smoke-subjects-data.ts`; regenerate it with
   `bun run test:scripts:subjects` and check it with
   `bun run test:scripts:subjects:check`.

3. Land this leaf after H15 and keep `path-policy-query-core.ts` as the thin
   Musi adapter. It must re-export the exact current API—
   `PATH_POLICY_QUERY_NAMES`, `isPathPolicyQueryName`, `queryPathPolicy`,
   `parsePathPolicyInput`, and `formatPathPolicyOutput`—while wiring the engine
   to `PATH_POLICY`, the smoke-subject registry, and the memoized smoke-name
   provider H15 lands. **H15's seam is specified concretely** in
   [HARNESS-CLUSTER-PLAN.md's H15 seam specification](../code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md#h15-seam-specification);
   read the shape there rather than restating it here. Do not replace H15's
   discovery seam with a directory-parameterized function in this commit. If
   H15 landed a different shape, reconcile the two documents before writing
   code.

4. Add engine-level tests using injected policy and smoke values while retaining
   the CLI compatibility coverage. Add parser and matcher cases for whitespace,
   non-header lines, exact files, normalized paths, trailing-slash directories,
   and false sibling-prefix matches; retain generator-specific diagnostic tests
   and fixture-selection parity cases. Refresh `scripts/path-policy/MODULE.md`,
   regenerate smoke subjects because the new engine joins the CLI import
   closure, and update every applicable `harness.controls.json` `triggerPaths`
   entry (fixture copies are derived, not listed; `fixtureExtras` is only for
   non-import runtime files). The focused validation surface is
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
  **The drain graph does not model this edge and will offer 152 as `free`; see
  the dispatch gate at the top of this leaf.** H15 owns lazy/memoized discovery
  and landed in `e288e33eb`, so this lane consumed its
  `scriptSmokeTestNames()` provider as the seam specification prescribes. H15's dead `directoryPrefixSubjects.sourceRelevant`, duplicated
  excluded-directory data, and `matchesFormatCheckCandidate` decision remain
  outside this leaf; H15 itself should update the status text in
  [31-harness-shared-helpers.md](../code-quality-2026-07-25/31-harness-shared-helpers.md),
  [49-path-policy-fixture-analyzer.md](../code-quality-2026-07-25/49-path-policy-fixture-analyzer.md),
  and [00-index.md](../code-quality-2026-07-25/00-index.md).
- The separate discovery-test-choreography cleanup has no authored leaf in this
  pack. If revived independently, land it first or in the same lane and reuse
  its directory-parameterized discovery function as this engine's provider;
  otherwise leave that test-only rewrite out of this leaf. Re-validated
  2026-09-03: the H15 seam specification assigns the choreography to neither
  slice, so `path-policy.test.ts:317-455` arrives here structurally intact and
  this leaf changes none of it. H15 does touch one line inside that range —
  `:341`'s `mod.SCRIPT_SMOKE_TEST_NAMES` becomes `mod.scriptSmokeTestNames()`,
  along with the two import-time comments at `:321-324` and `:335-337` — so
  re-read the block after H15 lands rather than trusting these coordinates. Its
  four cases are the only coverage of the ordering and fallback contract step 3
  preserves; keep them green rather than folding them into the new engine-level
  tests.
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
