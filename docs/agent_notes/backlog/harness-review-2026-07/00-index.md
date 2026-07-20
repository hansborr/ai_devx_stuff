# Harness Review 2026-07 — Task Pack

Status: Parked task index (2 surviving leaves, both design-gated; the
ratchet-merge, ratchet-platform, lint-rule, and hook lanes landed
2026-07-12..2026-07-15. The 25 Done/superseded leaf files were removed at
the 2026-07-19 backlog triages — recoverable from git history; their rows
below keep the landing record)
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
| 10 | Semantic min-merge baseline driver | RM | M-L | high | pair with 12 | Done — semantic min-merge driver landed (`e8b9f7db`) |
| 11 | Automate merge-driver install (+ health check) | RM | S | high | none | Done — `prepare` installs drivers; `doctor.sh` health check |
| 12 | Post-merge baseline truth-up | RM | S-M | med-high | none (pairs with 10) | Done — `.husky/post-merge` baseline truth-up (`1b732828`) |
| 14 | Baseline hand-edit integrity gate | RP | M | high | none | Done — `baseline-debt-accounting*.ts` via `--check-debt-accounting` |
| 15 | Parallelize ratchet collection | RP | M | med | none | Done — `current-collector.ts` bounded concurrency pool (default 3) |
| 16 | Implement `report-only` + `--propose` dry-run | RP | S-M | med | none | Done — `report-only` mode (`caf53107`) + `propose.ts` dry-run (`e2efc1ee`) |
| 17 | Ratchet trend + by-directory attribution | RP | S-M | low-med | none | Done — `lint:ratchet:trend` + `--by-directory` (`3b79af88`, `583e8357`) |
| 18 | Upgrade-drift classification + swap visibility | RP | S | low-med | none | Done — stale rule-source identity classification and equal-count swap visibility landed |
| 19 | `--update` preflight + expansion unification | RP | S-M | med | none | Done — update preflight + glob unification + GFM escaping (`e8e46212`) |
| 30 | No outer `prisma` client in `$transaction` callbacks | L | M | high | none | Done — `no-outer-client-in-transaction.js` (`d867c3d2`→`3a5e55ca`) |
| 31 | Raw-SQL fence + inventory-router escapee | L | S | high | none | Done — raw-SQL fence + inventory escapee migrated (`ee14e9f8`) |
| 32 | tRPC error-code discipline rule | L | M | high | none | Done — `local/no-plain-error-in-trpc` (`11f5d8f7`→`ae34ef94`) |
| 33 | No hand-built query keys | L | S-M | med-high | none | Done — `no-hand-built-query-keys` restricted-syntax (`40c451d0`) |
| 34 | Ban permissive shared/output schemas | L | S-M | med-high | none | Done — permissive shared/output schema bans landed |
| 35 | [Socket listener cleanup rule](./35-client-socket-listener-cleanup-rule.md) | L | M | med-high | none | Done — pairing half landed (`b1d220ba`); boundary half deferred (owner) |
| 36 | [`effect-boundary` marker rule](./36-effect-boundary-marker-rule.md) | L | M | med-high | useeffect-plan decision | Deferred (owner decision) |
| 38 | `strict-boolean-expressions` next slice | L | S | med | none | Done — `ratchet/strict-boolean-expressions-server-services` landed (`7135e5a0`, 2026-07-02); leaf removed 2026-07-19 (git history) |
| 50 | Hook-wiring schema: lifecycle events | H | M | high | none | Done — `hook-wiring-schema.ts` lists ~17 lifecycle events |
| 51 | PostCompact state re-injection | H | S-M | med-high | 50 | Done — SessionStart re-injection via `session-state.sh` |
| 52 | SubagentStop stop-policy | H | S-M | med | 50 | Done — SubagentStop stop-policy adapter + manifest entry (`f58262ac`); systemMessage rationale recorded (`4285af0f`) |
| 54 | protected-files advisory/deny split | H | M | med-high | none | Done — `protected-files.sh` deny tier (`68999c63`) |
| 56 | tidy hook immediate/deferred split | H | M | low-med | none | Done — `stop-policy.sh` immediate/deferred split (`48ac51aa`) |
| 57 | pre-push fast-commit backstop | H | S | med | none | Done — `.husky/pre-push` fast-commit backstop → `land.sh` |
| 58 | PostToolUseFailure fix guidance | H | S-M | low-med | 50 | Done — `failure-guidance.sh` wired in `.claude/settings.json` |
| 70 | export-ignore vs the reference goal | P | S | high | none | Partially superseded — copyable config carved into archives; discoverability → harness-audit 63 |
| 71 | Coverage-map claim vs checker scope | P | S | med | none | Done — `TRACKED_EXTENSION_PATTERN`/`TRACKED_BASENAMES` widened (`c28439e4`) |
| 74 | Relocate cadence output-style rules | P | S | med | none | Done — cadence policy relocated into `AGENTS.md`, output style trimmed to tone-only (`c62c2f3b`, 2026-07-02); leaf removed 2026-07-19 (git history) |

## Recommended Order

The merge lane (10–12), ratchet platform (14–17, 19), lint rules (30–34), and
hooks (50, 51, 54, 56–58) all landed between 2026-07-12 and 2026-07-15
(verified in `../sequential-drain-2026-07/01-verification-record.md`). What
remains:

1. **Still open:** nothing unconditional — 38 landed 2026-07-02 (`7135e5a0`)
   and 74 landed 2026-07-02 (`c62c2f3b`); both were verified on main at the
   2026-07-19 triage. 52 (SubagentStop stop-policy) landed as drain leaf 3.1.
2. **Design-gated / owner decision:** 35 boundary half and 36 (both recorded
   in their leaves); 70 is partially superseded.

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
