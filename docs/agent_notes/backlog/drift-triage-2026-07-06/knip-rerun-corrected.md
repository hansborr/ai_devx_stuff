# drift-triage-2026-07-06 — Corrected knip re-run (Lane 0 output)

**Status:** produced 2026-07-06 on `fix/drift-lane0` after the include-category +
`knip.config.ts` fixes landed in this lane. This file is the gating input for the
hygiene lane (**Lane H**); it supersedes AUDIT.md's pre-fix orphan-files/
unused-exports data, which the include-category bug distorted.

## Provenance

- Base commit: `b0477ada` (branch `fix/drift-lane0`, worktree `drift-0`).
- knip `6.14.1`, config `knip.config.ts` **with this lane's fixes applied**
  (`unlisted,dependencies` in every include set; root entry globs for
  `scripts/lint-ratchet/*.ts` + `scripts/path-policy/*.ts`; `"types"` added to the
  `__type-tests__` ignoreIssues).
- Orphan census: `knip --reporter json --include files,unlisted,dependencies
  --no-progress --config knip.config.ts`.
- Unused-export census: `--include exports,types,enumMembers,namespaceMembers,unlisted,dependencies`
  (same set the committed sensor gate now uses). This is the **whole-repo** knip
  verdict (no `--scope` filter) — the right gating input for Lane H, and identical
  to what `sensor:knip-unused-exports` now floors at.
- `chunk:034` (the unused-exports unit AUDIT.md left **capped**) is fully re-run
  here: the census below is a complete census, not a floor.

## Headline vs AUDIT.md

| Metric | AUDIT.md (pre-fix) | Corrected (this lane) |
|---|---|---|
| Orphan files (whole-repo) | 10 in the sampled chunk, 7 demonstrably false | **1 real** (`mock-zustand-stores.ts`) |
| Sensor unused-export floor | 281 (147 exports / 134 types) | **234** (100 exports / 134 types) |

The 47-symbol drop is the removal of false positives in live test-infrastructure
files (client/server `test/setup.ts`, `global-setup.ts`, the `mock-*` modules) that
knip now resolves as reachable once the vitest plugin registers `setupFiles`/
`globalSetup` entries. **No real finding was lost** — every AUDIT.md-named dead-code
item survives the fix (verified below).

## A. Orphan files — CORRECTED (complete)

Only one file survives the config fix as a genuine orphan:

| File | Verdict | Notes |
|---|---|---|
| `packages/client/src/test/mock-zustand-stores.ts` | **REAL orphan — delete (Lane H)** | Matches AUDIT.md line 103; both target tests spy on the real stores. |

Resolved false positives (were flagged pre-fix, now correctly clean — do NOT touch):

- `packages/client/src/test/setup.ts`, `packages/server/src/test/setup.ts`,
  `packages/server/src/test/global-setup.ts` — vitest entry files.
- `packages/client/src/test/mock-map-token-mutations.ts`, `mock-react-konva.tsx`,
  `mock-roll-toast.ts`, `mock-scroll-area.tsx` — imported from `vi.mock` factories.
- `scripts/lint-ratchet/post-merge-baseline-preflight.ts`,
  `scripts/path-policy/path-policy-query.ts` — live CLI entry points, now covered by
  the new root entry globs.

## B. Unused exports — CORRECTED census (234 symbols, 109 files)

Distribution: `scripts/drift-ai` 177 · other `scripts/**` 53 · `packages/client` 4 ·
`packages/server`/`packages/shared` 0 (contract surfaces are covered by
`ignoreIssues`). knip confirms every symbol below is unreferenced in the resolved
graph (tests included). **"Unreferenced" is not the same as "delete"**: Lane H must
apply the repair hint per symbol — remove if dead, or add a knip ignore if it is
intentional public API / used dynamically. The verdicts below classify the tiers I
can adjudicate; the full appendix is the raw actionable list.

### B1. AUDIT.md-named dead-code items — REAL, delete/dedup (Lane H)

All survive the fix as genuine unused exports:

| File | Symbol | Verdict |
|---|---|---|
| `scripts/drift-ai/coldspots-aggregate.ts` | `DAY_MS` | REAL — delete; 4 siblings redefine it privately (AUDIT L86). |
| `scripts/drift-ai/check-metadata.ts` | `IMPLEMENTED_CHECKS` | REAL — dead export (AUDIT L85). |
| `scripts/drift-ai/ts-source-util.ts` | `tsSysFileExists` | REAL — dead, unused even by its sibling factory (AUDIT L85). |
| `scripts/drift-ai/env-define-evaluator.ts` | 8 `EnvDefine*` types | REAL — dead type barrel (AUDIT L85). |
| `scripts/client-test-isolation-classifier.ts` | 7 `ClientTest*`/`Classify*` types | REAL — dead type barrel (AUDIT L85). |
| `scripts/harness/hook-wiring-schema.ts` | `HOOK_HARNESSES`, `HOOK_OUTPUT_CAPABILITIES`, `HookOutputCapability` | REAL — dead (AUDIT L85). |
| `scripts/drift-ai/duplicate-literals.ts` | 4 `DEFAULT_DUPLICATE_LITERALS_*` | REAL — dead barrel constants (AUDIT L85). |
| `scripts/drift-ai/duplicate-types.ts` | `DEFAULT_DUPLICATE_TYPES_MIN_PROPS` | REAL — dead barrel constant (AUDIT L85). |
| `scripts/drift-ai/duplicate-schemas.ts` | `DEFAULT_DUPLICATE_SCHEMAS_MIN_KEYS` | REAL — dead barrel constant (AUDIT L85). |
| `scripts/drift-ai/duplicate-constants.ts` | 3 `DEFAULT_DUPLICATE_CONSTANTS_*` | REAL — dead barrel constants (AUDIT L85). |
| `packages/client/src/test/mock-trpc-control.ts` | `setMockTRPCModule` | REAL — zero call sites (AUDIT L104). |
| `packages/client/src/components/character-create/wizard-context.tsx` | `isStepApplicable` | REAL — dead re-export (AUDIT L104). |

**Not in this census (correctly): `BANNER` and `parseWindowDays`.** AUDIT.md L87–88
list them as *duplication* findings, not unused exports — both are live/used, so
they never appear in the unused-export set. Lane H handles them as dedup (hoist to a
shared module), not deletion.

### B2. Duplicate-type twins — one copy is the dead one (Lane H dedup)

Same symbol exported from two modules; the census flags the unreferenced copy:

| Symbol | Files |
|---|---|
| `TestRelation` | `test-orphaning-types.ts` + `test-orphaning-advisory.ts` |
| `OwnershipSection` | `ownership-types.ts` + `ownership-advisory.ts` |
| `ClientTestIsolationMode` | `client-test-isolation-classifier-types.ts` + `client-test-isolation-classifier.ts` |
| `KnipUnusedExportsCategoryCounts` | `sensor-knip-unused-exports-baseline.ts` + `sensor-knip-unused-exports-core.ts` (core re-exports the baseline's) |
| `RULE_ID_PATTERN` | `baseline-hash.ts` + `lint-ratchet-baseline.ts` |

### B3. Bulk remainder — knip-confirmed unused; Lane H judgment per repair hint

The remaining ~200 symbols are overwhelmingly (a) `scripts/drift-ai` tuning-default
constants (`DEFAULT_*` in `coldspots-*`, `hotspots-*`, `dolos-*`, `sibling-naming.ts`,
`import-cycles.ts`, etc.) and (b) exported advisory/row/section **types** in the
`*-advisory.ts` / `*-types.ts` leaf modules. These are a genuine "one mechanical
hygiene pass" cluster (AUDIT.md L85) but are **not** blanket-deletable: some are an
intentional config-default / type API surface. Lane H should treat each as a
candidate and apply the repair hint (delete if truly dead; keep + `ignoreIssues`
entry if it is deliberate API). Two **new** client candidates the corrected re-run
surfaced (absent from AUDIT.md, likely because chunk:034 was capped) warrant a look:

- `packages/client/src/components/homebrew/entries/entry-editor-registry.ts` → `EDITOR_REGISTRY`
- `packages/client/src/test/mock-trpc-helpers.ts` → `withFailableMutationOptions`

The complete per-file list follows so Lane H has the raw signal.

## Appendix — full corrected unused-export listing (234 symbols)

<!-- Generated from the census command above; `[export]`/`[type]` = knip category. -->

### 1. scripts/drift-ai — 76 files, 177 symbols

- `scripts/drift-ai/birth-size-delta-types.ts` (5): BirthBlobRequest [type], CurrentBlobReader [type], BirthSizeDeltaBirth [type], BirthSizeDeltaBirthBurst [type], BirthSizeDeltaChurn [type]
- `scripts/drift-ai/bounded-full-history.ts` (4): DEFAULT_FULL_HISTORY_MAX_COMMITS [export], DEFAULT_FULL_HISTORY_MAX_FILES [export], DEFAULT_FULL_HISTORY_TIMEOUT_MS [export], BoundedHistoryScannedRange [type]
- `scripts/drift-ai/bounded-history-options.ts` (1): boundedHistoryOptionFields [export]
- `scripts/drift-ai/branch-points.ts` (1): BranchPointMetrics [type]
- `scripts/drift-ai/check-metadata.ts` (1): IMPLEMENTED_CHECKS [export]
- `scripts/drift-ai/check-plugin.ts` (1): CheckRunState [type]
- `scripts/drift-ai/class-construction-advisory.ts` (4): ClassUnusedExportsReportStatus [type], ClassConstructionUnusedExportCorrelation [type], ClassConstructionAdvisoryRow [type], ClassConstructionAdvisorySection [type]
- `scripts/drift-ai/class-construction-types.ts` (3): RISKY_CONTEXT_PREFIX [export], CLASS_RISKY_CONTEXTS [export], ClassDeclarationKind [type]
- `scripts/drift-ai/clone-candidates-advisory.ts` (2): CloneCandidateEngineConfig [type], CloneCandidateAdvisoryRow [type]
- `scripts/drift-ai/clone-candidates-sibling-overlay.ts` (1): CloneCandidateSiblingNamingEvidence [type]
- `scripts/drift-ai/clone-candidates.ts` (2): CloneCandidateCaps [type], CloneCandidateTruncation [type]
- `scripts/drift-ai/clone-corpus.ts` (2): CloneCorpusPairLabel [type], CloneCorpusCategoryRecall [type]
- `scripts/drift-ai/coldspots-aggregate.ts` (1): DAY_MS [export]
- `scripts/drift-ai/coldspots-args.ts` (2): DEFAULT_COLDSPOT_WINDOW_DAYS [export], CONCRETE_COLDSPOT_LENSES [export]
- `scripts/drift-ai/coldspots-coldspot.ts` (8): DEFAULT_COLDSPOT_AGE_THRESHOLD_DAYS [export], DEFAULT_COLDSPOT_REVISION_FLOOR [export], DEFAULT_COLDSPOT_AGE_STANDOUT_FACTOR [export], DEFAULT_NEIGHBORHOOD_CHURN_RATIO [export], DEFAULT_BIRTH_BURST_FILES [export], DEFAULT_BIRTH_BURST_LINES [export], DEFAULT_GONE_SILENT_DAYS [export], DEFAULT_LARGE_FILE_CHURN_LINES [export]
- `scripts/drift-ai/coldspots-format.ts` (2): StaleMarkerThresholds [type], ColdspotsWindow [type]
- `scripts/drift-ai/coldspots.ts` (1): ColdspotLens [type]
- `scripts/drift-ai/commit-intent.ts` (1): CommitIntentCategory [type]
- `scripts/drift-ai/config-inspect.ts` (1): ConfigInspectionSource [type]
- `scripts/drift-ai/config-readers.ts` (1): parseEmptyCheckConfig [export]
- `scripts/drift-ai/coverage-evidence-advisory.ts` (6): CoverageEvidenceSource [type], CoverageEvidenceSummary [type], CoverageEvidenceFunctionRow [type], CoverageEvidenceLineRow [type], CoverageEvidenceRow [type], CoverageEvidenceSection [type]
- `scripts/drift-ai/coverage-types.ts` (1): CoverageParseNoteKind [type]
- `scripts/drift-ai/coverage-unused-correlation-advisory.ts` (1): CoverageUnusedCorrelationSection [type]
- `scripts/drift-ai/coverage-unused-correlation.ts` (5): CoverageMatchState [type], CoverageMatchKind [type], PathMatchKind [type], CoverageUnusedCorrelationStats [type], CorrelationCaveatLabeler [type]
- `scripts/drift-ai/dead-code-corpus.ts` (5): DEAD_CODE_CORPUS_LABEL_KINDS [export], DeadCodeCorpusExportKind [type], DeadCodeCorpusLabelKind [type], DeadCodeCorpusSymbol [type], DeadCodeCorpusSymbolId [type]
- `scripts/drift-ai/dolos-advisory.ts` (2): DolosAdvisoryRow [type], DolosAdvisorySection [type]
- `scripts/drift-ai/dolos-candidates-args.ts` (5): DEFAULT_DOLOS_LANGUAGE [export], DEFAULT_DOLOS_THRESHOLD [export], DEFAULT_DOLOS_MAX_FILES [export], DEFAULT_DOLOS_MAX_CANDIDATE_PAIRS [export], DEFAULT_DOLOS_MAX_REPORTED_PAIRS [export]
- `scripts/drift-ai/dolos-types.ts` (1): DolosParserCaps [type]
- `scripts/drift-ai/duplicate-constants.ts` (3): DEFAULT_DUPLICATE_CONSTANTS_MIN_DISTINCT_FILES [export], DEFAULT_DUPLICATE_CONSTANTS_MIN_LENGTH [export], DEFAULT_DUPLICATE_CONSTANTS_MIN_NUMBER_DIGITS [export]
- `scripts/drift-ai/duplicate-literals.ts` (4): DEFAULT_DUPLICATE_LITERALS_INCLUDE_NUMBERS [export], DEFAULT_DUPLICATE_LITERALS_MIN_DISTINCT_FILES [export], DEFAULT_DUPLICATE_LITERALS_MIN_LENGTH [export], DEFAULT_DUPLICATE_LITERALS_MIN_NUMBER_DIGITS [export]
- `scripts/drift-ai/duplicate-schemas.ts` (1): DEFAULT_DUPLICATE_SCHEMAS_MIN_KEYS [export]
- `scripts/drift-ai/duplicate-shapes.ts` (2): DUPLICATE_SHAPE_PROVENANCE [export], DuplicateShapeDetailValue [type]
- `scripts/drift-ai/duplicate-types.ts` (1): DEFAULT_DUPLICATE_TYPES_MIN_PROPS [export]
- `scripts/drift-ai/duplicates-runner.ts` (1): JscpdSpawnResult [type]
- `scripts/drift-ai/env-branches-advisory.ts` (4): EnvBranchEraseExpectation [type], EnvBranchDeadBranch [type], EnvBranchReadEvidence [type], EnvBranchCandidateRow [type]
- `scripts/drift-ai/env-define-evaluator.ts` (8): EnvDefineAssumedValue [type], EnvDefineAssumption [type], EnvDefineBranchPrediction [type], EnvDefineConditionEvidence [type], EnvDefineConditionReadEvidence [type], EnvDefineRange [type], EnvDefineReadEvidence [type], EnvDefineReadKind [type]
- `scripts/drift-ai/ghost-files-match.ts` (1): GhostFileMatchKind [type]
- `scripts/drift-ai/ghost-files-tokens.ts` (3): isSourceLike [export], toPosix [export], uniqSorted [export]
- `scripts/drift-ai/harness-freshness.ts` (2): RepoFileReader [type], DirectoryListing [type]
- `scripts/drift-ai/hotspots-actionability.ts` (1): buildBaselineIndex [export]
- `scripts/drift-ai/hotspots-args.ts` (1): CONCRETE_LENSES [export]
- `scripts/drift-ai/hotspots-churn.ts` (1): DEFAULT_CHURN_STANDOUT_FACTOR [export]
- `scripts/drift-ai/hotspots-coupling.ts` (3): DEFAULT_MIN_SUPPORT [export], DEFAULT_DEGREE_CAP [export], DEFAULT_SWEEP_CAP [export]
- `scripts/drift-ai/hotspots-format.ts` (2): HotspotsWindow [type], HotspotsMetric [type]
- `scripts/drift-ai/hotspots-fragmentation.ts` (1): DEFAULT_FRAGMENTATION_MIN_HANDS [export]
- `scripts/drift-ai/hotspots-history.ts` (2): DEFAULT_MAX_WINDOW_DAYS [export], DEFAULT_MIN_COMMITS [export]
- `scripts/drift-ai/hotspots-suppression-churn.ts` (2): SUPPRESSION_CHURN_PATTERN [export], DEFAULT_SUPPRESSION_CHURN_MIN_CHANGES [export]
- `scripts/drift-ai/hotspots-thrash.ts` (3): DEFAULT_THRASH_MIN_REVISIONS [export], DEFAULT_THRASH_MAX_NET_LINES_PER_REVISION [export], DEFAULT_THRASH_YOUNG_DAYS [export]
- `scripts/drift-ai/import-cycles-graph.ts` (1): ModuleGraphRunnerInput [type]
- `scripts/drift-ai/import-cycles-tsconfig.ts` (1): ResolvedTsconfig [type]
- `scripts/drift-ai/import-cycles.ts` (5): MAX_UNRESOLVED_RATIO [export], IMPORT_CYCLES_TOOL [export], RUNTIME_CYCLE_HINT [export], TYPE_ONLY_CYCLE_HINT [export], ModuleEdge [type]
- `scripts/drift-ai/jscpd-bin.ts` (1): JscpdBinSource [type]
- `scripts/drift-ai/knip-duplicates.ts` (2): KNIP_DUPLICATES_REPAIR_HINT [export], KnipDuplicateExportSymbol [type]
- `scripts/drift-ai/knip-orphan-files.ts` (2): KNIP_CONFIG_CANDIDATES [export], ORPHAN_FILES_REPAIR_HINT [export]
- `scripts/drift-ai/knip-runner.ts` (3): KnipSpawnResult [type], KnipRunnerInput [type], KnipBinSource [type]
- `scripts/drift-ai/layer-direction.ts` (2): LAYER_DIRECTION_PROVENANCE [export], ServerLayer [type]
- `scripts/drift-ai/line-scanner.ts` (1): StringDelim [type]
- `scripts/drift-ai/module-doc-paths.ts` (1): RepoPathIgnored [type]
- `scripts/drift-ai/near-duplicates-runner.ts` (2): NearDuplicateRunnerInput [type], NearDuplicateRunnerResult [type]
- `scripts/drift-ai/near-duplicates.ts` (1): DEFAULT_NEAR_DUPLICATE_IGNORE_GLOBS [export]
- `scripts/drift-ai/numeric-literal-text.ts` (1): numericLiteralDigitCount [export]
- `scripts/drift-ai/ownership-advisory.ts` (4): OwnershipAdvisoryRow [type], OwnershipChangeSplit [type], OwnershipContributor [type], OwnershipSection [type]
- `scripts/drift-ai/ownership-types.ts` (1): OwnershipSection [type]
- `scripts/drift-ai/parsed-source-cache.ts` (2): SourceFileReader [type], SourceFileParser [type]
- `scripts/drift-ai/repo-io.ts` (1): RepoPathKind [type]
- `scripts/drift-ai/report-builder.ts` (3): CheckRunContext [type], CheckRunInput [type], CheckContext [type]
- `scripts/drift-ai/semgrep-advisory.ts` (5): SemgrepAdvisoryRow [type], SemgrepAdvisorySection [type], SemgrepCandidateRange [type], SemgrepRuleSourceProvenance [type], SemgrepScanScope [type]
- `scripts/drift-ai/semgrep-rule-sources.ts` (2): SEMGREP_RULES_LICENSE [export], UNKNOWN_LICENSE_ALLOW_TOKEN [export]
- `scripts/drift-ai/semgrep-runner.ts` (1): SemgrepCommandSource [type]
- `scripts/drift-ai/sibling-naming.ts` (5): DEFAULT_SIBLING_LIFECYCLE_MARKERS [export], DEFAULT_SIBLING_COPY_BACKUP_MARKERS [export], DEFAULT_SIBLING_VERSION_PATTERN [export], SiblingMarkerPosition [type], SiblingNamingRelation [type]
- `scripts/drift-ai/subcommand-args.ts` (2): SubcommandValueOption [type], SubcommandFlagOption [type]
- `scripts/drift-ai/suppressions-parse.ts` (1): SuppressionKind [type]
- `scripts/drift-ai/test-orphaning-advisory.ts` (7): DEFAULT_MIN_SOURCE_COMMITS [export], DEFAULT_TEST_MAPPING_PATTERNS [export], TEST_ORPHANING_SUBCOMMAND [export], RelatedTestEvidence [type], TestOrphaningRow [type], TestOrphaningSection [type], TestRelation [type]
- `scripts/drift-ai/test-orphaning-types.ts` (1): TestRelation [type]
- `scripts/drift-ai/ts-source-util.ts` (1): tsSysFileExists [export]
- `scripts/drift-ai/types.ts` (2): DEFAULT_IGNORE_DIR_PREFIXES [export], DriftChunkManifestEntry [type]

### 2. scripts (other) — 29 files, 53 symbols

- `scripts/client-test-isolation-classifier-types.ts` (2): MODULE_REGISTRY_MUTATION_METHOD_NAMES [export], ClientTestIsolationMode [type]
- `scripts/client-test-isolation-classifier.ts` (7): ClassifyClientTestFileSourceOptions [type], ClientTestFileClassification [type], ClientTestIsolationMode [type], ClientTestIsolationReason [type], ClientTestIsolationTotals [type], IsolatedClientTestFileClassification [type], ModuleRegistryMutationMethod [type]
- `scripts/codemods/concurrency-guard/types.ts` (1): Verdict [type]
- `scripts/codemods/lib/fixture-runner.test-helper.ts` (1): unknownProperty [export]
- `scripts/codemods/structured-logging-fix-ast.ts` (1): isStringConcat [export]
- `scripts/harness/control-field-validation.ts` (2): LINT_RATCHET_CONFIG_PATH [export], RATCHET_PRINCIPLE_RESTATEMENT_MESSAGE [export]
- `scripts/harness/harness-audit-report.ts` (4): HarnessAuditSeverityCounts [type], HarnessAuditControlSummary [type], HarnessAuditToolSummary [type], HarnessAuditTotals [type]
- `scripts/harness/harness-check-validation.ts` (1): formatMissingRatchetManifestMessage [export]
- `scripts/harness/hook-wiring-schema.ts` (3): HOOK_HARNESSES [export], HOOK_OUTPUT_CAPABILITIES [export], HookOutputCapability [type]
- `scripts/harness/verify-step-schema.ts` (3): isVerifyStepDynamicResolver [export], formatVerifyStepDynamicResolvers [export], VerifyStepDynamicResolver [type]
- `scripts/lib/doc-generator.ts` (1): DocRenderResult [type]
- `scripts/lint-agent-fix-text.ts` (1): LintAgentMessageForFix [type]
- `scripts/lint-ratchet/baseline-debt-accounting-git.ts` (1): defaultBaselineDebtAccountingGitDeps [export]
- `scripts/lint-ratchet/baseline-debt-accounting.ts` (1): BaselineDebtIncreaseKind [type]
- `scripts/lint-ratchet/baseline-hash.ts` (1): RULE_ID_PATTERN [export]
- `scripts/lint-ratchet/baseline-update-apply.ts` (1): defaultRunUpdateDeps [export]
- `scripts/lint-ratchet/debt-log-write.ts` (1): defaultDebtLogAppendDeps [export]
- `scripts/lint-ratchet/lint-ratchet-baseline.ts` (1): RULE_ID_PATTERN [export]
- `scripts/lint-ratchet/lint-ratchet-config.ts` (4): LintRatchetPluginExport [type], LintRatchetLocalSource [type], LintRatchetThirdPartySource [type], LintRatchetCoreSource [type]
- `scripts/lint-ratchet/lint-ratchet-metrics.ts` (2): ComplexityDelta [type], LintRatchetComplexityMessage [type]
- `scripts/lint-ratchet/lint-ratchet-output.ts` (1): HARNESS_DIAGNOSTICS_OUTPUT_ENV [export]
- `scripts/lint-ratchet/lint-ratchet-summary.ts` (1): runLintRatchetSummary [export]
- `scripts/lint-ratchet/max-lines-policy.ts` (2): maxLinesPolicy [export], MaxLinesRatchetPolicy [type]
- `scripts/lint-ratchet/propose.ts` (2): runLintRatchetPropose [export], formatLintRatchetPropose [export]
- `scripts/path-policy/path-policy-query-core.ts` (2): matchSegmentGlob [export], matchesPathPolicySelector [export]
- `scripts/path-policy/path-policy-query.ts` (3): runPathPolicyQueryCli [export], PathPolicyQueryCliOptions [type], PathPolicyQueryCliResult [type]
- `scripts/sensor-knip-unused-exports-baseline.ts` (1): KnipUnusedExportsCategoryCounts [type]
- `scripts/sensor-knip-unused-exports-core.ts` (1): KnipUnusedExportsCategoryCounts [type]
- `scripts/stryker-scripts.ts` (1): default [export]

### 3. packages/client — 4 files, 4 symbols

- `packages/client/src/components/character-create/wizard-context.tsx` (1): isStepApplicable [export]
- `packages/client/src/components/homebrew/entries/entry-editor-registry.ts` (1): EDITOR_REGISTRY [export]
- `packages/client/src/test/mock-trpc-control.ts` (1): setMockTRPCModule [export]
- `packages/client/src/test/mock-trpc-helpers.ts` (1): withFailableMutationOptions [export]

## Note on the sensor gate

Correcting the include set changed the committed floor in
`sensor-knip-unused-exports.baseline.json` (281 → 234) and its stored
`includeCategories` string. This lane regenerates the baseline (via
`bun scripts/sensor-knip-unused-exports.ts --update`) so `sensor:knip-unused-exports`
stays green — a necessary downstream consequence of the const change, not an
independent finding fix. Lane H deletions will lower this floor further; run
`--update` after Lane H lands.
