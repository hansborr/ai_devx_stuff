# drift:ai Full-Tree Audit — Prioritized Review Report

**Run:** broad-2026-07-06 · 118 findings kept, 161 discarded across 38 report units · triage: sonnet swarm + adversarial verify pass.
**Capped (not fully reviewed) units:** chunk:012, 016, 019, 022, 025, 026 (all duplicate-literals) and chunk:034 (unused-exports). Findings in those checks are a floor, not a census.

> **Provenance (2026-07-06).** Source scan: `bun run drift:ai -- --scope current
> --check all` plus the `semgrep-candidates` (local pinned MIT manifest),
> `hotspots --lens all`, and `coldspots` advisories, run at commit `ce77c323`
> on `docs/harness-review-2026-07b`. Raw reports (gitignored):
> `reports/drift-ai/broad-2026-07-06/`. Triage: 38 sonnet agents (one per
> chunk/advisory unit) + adversarial verify of every medium+ finding +
> synthesis; machine-readable verdicts in `confirmed-findings.json` beside this
> file. Known gap: unit `chunk:020:duplicate-literals` (75 rows) failed with an
> API error and was never triaged — those rows are unreviewed, on top of the
> capped units above.

## Executive summary

1. **The single most valuable fix is in drift-ai itself:** `scripts/drift-ai/knip-runner.ts` builds knip `--include` sets that never contain `unlisted`/`dependencies`, so knip's vitest plugin drops setupFiles/globalSetup entries and **every knip-backed check (orphan-files, unused-exports, knip-duplicates) systematically emits false positives** — reproduced under all 7 of drift-ai's category-selection keys. Fix this before trusting or re-running those units (including capped chunk:034).
2. One **high product finding**: `seed-srd-spells.ts` re-declares the 17-field `ParsedSpell` contract verbatim as a private `SpellJson` for the same serialize/read pipeline — silent desync on any schema change.
3. A **harness/tooling literal-drift cluster** (manifest path, generator output paths, path-policy constants, validation messages, git-log flags) is medium-severity but dogfood-weighted; in one case (`--no-renames` in drift-ai's history lenses) the documented load-bearing invariant is **already violated** at one of three call sites.
4. Product mediums are dominated by contract-layer duplication: forked `DAMAGE_TYPES`, already-diverged `MAX_PAGE_SIZE`/`MAX_SEARCH_LENGTH`, string-keyed SRD weapon tables, and uncentralized TRPCError/authz strings.

---

## High

### Tooling

- **`scripts/drift-ai/knip-runner.ts:103-148` — bug (CONFIRMED, fully reproduced).** `KNIP_INCLUDE_CATEGORIES` never includes `unlisted`/`dependencies` under any selection key, so knip's vitest plugin never registers `setupFiles`/`globalSetup` as entries. Result: 7 of 10 "orphan" files in the sampled chunk are demonstrably live (client/server `test/setup.ts`, `global-setup.ts`, four `mock-*` modules imported from `vi.mock` factories). Because one memoized knip spawn feeds orphan-files, unused-exports, and knip-duplicates, this is a 100%-of-combinations false-positive generator in the repo's own drift sensor. Root `knip.config.ts` has no mitigating exemption; the Tier-1 adapter does no filtering.

### Product

- **`packages/server/src/seed/seed-srd-spells.ts:20-36` — duplication (CONFIRMED).** Private `SpellJson` is a field-for-field, order-for-order copy of exported `ParsedSpell` (`spell-parser/parse-spell-block.ts`), zero imports between them — yet the JSON file it types is literally produced by serializing `ParsedSpell[]` (`generate-srd-spells.ts`). Any field add/rename desyncs silently with no compiler error. Fix: import the type.

---

## Medium

### Tooling (scripts/**, eslint-rules/**)

- **`scripts/drift-ai/hotspots-history.ts:340-346` — duplication (CONFIRMED; drift already occurred).** Load-bearing git-log flag array (`--no-renames`, explicitly commented as such) is hand-built in 3 files; `hotspots-suppression-churn.ts:36-41` uses `--name-only` feeding the same arrow-form-unaware parser but **omits `--no-renames`**. Extract a `GIT_LOG_BASE_ARGS` builder.
- **`eslint-rules/concurrency-guard.js:15-33` vs `scripts/codemods/concurrency-guard/constants.ts:14-113` — duplication (CONFIRMED).** `GATED_DELEGATES`/`GATED_MUTATORS`/`DIRECT_WRITE_SUGGESTIONS` byte-identically triplicated (third copy: `packages/server/src/utils/prisma-types.ts:103,134`) with **no drift-guard test**, unlike the `no-redundant-central-mock` precedent. A 6th gated delegate added to prisma-types silently misses lint and codemod.
- **`harness.controls.json` path — maintainability (CONFIRMED).** `join(repoRoot, "harness.controls.json")` hand-typed in 5 scripts (`harness-check.ts:115`, `generate-harness-controls.ts:94`, `generate-hook-wiring.ts:52`, `generate-verify-steps.ts:16`, `lint-ratchet-check-registry.ts:61`) plus path-policy literals; companion message "must declare a controls array" pasted 4-5x. Extract `HARNESS_MANIFEST_FILENAME` + `loadHarnessManifest()` (precedent exists: `scripts/harness/control-field-validation.ts`).
- **`scripts/harness-check.ts:118,192-212` — duplication.** The harness-drift validator re-hardcodes each generator's output path (`scripts/verify/steps.generated.sh`, `docs/generated/harness-controls.md`, `tsconfig.configs.json`) instead of importing the generators' constants — a self-referential gap in the drift checker.
- **`scripts/path-policy/path-policy.ts:104-110` — duplication.** Hand-copies values that already exist as named exports elsewhere (`DEBT_LOG_FILENAME`, `DEFAULT_ALLOWLIST_PATH`, the three hook-config paths, lint-coverage-map path). Path-policy gates verify:changed relevance, so an unsynced rename silently desyncs the gate.
- **`scripts/lib/lint-rule-docs.ts:115-151` vs `scripts/harness/{control-field-validation,generate-harness-controls-validation,harness-check-validation}.ts` — duplication.** repairCommand/pairedGuide/principle/invocation validation reimplemented in 4 files with identical error strings; a repairKind change can update only some copies.
- **`scripts/harness/harness-diagnostics-output.ts:19` & `scripts/lint-ratchet/lint-ratchet-output.ts:6` — duplication (CONFIRMED; reported by two units).** `HARNESS_DIAGNOSTICS_OUTPUT_ENV` + identical `harnessDiagnosticsOutputPath()` declared in both; other consumers already import from the harness module, proving it's the canonical home. No circular-dep obstacle.
- **`scripts/lint-ratchet/max-lines-policy.ts:89` — dead-code (CONFIRMED).** `readMaxLinesPolicy` is imported only by its own test; production (`eslint-config/code-quality-configs.js:9,20-24`) consumes `maxLinesPolicy.exceptions` unvalidated, and the validator checks a `ratchets` field hardcoded to `[]`. Wire it or delete it — currently the actually-consumed data is never validated.
- **`scripts/code-intel/cli-options.ts:46` — duplication.** The "Empty arguments are not supported." arg-guard loop is byte-identically reimplemented in **11 tool entry points**, each with its own bespoke Error subclass. Share `requireArg`.
- **`scripts/db-status.ts:57` — duplication.** Hardcodes `"musi_test"` despite `test-database-url.ts:5` owning `DEFAULT_TEST_DATABASE_NAME` — and the file's own comment (:50-53) flags the coupling it doesn't enforce.
- **`scripts/lint-ratchet/baseline-update-apply.ts:37-41` — duplication (CONFIRMED).** `ApplyLintRatchetUpdateOptions` ≡ `DecideUpdateOptions`; the same runtime object is threaded through both types, working only by structural accident.
- **`scripts/drift-ai/clone-candidates-command.ts:69-74` — duplication (CONFIRMED).** `ResolvedCloneCandidateConfig` ≡ `near-duplicates.ts`'s `ResolvedCompareConfig`; two resolution paths for the same check's tuning parameters can produce inconsistent similarity thresholds.
- **`scripts/codemods/trpc-shared-{input,output}*.ts` — duplication (CONFIRMED with caveat).** The `assertConstSchemaIsOnly{Input,Output}Reference` twins (14 lines each) are the substantive duplication; the eslint-rules half is mostly boilerplate already sharing a common collector, and `singleModeArgs` is actually a 4-file repo-wide pattern (stronger case for a shared codemod-CLI helper).
- **Advisory — agent-cli dispatch harness churn (hotspots, investigate).** `agent-run.sh` (41 revs) + `test-skill-dispatch-wrappers.sh` (coChanges=11) remain the window's dominant fix-heavy hotspot (80-93% fix commits); the `.codex` mirror deletion shows consolidation already started. Decide: keep iterating live or pause for a consolidation pass. (Verify note: "one coupled subsystem" framing was narrowed — harness.controls.json and ai-hooks scripts don't measurably co-change with the core.)

### Product

- **`packages/shared/src/rules/weapon-mastery.ts:29` / `srd-weapons.ts:76` — architecture (CONFIRMED).** Both SRD weapon tables keyed by bare `string`, no shared `WeaponName` union — a weapon rename compiles cleanly and silently orphans its mastery entry. Contract package.
- **`packages/shared/src/schemas/monster-inputs.ts:11` et al. — duplication (CONFIRMED; drift already occurred).** `MAX_PAGE_SIZE=100` privately declared in 5+ input-schema files, `notification-inputs.ts` already diverged to 50 and `note-inputs.ts` to `MAX_SEARCH_LENGTH=200` vs 100 elsewhere. `constants.ts` is the established home and never got these.
- **`packages/shared/src/schemas/npc-inputs.ts:4` — bug/investigate (CONFIRMED as unexplained).** `MAX_DESCRIPTION_LENGTH` is 10_000 in npc/inventory-inputs but 5000 in campaign/encounter-inputs (+ homebrew's own 5000), no rationale in code or git history. Decide the intended cap, then centralize.
- **`packages/server/src/seed/spell-parser/extract-spell-metadata.ts:15-28` — duplication (CONFIRMED).** Canonical 13-value `DAMAGE_TYPES` from `shared/rules/damage-types.ts` re-forked here and in `client/.../item-form-data.ts:56-68`; both files' packages already import from shared elsewhere, so no wiring barrier.
- **`packages/server/src/utils/campaign-auth.ts:49-106` — maintainability (CONFIRMED).** `authz.*` event names and `not_member`/`campaign_not_found` reason codes inlined across three auth helpers; logs-audit matches these exact strings, and a typo compiles fine.
- **"Campaign not found" x6 (`campaign.ts:155,164`, `campaign-auth.ts:56,89`, `encounter-combat-auth.ts:142`, `note-auth.ts:56`) — maintainability (CONFIRMED).** Load-bearing (test-asserted) NOT_FOUND message with intentional mismatch semantics per docs/authorization.md; consumers already import from campaign-auth.ts, so a shared helper is low-risk.
- **TRPCError message groups — duplication (CONFIRMED).** "Encounter not found" x5 files, "Collection not found" x6 sites, "Character has no stats" x3, "It is not this participant's turn" x3; no error-message constants module exists anywhere in server/shared.
- **`script.progress`/`script.warning` log tags (31 sites, ~17 seed files + `structured-logging-fix-transforms.ts:50-52`) — duplication (CONFIRMED).** `ScriptLogFields = Record<string, unknown>` gives zero typo protection, unlike the literal-typed `socket.broadcast` sibling; the codemod that rewrites these tags carries a third disconnected copy.
- **`packages/server/src/services/character-live-state/types.ts:4-9` — duplication (CONFIRMED).** `CharacterLiveStateContext` ≡ `CombatActionContext` ≡ `InventoryServiceContext` — 3-way byte-identical narrow request context; one shared `NarrowServiceContext`.
- **`packages/server/src/seed/rules-glossary-parser/parse-glossary-entry.ts:1-6` — duplication (CONFIRMED).** Same generator→JSON→seed pipeline fork as the spell case, 4 fields (`GlossaryItem` in seed-srd-reference-tables.ts).
- **`packages/server/src/seed/generate-class-features.ts:21-25` — duplication (CONFIRMED).** `ClassCfg` + full 12-entry `CLASSES` array byte-identical in two codegen scripts (diff-verified).
- **`packages/client/src/components/sheet/hp-adjuster.tsx:6-10` — duplication (CONFIRMED).** `AdjustHpInput` ≡ `AdjustHpPayload` incl. the literal-union `mode`; the same callback is threaded through both types.
- **`packages/client/src/components/vtt/drawer/tabs/actions-tab-spells.tsx:57-63` — duplication (CONFIRMED with caveat).** `SpellLevelBlockProps` identical in two files, but render bodies have already diverged (compact vs full UI) — share the props type; don't force a component merge.
- **`encounters-panel.tsx:55-86` / `maps-panel.tsx:54-83` (+ detail views) — duplication.** List/error-state components line-for-line identical with no shared base; a parameterized EntityList/ErrorState removes real, growing duplication.
- **`sheet/inventory-panel.tsx:43-51` / `vtt/drawer/tabs/inventory-tab.tsx:95-105` — duplication (CONFIRMED).** `groupByType` byte-identical pure function; trivial hoist.
- **`vtt/drawer/monster-stat-block-header.tsx:105-115` / `tabs/stats-tab-summary.tsx:53-63` — duplication (CONFIRMED).** `formatSpeed` + `NON_WALK_MODES` table identical across monster/character views.

---

## Low

### Tooling

- `knip.config.ts:47` — maintainability: root entry globs miss `scripts/lint-ratchet/*.ts` and `scripts/path-policy/*.ts`, so two live CLI entry points (`post-merge-baseline-preflight.ts`, `path-policy-query.ts`) false-positive as orphans. Fold into the knip-runner fix.
- `knip.config.ts` `__type-tests__` ignoreIssues — add `"types"` (only surviving half of the worker-test-database finding; the setupFiles/globalSetup half was **refuted** on clean reproduction and downgraded).
- `scripts/lint-ratchet/lint-ratchet-config.ts:103-312` — maintainability: ignore-glob triple pasted 5-6x in one file; the `local-type-assertion-boundary` ratchet copy is already missing `**/generated/**`. Hoist `commonRatchetIgnores`.
- Unused-exports hygiene cluster (all CONFIRMED dead or file-local): ~65 stray `export`s across 35 drift-ai files; dead barrels in `duplicate-{literals,types,schemas,constants}.ts`, `env-define-evaluator.ts:6-18`, `check-metadata.ts:59` (`IMPLEMENTED_CHECKS`); `ts-source-util.ts:36` (`tsSysFileExists`, unused even by its own sibling factory); `client-test-isolation-classifier.ts:18-30` barrel; `hook-wiring-schema.ts:1-2,38`. One mechanical hygiene pass.
- `coldspots-aggregate.ts:9` — duplication: exported `DAY_MS` unused while 4 sibling files redefine it privately.
- `coldspots.ts:51` / `hotspots.ts:53` — duplication: identical `BANNER` string (reported by two units); plus "coverage artifacts" label x3 in coverage advisories.
- `coldspots-args.ts:154-161` / `hotspots-args.ts:95-102` — duplication: `parseWindowDays` verbatim.
- Drift-ai `RunOptions` (`config-inspect-command.ts:25-29` + ownership/test-orphaning pair) — duplication, **downgraded by verify**: only 3 of the claimed 15 files are verbatim; shared base type is a small prefix refactor.
- `client-test-isolation-classifier-types.ts:63-67` — duplication, **downgraded**: bare `{exitCode,stdout,stderr}` triple in 3 files (not 7).
- `birth-size-delta-args.ts:61-80` (+ ownership/test-orphaning) — duplication: bounded-int flag quad repeated; already on the team's backlog per subcommand-args.ts comment, no divergence found.
- "InputSchema" suffix x3 (`trpc-shared-input.ts:158`, `-candidates.ts:18`, `strict-shared-schemas.js:160`); `SHARED_SCHEMA_PREFIX` in eslint-rules + codemods (two units); `PAIRED_GUIDE` doc path x3 eslint rules — naming-convention/doc-path literals with no tie.
- `--format` flag parsed 5 different ways across script CLIs (`code-intel/cli-args.ts:91` et al.); `--output=` hand-rolled in `lint-agent-envelope.ts:49` + `harness-emit-envelope.ts` (investigate).
- `path-policy.ts:103` hardcodes `lint-ratchet.baseline.json` despite exported `BASELINE_FILENAME`; `eslint-config/` prefix x4 in-file (test-guarded, nice-to-have).
- Codemod test scaffolding copies: fixture-metadata validation x3-4 suites (`concurrency-guard.test.ts:42-53` etc.), `MetaFields`+`commitBlock`, `CtxOverrides`+`knipReporting`, `FixtureMetadataBase`, `SpawnCall` — all belong in the shared test-helpers they already sit beside.
- `harness-emit-envelope.ts:35-57`, `semgrep-rule-manifest.ts:95-172` (self-documented), "unknown JSON parse error" x3, dolos/semgrep `reason` union, semgrep flag literals, `$transaction` literal x2, `"eslint-rules"` dir literal — investigate-tier, batch or skip.
- Import cycles (all type-only, investigate): drift-ai's own check-config registry is the **largest cycle in the scan (36 files)** — ironic for the tool that reports import-cycles; lint-ratchet baseline cluster (8); logs-audit (7). Cheap `*-types.ts` leaf fixes.
- Coldspots lens (`coldspots-coldspot.ts`) surfaces a deleted file (`class-features-b.ts`) — documented-intentional, but tag deleted-since-touch rows.
- Advisory: `.github/workflows/ci.yml` thrash (8/10 fix commits, net -18 lines) reads as deliberate consolidation into the harness manifest; confirm it's settled.

### Product

- `packages/client/src/test/mock-zustand-stores.ts:1` — dead-code: genuinely orphaned (both target tests spy on real stores instead); delete or wire in.
- `mock-trpc-control.ts:55` — dead-code: `setMockTRPCModule` has zero call sites; `wizard-context.tsx:22` dead `isStepApplicable` re-export.
- `packages/server/src/utils/__type-tests__/assert-turn-opts-dedup.ts:9` — architecture: mechanical add to `ALLOWED_LAYER_DIRECTION_EDGES` (existing precedent).
- `packages/shared/src/schemas/srd-reference.ts:7-11` — maintainability: six identical `{id,name,description}` schemas in the contract layer; extract `srdReferenceEntrySchema` base.
- `hooks/canvas-input/tool-handlers.ts:96,98` — maintainability: the one real gap in the otherwise type-guarded `MapTool` union — bare `string` Sets/Records lose rename protection; plus the `template-` prefix strip x3 files.
- SRD class-id literals (`class-wizard` 127 occ/45 files; `class-rogue` 78/20 etc.) — investigate: `SORCERER_CLASS_ID` shows the intended named-constant pattern, unapplied to other classes; classId is a bare `z.string()`.
- Error/copy strings: "Not a member of this campaign" x4 surfaces incl. a socket ack; "Participant not found" x3; stats-conditions in-file x2 pairs; homebrew-helpers in-file x2; "Invalid challenge rating" x4 in shared schemas; `mimeToExtension` switch re-lists `ALLOWED_IMAGE_MIME_TYPES` in the same file that imports the constant; `no_socket_server` reason untyped (its sibling `event` field is literal-typed and safe); socket event names (likely compile-checked, hoist for readability); `"campaign"` visibility literal in an untyped Prisma `where` (`homebrew.ts:175`); "All numeric fields are required" x2.
- UI duplication: MonsterTab/MagicItemList list-tab pattern (extract on third compendium type); monster-form-fields 4x JSX blocks; EnumSelect pair; per-page EmptyState/ErrorState x3; monster section labels x3 surfaces; mock-trpc pagination queryFn; IoMock test double x2.
- Small type dups: `ContextMenuState` x2, `MapToolbarViewControls` re-declares child props, `SavingThrowsProps`≡`SkillsListProps` (investigate), panels props (investigate), `RegionRect`/rect shape (investigate).
- Tailwind clusters (batch as one design-token pass, don't fix individually): panel wrapper class x15 sheet files, checkbox class x10 homebrew forms, step-heading combos x9-14, `font-mono text-[10px]` x~9, small badge fragments x3-6, SELECTED/UNSELECTED level-up constants x3.
- Documented-convention repeats to leave alone unless touched: character-live-state command preamble (MODULE.md-recorded), tRPC route paths in test files (loud failure mode; shared route builder is optional), HTTP status constants x~18 test files (investigate).

---

## Discounted noise

161 findings were discarded across 38 report units; **duplicate-literals was by far the noisiest check** — it accounts for the bulk of discards (incidental word collisions like fixture "campaign" strings, test-assertion literals, compile-checked enum keys) and 6 of the 7 capped units (chunks 012, 016, 019, 022, 025, 026), so its 51 kept findings undercount true coverage of that check. The 7th cap was chunk:034 (unused-exports) — moot to re-run until the knip-runner include-category bug is fixed, since that bug distorts the whole unused-exports/orphan-files input. Kept-by-check: duplicate-literals 51, duplicate-types 21, unused-exports 14, near-duplicates 11, duplicate-constants 8, import-cycles 3, orphan-files 3, hotspots/coldspots advisories 3, duplicates 2, duplicate-schemas 1, layer-direction 1. Two headline claims were refuted or downgraded in verify (server vitest setupFiles knip gap; "15-file RunOptions copy-paste") and are reflected above at their corrected severity.

## Recommended next actions

- [ ] **Fix `knip-runner.ts` include-category selection** (add `unlisted`/`dependencies` to every `INCLUDE_CATEGORIES_BY_SELECTION` value, or otherwise preserve vitest-plugin entries), add the `knip.config.ts` fixes (root entry globs for `scripts/{lint-ratchet,path-policy}/*.ts`; `"types"` in `__type-tests__` ignoreIssues), then **re-run orphan-files/unused-exports** including capped chunk:034.
- [ ] Import `ParsedSpell` in `seed-srd-spells.ts` and `ParsedGlossaryEntry` in `seed-srd-reference-tables.ts` (delete `SpellJson`/`GlossaryItem`).
- [ ] Extract a shared git-log args builder in drift-ai and restore `--no-renames` in `hotspots-suppression-churn.ts` (documented invariant already violated).
- [ ] Add a drift-guard test tying `eslint-rules/concurrency-guard.js` ⇄ `codemods/concurrency-guard/constants.ts` ⇄ `prisma-types.ts` (copy the `no-redundant-central-mock` pattern).
- [ ] Harness consolidation pass: `HARNESS_MANIFEST_FILENAME` + shared loader; harness-check imports generator output-path constants; path-policy imports `DEBT_LOG_FILENAME`/`DEFAULT_ALLOWLIST_PATH`/hook paths; merge `HARNESS_DIAGNOSTICS_OUTPUT_ENV` into one module; unify the 4-file control-field validation.
- [ ] Decide `max-lines-policy.ts`: wire validation into what production actually consumes (`.exceptions`) or delete the scaffolding.
- [ ] Shared-contract constants pass: centralize `MAX_PAGE_SIZE`/`MAX_SEARCH_LENGTH` in `constants.ts` (resolve the 50/200 divergences), rule on the 5000-vs-10000 `MAX_DESCRIPTION_LENGTH` split, import `DAMAGE_TYPES` from shared in both forks, key the two weapon tables off a shared `WeaponName` union.
- [ ] Server error/authz string constants: per-domain message constants next to `campaign-auth.ts` (Campaign/Encounter/Collection/Participant not found, turn message), literal-type the authz event/reason vocabulary, and give `script-logger` a typed event union.
- [ ] Shared `requireArg` for the 11-site CLI arg-guard; `db-status.ts` imports `DEFAULT_TEST_DATABASE_NAME`; consolidate the two duplicate-type pairs in lint-ratchet and clone-candidates.
- [ ] One batched hygiene commit: drift-ai stray exports/dead barrels, `DAY_MS`, `BANNER`, delete `mock-zustand-stores.ts` and `setMockTRPCModule`, add the layer-direction allowlist edge.
- [ ] Product refactor queue (as-touched, not standalone): panels/list-state extraction, `groupByType`/`formatSpeed` hoists, `AdjustHpPayload` import, `SpellLevelBlockProps` share, Tailwind design-token pass.
- [ ] Maintainer decision on the agent-cli harness: continue live iteration on `agent-run.sh` or schedule the consolidation pass the `.codex`-mirror deletion started; optionally re-run the six capped duplicate-literals chunks after the above lands.