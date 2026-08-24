# 49. The fixture copy-set analyzer is nine modules and 1,541 lines inside `scripts/path-policy/` with no `MODULE.md`, and 43 of its 49 test cases sit in one 803-line file

Status: Partially landed 2026-08-01 on `fix/cq-harness-h13-h14` (merge
`64a7fac64`) — H13 (`9c87ed4fa`) and H14 (`9ced30028`) landed; H15 remains
blocked on unlanded 27-PLAN slice 27.3, and the test split was dropped by the
harness cluster plan
Theme: orientation contract missing where the charter requires one · Area: harness · Severity: low · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`scripts/path-policy/` now holds two unrelated concerns. The older one is the
changed-file path policy and the smoke-subject map. The newer one is a static
analyzer that reads every hand-written smoke test's shell, models what each
fixture puts inside its sandbox, and fails the build when a copy set is not
closed over its dependencies. That analyzer is nine non-test modules and 1,541
lines — 64% of the directory's hand-written non-test code — and nothing at the
directory level says it exists.

**The per-file comments are good; the composition is undocumented.** Each of
the nine modules opens with a substantial header explaining its own job, and
several of those headers are excellent. What no file states is the shape they
form: which module is the entry point, what calls it, what order the passes run
in, and which of the nine a contributor should start reading. The one prose
description of the directory that exists — the `scripts/README.md` table row —
describes only the older half ("Changed-file classification and smoke-test
subject mapping used by script wrappers") and does not mention the analyzer at
all. A contributor following the documentation is told the larger half of the
directory is not there.

**The surface it guards has a public vocabulary with no public home.** Smoke
authors are expected to write `# fixture-closure: not-an-entry - <reason>` and
`# fixture-closure: unmodelled-copy - <reason>` annotations above copies the
static model cannot read, and an annotation that governs nothing is itself a
failure. Four such annotations exist across three live smoke files. The only
statement of that vocabulary anywhere is a comment inside the module that parses
it. The analyzer also carries a deliberate, live blind spot — entry selection is
a path heuristic, so a copied non-`scripts/**` module that the fixture actually
executes gets no closure check — recorded in the same way, in a source comment
nobody reaches without already being in the file.

**The test file is the second orientation problem.** The family has 49 cases in
two files, and 43 of them live in one 803-line file driving one exported
function over a temp-dir repo. Sixteen cover the original shell-source closure;
27 sit in a nested describe for the import closure. The other file holds 6 cases
against one module. Seven of the nine modules have no direct test of their own,
including four that are pure string functions with no filesystem access, whose
behaviour is currently asserted only through an end-to-end path that writes
shell files to disk. There is no lint pressure to change this: `local/max-lines` is off for
test files, so the file can keep growing at whatever rate the analyzer does.

## Evidence

### Size and shape

- `scripts/path-policy/` — 21 `.ts` files, 5,108 lines. Of those, 1,850 lines are
  the five test files, 865 are the generated `path-policy-smoke-subjects-data.ts`,
  and 2,393 are hand-written non-test source.
- The nine analyzer modules and their lines: `fixture-sandbox-model.ts` 351,
  `fixture-copy-expressions.ts` 260, `fixture-shell-dependencies.ts` 257,
  `fixture-helper-calls.ts` 190, `fixture-import-closure.ts` 115,
  `fixture-loop-bindings.ts` 101, `fixture-shell-scope.ts` 93,
  `fixture-seed-statements.ts` 91, `fixture-seeding-annotations.ts` 83 — 1,541
  lines, 64% of the directory's hand-written non-test source.
- The other half is `path-policy.ts` 289, `smoke-subject-headers.ts` 225,
  `path-policy-query-core.ts` 222, `path-policy-query.ts` 80,
  `path-policy-smoke-subjects.ts` 21, `generate-smoke-subjects.ts` 15 — 852
  lines.
- Before `1656c76a`, `bb6ea97a`, and `c8b27f49` (all 2026-07-25) the analyzer was
  three files and 542 lines (`fixture-shell-dependencies.ts` 294,
  `fixture-helper-calls.ts` 155, `fixture-shell-scope.ts` 93), and its tests were
  398 lines. Tests are now 903 lines across two files.
- No `MODULE.md` or `*-MODULE.md` exists anywhere under `scripts/path-policy/`.
  `scripts/drift-triage/MODULE.md` is the only module doc under `scripts/`, and
  `MODULE-INDEX.md:59` is its single `scripts/` row.
- `scripts/README.md:64` — the directory table row: "Changed-file classification
  and smoke-test subject mapping used by script wrappers." No mention of fixture
  copy sets, sandboxes, or closure checking.

### The composition a doc would record

- `scripts/path-policy/smoke-subject-headers.ts:5`, `:177` — the only caller.
  `projectSmokeSubjectOutputs` opens by calling
  `validateFixtureShellDependencies(repoRoot)` before collecting subject
  definitions, so the analyzer runs as a precondition of generating
  `path-policy-smoke-subjects-data.ts` and
  `scripts/fixtures/test-scripts/all-smoke-tests.txt` (`:179-188`).
- `scripts/path-policy/fixture-shell-dependencies.ts:242` —
  `validateFixtureShellDependencies(repoRoot): void`, the analyzer's sole export
  and the whole family's public surface.
- Reached from two package scripts: `test:scripts:subjects` /
  `test:scripts:subjects:check` (`scripts/path-policy/generate-smoke-subjects.ts`)
  and `harness:skills:refresh` / `harness:skills:check`
  (`scripts/harness/generate-skill-artifacts.ts:9`, which imports
  `smoke-subject-headers.js`).
- `harness.controls.json:1606-1614` and `:1643-1651` — the nine modules are
  enumerated as `triggerPaths` and `fixturePaths` of `check/skill-artifacts-generator`;
  `:1668-1676` repeats them for `check/smoke-subjects-generator`. Adding a tenth
  module means editing generated harness surfaces, not just the directory.
- `scripts/path-policy/fixture-shell-dependencies.ts:1-15` — the three axes every
  copy set is checked on (`cp` sources named by smoke-subject headers; closure
  over literal `# shellcheck source=` edges; closure over the static import graph
  of copied `scripts/**` TS/JS entries), plus the two deliberate exclusions
  (dynamic sources, heredoc bodies).
- `scripts/path-policy/fixture-sandbox-model.ts:1-19` — the four seeding
  mechanisms a sandbox can use (heredoc-synthesized stub, `ln -s` into
  `node_modules`, recursively copied directory, whole-tree `git clone` /
  `git worktree add`) and what each one does to the walk.
- `scripts/path-policy/fixture-sandbox-model.ts:21-28` — the keying invariant:
  contributions merge by function scope *and* fixture root, never by root token
  alone, so unrelated fixtures reusing `$repo` cannot cross-satisfy each other
  and one function's `git clone` cannot switch checking off for every fixture
  sharing the token.
- `scripts/path-policy/fixture-copy-expressions.ts:1-8` — the shared primitive
  layer both closure checks read, and the rule that anything built at runtime
  resolves to `undefined`.

### The undocumented public vocabulary and the blind spot

- `scripts/path-policy/fixture-seeding-annotations.ts:1-17` — the escape hatch in
  full: `# fixture-closure: not-an-entry - <reason>` and
  `# fixture-closure: unmodelled-copy - <reason>`, each sitting in the comment
  block directly above the `cp` it governs, each requiring a reason, and each
  failing if it governs nothing.
- Live uses, four total: `scripts/tests/test-lint-ratchet.sh:201`
  (`unmodelled-copy`) and `:1807` (`not-an-entry`),
  `scripts/tests/test-lint-coverage-map-gen.sh:42` (`unmodelled-copy`),
  `scripts/tests/test-harness-check.sh:130` (`unmodelled-copy`).
- No file under `docs/` mentions `fixture-closure:` as an annotation a smoke
  author can write.
- `scripts/path-policy/fixture-import-closure.ts:11-21` — the blind spot:
  `entryPathPattern` treats every copied `scripts/**` TS/JS file as executed and
  everything outside `scripts/` as inert, "which is wrong in both directions".
  The named live instance is `eslint-rules/type-assertion-boundary.js`, copied
  into a fixture and imported by the executed fixture ESLint config in
  `scripts/tests/test-lint-ratchet.sh`; it is import-free today, so extracting a
  helper out of it would under-close that fixture silently.

### The test file

- `scripts/path-policy/fixture-shell-dependencies.test.ts` — 803 lines, one
  top-level `describe` at `:9`, 43 `it()` cases. Sixteen are shell-closure and
  scope cases (`:40`-`:349`); 27 are inside the nested
  `describe("copied TS/JS entry import closures")` at `:378`.
- Every case calls `validateFixtureShellDependencies(repoRoot)` against a
  `mkdtempSync` repo seeded in `beforeEach` (`:12-28`) and torn down in
  `afterEach` (`:29-31`), writing smoke shell through the local `writeSmoke`
  helper (`:33-38`).
- `scripts/path-policy/fixture-helper-calls.test.ts` — 100 lines, 6 cases, the
  only module-level test in the family.
- No direct test exists for `fixture-copy-expressions.ts`,
  `fixture-import-closure.ts`, `fixture-loop-bindings.ts`,
  `fixture-sandbox-model.ts`, `fixture-seed-statements.ts`,
  `fixture-seeding-annotations.ts`, or `fixture-shell-scope.ts`.
- Four of those seven import neither `node:fs` nor `node:path` and are pure
  string readers: `fixture-shell-scope.ts`, `fixture-loop-bindings.ts`,
  `fixture-seed-statements.ts`, `fixture-seeding-annotations.ts` (368 lines
  combined).
- Eleven cases whose subject is one of those pure modules but which are asserted
  end-to-end today: `:189` (brace-group guard closed by a lone brace), `:212`
  (function-keyword declarations), `:233` (identical nested function names) for
  `fixture-shell-scope.ts`; `:576` (literal loop variable) and `:605` (loop
  bindings scoped to their function) for `fixture-loop-bindings.ts`; `:549`,
  `:562`, `:669`, `:680`, `:696`, `:711` (annotation acceptance, rot, and unknown
  kinds) for `fixture-seeding-annotations.ts`.
- `:590` (literal glob expansion) reads like a twelfth, but its subject is
  `expandLiteralGlob` (`fixture-copy-expressions.ts:41`), which calls
  `readdirSync`; that case needs a real directory whatever file it lives in.
- `eslint-config/test-configs.js:96-101` — `unitTestConfigs` sets both
  `max-lines` and `local/max-lines` to `"off"` for test files, so the repo-wide
  300-line cap (`eslint-config/rule-groups.js:28`) never applies here and nothing
  will flag further growth.
- `lint-ratchet.baseline.json` carries no `scripts/path-policy/` entries, so
  there is no tracked debt row for any of this either.

### Charter fit

- `docs/module-docs.md:26` — "Large feature directories with several files,
  tests, or subdirectories"; `:28-29` — surfaces that "own transactions, cache
  writes, socket invalidation, optimistic updates, store writes, or cross-module
  contracts"; `:32` — the only carve-out, "Do not add one for a single
  self-contained file unless it carries invariants that would otherwise live only
  in comments."
- The invariants above live only in comments today: the four seeding mechanisms,
  the scope-plus-root keying rule, the annotation vocabulary, and the entry-path
  blind spot are each stated exactly once, inside the module that implements them.

## Proposed direction

Two commits: steps 1-2 together (the guide requires the regenerated index in the
same commit as the doc), then step 3. Do them in that order — step 1 establishes
which modules are entry points and which are internals, which is what makes step
3's split lines obvious.

1. **Write `scripts/path-policy/MODULE.md`**, following
   [`docs/guides/add-module-doc.md`](../../../guides/add-module-doc.md) and
   modelled on `scripts/drift-triage/MODULE.md`, the directory's nearest
   neighbour under `scripts/`. Use the six charter section names from
   `docs/module-docs.md:41-50`, and add a `Concepts:` line covering the terms
   someone would actually search: fixture copy sets, sandbox closure, smoke
   subjects, changed-file path policy. Per the guide's steps 7-11 the content
   that must be in it:
   - **Purpose** — the directory owns two concerns and should say so plainly:
     the changed-file path policy plus smoke-subject map (`path-policy*.ts`,
     `smoke-subject-headers.ts`, `generate-smoke-subjects.ts`) and the fixture
     copy-set analyzer (`fixture-*.ts`). Name the adjacent owner it is most often
     confused with: `scripts/harness/fixture-closure-check.ts` validates declared
     `generatedSurface.fixturePaths` in `harness.controls.json` against a
     computed import closure; this directory reads real smoke shell and never
     touches the manifest.
   - **Data Flow** — the pass order, not a file tree.
     `fixture-shell-scope.ts` produces scoped shell lines →
     `fixture-helper-calls.ts` and `fixture-loop-bindings.ts` resolve
     composition and loop bindings → `fixture-copy-expressions.ts` and
     `fixture-seed-statements.ts` answer "which repository file does this operand
     name" and "what does this statement put in the sandbox" →
     `fixture-sandbox-model.ts` assembles the sandbox →
     `fixture-import-closure.ts` walks copied TS/JS entries →
     `fixture-seeding-annotations.ts` applies the escape hatches →
     `fixture-shell-dependencies.ts` reports. State the three enforcement axes
     from `fixture-shell-dependencies.ts:1-15` here rather than restating them
     per module.
   - **External Entry Points** — `validateFixtureShellDependencies`
     (`fixture-shell-dependencies.ts:242`) is the family's only export consumed
     outside it, called from `smoke-subject-headers.ts:177`; reachable via
     `bun run test:scripts:subjects` / `:check` and `bun run harness:skills:refresh`
     / `harness:skills:check`. Everything else under `fixture-*.ts` is
     module-internal. Say that adding a module means adding it to the
     `triggerPaths` and `fixturePaths` lists of both `harness.controls.json`
     records (`:1606-1614`, `:1643-1651`, `:1668-1676`), not just to the
     directory.
   - **State Ownership** — no DB, cache, or socket state; the family owns no
     output artifacts at all, only a throw. The subject-map half owns the two
     generated outputs listed at `smoke-subject-headers.ts:179-188`.
   - **Test Seams** — `fixture-shell-dependencies.test.ts` and
     `fixture-helper-calls.test.ts`, plus whatever step 3 produces; focused runs
     via `bun run test:scripts:file -- <file>`.
   - **Gotchas** — promote, do not duplicate, the four invariants that currently
     live only in headers: the four sandbox seeding mechanisms
     (`fixture-sandbox-model.ts:1-19`), the scope-plus-root keying rule
     (`:21-28`), the `# fixture-closure:` annotation vocabulary with its
     "an annotation that governs nothing is a failure" rule
     (`fixture-seeding-annotations.ts:1-17`), and the entry-path blind spot
     (`fixture-import-closure.ts:11-21`) including the
     `eslint-rules/type-assertion-boundary.js` instance. Point at the source
     comment for each rather than restating it at full length; the guide's step
     11 wants concrete paths, and leaf 45's failure mode — a contract restated in
     three places and wrong in two — is exactly what to avoid here. The blind
     spot is a live limitation, not a TODO: record it as a known boundary with
     its file:line, not as deferred work.
2. **Run `bun run module:index`** and include the regenerated `MODULE-INDEX.md`
   in the same commit (guide step 13). Also update the `scripts/README.md:64`
   directory row so it names both concerns; it is the row a contributor reads
   before they know the module doc exists.
3. **Split `fixture-shell-dependencies.test.ts` along the module seams the doc
   just named.** Three moves, and the arithmetic should come out at 43 cases
   either side:
   - Eleven cases move to three new module-level files, asserting against the
     module's own export instead of a temp-dir repo:
     `fixture-shell-scope.test.ts` takes `:189`, `:212`, `:233`;
     `fixture-loop-bindings.test.ts` takes `:576` and `:605`;
     `fixture-seeding-annotations.test.ts` takes `:549`, `:562`, `:669`, `:680`,
     `:696`, `:711`.
   - The remaining 19 cases under the nested describe at `:378` move to
     `fixture-import-closure.test.ts`, staying end-to-end — they assert the
     interaction of the sandbox model with the closure walker, which is what
     they are for.
   - Thirteen shell-source-closure and smoke-subject-metadata cases stay in
     `fixture-shell-dependencies.test.ts`, which is what its name claims.

   Every case must keep asserting the same behaviour: this is a move, not a
   rewrite, and a case that cannot be expressed against a module export stays
   where it is (see caveats). `fixture-seed-statements.ts` has no case of its own
   to inherit — leave it uncovered rather than inventing tests to fill a file, or
   add direct coverage as a separate follow-up.

## Scope / caveats

- **The remedy is documentation and test placement, not a rewrite.** Do not
  restructure the nine modules, merge any of them, or change the analyzer's
  behaviour. The decomposition is real and the per-module headers are already
  good; what is missing is the directory-level statement of how they compose.
- **Do not move `fixture-*.ts` into a subdirectory.** The path appears in
  `harness.controls.json` three times as generated-surface trigger and fixture
  lists, in `scripts/harness/generated-surface-freshness.generated.sh:48` and
  `:57`, and in `docs/generated/lint-coverage-map.md:303`. Moving these files
  means updating all of those surfaces in one commit for no behavioural gain, so
  it is out of scope here. Leaf 28 owns the `scripts/` top-level layout question,
  but its family moves (step 3) do not reach inside `scripts/path-policy/`.
- **Do not convert the end-to-end cases into unit tests wholesale.** The
  cross-file cases are the ones that catch the drift this analyzer exists to
  catch — the same-named-root separation cases (`:725`, `:746`, `:764`, `:783`),
  the sibling-helper composition case (`:510`), and the multi-sandbox case
  (`:151`) are only meaningful through the full entry, and stay end-to-end
  wherever step 3 files them. Step 3 moves only the eleven cases that are
  genuinely about one module's string handling. Restating entry-level behaviour
  against module internals in the new files is the failure mode to avoid; it
  would raise the case count without raising the coverage.
- **Two different things are called "fixture closure" and the doc must
  disambiguate them.** `scripts/harness/fixture-closure-check.ts:1-9` validates
  `harness.controls.json` `generatedSurface.fixturePaths` against a computed
  import closure of `scripts/harness-check.ts`;
  `scripts/path-policy/fixture-shell-dependencies.ts` parses live smoke shell.
  Neither imports the other. Getting this wrong sends a contributor to the wrong
  file for the wrong failure message.
- **Do not fix the entry-path blind spot as part of this.**
  `fixture-import-closure.ts:11-21` records a deliberate limitation with a live
  instance and an explicit note that no positive "this non-`scripts/**` file is
  an entry" annotation exists because no fixture needs one yet. Closing it means
  designing a third annotation kind and is its own proposal; this leaf makes the
  limitation findable, nothing more.
- **Sequencing with leaf 31.** Leaf 31's steps 9, 11, 12, and 13 all edit this
  directory; step 9 unifies duplicated helpers inside it — one `normalizePath`
  instead of three
  (`fixture-copy-expressions.ts:65`, `smoke-subject-headers.ts:24`,
  `path-policy-query-core.ts:36`), one smoke-file regex instead of four, and the
  private `stripQuotes`/`capture` copies in `fixture-helper-calls.ts:46-60`
  folded into the exported pair. Those edits change import lines in files this
  leaf documents. No ordering dependency for step 1, but do not work leaf 31 and
  step 3 concurrently in `scripts/path-policy/`; if leaf 31 lands first, the
  Data Flow section describes the unified helpers instead.
- The doc describes the directory as it is today. If a later change moves the
  analyzer or closes the blind spot, refresh the doc then rather than
  pre-describing an intended end state.
