# Harness Review 2026-07 — Task Pack

Status: Parked task index
Created: 2026-07-01
Source: 2026-07-01 AI-harness review (multi-agent: harness surface map, lint +
ratchet deep-dive, web research, Codex second opinion). Provenance,
convergence signals, and rejected verdicts:
[`01-sources-and-verdicts.md`](./01-sources-and-verdicts.md) — read that
first.

Each leaf is one small commit (leaves that need splitting say so inside).
Every count and file:line in the leaves was re-verified against HEAD on
2026-07-01, and several of the original review's claims were corrected in
the process — where a leaf and the review conversation disagree, trust the
leaf. Still re-verify seams before implementing; paths drift.

A special note on the 10–13 merge lane: it is motivated by field experience —
this ratchet design was adopted in another multi-contributor, high-debt repo
and baseline merge conflicts were a recurring cost. That lane is the pack
owner's stated priority.

## Task List

Tracks: **RM** ratchet merge-conflicts, **RP** ratchet platform, **L** lint
rules, **H** hooks, **P** public-reference fitness.

| # | Task | Track | Size | Severity | Depends on | Status |
|---|---|---|---|---|---|---|
| 10 | [Semantic min-merge baseline driver](./10-semantic-min-merge-driver-for-baseline.md) | RM | M-L | high | pair with 12 | Done |
| 11 | [Automate merge-driver install (+ health check)](./11-merge-driver-auto-install-and-health-check.md) | RM | S | high | none | Done |
| 12 | [Post-merge baseline truth-up](./12-post-merge-baseline-truth-up.md) | RM | S-M | med-high | none (pairs with 10) | Done |
| 13 | [Baseline sharding per ratchet](./13-baseline-sharding-per-ratchet.md) | RM | M | med | outcome of 10 | Rejected (won't-do) |
| 14 | [Baseline hand-edit integrity gate](./14-baseline-hand-edit-integrity-gate.md) | RP | M | high | none | Done |
| 15 | [Parallelize ratchet collection](./15-batch-ratchet-collection.md) | RP | M | med | none | Done |
| 16 | [Implement `report-only` + `--propose` dry-run](./16-report-only-mode-and-propose-dry-run.md) | RP | S-M | med | none | Done |
| 17 | [Ratchet trend + by-directory attribution](./17-ratchet-trend-and-debt-attribution.md) | RP | S-M | low-med | none | Done |
| 18 | [Upgrade-drift classification + swap visibility](./18-upgrade-churn-message-and-swap-visibility.md) | RP | S | low-med | none | Done |
| 19 | [`--update` preflight + expansion unification](./19-update-mode-preflight-and-expansion-unification.md) | RP | S-M | med | none | Done |
| 30 | [No outer `prisma` client in `$transaction` callbacks](./30-no-prisma-client-in-transaction-rule.md) | L | M | high | none | Done |
| 31 | [Raw-SQL fence + inventory-router escapee](./31-raw-sql-fence-and-inventory-escapee.md) | L | S | high | none | Done |
| 32 | [tRPC error-code discipline rule](./32-trpc-error-code-discipline-rule.md) | L | M | high | none | Done |
| 33 | [No hand-built query keys](./33-no-hand-built-query-keys-rule.md) | L | S-M | med-high | none | Done |
| 34 | [Ban permissive shared/output schemas](./34-ban-permissive-shared-and-output-schemas.md) | L | S-M | med-high | none | Done |
| 35 | [Socket listener cleanup rule](./35-client-socket-listener-cleanup-rule.md) | L | M | med-high | none | Done (pairing half; boundary deferred) |
| 36 | [`effect-boundary` marker rule](./36-effect-boundary-marker-rule.md) | L | M | med-high | useeffect-plan decision | Deferred (owner decision) |
| 37 | [Four cheap plugin/config rule adds](./37-cheap-plugin-and-config-rule-adds.md) | L | S | low-med | (b) dep-age gate | Done |
| 38 | [`strict-boolean-expressions` next slice](./38-strict-boolean-expressions-next-slice.md) | L | S | med | none | Done |
| 39 | [Promote knip dead-export floor](./39-wire-or-drop-knip-jscpd.md) | L | S-M | low-med | none | Done |
| 40 | [`trpc-auth-before-persistence` prototype](./40-trpc-auth-before-persistence-rule.md) | L | M-L | med-high | prototype measurement | Rejected (measured noise) |
| 50 | [Hook-wiring schema: lifecycle events](./50-hook-wiring-schema-lifecycle-events.md) | H | M | high | none | Done |
| 51 | [PostCompact state re-injection](./51-precompact-state-reinjection.md) | H | S-M | med-high | 50 | Done |
| 52 | [SubagentStop stop-policy](./52-subagentstop-stop-policy.md) | H | S-M | med | 50 | Done |
| 53 | [Fix policy.sh raw-string false positives](./53-policy-raw-string-false-positives.md) | H | M | high | none | Done |
| 54 | [protected-files advisory/deny split](./54-protected-files-advisory-deny-split.md) | H | M | med-high | none | Done |
| 55 | [Opt-in hard Stop gate](./55-opt-in-hard-stop-gate.md) | H | M | med | none | Done |
| 56 | [tidy hook immediate/deferred split](./56-tidy-hook-immediate-vs-deferred-split.md) | H | M | low-med | none | Done |
| 57 | [pre-push fast-commit backstop](./57-pre-push-fast-commit-backstop.md) | H | S | med | none | Done |
| 58 | [PostToolUseFailure fix guidance](./58-posttoolusefailure-fix-guidance.md) | H | S-M | low-med | 50 | Done |
| 70 | [export-ignore vs the reference goal](./70-export-ignore-vs-reference-goal.md) | P | S | high | none | Done |
| 71 | [Coverage-map claim vs checker scope](./71-coverage-map-claim-vs-checker-scope.md) | P | S | med | none | Done |
| 72 | [Envelope: structured skipped findings](./72-envelope-structured-skipped-findings.md) | P | S-M | med | none | Done |
| 73 | [MODULE.md ↔ nested AGENTS.md](./73-module-md-nested-agents-md-aliasing.md) | P | M | med | none | Done |
| 74 | [Relocate cadence output-style rules](./74-cadence-output-style-load-bearing-rules.md) | P | S | med | none | Done |
| 75 | [Portable-core extraction](./75-portable-core-extraction.md) | P | L | med | 70, 74 (soft) | Done (Milestone 1 only) |

## Recommended Order

1. **Merge lane (owner priority):** 11 (smallest, immediately useful) → 10 →
   12. Take 13 only if 10's semantic driver disappoints in practice — 10
   also fixes same-rule collisions that sharding can't.
2. **High-severity standalone fixes:** 53 (live false-positive bug — the
   review's own probe command was denied by the hook), 14 (the one real
   ratchet enforcement hole), 31 (live raw-SQL escapee), 70 (before any
   publicizing of the repo).
3. **Zero-findings rule adds** (cheap, land at zero, no ratchet needed):
   30, 33, 34, 35 (pairing half), and 37's zero-finding sub-items; 38 is
   pure registry work.
4. **Hook lifecycle:** 50 first — it unblocks 51, 52, 58 *and* the parked
   SessionStart-rehydration item (R11) in
   [`../harness-presentation-2026-06/`](../harness-presentation-2026-06/00-README.md).
5. **Design-gated last:** 13, 36, 40, 55, 73, 75 each need an explicit
   decision recorded before implementation; the gate is written inside each
   leaf.

## Promotion Rules

1. Promote exactly one leaf into active work; read
   [`01-sources-and-verdicts.md`](./01-sources-and-verdicts.md) first.
2. Reconfirm seams with `rg` / `bun run code:intel` before editing — the
   leaves were verified 2026-07-01 and paths drift.
3. Preserve the repo timing model: report-only/advisory first for broad
   sensors; gates only after low noise, clear repair text, and a concrete
   consumer (`docs/ai-harness.md` states the promotion policy).
4. New rules with existing debt start as lint-ratchet entries per
   `docs/guides/lint-ratchet.md` ("Adding a new rule to an already linted
   area"); zero-findings rules go straight to normal lint.
5. When a leaf lands, mark its row Done here; move durable context to
   `LOG.md` / `finished_work/` only if the commit cannot carry it.
