# Status

**Last updated**: 2026-05-21 — `feature/lint-hardening-baseline-drain-audit`
drained 39 ratchet baseline items across four commits and merged as
`9d0d1f9b`. `lint:ratchet` current findings dropped `128 -> 89`. Per-commit
deltas: magic-numbers in top-level scripts `15 -> 0`, `require-await` in
`scripts/code-intel.test.ts` `11 -> 0`, codemod-test `only-throw-error` +
`expect-expect` `12 -> 0`, and `scripts/drift-ai.ts:249` `parseArgs`
complexity `49 -> 6` (file max `49 -> 18`). CLI behavior preserved
byte-for-byte for spot-checked entrypoints; codex review found no
regressions. Details: `finished_work/baseline-drain-batch.md`.

## Active

Lint-hardening review follow-up Tier 2 remains the active workstream. The
follow-up queue lives in `backlog/lint-followups/00-index.md`. Broad-shallow
Leaf 41 coverage is **complete enough** after Leaf 41j; the next promoted
work should be a named drain or deeper-rule leaf, not a broad-shallow
re-audit.

Suggested next drain targets (audit `/tmp/codex-drain-audit-report.md`):

- `ratchet/core-complexity-codemods` (24 items, L effort — split by file).
- Remaining `ratchet/core-complexity-drift-ai` items (9 left after
  parseArgs drain).
- `local/max-lines-*` ratchets, only with dedicated module-split time.

Bug-class findings (`vitest/expect-expect`, non-`Error` throws, ambiguous
truthiness) keep their fix-soon drain priority. New floors stay in
local/pre-commit (CI is not the only enforcement point). Each new ratchet's
finished-work note must state an explicit exit path.

## Verification

Each merged leaf passed its scoped gates (at minimum `lint`, `typecheck`,
plus `test:scripts:changed` / `test:server` / `test:client` as relevant).
Per-leaf detail lives in `LOG.md` and the per-leaf `finished_work/` notes.

## Historical context

`LOG.md` is the curated chronological history. The lint-hardening backlog
index is `backlog/lint-hardening-cross-repo-review.md`, with the verdict
register at `backlog/lint-hardening/evaluation-verdicts.md`. Parked
in-progress lint context docs are provenance-only — open them only when a
human asks for re-triage.
