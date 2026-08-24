# 134. Seven private source/test path classifiers across drift-ai, drift-triage, code-intel and the codemods disagree about which files are tests

Status: Landed on fix/cq-134
Theme: shared path taxonomy · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Every analyzer family in `scripts/` needs to answer the same two questions —
"is this path source code?" and "is this path a test?" — and each one answers
them with its own private constants and regexes. Drift-ai alone carries four
classifiers (its scope model, the test-orphaning lens, the thrash-history lens,
and the class-construction inventory), drift-triage a fifth, code-intel a
sixth, and the concurrency-guard codemod a seventh. They provably disagree on
concrete paths: `foo.spec.ts` is a test to test-orphaning, triage, thrash and
class-construction but plain source to code-intel and the concurrency guard;
`fixtures/x.ts` is test-adjacent to triage and class-construction but source to
test-orphaning; `foo.mts` is source to test-orphaning but invisible to the main
drift-ai scope model unless an operator configures the extension in.

Some of that divergence is deliberate policy — code-intel wants only runnable
Vitest files, triage wants to downweight anything test-adjacent, the thrash
lens fuzzily matches paths that may no longer exist — but the policies are
nowhere named, so a contributor cannot tell intent from drift. The costs are
concrete: adopting a new extension or test-naming convention means finding and
editing up to seven unrelated files; configured extension additions reach only
the one classifier that supports them; and two analyzers reporting on the same
path can silently mean different things by "test", which undermines comparing
their results at all.

## Evidence

- `scripts/drift-ai/test-orphaning-mapping.ts:9-34` — a fully private
  taxonomy: `SOURCE_EXTENSIONS` (8 entries, including `.mts`/`.cts`),
  `TEST_DIR_SEGMENTS` (`__tests__`, `__test__`, `test`, `tests`, `e2e` —
  segment-exact, no `fixtures`), `TEST_BASENAME`
  (`/\.(?:test|spec)\.[mc]?[jt]sx?$/u`), and `DECLARATION_SUFFIXES`
  (`.d.ts`/`.d.mts`/`.d.cts`).
- `scripts/drift-ai/scope.ts:24-31` — `BUILT_IN_SOURCE_EXTENSIONS` has only 6
  entries (no `.mts`/`.cts`), so the two drift-ai source models already
  disagree; `:62-69` `buildSourceExtensions` accepts configured additions that
  flow to nothing outside this model.
- `scripts/drift-ai/hotspots-thrash.ts:172-174` — `isTestPath` is a broad
  case-insensitive heuristic
  (`/(?:^|[./_-])(?:test|spec)(?:[./_-]|$)/iu`) matching a `test`/`spec` token
  anywhere in the path, including paths deleted from the working tree.
- `scripts/drift-ai/class-construction.ts:55-56` — a fourth drift-ai
  classifier: `DEFAULT_TEST_FILE_PATTERN` adds `__mocks__` and `__fixtures__`,
  which no sibling classifier recognizes, plus `fixtures`, which triage also
  recognizes at `scripts/drift-triage/triage-report-support.ts:31`.
- `scripts/drift-triage/triage-report-support.ts:30-31` — triage's `TEST_FILE`
  additionally matches `.test-helper`/`-test-helper` suffixes and its
  `TEST_DIRECTORY` additionally matches `fixtures`, `test-support` and
  `examples`; `:108-111` `isTestLocation` applies them after stripping
  `:line:col` suffixes.
- `scripts/code-intel/test-files.ts:1-7` — the narrowest of all:
  `isTestFile` recognizes only `.test.ts`/`.test.tsx` (no `.spec`, no
  directory rules), plus `isSlowTestFile` for `.slow.test`.
- `scripts/codemods/concurrency-guard/paths.ts:10-19` — a seventh classifier:
  `isTestPath` matches only `.test.tsx?` and `isTypeTestPath` adds a
  `__type-tests__` segment rule found nowhere else.
- `scripts/harness/manifest-contract-check.ts:144` — one more independent
  basename rule (`TEST_FILE_PATTERN = /\.test\.[^.]+$/u`) turned up while
  confirming the above, making the true count higher than the seven core
  sites.

## Proposed direction

Consolidate into one pure shared module under `scripts/lib/` (e.g.
`scripts/lib/path-taxonomy.ts`) — **not** `packages/shared` (`scripts` is not
a workspace package) and **not** framed as a "service" (in this repo that word
means `packages/server/src/services/`).

1. The module owns the shared primitives: the source-extension set (including
   `.mts`/`.cts`), the declaration suffixes, the `.test`/`.spec` basename
   regex, and the test-directory segment set.
2. It exports **named policies per intent** rather than one merged predicate:
   - *strict runnable-test* — code-intel's `.test.ts(x)` plus `.slow.test`;
   - *orphaning* — segment-exact test directories plus declaration exclusion
     (today's `test-orphaning-mapping.ts` behavior);
   - *triage test-adjacent* — helpers, `fixtures`, `test-support`, `examples`
     (today's `triage-report-support.ts` behavior);
   - *broad history-heuristic* — `hotspots-thrash.ts`'s fuzzy regex over
     possibly-deleted paths.
3. Route configured extension additions (`scope.ts` `buildSourceExtensions`)
   through the module so they flow to every opted-in consumer.
4. Migrate each family **behavior-preservingly** first, pinned by
   characterization tests per policy (runnable one file at a time with
   `bun run test:scripts:file -- <file>`). Converge accidental drift — e.g.
   `scope.ts` missing `.mts`/`.cts` — only as explicit follow-up decisions,
   never silently inside a migration commit.
5. Sweep the additional classifiers found during review
   (`scripts/codemods/concurrency-guard/paths.ts`, the drift-ai
   `class-construction*` pattern) into the same module, or annotate at the
   declaration why they stay local.
6. Add a short MODULE.md or header contract naming each policy's intent, so a
   harness adopter can tell deliberate policy from drift at a glance.

## Scope / caveats

- **Do not unify the policies' behavior.** The divergence is partly
  intentional: code-intel's `isTestFile` must stay strict (it feeds
  runnable-test queries), triage's broad matching deliberately downweights
  test-adjacent paths, and the thrash lens's fuzzy regex is a history
  heuristic that must tolerate deleted paths. The named-policy design exists
  precisely so consolidation does not flatten these into one predicate.
- Every migration commit is net-zero on classification results; any behavior
  change (including the `.mts`/`.cts` gap in `scope.ts`) is a separate,
  explicitly decided commit with its own characterization-test update.
- `scripts/harness/manifest-contract-check.ts:144` was found during
  verification and is not in the core migration list; give it the same
  step-5 treatment (sweep or annotate) rather than expanding step 4.
- Prior pack: the 2026-07-25 pack's
  [31-harness-shared-helpers.md](../code-quality-2026-07-25/31-harness-shared-helpers.md)
  H9 slice deleted only the drift-ai-internal `SOURCE_LIKE_EXTS` duplicate of
  `BUILT_IN_SOURCE_EXTENSIONS` (confirmed gone at the pin); it never touched
  test-orphaning, hotspots-thrash, class-construction, triage, code-intel or
  the codemod, and no prior ruling declines a shared classification module.
  The still-open harness slices there (H15, H20/H21) do not schedule this
  work.
- The divergence was not "reintroduced" after that pack:
  `test-orphaning-mapping.ts` predates it (added 2026-06-04) and was simply
  outside H9's scope.
- Serialize with
  [109-musi-repository-policy-embedded-throughout.md](./109-musi-repository-policy-embedded-throughout.md):
  leaf 109's drift-triage `pathArea` extraction is narrower than this leaf's
  source/test taxonomy, but both alter drift-triage taxonomy code; either may
  land first, but do not implement them concurrently.
