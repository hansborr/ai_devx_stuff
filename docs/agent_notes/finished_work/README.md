# Finished Work

This archive is intentionally pruned. Do not recreate a large historical note
dump here.

Durable history belongs in `../LOG.md`. Cross-cutting rationale belongs in
`../DECISIONS.md`. Keep only a finished-work note when it contains operational
detail that cannot be recovered from code, tests, commits, `LOG.md`, or
`DECISIONS.md`.

## Index

- `socket-emit-inventory.md` — DX5.3a inventory and registry-scope
  classification (closed at DX5.3f).
- `fixture-builder-inventory.md` — DX7.0c inventory of fixture outliers and
  per-leaf builder targets for the DX7.1a-DX7.1i splits.
- `codebase-review-next-cycle.md` — closed CR1-CR21 review cycle with the
  landed leaf summaries and deferred/rejected rationale.
- `cache-budget-verification-plan.md` — landed cache-budget verification
  implementation; conditional follow-ups live in
  `../backlog/cache-budget-followups.md`.
- `precommit-240-budget-followup.md` — changed-mode verify parallelization,
  staged script-smoke selection, and ratchet-smoke fixture narrowing that
  restored local verify/pre-commit runs under the 240s hard budget.
- `ai-harness-improvements.md` — landed broad harness-improvement plan;
  remaining conditional work lives in `../backlog/ai-harness-followups.md`.
- `concurrency-codemod-feasibility.md` — checker-first concurrency codemod
  feasibility analysis; optional hardening lives in
  `../backlog/concurrency-guard-followups.md`.
- `concurrency-guard-expansion.md` — landed concurrency-guard baseline plan;
  optional hardening lives in `../backlog/concurrency-guard-followups.md`.
- `expand-barrel-codemod.md` — landed barrel-expansion codemod, cleanup, and
  `local/no-barrel` enforcement.
- `code-intel-review-followups.md` — landed `code:intel` review slices;
  conditional follow-ups live in `../backlog/code-intel-followups.md`.
- `code-intel-ux-fixes.md` — landed `code:intel` UX work: slices A-D, Slice E
  (`refs`), and Slice F (daemon mode). Daemon transport, `ProjectCache`
  reference project, performance numbers, and locked decisions live here.
- `a11y-tree-playwright-plan.md` — landed tracked Playwright CLI skills,
  e2e lint coverage, role-first selector drift guard, and final Playwright lint
  warning cleanup.
- `shared-rules-stryker-triage.md` — focused `attack-roll.ts` mutation
  survivor triage with the useful/equivalent mutant classification that led to
  the multi-digit crit-dice fixture.
- `doc-length-hook-redesign.md` — landed doc-length surface split
  (edit vs commit), softened advisory wording, phantom-arm cleanup, and the
  decisions to leave Codex unwired and defer throttling.
- `drift-ai-field-run-calibration.md` — repeatable `drift:ai` calibration
  record template plus the first focused Musi current-scope baseline and linked
  detector-tuning follow-up.
- `scripts-and-hooks-reorg-2026-06.md` — completed scripts and AI-hooks reorg
  plan, including the generated verify/hook wiring decisions and the stale-path
  cleanup lesson from the mechanical move phase.
- `lint-review-2026-06.md` — closed 23-leaf lint-setup review pack: scripts
  coverage inversion, 37-to-9 ratchet drain, e2e selector floors, cache
  removal, merge-base preflights, and the import-cycle verdict.
- `lint-followups-2026-06.md` — closed 16-leaf successor to the lint-review
  pack: e2e selector debt drain (172 findings/21 files) with the selector
  ratchets retired, runtime import-cycle gate, and ESLint plugin evaluations.
- `drift-ai-findings.md` — closed `drift:ai --scope current` triage: 30
  implemented quality fixes (dedup/dead-code/doc-drift) plus 1 won't-fix false
  positive, across tooling and product code.
- `drift-ai-next-items.md` — closed post-ship `drift:ai` task pack: 43 leaves
  across diagnostics fusion/projection, prototype advisory lenses
  (clone/commented-code/layer-direction), and governance/config inspection.
- `testsuite-audit.md` — 2026-06-21 reconciliation of the 55-finding test-suite
  audit: 43 closed, 12 still open (listed in `../backlog/testsuite-audit/`).
- `mutation-coverage-2026-06.md` — 95-finding StrykerJS pack: 94 landed via
  merged `feat/mutation-expand-shared-server`; residual #75 queued for Codex.
- `ux-audit-2026-06-p0.md` — three 2026-06-06 live-play P0 blockers shipped;
  only the manual dev-DB fixture reseed deferred.
