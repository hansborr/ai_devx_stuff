# AI Harness and Lint Audit — 2026-07-21

Status: Triaged audit record — no leaf is promoted automatically
Date: 2026-07-21

Multi-agent audit of the lint system, AI-hook adapters, verification wrappers,
agent-facing messages, and backlog governance. The audit deliberately excluded
VTT feature behavior except where app files were useful lint fixtures.

## Overall verdict after adversarial review

The harness has strong generated-control, focused-test, and repair-text
foundations: `harness:check`, generated-doc checks, local-rule tests, and the
AI-hook suite all passed. The main residual risk is at boundaries where a
successful process exit does not mean "no information": report-only commands,
provider result transport, edit paths from other worktrees, Git diff discovery,
and multi-table/cross-pack backlog state.

The audit found real defects, but its first pass inflated several narrow fixes
into new frameworks. The table below records the follow-up disposition. This is
a parked evidence pack, not a second ready queue: promote accepted work through
`../ready-2026-07/00-index.md` only after the owner chooses it over product and
behavior work.

| # | Item | Priority | Size | Status |
|---|---|---|---|---|
| 02 | [Fail closed when command-result exit evidence is missing](./02-result-exit-evidence.md) | P1 | S | Revision candidate — owner decision required |
| 03 | [Make Bun cache identity and artifacts coherent](./03-bun-cache-identity-and-artifacts.md) | P1 core / P2 retention | M | Revision candidate — owner decision required |
| 04 | [Preserve live output for report commands](./04-live-report-output-contract.md) | P1 core / P2 manifest | M | Approved 2026-07-21 — open sensor/ratchet classifications ruled |
| 05 | [Make edit hooks target-worktree aware](./05-edit-hook-target-worktree.md) | P1 first slice / P2 remainder | M + follow-up | Approved 2026-07-21 — worktree-local marker scope selected |
| 06 | [Fail closed during changed script-smoke selection](./06-script-smoke-selection-and-output.md) | P2 | S | Approved 2026-07-21 — full-suite fallback selected |
| 07 | [Conservatively scan when pre-push diff discovery fails](./07-prepush-diff-fallback.md) | P3 | S | Deferred |
| 08 | [Align async lint repairs under the real server config](./08-async-lint-contract.md) | P2 repair / P3 expansion | S-M | Split candidate — owner decision required |
| 09 | [Batch the lint-coverage edit hook](./09-lint-coverage-hook-budget.md) | P2 | M | Revision candidate — owner decision required |
| 10 | [Correct migration and Prisma hook guidance](./10-prisma-guidance-accuracy.md) | P1 | S | Accepted candidate — owner decision required |
| 11 | [Preserve commit truth-up advisories across harnesses](./11-cross-harness-commit-advisories.md) | P2 | S | Accepted candidate; pair with 13; owner decision required |
| 12 | [Parse every same-pack backlog task table](./12-backlog-index-completeness.md) | P2 | S | Accepted candidate — owner decision required |
| 13 | [Make commit failure summaries fair](./13-failure-summary-signal.md) | P2 | S | Accepted candidate; pair with 11; owner decision required |
| 14 | [Reduce misleading Codex edit status chatter](./14-codex-edit-status-aggregation.md) | P3 | S | Configuration-cleanup candidate — owner decision required |
| 15 | [Pin Copilot registration into public archives](./15-copilot-archive-contract.md) | P3 | S | Opportunistic candidate — owner decision required |
| 16 | [Package-script discovery decision](./16-package-script-discovery.md) | — | — | Rejected; docs-only alternative |
| 17 | [Parallel script-smoke output decision](./17-script-smoke-green-output.md) | below P3 | — | Deferred until measured pain |
| 18 | [Cross-pack backlog identity redesign](./18-cross-pack-backlog-identity.md) | P2 | M | Approved 2026-07-21 — replacement authoritative-link design signed off |
| 19 | [Scope flaky-test guidance to evidence](./19-flaky-guidance-scope.md) | P2-P3 | S-M | Revision candidate — owner decision required |
| 20 | [Verify progress-output decision](./20-verify-output-signal.md) | — | — | Rejected; narrow cleanup only |

## Promotion sequence if harness work is selected

1. Treat 02 + the P1 core of 03 as one result/cache-integrity tranche.
2. Land the narrow 04 live-report behavior before adding more report sensors.
3. Split 05: shared target resolver plus Prisma/protected-files first; advisory
   parity is a later slice. The owner selected worktree-local scope for the
   protected-edit marker (2026-07-21); record that contract across the manifest,
   docs, and tests during migration.
4. Land 10 as an independent small correctness repair.
5. Take 09, 06, combined 11+13, and 12 only after the higher-risk boundary
   fixes. Redesign 18 as the second backlog-governance slice if it is promoted.
6. Return to product/behavior priorities before output-polish work.

Rejected leaves remain linked as decision records so later audits do not
re-propose their implementation shapes.

The evidence, checks, rejected duplicates, and exact live-drift inventory are
in [01-sources-and-verdicts.md](./01-sources-and-verdicts.md).
