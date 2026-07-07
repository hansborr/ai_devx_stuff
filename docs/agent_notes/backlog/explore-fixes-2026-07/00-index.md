# Explore Fixes 2026-07 — Task Pack

Status: Parked task index
Created: 2026-07-03
Source: dual-model exploration pass (Codex investigation + three independent
Claude sweeps + Codex adversarial triage + orchestrator fact-check).
Provenance, kill list, and the ratchet-debt snapshot:
[`01-sources-and-verdicts.md`](./01-sources-and-verdicts.md) — read that
first.

Each leaf is one small commit unless it says otherwise. Every citation was
re-verified at HEAD on 2026-07-03; line numbers drift, so reconfirm seams
with `rg` / `bun run code:intel` before editing. The dominant theme is
**dogfood-tooling correctness**: CLI arg-parsing footguns, an unsafe
`rm -rf`, silent safety-override state, and stale-artifact hygiene — the
kind of bugs the harness itself trips over.

## Task List

Tracks: **T** tooling, **D** ratchet drains/disposition, **C** client,
**TS** tests, **DOC** docs.

| # | Task | Track | Size | Priority | Depends on | Status |
|---|---|---|---|---|---|---|
| 10 | [Option-value guard: logs:audit / harness:audit](./10-option-value-guard-logs-harness-audit.md) | T | S | P1 | none | Done |
| 11 | [Option-value guard: drift-ai / code-intel / drift CLIs](./11-option-value-guard-drift-and-code-intel-clis.md) | T | M | P1 | 10 | Done |
| 12 | [bun-run-quiet allowlist refresh + drift check](./12-bun-run-quiet-allowlist-refresh.md) | T | S | P1 | none | Done |
| 13 | [Surface `.allow-protected-edits` in session state](./13-session-state-surface-protected-edits-marker.md) | T | XS | P1 | none | Done |
| 14 | [slow-drift output-dir `rm -rf` guard](./14-slow-drift-output-dir-guard.md) | T | XS | P1 | none | Done |
| 15 | [slow-drift run metadata + staleness docs](./15-slow-drift-report-metadata-and-docs.md) | T | S | P1 | none | Done |
| 16 | [generate-hook-wiring atomic-writer mkdir](./16-hook-wiring-writer-mkdir.md) | T | XS | P2 | none | Done |
| 17 | [typecheck.sh smoke test](./17-typecheck-sh-smoke-test.md) | T | M | P2 | none | Done |
| 18 | [Worktree Redis URL single-source](./18-worktree-redis-url-single-source.md) | T | XS | P2 | none | Done |
| 19 | [.husky/post-commit mode consistency](./19-husky-post-commit-mode-consistency.md) | T | XS | P2 | none | Done |
| 30 | [Memoize auth context value (whole-ratchet clear)](./30-auth-context-constructed-context-value.md) | D | XS | P1 | none | Done |
| 31 | [prefer-screen-queries drain (whole-ratchet clear)](./31-prefer-screen-queries-drain.md) | D | S | P2 | none | Done |
| 32 | [no-plain-error-in-trpc debt disposition](./32-no-plain-error-ratchet-disposition.md) | D | S | P2 | decision inside leaf | Done |
| 50 | [Shared death-save dots component](./50-shared-death-save-dots.md) | C | S | P2 | none | Done |
| 51 | [Homebrew tab query-state shell](./51-homebrew-tab-query-state-shell.md) | C | S | P2 | none | Done |
| 60 | [De-flake test-verify-logs marker-age assertions](./60-verify-logs-marker-age-flake.md) | TS | XS | P1 | none | Done |
| 70 | [Close stale flaky entry #7 (SRD subclass)](./70-close-stale-flaky-entry-srd-subclass.md) | DOC | XS | P2 | none | Done |

## Recommended Order

1. **Small P1 footgun closures first:** 19 → 13 → 14 → 60 → 10 — each XS/S,
   tooling-first, closes a real workflow hazard (Codex's sequencing, with 19
   demoted-in-rationale but kept early for cheapness).
2. **Then the S/M P1s:** 12 (classify deliberately — wrapping a live-output
   script degrades it), 11 (several CLIs; spot-run each), 15 (keep the test
   cheap — fixtures, not real producer runs).
3. **Ratchet clears:** 30, 31, then decide 32.
4. **Rest:** 16, 18, 17 (hang-risk: hard timeouts + FIFO draining, crib
   `test-vitest*.sh`), 50, 51, 70 anywhere they fit.

## Promotion Rules

1. Promote one leaf at a time; read
   [`01-sources-and-verdicts.md`](./01-sources-and-verdicts.md) first —
   especially the kill list, so dead candidates stay dead.
2. Reconfirm seams with `rg` / `bun run code:intel` before editing.
3. Ratchet leaves follow the zero-baseline lifecycle in
   `docs/guides/lint-ratchet.md`.
4. When a leaf lands, mark its row Done here; durable context goes to
   `../../LOG.md` / `../finished_work/` only if the commit cannot carry it.
