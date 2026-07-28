# 31. The scripts/ leaf-utility layer: residual guard adoption, shell finding shape, path-policy duplication, and a tail of dead helpers

Status: Proposed — not promoted
Theme: Duplicated helpers in the harness tooling tree · Area: harness · Severity: medium · Size: L

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`scripts/` and `tools/` have grown into a large TypeScript + shell tooling tree
whose leaf-utility layer is only half built. `scripts/lib/` owns the two
highest-frequency helpers — `records.ts` (`isRecord`/`isObjectLike`) and
`error-message.ts` (`errorMessage`) — but adoption stopped short of the tail, and
every other recurring shape still has no home at all. Seven `scripts/` modules
still declare their own record guard under two names and four narrowed types,
one of them inside `scripts/lib/` itself; 44 non-test `scripts/` sites still
inline the error-to-string ternary; eleven call sites across four shell
producers hand-assemble the same harness finding JSON object even though
`packages/shared` already owns its schema.

The cost is not bytes. It is that the shapes drift while nobody is watching. The
same "is this a smoke test file" question is asked in four files in
`scripts/path-policy/` under two non-equivalent regexes, neither of which has an
owner; the same `path.replaceAll("\\", "/")` body exists three times under two
names in that same directory, one of them already an exported de facto owner the
other two are unaware of; `stripQuotes` and `capture` exist twice with
byte-identical bodies two files apart; and `drift-ai` owns two independent
copies of the six-extension source set plus a pair of mutually-inverse
scope/path converters split across two modules, one of which already imports the
other's type to express its half. A maintainer who fixes one of these has no way
to know the others exist.

A second, smaller cluster in the same tree is the residue of the same absent
review pressure: helpers that no longer do anything (a spread that re-copies the
key it just copied, a wrapper whose body is a single delegating `return`, a
`.sort()` whose only consumer is a `Set` constructor), a policy field with zero
readers that duplicates data sitting eight lines above it, and a predicate that
is statically `true` and is kept compiling only by a widening `: string`
annotation.

## Evidence

Duplicated record shape (shell producers):

- `scripts/doctor.sh:82` — `emit_finding`, with three `jq -nc` branches at `:92`, `:99`, `:106` keyed on optional `path`/`line`.
- `scripts/verify-logs.sh:668`, `:685`, `:705` — three more hand-inlined copies of the same object.
- `scripts/migration-safety-scan.sh:133`, `:518`, `:534` — three more.
- `scripts/generate-module-index.sh:82`, `:84` — two more, built as raw JSON string literals with no `jq` at all. Fourth producer.
- All eleven sites pipe into `scripts/harness-emit-envelope.ts`, which already imports `harnessFindingSchema` from `packages/shared/src/schemas/harness-diagnostics.ts`. The fields are *not* uniform: all eleven emit `control`/`severity`/`why`/`howToFix`/`repairKind:"manual"`; ten emit `path` (the exception is the no-path branch at `doctor.sh:106`); three emit `line` (`doctor.sh:92`, `migration-safety-scan.sh:518`, `:534`); nine emit `messageId` (the two `generate-module-index.sh` raw-JSON literals do not). `path` (`harness-diagnostics.ts:41`), `line` (`:42`) and `messageId` (`:44`) are all `.optional()`, and the schema's `superRefine` (`:76-82`) rejects a `line` without a `path`.

Duplicated type guards:

- `scripts/lib/records.ts` is the shared home: `isRecord` (strict, rejects arrays) at `:13` and `isObjectLike` (array-permitting) at `:18`. Its docstring (`:1-10`) states the difference is a correctness seam, not a style preference — the loose guard narrows `unknown[]` to `Record<string, unknown>` and lets a caller index a field that is always `undefined`. The two are not interchangeable, so adoption is a per-call-site choice.
- Seven local declarations of the strict guard remain under `scripts/`, spelled under two names and four narrowed types: `code-intel/json-utils.ts:27` (`isRecord`, exported, five importers, narrowing to `JsonRecord`), `drift-ai/config-readers.ts:10` (`isRecord`, exported, seven importers, narrowing to `UnknownRecord`), `sensor-knip-unused-exports-baseline.ts:32`, `sensor-near-duplicates-baseline.ts:26` and `suppression-ledger-baseline.ts:33` (private `isRecord` over `Record<string, unknown>`), plus the two `isJsonObject` spellings below. All four narrowed types are plain aliases of `Record<string, unknown>` (`code-intel/types.ts:198`, `drift-ai/config-readers.ts:8`, `logs-audit/logs-audit-redaction.ts:8`, `lib/verify-metadata-core.ts:43`), so the shared predicate substitutes structurally; the per-call-site decision is strict vs loose, not which alias.
- `scripts/logs-audit/logs-audit-redaction.ts:56` — `isJsonObject`, exported and imported by `logs-audit-request-ids.ts:5` and `logs-audit-event-fields.ts:5`. A live third spelling of the same predicate, and therefore a residual adoption site as well as the model for how a directory should share one.
- `scripts/lib/verify-metadata-core.ts:58` — a private arrow `isJsonObject` with the strict body, read at `:122`, `:149` and `:233`. It sits in `scripts/lib/` itself, the same directory as the `records.ts` it re-declares.
- Seven more live under `tools/lint-ratchet/src/`: `governance/debt-log-schema.ts:382`, `kernel/baseline-hash.ts:14`, `kernel/baseline-item-parse.ts:4`, `kernel/baseline-merge-values.ts:1`, `kernel/eslint-json.ts:32`, `kernel/metrics-parse.ts:11`, `kernel/rule-source.ts:87`. These are out of scope — see the package-boundary caveat.

Duplicated error stringification:

- `scripts/lib/error-message.ts:10` exports `errorMessage`. Its docstring (`:1-9`) deliberately excludes callers that need more than the message — a `stderr`/`stdout` payload, or a structured JSON fallback — so the remaining sweep is a case-by-case pass, not a regex replace.
- 53 inline `x instanceof Error ? x.message : String(x)` ternaries remain in non-test TypeScript repo-wide. 45 are under `scripts/`, and one of those 45 is `scripts/lib/error-message.ts:11` — the shared helper's own body — leaving 44 sweep targets: 21 in top-level `scripts/*.ts` modules, 12 in `drift-ai/`, 6 in `harness/`, 2 in `code-intel/`, 1 in `lint-ratchet/` (`check-registry.ts:209`), 1 in `path-policy/` (`fixture-import-closure.ts:108`), 1 in `drift-triage/` (`drift-triage-collect.ts:102`). Densest single files: `scripts/mutation-survivors.ts`, `scripts/db-status.ts` and `scripts/harness/registration-generated-checks.ts` with three each; `scripts/drift-ai/config.ts:224` and `:232`.
- The other 8 sit outside `scripts/` and are all out of scope: 6 under `tools/lint-ratchet/src/` (`git-rail/merge-cli.ts:74`, `git-rail/merge-driver-presence.ts:59`, `governance/propose.ts:100`, `kernel/eslint-runner.ts:76`, `kernel/group-baseline-parse.ts:29`, `kernel/rule-source.ts:302`), plus `packages/server/scripts/pgexec.ts:65` and `examples/lint-ratchet-demo/scripts/lint-ratchet.ts:270`. The four remaining `instanceof Error` sites under `tools/` are different shapes — `? error : new Error(String(error))` (`kernel/eslint-runner.ts:85`, `kernel/current-collection-scheduler.ts:55`), `: "unknown error"` (`kernel/git-tracked-files.ts:21`), `: "unknown JSON parse error"` (`governance/debt-log-jsonl.ts:30`) — and are not this helper's case.
- `scripts/codemods/lib/fixture-runner.test-helper.ts:151` declares a same-named but richer `errorMessage` (string passthrough plus `JSON.stringify` fallback) that behaves differently on non-`Error` inputs.

Duplicated literals and near-duplicate helpers:

- `scripts/drift-ai/coverage-unused-correlation.ts:170-179`, `:183-192`, `:206-215` — the identical seven-field "unavailable" result (`state: "unavailable"`, `hits: null`, `matchedLine: null`, `matchedEndLine: null`, `matchKind: "none"` over a shared `base`) built three times; only `pathMatch` and `note` vary.
- Four declaration sites for "a smoke test file" under two non-equivalent regexes, in four files all in `scripts/path-policy/`: `path-policy-query-core.ts:132` — `/^scripts\/tests\/test-[^/]+\.sh$/u` (repo-relative path form); `fixture-shell-dependencies.ts:39`, `smoke-subject-headers.ts:7`, and `path-policy-smoke-subjects.ts:13` — `/^test-.+\.sh$/u` three times (bare basename form; the last inline inside a `.filter()`).
- `scripts/path-policy/fixture-copy-expressions.ts:65` `normalizePath` (exported, and already imported by `fixture-import-closure.ts:27`, `fixture-seed-statements.ts:12` and `fixture-loop-bindings.ts:17`), `scripts/path-policy/smoke-subject-headers.ts:24` `normalizePath` (private), and `scripts/path-policy/path-policy-query-core.ts:36` `normalizeComparablePath` are three byte-identical `path.replaceAll("\\", "/")` bodies under two names in one directory. One is already the de facto shared export; the other two are unaware of it.
- `scripts/path-policy/fixture-copy-expressions.ts:69-83` exports `stripQuotes` and `capture`; `scripts/path-policy/fixture-helper-calls.ts:46-60` declares the same two functions privately with byte-identical bodies.
- `scripts/drift-ai/path-util.ts:6-13` `SOURCE_LIKE_EXTS` and `scripts/drift-ai/scope.ts:24-31` `BUILT_IN_SOURCE_EXTENSIONS` are both `new Set([".ts",".tsx",".js",".jsx",".mjs",".cjs"])`, both exported, neither derived from the other. `scope.ts:49` `buildSourceExtensions` marks `scope.ts` as the natural owner, and `BUILT_IN_SOURCE_EXTENSIONS` is the name the `scripts/drift-ai.ts:109` facade re-exports. `SOURCE_LIKE_EXTS` has two importers: `ghost-files-match.ts:11`, and the `ghost-files-tokens.ts:5` pass-through consumed by `ghost-files.ts:10`.
- `scripts/drift-ai/ghost-files-tokens.ts:5` is a bare `export { SOURCE_LIKE_EXTS } from "./path-util.js"` pass-through.
- `scripts/drift-ai/path-util.ts:33-44` `changedFilesFromScope` is the exact inverse of `scripts/drift-ai/scope.ts:33-40` `toChangedScopeFile`, and `path-util.ts:3` already imports `DetectorScope` from `scope.js` to express it. 53 non-test `drift-ai` modules import `path-util.js`; 25 import `scope.js`.
- `scripts/drift-ai/arg-readers.ts:38-41` `readPath(option, value)` and `:43-47` `readNonEmptyPath(value, flag)` differ only in trimming, throw the identical `` `${x} requires a path.` `` message, and take their arguments in opposite orders. The file's four other readers (`readNonEmptyPath:43`, `readPositiveInt:49`, `readRatio:57`, `readNonEmpty:65`) all use `(value, flag)`; `readPath` is the lone outlier. Its only call sites are `scripts/drift-ai/subcommand-args.ts:65`, `:70`, `:131`.
- `scripts/drift-ai/dolos-output.ts:142` declares a *different*, private `readPath(row: CsvObject, key: string)` used at `:116`, `:117`, `:187` for CSV columns — a same-directory name collision between two unrelated functions.
- `scripts/drift-triage/triage-report.ts:51` and `scripts/drift-triage/triage-report-support.ts:184` — `const CLONE_CHECKS = new Set(["duplicates", "near-duplicates"])`, declared twice, even though `triage-report.ts:15` already imports `mergeUniqueLocations` (and `driftDeferredReason`, `addReviewItem`) from the support module.
- `scripts/drift-triage/triage-report-support.ts:33-41` — `mergeUniqueLocations(target, additions): void` mutates an out-param, forcing a build-fresh-array dance at `triage-report.ts:131-132`, `triage-report-support.ts:122-124` and `:205-206`. Only `triage-report-support.ts:117` is a genuine merge-into-existing. (The adjacent `locationDetails` build calls the private `mergeUniqueLocationDetails` (`:43`) at `:118` and `:125` over `TriageLocation[]`, not this helper — out of scope for a `string[]` sibling.)
- `scripts/code-intel/server-cli.ts` — 15 occurrences of the `code-intel daemon: ` prefix (`:117`, `:120`, `:125`, `:132`, `:138`, `:143`, `:158`, `:166`, `:193`, `:198`, `:215`, `:230`, `:244`, `:271`, `:276`), 13 of which sit next to a literal `exitCode: 0`. The other two are `exitCode: 1` at `:214` and a pass-through `exitCode: stop.exitCode` at `:229`. Sites span `statusCommand` (`:107-145`), `stopCommand` (`:147-178`), `stopRunningDaemon` (`:180-200`), `stopUnverifiedDaemon` (`:202-219`), `restartCommand` (`:221-246`), `stopAbsentState` (`:268-278`).

Dead / no-op code and dead data:

- `scripts/drift-ai/hotspots-history.ts:194-196` — `finalizeRecord(record) { return { ...record, files: record.files }; }`; the spread already copies `files`. Callers at `:143`, `:152`.
- `scripts/code-intel/query-executor.ts:100-106` — `definitionNameMissHint` is a pass-through whose body is a single delegating `return queryDefinitionNearMatches(...)`. One caller, `:96`.
- `scripts/lint-message-eval/evaluator.ts:214` — `const modes = fixture.arms.map(arm => arm.mode).sort()`; `modes` is only used at `:215` as `new Set(modes)`, so the sort is provably dead. `setHasEvery` (`:98-100`) has exactly one call site (`:215`, the same line).
- `scripts/lint-message-eval/reporter.ts:11-18` `armFor` (throws on miss) and `scripts/lint-message-eval/evaluator.ts:168-170` `armIterations` (`?? null`) are the same `arms.find(a => a.mode === mode)` lookup with different miss handling.
- `scripts/path-policy/path-policy.ts:79` (type) and `:255` (value) — `directoryPrefixSubjects`. Its `.sourceRelevant` list (`:256-264`: `.husky/ packages/ e2e/ scripts/ tools/ eslint-config/ eslint-rules/`) is byte-identical to the seven `{kind:"prefix"}` selectors at `:171-177` and has zero readers anywhere in the repo. The only readers of the whole field are `scripts/path-policy/path-policy.test.ts:263-264`, and both assert on `.scriptSmoke`.
- `scripts/path-policy/path-policy.ts:217` and `:242` — `excludedDirectoryNames: ["node_modules", "worktrees", ".playwright-cli"]` duplicated between `shellSurfaces` and `configSurfaces` in the same object literal.
- `scripts/path-policy/path-policy-query-core.ts:116-119` — `matchesFormatCheckCandidate` reads `PATH_POLICY.formatCheckCandidates.parserSurface` into a `: string` local and compares it to `"prettier"`. `path-policy.ts:72` types that field as the literal `"prettier"` and `:248` sets it to `"prettier"` under `as const satisfies PathPolicy`, so the comparison is statically true; the widening annotation is the only thing keeping TS quiet. Wired at `path-policy-query-core.ts:175` through `pathFilter`, whose only other predicate is `path.length > 0` (`:121-124`) — so the query echoes every non-empty input. No explanatory comment anywhere near it.
- `scripts/path-policy/path-policy-smoke-subjects.ts:21` — `export const SCRIPT_SMOKE_TEST_NAMES = discoverScriptSmokeTestNames();` runs at import time; `discoverScriptSmokeTestNames` (`:6-19`) resolves `join(process.cwd(), "scripts", "tests")` and does `existsSync` + `readdirSync`, falling back to `Object.keys(SCRIPT_SMOKE_SUBJECTS)` when the directory is absent. `scripts/path-policy/path-policy-query-core.ts:2` imports it eagerly and reads it three times in `smokeTestsForPaths` (`:141-158`).

## Proposed direction

Each numbered step is one commit. Steps 1-3 are independent of each other; do them
in whatever order suits, but land 4 before 5.

1. **Finish adopting `scripts/lib/records.ts`.** Convert the seven remaining
   `scripts/` declarations, choosing `isRecord` or `isObjectLike` per call site
   rather than assuming the strict one. `sensor-knip-unused-exports-baseline.ts:32`,
   `sensor-near-duplicates-baseline.ts:26` and `suppression-ledger-baseline.ts:33`
   are private and are plain import swaps. `drift-ai/config-readers.ts:10` and
   `code-intel/json-utils.ts:27` are exported and have seven and five importers
   respectively, so re-export from `scripts/lib/records.ts` under the existing
   names rather than churning the importers; their `UnknownRecord`/`JsonRecord`
   return types are aliases of `Record<string, unknown>`, so the shared predicate
   substitutes without re-typing. Point `logs-audit/logs-audit-redaction.ts:56`
   `isJsonObject` at the shared guard too, keeping the exported name its two
   siblings import. Convert the private arrow at
   `scripts/lib/verify-metadata-core.ts:58` in the same commit — an un-adopted
   copy inside `scripts/lib/` is the one that most invites the next one. Do not
   create a second guards module.
2. **Sweep the remaining error ternaries onto `errorMessage`.** Import
   `scripts/lib/error-message.ts` at the 44 non-test `scripts/` sites, densest
   first (`mutation-survivors.ts`, `db-status.ts`,
   `harness/registration-generated-checks.ts`, then `drift-ai/`). Skip any caller
   that needs more than the message — a `stderr`/`stdout` payload or a structured
   fallback — which the helper's docstring already carves out; leave those with
   their own local helper and say so in the commit. Go directory by directory, not
   in one 44-site sweep.
3. **Collapse the harness finding record onto its schema.** Add one shell helper
   (`scripts/lib/harness-finding.sh` exporting `emit_harness_finding`) taking
   `control`, `severity`, `why`, `howToFix` as required and `path`, `line`,
   `messageId` as optional — mirroring `doctor.sh:82-89`'s existing `emit_finding`,
   which already defaults `path`/`line` via `${6:-}`/`${7:-}` and validates that
   `line` is numeric. Keep `messageId` optional so converting
   `generate-module-index.sh:82,84` does not have to invent one, and keep the
   "line requires `path`" invariant so the helper cannot construct a finding
   `harnessFindingSchema` rejects. Source it from `doctor.sh`, `verify-logs.sh`,
   `migration-safety-scan.sh`, and `generate-module-index.sh`. Add a smoke
   assertion that the emitted object still parses against `harnessFindingSchema`
   via `scripts/harness-emit-envelope.ts`. `generate-module-index.sh:82,84` is the
   highest-value convert: it is the one producer that does not even use `jq`.
4. **Fix `drift-ai` ownership of the source-extension set and the scope
   converters.** Delete `SOURCE_LIKE_EXTS` from `scripts/drift-ai/path-util.ts` and
   keep `BUILT_IN_SOURCE_EXTENSIONS` — that is the name `scripts/drift-ai.ts:109`
   already re-exports and the one `scope.ts:49` `buildSourceExtensions` builds on.
   Update the two importers (`ghost-files-match.ts:11`, and `ghost-files.ts:10` via
   dropping the `ghost-files-tokens.ts:5` pass-through in favour of a direct
   import). Move `changedFilesFromScope` next to its inverse `toChangedScopeFile`
   in `scope.ts` so the pair is readable in one place. `path-util.ts` already
   depends on `scope.ts`, so this removes an edge rather than adding one.
5. **Normalise `scripts/drift-ai/arg-readers.ts`.** Flip `readPath` to
   `(value, flag)` to match its four siblings, update the three call sites in
   `subcommand-args.ts` (`:65`, `:70`, `:131`), and either fold it into
   `readNonEmptyPath` or rename it to say what makes it different (it does not
   trim). Separately, rename the unrelated private `readPath` in
   `scripts/drift-ai/dolos-output.ts:142` to something like `readCsvColumn` so
   the directory stops carrying two different `readPath`s.
6. **De-duplicate `scripts/drift-triage/`.** Delete the `CLONE_CHECKS` copy in
   `triage-report.ts:51` and import it from `triage-report-support.ts` (which
   `triage-report.ts:15` already imports from). Then add a pure
   `uniqueLocations(...lists): string[]` beside `mergeUniqueLocations` in the
   support module and use it at the three build-fresh sites
   (`triage-report.ts:131-132`, `triage-report-support.ts:122-124`, `:205-206`),
   leaving the mutating `mergeUniqueLocations` for the one genuine
   merge-into-existing caller at `triage-report-support.ts:117`. Leave the
   `mergeUniqueLocationDetails` calls at `:118`/`:125` alone — different helper,
   different element type.
7. **Add result constructors to `scripts/code-intel/server-cli.ts`.** A single
   `daemonResult(exitCode: number, message: string)` that applies the
   `code-intel daemon: ` prefix, with thin `ok(message)` / `failure(message)`
   wrappers over it. It must support all three shapes — the 13 `exitCode: 0`
   literals, the `exitCode: 1` at `:214`, and the pass-through
   `exitCode: stop.exitCode` at `:229`. An ok/failure pair alone is not enough.
8. **Fold `scripts/drift-ai/coverage-unused-correlation.ts` onto one
   `unavailable(base, pathMatch, note)` factory** used by all three returns at
   `:170-179`, `:183-192`, `:206-215`.
9. **Unify the shared vocabulary inside `scripts/path-policy/`.** Export one
   smoke-file pattern (and one predicate over it) from a single module in that
   directory and point `path-policy-query-core.ts:132`,
   `fixture-shell-dependencies.ts:39`, `smoke-subject-headers.ts:7` and
   `path-policy-smoke-subjects.ts:13` at it. The two existing regexes are *not*
   equivalent — one is anchored at `scripts/tests/` and one is a bare basename
   match — so the consolidation must keep both meanings, e.g. a basename predicate
   plus a directory-qualified wrapper. Do not silently collapse them into one.
   Separately, the path normaliser already has an owner:
   `fixture-copy-expressions.ts:65` `normalizePath` is exported and consumed by
   three sibling modules, so the work is deleting the two unaware copies
   (`smoke-subject-headers.ts:24`, and `path-policy-query-core.ts:36`
   `normalizeComparablePath`) and importing it instead; if
   `fixture-copy-expressions.ts` is judged too narrow a home for a directory-wide
   normaliser, move it to the same new shared module as the pattern and update its
   three existing importers in the same change. Do the same for the byte-identical
   `stripQuotes`/`capture` pair: `fixture-helper-calls.ts:46-60` should import the
   exports at `fixture-copy-expressions.ts:69-83`.
10. **Delete the dead code.** `finalizeRecord` in
    `scripts/drift-ai/hotspots-history.ts:194-196` (inline the spread at `:143`
    and `:152`), `definitionNameMissHint` in
    `scripts/code-intel/query-executor.ts:100-106` (inline at `:96`), the dead
    `.sort()` at `scripts/lint-message-eval/evaluator.ts:214`, and the
    single-caller `setHasEvery` at `:98-100`. Unify
    `scripts/lint-message-eval/reporter.ts:11-18` `armFor` and
    `scripts/lint-message-eval/evaluator.ts:168-170` `armIterations` onto one
    lookup with an explicit missing-arm policy.
11. **Delete `PATH_POLICY.directoryPrefixSubjects.sourceRelevant`** at
    `scripts/path-policy/path-policy.ts:256-264` and its type field at `:79`
    (keeping `.scriptSmoke`, which `path-policy.test.ts:263-264` asserts on), or
    derive it from the `{kind:"prefix"}` selectors at `:171-177` if a reader is
    genuinely planned. Hoist the duplicated
    `excludedDirectoryNames` literal shared by `:217` and `:242` to one `const`.
12. **Resolve the constant-true predicate at
    `scripts/path-policy/path-policy-query-core.ts:116-119`.** Two honest
    outcomes: either delete `matchesFormatCheckCandidate` and let the
    `formatCheckCandidates` query be the plain non-empty filter it already is,
    or keep the runtime check and add a comment saying it is a guard against a
    future non-prettier `parserSurface` value. What must not survive is a
    `: string` widening annotation with no explanation.
13. **Make `SCRIPT_SMOKE_TEST_NAMES` lazy.** Turn
    `scripts/path-policy/path-policy-smoke-subjects.ts:21` into a memoised
    `scriptSmokeTestNames()` function (or one that takes an explicit repo root
    instead of reading `process.cwd()`), and update the three reads in
    `scripts/path-policy/path-policy-query-core.ts:141-158`. Consider renaming
    the module to say it exports *test names*, since the sibling
    `path-policy-smoke-subjects-data.ts` owns the subjects.

## Scope / caveats

- **`tools/lint-ratchet/` is out of scope for steps 1 and 2.** It is
  `@musi/lint-ratchet`, a sealed repo-agnostic package, and
  `tools/lint-ratchet/test/boundary/check-package-boundary.ts:260` fails any
  relative import that escapes the package. Its seven local record guards and six
  inline error ternaries must not be pointed at `scripts/lib/`. If they are worth
  de-duplicating at all it is inside the package, as separate work under
  `tools/lint-ratchet/src/kernel/`.
- **`scripts/lib/records.ts` is the guard's home; `config-readers.ts` is not.**
  `scripts/drift-ai/config-readers.ts:3-5` has runtime imports of
  `./config-paths.js`, `./errors.js` and `./path-util.js`, so importing it from
  `knip-runner.ts` just for a type guard would drag config parsing into every knip
  module. It re-exports; it does not own.
- **`scripts/codemods/lib/fixture-runner.test-helper.ts:151` is a same-named but
  different `errorMessage`.** It adds a string passthrough and a `JSON.stringify`
  fallback and behaves differently on non-`Error` inputs. Leave it where it is;
  do not collapse it into `scripts/lib/error-message.ts` and do not let step 2's
  sweep rewrite its callers.
- **The smoke-file regexes are not interchangeable.** `/^scripts\/tests\/test-[^/]+\.sh$/u`
  matches a repo-relative path; `/^test-.+\.sh$/u` matches a bare filename. Step 9
  must preserve both meanings. Consolidating to whichever one you happened to
  read first will silently change which files the path policy classifies as smoke
  subjects, and the path policy feeds the commit gate.
- **`isRecord` and `isObjectLike` are not interchangeable either.** An array is
  `typeof "object"` and non-null, so `isObjectLike` narrows `unknown[]` to
  `Record<string, unknown>` and lets a caller read a field that is always
  `undefined`. Step 1 must pick per call site, not globally.
- **`mergeUniqueLocations` must keep its mutating form.** There is one legitimate
  merge-into-existing caller at `scripts/drift-triage/triage-report-support.ts:117`.
  Step 6 adds a pure sibling for the three build-fresh sites; it does not replace
  the mutator.
- **`server-cli.ts` needs three result shapes, not two.** 13 `exitCode: 0`
  literals, one `exitCode: 1` at `:214`, and one pass-through
  `exitCode: stop.exitCode` at `:229`. An ok/failure pair cannot express the
  pass-through.
- **This leaf must be split before it is scheduled; the L rating is per-part,
  not for the whole.** Thirteen commits across five directories is not one unit
  of work. Land it as three leaves: the cross-cutting helper layer (steps 1-3, of
  which step 3 is the bulk), the `drift-ai`/`drift-triage`/`code-intel` local
  clean-ups (steps 4-8 and 10), and `scripts/path-policy/` duplication, dead data
  and import-time filesystem reads (steps 9 and 11-13). Each part is M or
  smaller. Do not schedule the thirteen steps as a single work item.
- **Any new `scripts/lib/` file that a smoke fixture copies must be registered.**
  Add it to `scripts/path-policy/path-policy-smoke-subjects-data.ts` and give the
  consuming smoke a `# smoke-subjects:` header, or the fixture copy-set gate
  fails: every copied fixture input now needs a registered subject, and copy forms
  the model cannot resolve fail loudly instead of being skipped. `scripts/lib/records.ts`
  is the worked precedent — it appears 19 times in
  `path-policy-smoke-subjects-data.ts`. This applies to step 3's
  `scripts/lib/harness-finding.sh`.
- `scripts/path-policy/` feeds the changed-file classification used by
  `verify:changed` and the commit gate. Changes there are behaviour changes to
  the gate even when they look like refactors — run the path-policy smoke subject
  and `bun run harness:check` before committing steps 9 and 11-13.
- If you decide to prevent recurrence with a lint rule (a `no-local-isRecord`
  style restriction), read `docs/guides/local-eslint-rules.md` first, and
  `docs/guides/lint-ratchet.md` before touching any ratcheted count — a new rule
  that fires across the tree must land through the ratchet, not as a red build.
- **Sequence step 13 after leaves 27 and 32.** Both of those add a new
  `scripts/tests/test-*.sh` file and register it in
  `scripts/path-policy/path-policy-smoke-subjects-data.ts`; step 13 changes how
  `scripts/path-policy/path-policy-smoke-subjects.ts` discovers smoke test names
  from that same directory and data module (`discoverScriptSmokeTestNames` reads
  `scripts/tests/` and falls back to `Object.keys(SCRIPT_SMOKE_SUBJECTS)`).
  Landing step 13 mid-extraction means debugging a discovery change and a
  subject-registration change at once.
- **Step 3's helper belongs in `scripts/lib/`.** That is the documented home for
  shared shell helpers sourced by multiple script families (`scripts/README.md:61`,
  alongside `gate-env.sh` and `parallel-step.sh`), and step 3's consumers —
  `doctor.sh`, `verify-logs.sh`, `migration-safety-scan.sh`,
  `generate-module-index.sh` — are production scripts. Because `scripts/lib/` is
  sourced by `scripts/verify.sh` and the hooks at runtime, keep the new helper
  pure — function definitions only, no side effects at source time — and run
  `bun run harness:check` before committing step 3.
- **Leaf 49 documents this directory.** Its step 1 writes the
  `scripts/path-policy/` fixture-analyzer `MODULE.md` and its step 3 refiles the
  803-line test. Steps 9 and 11-13 here change the helpers and import lines that
  doc describes; do not work the two concurrently. If this leaf lands first,
  leaf 49's Data Flow section describes the unified helpers.
- TDD applies: each of steps 1-10 has an existing test surface next to the module
  being changed. Add or extend the focused test before the edit, and use
  `bun run test:scripts:file -- <file>` for the scripts project.
