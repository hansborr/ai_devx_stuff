# Verification Record — 2026-07-15 Backlog Sweep

Status: Provenance record
Created: 2026-07-15

How this pack was built: four explorer agents assessed every backlog pack and
standalone note for actionability; the resulting ~45-leaf proposal was then
re-verified leaf-by-leaf by three verification agents (plus forks) against
HEAD `ab318d05`, reading target files and `git log` rather than trusting note
status lines. Roughly **a third of the proposal turned out to be already
implemented** — the notes were stale. This file records the evidence so the
stale leaves are not re-proposed.

## Already landed (status lines stale at verification time)

These were proposed as open by their source notes but are implemented at
HEAD. Leaf 0.1 (`02-reconcile-stale-source-pack-statuses.md`) updates the
source packs.

### harness-review-2026-07 — ratchet platform (landed ~2026-07-12)

| Leaf | Evidence |
|---|---|
| 10 semantic min-merge baseline driver | `scripts/lint-ratchet/baseline-merge.ts` + `baseline-merge-cli.ts`; driver invokes semantic merge before refuse-recipe fallback (`e8b9f7db`) |
| 11 merge-driver auto-install + health check | `package.json:148` `prepare` chains installer; `scripts/doctor.sh:824-827` health check |
| 12 post-merge baseline truth-up | `.husky/post-merge` calls truth-up script (`1b732828`) |
| 14 hand-edit integrity gate | `baseline-debt-accounting*.ts`, wired as `--check-debt-accounting` through `bun run verify` |
| 15 parallel ratchet collection | `current-collector.ts` bounded concurrency pool (default 3) |
| 16 report-only mode + `--propose` dry-run | `LintRatchetMode = "no-new" \| "report-only"` (`lint-ratchet-config.ts:26`, `caf53107`); `propose.ts` dry-run (`e2efc1ee`; registry-parity + glob-normalization follow-ups `db040d5a`, `96d99573`) |
| 17 trend/by-directory reporting | `lint:ratchet:trend` (`package.json:86`), `--by-directory` in `cli.ts` (`3b79af88`, `583e8357`); index row still said Open |
| 18 half (b) equal-count swap visibility | `messagesFingerprint` persisted (`current-collector.ts:44,67`) and consumed by `message-swap-info.ts:13-31`; **half (a) identity-drift classification remains open → leaf 2.1** |
| 19 update preflight / glob unification / GFM escaping | `assertLintRatchetUpdateRegistryClean` (`lint-ratchet-check-registry.ts:290`); `runEslintForFiles` explicit file list (`eslint-runner.ts:221`); `markdown-escape.ts` applied in `lint-ratchet-report.ts` (`e8e46212`, `c7843953`, `93167a63`) |

### harness-review-2026-07 — lint rules (all five landed)

| Leaf | Evidence |
|---|---|
| 30 no-outer-client-in-transaction | `eslint-rules/no-outer-client-in-transaction.js`, registered `eslint-config/local-plugin.js:50` (`d867c3d2`→`3a5e55ca`) |
| 31 raw-SQL fence | `rawPrismaSqlRestrictedSyntax` (`package-boundary-configs.js:13-17`); inventory escapee migrated to `inventory-service.ts` (`ee14e9f8`) |
| 32 tRPC error discipline | `local/no-plain-error-in-trpc` at error for routers/services (`package-boundary-configs.js:119`), documented REST-boundary carve-out for `upload-service.ts` (`11f5d8f7`→`ae34ef94`) |
| 33 hand-built query keys | `handBuiltQueryKeyPropertyRestrictedSyntax` (`client-configs.js:17-24`) (`40c451d0`, `2fbf5031`) |
| 34 permissive schema/output ban | `sharedSchemaZAnyRestrictedSyntax` + `permissiveTrpcOutputRestrictedSyntax` (`package-boundary-configs.js:24-35`) |

### harness-review-2026-07 — hooks (all but 52 landed)

| Leaf | Evidence |
|---|---|
| 50 hook-wiring lifecycle events | `hook-wiring-schema.ts:3-20` lists ~17 events |
| 51 session-state re-injection | `.claude/settings.json` SessionStart matcher `startup\|resume\|compact` → `scripts/ai-hooks/session-state.sh`; also satisfies the R11 SessionStart item |
| 54 protected-files deny tier | `protected-files.sh:240` `ai_emit_deny` for baseline/registers/generated/lockfile (`68999c63`) |
| 56 tidy immediate/deferred split | `ai_stop_lint_warnings_*` family in `stop-policy.sh`, per-edit residual warnings removed (`48ac51aa`); same work as agent-friction-2026-06 §D1 |
| 57 pre-push fast-commit backstop | `.husky/pre-push` exists, checks verify evidence, points at `land.sh` |
| 58 PostToolUseFailure guidance | `.claude/settings.json` wires `failure-guidance.sh`; OOM/lock-holder/flaky matchers all present |

### Other packs and notes

| Item | Evidence |
|---|---|
| lint-adoption-2026-07, all 10 leaves | merged via `ab318d05`/`4528e972` |
| lint-deep-dive-2026-07 leaf 76 | implemented `d714f4ce` 2026-07-14; index row said Ready |
| drift-triage packs 2026-07-06 / 2026-07-13 fix items | all merged (`861d46cc`, `ae1720d6`); only REVIEW-FOLLOWUPS items 1/3/4 remain → leaf 4.6 |
| drift REVIEW-FOLLOWUPS item 2 (shared dirty-probe exclusions) | `triageGeneratedArtifactExclusions` used by all three sites (`31ce6e49`) |
| testsuite-audit #14 RuleTester placeholder assertions | both test files assert interpolated `data:` alongside `messageId` |
| testsuite-audit #32 premise ("no shared helper") | `scripts/test-support/tmp-repo.test-helper.ts` exists, 35 importers (`fddc0b80`, `595e9442`); residue → leaf 4.7 |
| ghost-files noun-pair false positive | `drift-ai.config.json:15-23` `currentAllowedPairs` covers the pair |
| harness-review 71 coverage-map scope | `TRACKED_EXTENSION_PATTERN`/`TRACKED_BASENAMES` widened (`c28439e4`) |
| harness-strictness HC-1 PR template | `## Intent / Comprehension` section present (`1fdea456`) |
| lint-fix-dist-preflight-parity.md | `lint:fix` → `scripts/lint-fix.sh` sourcing `lint-dist-preflight.sh` |
| codebase-audit #05 / #20 doc leaves | `docs/guides/per-worktree-dev.md` and `packages/client/src/pages/MODULE.md` exist |
| harness-research PB-1 premise ("zero property tests") | `fast-check` in `packages/shared/package.json:42`; `character-rules.property.test.ts` (`3c302f89`); residue → leaf 5.1 |
| arch-review #13 substrate ruling | signed off `b7c2ce73` 2026-07-14, `docs/ai-harness.md` **Substrate Ruling (Bash Vs TS)** |
| dialog-reset-on-open-convention.md | keyed-remount migration landed `284d9c5a` via lint-adoption leaf 21 |
| merge-driver-field-exercise prerequisite | agent-cli-consolidation-pass merged `b8fcdfbc`, archived `8e72996c` — exercise unblocked → leaf 2.2 |
| harness-audit-2026-07 | fully drained and landed 2026-07-15 (prior session) |

## Verified still open

Every Ready row in [`00-index.md`](./00-index.md) was confirmed open at HEAD
with file:line evidence on 2026-07-15 (exception: leaf 4.5, flagged
unverified in its row). Highlights that re-scope the source notes:

- sweep-45: items 2 and queue-wait are done; only items 1/3/4 remain
  (leaf 1.5).
- explore-11: the duplicated installer block now covers **4** merge drivers
  across `post-merge`/`post-checkout`/`post-commit`.
- explore-05: `.husky/pre-commit:253` regex is missing
  `generate-restricted-disable-rules.ts` and `generate-smoke-subjects.ts`,
  both present in `harness-check.ts` `GENERATED_FRESHNESS_OUTPUTS`.

## Excluded — do not promote without owner sign-off

| Item | Reason |
|---|---|
| lint-review-followups 02 (near-dup detector v2) | its own gate ("only if the gate keeps earning its verify slot") is not yet established |
| lint-review-followups 05 (fixture builder) | leaf says fold into the next change touching movement tests, not standalone |
| slow-test-tier-candidates.md | own gate: promote only if per-commit time still needs trimming; leaf 3.7 attacks that more directly |
| typescript-6-upgrade.md | plan says handle alone; incompatible with a drain sequence |
| dependency bumps (age-gated followups, fastify-multipart-10, node-types-25, eslint-plugin-jsdoc-63) | dedicated deps pass; age-gated candidate list is stale (2026-05-28) and must be re-derived |
| codebase-audit #08 (router transaction extraction) | concurrency-sensitive; deserves its own focused session with `docs/CONCURRENCY.md` open |
| codebase-audit #24 residue (`getById` alias removal) | deployment-timing call, owner decides |
| codebase-audit #09 step 2 (rename) | judgment-heavier than the step-3 reorder; owner call |
| harness-review 35 (socket-listener boundary half), 36 (effect-boundary marker) | design-gated / owner decision recorded in leaves |
| harness-review 74 (cadence rules → AGENTS.md) | AGENTS.md edit is deliberately human-reviewed |
| harness-strictness HS-1 (TS strictness flags) | wants a discovery pass + per-flag review; `exactOptionalPropertyTypes` explicitly not for unattended work |
| harness-research DL-1 / A11Y-1 / EV-1 | DL-1 drains ~40 client files of visual code (review-heavy); A11Y-1/EV-1 add deps/infra — promote deliberately, not as drain filler. _Correction (2026-07-19): DL-1 and A11Y-1 had in fact already landed 2026-06-22 (`c7ed8c00`, `d49d3ca9`) when this record was written; only EV-1 remains open._ |
| harness-research SEC-1 / PR-1 / GC-1 | pack marks design-gated, "do not implement during routine backlog draining" |
| agent-friction A-arch, D2, D3 | A-arch is its own dedicated leaf (gate re-pointing); D2 needs a repro capture first; D3 flag-gated, med-high risk |
| client-test-isolation 3c Track B | own doc: do-not-schedule unless CI wall time is a measured blocker |
| lint-deep-dive residue (14, 16, 23, 71, 40b, 50b, 70c) | trim candidates / parked / design recorded, owner review pending |
| lint-messaging 22 step (b) | contingent on the generic bridge proving insufficient — not a scoped leaf |
| scripts-flat-family-reorg.md | repo-convention ruling, owner call |
| concurrency-guard / code-intel / cache-budget followups, vitest-worker override, claude-cache-spanning, worktree-local-observability, drift-ai-next-checks | trigger conditions unmet or design needed, per their own notes |
