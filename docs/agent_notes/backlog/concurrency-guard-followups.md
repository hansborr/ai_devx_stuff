# Concurrency Guard Follow-ups

Status: Parked, optional hardening
Last triaged: 2026-05-08
Source: `../finished_work/concurrency-guard-expansion.md`

The useful baseline has landed: `bun run codemod:concurrency-guard -- --check`
/ `--all` / `<file>`, `local/concurrency-guard` as an ESLint error for direct
gated delegate writes outside mutation helpers, and the race-sensitive
mutation guide/harness map references.

## Remaining Work

- Extract a shared guard contract module only if the codemod and ESLint rule
  start drifting. Today the lint rule intentionally covers a smaller
  low-noise surface than the codemod.
- Consider helper-internal ESLint checks only for shape-only cases that are
  clean in a manual codemod run. Keep ambiguous helper classification,
  provenance, counter-flow, and lock-order findings in the codemod unless they
  become reliably syntax-only.
- Add codemod-only advisory checks for cross-table helper order with reviewed
  allowlists for documented row-disjoint exceptions.
- Strengthen value/provenance checks for Pattern A/B/C helpers only when a
  focused fixture proves the signal is stable.
- Add a golden test over current helper files if the guard surface expands
  again, so future refactors cannot silently relax checks.

## Non-Goals

- Do not add new concurrency gates or gated tables from this note.
- Do not auto-rewrite business-code writes where choosing the helper changes
  domain semantics.
