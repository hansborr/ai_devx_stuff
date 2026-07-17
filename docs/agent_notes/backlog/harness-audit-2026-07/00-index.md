# Harness Audit 2026-07 — Task Pack

Status: Complete — wave 1 drained 2026-07-14 (leaves 01–05, 10–15, 20–24,
50–51, 54–55) and wave 2 drained 2026-07-14 (leaves 30–33, 40–48, 52–53,
60–69), both with review fix-forwards; no leaves remain Ready
Created: 2026-07-13
Source: six audit lanes at HEAD `14106498`: five Codex consults in isolated
provisioned worktrees and one Grok 4.5 first-contact lane, followed by one
independent adversarial verifier per lane. The pass retained **21 confirmed,
17 amended, 0 rejected** findings; three severities were deflated and one
claimed mechanism was refuted. See [Sources and Verdicts](./01-sources-and-verdicts.md)
for the authoritative reconciliation record.

The main risks cluster around gates that can fail open or hang, the paved
worktree path breaking on fresh template fingerprints, and cross-harness
protections drifting apart silently. The public showcase has a parallel
credibility problem: lint claims sometimes run ahead of enforcement, while
first-contact docs still serve product visitors much better than harness
visitors.

## Task List

Tracks: **T** tooling/config, **DOC** docs.

| # | Task | Track | Size | Priority | Depends on | Status |
|---|---|---|---|---|---|---|
| 01 | [Failed `git diff` can produce a valid clean-tree fingerprint](./01-failed-git-diff-can-produce-a-valid-clean-tree-fingerprint.md) | T | S | P2 | none | Done |
| 02 | [`land.sh` can verify untracked dependencies that never enter the merge](./02-land-sh-can-verify-untracked-dependencies-that-never-enter-the-merge.md) | T | S | P2 | none | Done |
| 03 | [The core verify timeout can hang instead of completing with 124](./03-core-verify-timeout-can-hang-instead-of-completing-with-124.md) | T | S | P2 | none | Done |
| 04 | [Selector crashes are reported as empty, successful lint selections](./04-selector-crashes-are-reported-as-empty-successful-lint-selections.md) | T | M | P2 | none | Done |
| 05 | [Empty `verify:changed` launches the entire gate](./05-empty-verify-changed-launches-the-entire-gate.md) | T | S | P2 | none | Done |
| 10 | [`worktree:new` breaks on new template fingerprints](./10-worktree-new-breaks-on-new-template-fingerprints.md) | T | S | P1 | none | Done |
| 11 | [Numeric but impossible worktree allocations pass validation](./11-numeric-but-impossible-worktree-allocations-pass-validation.md) | T | S | P3 | none | Done |
| 12 | [A transient database-list failure makes GC erase live reservations](./12-transient-database-list-failure-makes-gc-erase-live-reservations.md) | T | S | P3 | none | Done |
| 13 | [Async verification reports “started” without usable state](./13-async-verification-reports-started-without-usable-state.md) | T | S | P3 | none | Done |
| 14 | [Concurrent merge-driver installers can lose attribute blocks](./14-concurrent-merge-driver-installers-can-lose-attribute-blocks.md) | T | S | P3 | [explore 11](../harness-explore-2026-07/11-hook-trio-dedup.md) | Done |
| 15 | [`init-*.lock` files accumulate forever](./15-init-lock-files-accumulate-forever.md) | T | XS | P3 | none | Done |
| 20 | [Force-updating branches and tags is protected only in Claude](./20-force-updating-branches-and-tags-is-protected-only-in-claude.md) | T | M | P1 | none | Done |
| 21 | [Shim validation accepts the wrong body—or no body](./21-shim-validation-accepts-the-wrong-body-or-no-body.md) | T | M | P2 | none | Done |
| 22 | [A tracked Codex session-state shim contradicts the declared omission](./22-tracked-codex-session-state-shim-contradicts-the-declared-omission.md) | T | S | P2 | 21 | Done |
| 23 | [Skill mirrors and gitignore opt-ins are outside the manifest](./23-skill-mirrors-and-gitignore-opt-ins-are-outside-the-manifest.md) | T | M | P2 | none | Done |
| 24 | [`agent-cli` attachment-only mission semantics are ambiguous](./24-agent-cli-attachment-only-mission-semantics-are-ambiguous.md) | T | XS | P3 | none | Done |
| 30 | [Missing `backlog:lint --file` targets report success](./30-missing-backlog-lint-file-targets-report-success.md) | T | XS | P3 | none | Done |
| 31 | [Max-lines checker silently ignores unknown options](./31-max-lines-checker-silently-ignores-unknown-options.md) | T | XS | P3 | none | Done |
| 32 | [Root harness commands are unusable from package subdirectories](./32-root-harness-commands-are-unusable-from-package-subdirectories.md) | T | S | P3 | none | Done |
| 33 | [Default ratchet trend consumes thousands of agent tokens](./33-default-ratchet-trend-consumes-thousands-of-agent-tokens.md) | T | S | P3 | [review 17](../harness-review-2026-07/17-ratchet-trend-and-debt-attribution.md) | Done |
| 40 | [Local rules lack an adopter-ready starting point](./40-local-rules-lack-an-adopter-ready-starting-point.md) | T | M | P2 | none | Done |
| 41 | [The standalone demo advertises a Musi-coupled rule as ready to wire up](./41-standalone-demo-advertises-a-musi-coupled-rule-as-ready-to-wire-up.md) | T | M | P2 | none | Done |
| 42 | [`test-file-location` does not enforce the co-location it promises](./42-test-file-location-does-not-enforce-the-colocation-it-promises.md) | T | S | P2 | none | Done |
| 43 | [Bare prose satisfies `no-llm-artifacts` tracking-reference requirement](./43-bare-prose-satisfies-no-llm-artifacts-tracking-reference-requirement.md) | T | S | P3 | none | Done |
| 44 | [The authoritative harness map presents only part of the local-rule inventory](./44-authoritative-harness-map-presents-only-part-of-local-rule-inventory.md) | DOC | S | P3 | none | Done |
| 45 | [Ratchet summary’s `files` column means debt-bearing files, not scope](./45-ratchet-summary-files-column-means-debt-bearing-files-not-scope.md) | T | XS | P3 | none | Done |
| 46 | [Trend reports retired historical debt as “current”](./46-trend-reports-retired-historical-debt-as-current.md) | T | S | P2 | [review 17](../harness-review-2026-07/17-ratchet-trend-and-debt-attribution.md) | Done |
| 47 | [The debt-log report calls historical retirements “Acceptance”](./47-debt-log-report-calls-historical-retirements-acceptance.md) | T | XS | P3 | none | Done |
| 48 | [The config-surface pattern is visible but not teachable](./48-config-surface-pattern-is-visible-but-not-teachable.md) | DOC | S | P3 | [explore 19](../harness-explore-2026-07/19-copyability-config-block.md) | Done |
| 50 | [Quickstart password instructions produce mismatched database credentials](./50-quickstart-password-instructions-produce-mismatched-database-credentials.md) | DOC | XS | P1 | none | Done |
| 51 | [Concurrency writer inventory omits level-up and sorcery conversions](./51-concurrency-writer-inventory-omits-level-up-and-sorcery-conversions.md) | DOC | S | P2 | none | Done |
| 52 | [AI harness calls blocking suppression checks manual/report-only](./52-ai-harness-calls-blocking-suppression-checks-manual-report-only.md) | DOC | XS | P2 | [deep-dive 50](../lint-deep-dive-2026-07/50-suppression-registers-into-commit-gate.md) | Done |
| 53 | [README describes the wrong normal verification workflow](./53-readme-describes-the-wrong-normal-verification-workflow.md) | DOC | XS | P2 | none | Done |
| 54 | [Character-sheet module recommends a removed ref pattern](./54-character-sheet-module-recommends-a-removed-ref-pattern.md) | DOC | XS | P2 | none | Done |
| 55 | [Root `CONTEXT.md` is mislabeled and assigns concentration to the wrong boundary](./55-root-context-is-mislabeled-and-assigns-concentration-to-the-wrong-boundary.md) | DOC | S | P2 | none | Done |
| 60 | [README front door buries the harness](./60-readme-front-door-buries-the-harness.md) | DOC | S | P2 | none | Done |
| 61 | [`docs/generated/` is labeled machine-written while a map is hand-authored](./61-docs-generated-is-labeled-machine-written-while-a-map-is-hand-authored.md) | DOC | S | P2 | [explore 13](../harness-explore-2026-07/13-generate-lint-coverage-map.md) | Done |
| 62 | [`docs/agent_notes/` has no stranger reading contract](./62-agent-notes-has-no-stranger-reading-contract.md) | DOC | S | P2 | none | Done |
| 63 | [Archive-vs-clone boundary is invisible in the first hour](./63-archive-vs-clone-boundary-is-invisible-in-the-first-hour.md) | DOC | XS | P2 | [review 70](../harness-review-2026-07/70-export-ignore-vs-reference-goal.md) | Done |
| 64 | [Authoritative harness map is still “awaiting owner sign-off”](./64-authoritative-harness-map-is-still-awaiting-owner-sign-off.md) | DOC | XS | P3 | [arch 13](../arch-review-2026-07/13-substrate-ruling-bash-vs-ts.md) | Done |
| 65 | [No 15-minute visitor tour or copy ladder](./65-no-fifteen-minute-visitor-tour-or-copy-ladder.md) | DOC | M | P2 | 60 | Done |
| 66 | [No outsider-facing commit-gate lifecycle walkthrough](./66-no-outsider-facing-commit-gate-lifecycle-walkthrough.md) | DOC | S | P3 | 65 | Done |
| 67 | [Root `DESIGN.md` has no role label](./67-root-design-md-has-no-role-label.md) | DOC | XS | P3 | none | Done |
| 68 | [`drift-ai.config.json` reads as committed local state](./68-drift-ai-config-json-reads-as-committed-local-state.md) | DOC | XS | P3 | none | Done |
| 69 | [Root baselines look like dump files](./69-root-baselines-look-like-dump-files.md) | DOC | XS | P3 | none | Done |

## Showcase surfaces to protect

- **Lint ratchet platform:** the symmetric baseline, adoption guide, and
  clone-and-run demo in `docs/guides/lint-overview.md`,
  `docs/guides/lint-ratchet-adoption.md`, and
  `examples/lint-ratchet-demo/`.
- **Controls → generated artifacts → check:** `harness.controls.json` as the
  inventory, generated wiring/docs as the rendered contract, and
  `harness:check` as proof.
- **Shared bodies with thin adapter shims:** the cross-harness pattern in
  `scripts/ai-hooks/` and its harness-specific wrappers.

## Reconciliation notes for earlier packs

- `harness-review-2026-07b` leaf 60 is fully stale at HEAD: all four gaps
  are now present in `AGENTS.md`; only its leaf-53 header-hygiene footnote
  remains.
- `harness-review-2026-07` leaf 17 has a stale status line saying trend is
  not implemented; trend shipped in `3b79af88`, and leaves 33 and 46 extend it.
- `harness-review-2026-07` leaf 70 is partially superseded by
  `.gitattributes` carve-backs; leaf 63 owns the remaining discoverability gap.
- `arch-review-2026-07/00-report.md:299-301` claims zero hook orphans, which
  leaf 22 contradicts.
- Memory-recorded worktree bugs involving swallowed failure and
  `allocations.json` truncation are fixed at HEAD by `6f002720`,
  `81a1af1c`, and `9063e39e`; do not re-file them.

## Recommended Order

Wave 1 (P1s, gate/worktree/hook correctness, docs accuracy: 01–05, 10–15,
20–24, 50–51, 54–55) is Done. For the remainder:

1. **P2 correctness:** 46, with docs-accuracy leaves 52–53 in parallel with
   the public-reference work.
2. **Presentation cluster:** 60–69 plus the doc-facing leaves in 40–48.
   The upcoming public presentation makes the DOC P2 leaves time-sensitive;
   land 60 before 65, and 65 before 66.
3. **P3 remainder:** 30–33, 45, 47, and the remaining P3 lint/docs polish
   in any order after their linked owners are re-verified.

## Promotion Rules

1. Promote one leaf at a time; read its Evidence block and re-verify every
   citation at HEAD before editing.
2. Keep each leaf to one commit unless the leaf says otherwise; update this
   index's Status column in the same commit that finishes a leaf.
