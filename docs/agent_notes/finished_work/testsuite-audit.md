# Test-Suite Audit — closed leaves (reconciled 2026-06-21)

The 2026-06 lens-driven test-suite audit filed 55 findings (run-time 12 /
defect-catching 19 / maintainability 24). A 2026-06-21 reconciliation
(per-leaf re-verification against `main`) found **43 already Done** and removed
their leaf files; **12 remain** in `../backlog/testsuite-audit/` (8 queued for
the Codex drain, 4 supervised-only).

## Closed (43)

01, 05, 07, 08, 11, 12, 13, 15, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
29, 30, 31, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 45, 47, 48, 49, 50, 51,
53, 54, 55.

These landed across the intervening test-quality work (client mock-hygiene +
split-isolation lane, shared `clearMocks` in all four vitest configs, the
fixture-builder/render-helper consolidation, the eslint-rules `messageId`
migration, the seed-parser and CAS-conflict coverage, etc.). The leaf text for
any closed finding is recoverable from git history (the files lived at
`docs/agent_notes/backlog/testsuite-audit/NN-*.md` before this commit).

## Still open (12)

See `../backlog/testsuite-audit/00-index.md`. Codex-suitable: 02, 06, 14, 16,
32 (partial) and 44, 46, 52 (ready). Supervised-only: 03, 04, 09, 10.
