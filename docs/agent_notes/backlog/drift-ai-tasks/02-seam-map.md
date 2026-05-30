# drift:ai — Code Seam Map (verified)

Verified against source on 2026-05-29 by the `mapper` agent during the
decomposition pass. Line numbers were re-checked against the actual files (the
older `drift-ai-review/` notes cite line numbers that have since drifted — prefer
**this** file's anchors, but always re-confirm before editing, since the source
moves).

Paths are relative to `scripts/drift-ai/` unless prefixed with `scripts/`.

---

## 1. Entry / dispatch
- `scripts/drift-ai.ts:1–71` — public API re-exports (`runDriftAi`, `DriftAiError`,
  `buildReport`, `formatJson`/`formatText`, git/scope helpers, type exports). This
  is the library surface; new public symbols get re-exported here.
- `runner.ts:81–122` — `runDriftAi` (main entry: arg parse → git context → report).
  - `runner.ts:82–84` — `argv[0] === "harness-freshness"` subcommand branch (the
    precedent for a new bespoke subcommand like `hotspots`).
  - `runner.ts:91–92, 102` — `DriftAiError → exit 2` try/catch blocks (duplicated).
  - `runner.ts:108–112` — `warnForUnsupportedDuplicateExtensions` call
    (fn defined `runner.ts:160–173`).
  - `runner.ts:124–150` — `runHarnessFreshnessSubcommand` (bespoke arg handling,
    no `--format`/`--output` parity).

## 2. Check dispatch
- `report-builder.ts:38–95` — `CHECK_RUNNERS` record: `duplicates` (38–62),
  `ghost-files` (63–77), `comments` (78–85), `suppressions` (86–94).
- `report-builder.ts:21–34` — `CheckContext` 11-field god-bag (detectorScope, jscpd,
  listDirectory, inventoryByDir, readFile, suppressionsGit, repoRoot,
  suppressionDiffRef, config, roots, sourceExtensions, warnStderr).
- `report-builder.ts:124–148` — `buildCheckRunnerContext` (rebuilds CheckContext
  per check; the conditional-spread noise lives here).
- `report-builder.ts:150–186` — `buildReport` (orchestrator; output struct built
  `174–185` in scope-then-findings key order).
- `report-builder.ts:97–102` — `IMPLEMENTED_CHECKS`.
- `report-builder.ts:188–191` — `checkRunsForScope` (suppressions skipped in current).
- `types.ts:3` — `DriftCheckId = "duplicates" | "ghost-files" | "comments" | "suppressions"`.
- `types.ts:5–10` — `ALL_CHECKS` (canonical order).
- `types.ts:20–27` — `DriftFinding` (check, file, message, hint?, relatedFiles?, details?).
- `types.ts:29–40` — `DriftReport` (schemaVersion, scopeMode, base, resolvedRef,
  roots, configPath, enabledChecks, skippedChecks, scope, findings).
- `schemaVersion` literal `1` at **six** sites: `types.ts:30`, `types.ts:43`
  (`DriftFindingChunk`), `types.ts:63` (`DriftChunkManifest`),
  `report-builder.ts:175`, `chunks.ts:23`, `chunks.ts:47` — no shared constant.
  (`report-format.ts` does not emit the version.)

## 3. Shared-helper duplication (target of the path-util task)
- `toPosix` / `normalizeRepoPath`:
  - `config-parsing.ts:60–65` — exported `normalizeRepoPath` (canonical: splits on
    `path.sep`, trims `./`, etc.); also `collapseRepoPath` (67–71),
    `pathEscapesRepo` (73–75).
  - `duplicates-runner.ts:201–203` — private `toPosix` wraps `normalizeRepoPath`.
  - `normalizeRepoPath` consumers: `config.ts:100–103` (`pathHasAnySegment`),
    `config.ts:106` (`pathHasAnyPrefix`), `config.ts:112` (`matchesAnyGlob`).
- `isSourceLike`:
  - `ghost-files-tokens.ts:67–72` (param `sourceExtensions`, default `SOURCE_LIKE_EXTS`) — more complete.
  - `duplicates-runner.ts:205–207` (param `supportedExtensions`).
- `uniqSorted`:
  - **defined** `ghost-files-tokens.ts:82–84` (exported).
  - imported `ghost-files-match.ts:11`, `ghost-files-current.ts:9`.
- `changedFilesFromScope` — **byte-identical** in `duplicates-runner.ts:295–306`
  and `ghost-files-changed.ts:86–97`. (No copy in `ghost-files-current.ts`.)
- sort comparator — identical logic: `sortDuplicateFindings`
  (`duplicates-runner.ts:288–293`) vs `sortFindings` (`ghost-files-findings.ts:53–58`).
- `isExcludedFromDuplicates` (`duplicates-runner.ts:209–211`), `configuredRootFor`
  (`duplicates-runner.ts:213–220`) — duplicated patterns vs `ghost-files-tokens.ts`
  (`isExcludedPath` 58–65).

## 4. jscpd resolution
- `duplicates-runner.ts:51–104` — `defaultJscpdRunner` factory.
  - `:52` — `repoRoot = options.repoRoot ?? process.cwd()` (used for BOTH bin and cwd).
  - `:73` — bin: `path.join(repoRoot, "node_modules", ".bin", "jscpd")`.
  - `:75` — subprocess `cwd: repoRoot`.
  - `:79` — ENOENT / `result.error` handling.
  - `:188` — missing-binary hint text ("ensure node_modules/.bin/jscpd is installed.").

## 5. Git seam (hotspots + scope foundation)
- `git-changed-scope.ts:18` — `GitRunner = (args: readonly string[]) => string`.
- `git-changed-scope.ts:20–22` — `defaultGitRunner` (wraps `execFileSync("git", …)`).
- `git-changed-scope.ts:99–109` — `isIgnoredPath` (segments, prefixes, globs, then
  `DEFAULT_IGNORE_EXTENSIONS`/`DEFAULT_IGNORE_FILES`).
- `git-changed-scope.ts:111–116` — `filterScope` (drops ignored from `ChangedFile[]`).
- `git-changed-scope.ts:60–76` — `parseNameStatus` (A/M/R/C/D).
- `git-changed-scope.ts:118–129` — `discoverChangedFiles` (`git diff --name-status <ref>`
  + `git ls-files --others --exclude-standard`, deduped). NOTE: `:119` is where a
  shallow-clone `git diff` SIGSEGV surfaces (see 01-shared-context).

## 6. Reporting / chunking
- `report-format.ts:21–36` — `formatText` (header `3–19`; findings "WARN check: file — message";
  "FIX: …"). Clean/empty branch `:24–25` ("no implemented checks selected.");
  skipped line `:16` ("skipped: {checks} (not run for this scope)").
- `report-builder.ts:174–185` — DriftReport key order (scope before findings).
- `chunks.ts:5–36` — `groupFindingsForChunks` (groups by check `:15`, slices at
  chunkSize; chunk `check` = `slice[0].check` `:20,:31`; chunkIndex/chunkCount).
- `chunks.ts:86` — filename `${index.padStart(3,"0")}-${check}.json`.
- `report-output.ts:23–38` — `writeReportOutputs`; JSON-without-output-path → stderr
  warn branch `:33–35`.
- `cli-args.ts:24–39` — usage text (`--format`, `--output`, `--check`, `--root`,
  `--config`, `--chunk-dir`/`--chunk-size`).

## 7. Ghost-files Musi-isms
- `ghost-files-findings.ts:12–14` — `repairHint` ("bun run code:intel -- dependents <peerPath>").
- `ghost-files-findings.ts:32–36` — `currentPairHint` (lists both dependents commands).
- `ghost-files-tokens.ts:5–16` — `WEAK_TOKENS`; `:18–23` `PEER_EXCLUDE_PATTERNS`;
  `:25` `SINGULAR_INVARIANTS`.
- `ghost-files-match.ts:47,77` — Levenshtein edit-distance cap (hardcoded `2`).

## 8. harness-freshness
- `harness-freshness.ts:63` — `DEFAULT_HARNESS_PATH = "docs/ai-harness.md"`.
- `harness-freshness.ts:64` — `DEFAULT_GUIDES_DIR = "docs/guides"`.
- `harness-freshness.ts:42–50` — `RunHarnessFreshnessCheckOptions`
  (`harnessPath?`, `guidesDir?`, readers/listing/exists/ignore) — exist but NOT CLI-wired.
- `harness-freshness.ts:107–118` — `formatHarnessFreshnessText` (bespoke formatter).
- `harness-freshness-io.ts:35–100` — defaultFileReader/DirectoryListing/PathExists/PathIgnored
  (a 4th copy of the "safe repo-relative reader").

## 9. Lexers (shared-lexer candidate)
- `comments.ts:62–84` — `analyzeCommentMetrics`; `:93–101` `advanceBlockComment`;
  `:103–113` `advanceInString`; `:115–123` `advanceCode`; `:125–150+` `classifyLine`.
- `suppressions-parse.ts:58–75` `advanceBlockSegment`; `:77–86` `advanceSegmentString`;
  `:94–100+` `advanceSegmentCode`; `scanCommentSegments` (same file).
- Both are structurally-parallel state machines (track `inBlockComment` +
  `inString`, handle `//`, `/*`, quotes, backslash escapes). Outputs differ.

## 10. Config
- `config.ts:124–150+` — `globToRegExp` (hand-rolled glob compiler).
- `config-paths.ts:35–58` — `cloneDefaultConfig` (hand-maintained deep clone).
- `config-parsing.ts` — `normalizeRepoPath` + config parse helpers.
- `drift-ai.config.json` (committed): `roots` = packages/{shared,server,client}/src,
  scripts, eslint-rules; `ignore.prefixes` = ["docs/", "packages/server/prisma/migrations/"];
  `checks["ghost-files"].currentAllowedPairs` (6 Musi pairs);
  `checks.comments.excludePrefixes` = ["scripts/", "eslint-rules/"].

## 11. Tests
- Present: `comments.test.ts`, `current-inventory.test.ts`, `duplicates.test.ts`,
  `ghost-files.test.ts`, `harness-freshness.test.ts`, `scope.test.ts`,
  `suppressions.test.ts`.
- `chunks.ts` has **no dedicated test**.
- DI-fakes pattern throughout (no `vi.mock`): injected `FileReader`, `GitRunner`,
  `JscpdRunner`, `DirectoryListing`.

## 12. Dependency availability (tools checkout = this worktree)
| Dep | Present? | Version | bin |
|---|---|---|---|
| jscpd | yes | 4.2.3 | `node_modules/.bin/jscpd` |
| ts-morph | yes | ^28.0.0 | (library, no bin) |
| knip | yes | 6.14.1 | `node_modules/.bin/knip`, `knip-bun` |
| eslint-plugin-import-x | yes | 4.16.2 | (ESLint plugin — `no-cycle` rule) |
| madge | **NO** | — | — |
| dependency-cruiser | **NO** | — | — |
