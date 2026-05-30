# drift:ai — Code Quality, Maintainability & Architecture Review

Analysis-only. Scope: `scripts/drift-ai.ts` + all `scripts/drift-ai/*.ts`
(~7300 LOC) + `scripts/drift-ai.test.ts` (1642 lines). Does **not** repeat
detector-output findings (`drift-ai-current-findings.md`) or lint-adoption
mechanics (lint-followups 32/33/34) — but High-1 diagnoses a structural side
effect of those splits.

## Summary

Well-engineered overall: pure analysis is cleanly separated from I/O via injected
runners, error handling is consistent (`DriftAiError` + report-only contract),
tests inject fakes through DI seams (no `vi.mock`). Maintainable as-is. Two
structural issues dominate:

1. **Helper duplication across max-lines-driven `*-runner` splits** — mechanical
   cleanup, removes a real correctness-drift risk (High-1).
2. **Check dispatch is over-abstracted and bespoke per check** — adding a check
   touches 5 files / ~8 sites; `exactOptionalPropertyTypes` turns every context
   hop into conditional-spread noise (High-2/3). A check-plugin registry collapses
   this and is the **single highest-leverage structural recommendation**.

---

## High

### High-1 — Identical private helpers copy-pasted across max-lines splits

`local/max-lines` (300 lines) forced three modules to split in half; shared
private helpers were copy-pasted across the seam instead of extracted. The file
headers state the intent (`duplicates-runner.ts:2`, `suppressions-parse.ts:2`,
`harness-freshness-io.ts:2`: "to keep each module under the max-lines ratchet").

Duplicated definitions (found via `rg "function <name>"`):
- `toPosix` ×4 (`ghost-files-tokens.ts:103` exported, `duplicates.ts:170`,
  `duplicates-runner.ts:201`, `comments.ts:192`) — **three are not equivalent**:
  ghost-files does `replace(/\\/gu,"/").split(path.sep).join("/")`, comments does
  only `split(path.sep).join("/")`, duplicates delegates to `normalizeRepoPath`
  (also trims `./` + trailing slash). So a path may normalize differently between
  the duplicates and comments checks.
- `isSourceLike` ×4 (same files), `uniqSorted` ×3 (`ghost-files-tokens.ts:82`,
  `config.ts:158`, `config-parsing.ts:252`).
- `changedFilesFromScope` — **byte-identical** between `ghost-files-changed.ts:86`
  and `duplicates-runner.ts:295` (verified with `diff`); third map variant in
  `suppressions.ts:60`.
- `isExcludedFromDuplicates` + `configuredRootFor` duplicated *within* the
  `duplicates.ts`/`duplicates-runner.ts` pair (lines 181/238 vs 209/213).
- Sort comparator duplicated verbatim: `sortFindings` (`ghost-files-findings.ts:53`)
  vs `sortDuplicateFindings` (`duplicates-runner.ts:288`).

This is exactly the drift the tool detects — and `toPosix` has already diverged.

**Change.** New `scripts/drift-ai/path-util.ts` exporting canonical `toPosix`,
`isSourceLike`, `uniqSorted`, `changedFilesFromScope`, `sortFindingsByFileMessage`;
import everywhere. Pick the `normalizeRepoPath`-based `toPosix` as canonical, pin
the chosen normalization with a test, and verify ghost-files/comments fixtures
still pass. Unblocks Med-3.

### High-2 — Check dispatch is over-abstracted and bespoke per check

A check call flows: `resolveRunContext` (`runner.ts:41`) builds a `CheckContext`
→ `buildReport` (`report-builder.ts:150`) → `buildCheckRunnerContext`
(`report-builder.ts:124`) rebuilds a near-identical `CheckContext` field-by-field
→ `CHECK_RUNNERS[check]` (`report-builder.ts:38-95`), where each entry re-derives
config, branches on `scopeMode`, and resolves ignore globs via four free helpers.

Problems:
1. `CheckContext` (`report-builder.ts:21-34`) is an 11-field god-bag of optionals;
   every check receives the union of all deps though `comments` needs only
   `readFile`, `ghost-files` never touches `jscpd`. Leaky abstraction.
2. Context is built (`runner.ts:59-78`) then immediately rebuilt
   (`report-builder.ts:130-147`) only to swap `detectorScope`/`roots`/
   `inventoryByDir` — a shallow spread, blocked by the strict-optional idiom (High-3).
3. No shared check contract — `CHECK_RUNNERS` is a `Record` of opaque closures.

Adding a check today = `types.ts` (union + `ALL_CHECKS`) + `report-builder.ts`
(`IMPLEMENTED_CHECKS`, `CHECK_RUNNERS`, maybe `checkRunsForScope`) + thread any new
dep through `RunOptions`/`resolveRunContext`/`CheckContext`/`buildCheckRunnerContext`
(4 sites) + `cli-args.ts` usage+error strings.

**Change — check-plugin registry:**

```ts
export type CheckRunContext = {
  detectorScope; config; roots; sourceExtensions; repoRoot;
  suppressionDiffRef: string | null;
  inventoryByDir: ReadonlyMap<string, readonly string[]> | undefined;
  warnStderr; deps: CheckDeps;   // jscpd, listDirectory, readFile, suppressionsGit
};
export type CheckPlugin = {
  id: DriftCheckId; usage: string;
  runsForScope: (mode: ScopeMode) => boolean;   // default () => true
  run: (ctx: CheckRunContext) => DriftFinding[];
};
export const CHECK_PLUGINS = [duplicatesCheck, ghostFilesCheck, commentsCheck, suppressionsCheck];
```

`buildReport` = filter by `runsForScope`, build context **once**, `flatMap`
`plugin.run`. `ALL_CHECKS`/`IMPLEMENTED_CHECKS`/`checkRunsForScope`/the four
ignore-glob helpers/`buildCheckRunnerContext` collapse into plugins + one context
build. `cli-args.ts` usage + "unknown check" derive from `CHECK_PLUGINS`. Adding a
check = write one plugin file, append it. Keep `harness-freshness` *outside* the
registry (distinct subcommand + finding type, Med-1).

### High-3 — `exactOptionalPropertyTypes` conditional-spread noise

The `...(x === undefined ? {} : { x })` idiom appears 16× in non-test code,
concentrated in context-threading: `report-builder.ts` ×7, `prepare-run.ts` ×2,
`cli-args.ts` ×2, `runner.ts:64-70`. `runner.ts:64-70` and
`report-builder.ts:134-146` re-spread the *same* optional values twice. The idiom
itself is the correct way to honor the strict flag — the volume is the symptom.

**Change.** Mostly dissolved by High-2 (build context once → drop the 8 spreads in
`buildCheckRunnerContext`). For remaining optionals, prefer explicit-`null`
modeling (as `PreparedRun.suppressionDiffRef: string | null` already does) over
`?`-optional+spread, or a tiny `omitUndefined(obj)` helper. Do **not** relax the
strict flag repo-wide.

---

## Medium

### Med-1 — `harness-freshness` is a parallel mini-pipeline with a divergent shape
Not a `DriftCheckId`; separate subcommand (`runner.ts:124`) with its own
`HarnessFreshnessFinding` (`harness-freshness.ts:25`, **required** `details` vs
`DriftFinding.details?`), its own text formatter (`harness-freshness.ts:107`,
duplicating the `WARN … — … / FIX:` rendering in `report-format.ts:31-34`), and
its own repo-confinement I/O factories (`harness-freshness-io.ts:28`) — a 4th copy
of "safe repo-relative reader" (cf. `comments.ts:215`, `ghost-files.ts:28`).
**Change.** Keep it a separate subcommand, but share (a) a `formatFindingLines`
renderer between both formatters; (b) one `safeRepoPath`+reader/listing factory —
promote the `harness-freshness-io.ts` version into High-1's path-util, delete the
others.

### Med-2 — `details` under-used; `schemaVersion` has no constant
`DriftFinding.details?` (`types.ts:26`) is set only by suppressions
(`suppressions-parse.ts:306`), so JSON consumers can't rely on it. `schemaVersion`
is literal `1` at 6 sites (`types.ts:30,43,63`, `report-builder.ts:175`,
`chunks.ts:23,47`) — value and type can drift on a v2 bump.
**Change.** `export const DRIFT_SCHEMA_VERSION = 1 as const`, reference everywhere,
type as `typeof DRIFT_SCHEMA_VERSION`. Either populate `details` for all checks
(data exists, e.g. `GhostFileMatch.kind/sharedTokens`, duplicate `lines`) or
document it as suppressions-only.

### Med-3 — Reconsider max-lines splits after helpers are shared
`duplicates`/`duplicates-runner` and `suppressions`/`suppressions-parse` were split
for the 300-line ceiling, not by responsibility — `duplicates-runner.ts` holds the
subprocess *and* a 2nd copy of scope-mapping; `duplicates.ts:259-267` re-exports
symbols it imported from the runner (round-trip smell). After High-1, re-split
along a real axis (e.g. `duplicates-jscpd-report.ts` = pure parse/build vs
`duplicates-runner.ts` = subprocess+orchestration) if still over ceiling.

### Med-4 — Two near-identical hand-rolled comment/string lexers
`comments.ts:86-170` (`classifyLine`/`advanceCode`/`advanceInString`/
`advanceBlockComment`) and `suppressions-parse.ts:58-142` (`scanCommentSegments`/
`advanceSegment*`) are structurally parallel state machines (both track
`inBlockComment` + `inString: StringDelim|false`, both handle `//`,`/*`,quotes,
backslash escapes). Outputs differ (ratio counts vs comment segments). Highest
*correctness*-drift risk — an escape/template-literal edge-case fix won't
propagate.
**Change** (Medium, harder): extract a shared `scanLine(line, state, visitor)`
core; build the ratio counter and segment extractor as two visitors. Minimum:
share `StringDelim` + the low-level delim/escape advance.

### Med-5 — `runDriftAi` error handling duplicated; harness-freshness bypasses it
Two near-identical try/catch blocks map `DriftAiError`→exit 2 (`runner.ts:86-93`,
`95-104`). `runHarnessFreshnessSubcommand` does ad-hoc arg validation
(`runner.ts:137-141`) with a different error shape (no `usage()`).
**Change.** Extract one `DriftAiError`/`DriftAiHelp`→exit-code wrapper; route
harness-freshness arg errors through `DriftAiError`.

---

## Low

- **Low-1** `cli-args.ts` parser dispatch is grouped by I/O type, not by option:
  `parsePathOption` (`:104`) and `parseOutputOption` (`:128`) multiplex several
  flags via inner `optionNameFor` branching, and `OPTION_PARSERS` (`:197`) points
  multiple keys at each. Prefer one small parser per option or a declarative table.
- **Low-2** `globToRegExp` (`config.ts:124-152`) is a hand-rolled glob engine — a
  4th glob semantics in the repo. Fine now; candidate for a vetted dep *if*
  extracted standalone (coordinate with extraction task).
- **Low-3** `cloneDefaultConfig` (`config-paths.ts:35-58`) is a hand-maintained
  deep clone; a new config array field silently leaks a shared reference if missed.
  Prefer `structuredClone` or a deep-independence test.
- **Low-4** Ghost-files tuning knobs are buried as module-private sets
  (`ENTRY_POINT_STEMS` `ghost-files-match.ts:84`; `WEAK_TOKENS`/
  `PEER_EXCLUDE_PATTERNS`/`SINGULAR_INVARIANTS` `ghost-files-tokens.ts:5-25`).
  Surface weak-tokens/entry-points via `DriftAiGhostFilesConfig` if ghost-files
  tuning is prioritized.
- **Low-5** `intersection` (`ghost-files-tokens.ts:94`) is O(n²) via `out.includes`;
  tiny inputs so cosmetic, but a `Set` dedup matches the file's style.

---

## Type design (`types.ts`)

Good: `ScopeFile` discriminated union (`scope.ts:5-17`) with consistent
`file.scope !== "changed"` guards; right-sized status union.
Weak: `DriftFinding.details?` is both too loose (any string key) and under-used
(Med-2). Duplicate findings string-pack location into `file` as `"path:start-end"`
(`duplicates.ts:104`) + free-text message; a machine consumer (the `chunks.ts`
machinery implies one) must re-parse. Structured `details` would serve better.

## Tests

Strong, behavior-focused, real fakes via DI (no `vi.mock`). The 1642-line
integration test covers `parseArgs`/`parseNameStatus`/`parseDriftAiConfig`/ref
resolution/`buildReport` no-op fallback/full `runDriftAi` both scopes incl.
jscpd-clone + ghost-pair fixtures. Gaps:
- **`chunks.ts` has no dedicated test** — `chunkIndex`/`chunkCount` math (`:29`)
  and `orderedChunkChecks` extras-sorting (`:73`) only exercised indirectly; pin
  empty/single-oversized/extras-ordering edge cases.
- **`report-output.ts`** json+no-output-path warns-to-stderr branch
  (`writeReportOutputs:30-38`) deserves a focused test.
- Do **not** add a test for `buildCheckRunnerContext` — it disappears under High-2.

## Newcomer barriers (ranked)
1. 8-touchpoint check-addition flow (High-2).
2. Which `toPosix`/`isSourceLike` to reuse + that they differ (High-1).
3. Why `harness-freshness` is wired unlike the four real checks (Med-1).
4. Double context build + conditional spreads reads as accidental complexity (High-3).

## Suggested order
1. **High-1** (path-util) — mechanical, removes correctness-drift risk, unblocks Med-3.
2. **High-2** (plugin registry) — after High-1; dissolves most of High-3 + Med-5.
3. **Med-2** (schema constant + details policy) — trivial, do alongside.
4. **Med-1 / Med-4** (shared renderer + lexer) — correctness-relevant, more involved.
5. Low items opportunistically.
