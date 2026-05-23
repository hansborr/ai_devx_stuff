# Status

**Last updated**: 2026-05-23 — `feature/lint-ratchet-sharing-backlog`
has lint-ratchet sharing Leaves 01-05 and 07 complete; Leaf 06 remains parked
pending human input on the license + reference-repo decision. Leaf 07 landed
across `3ed81324ada4`, `8401dd01dd2f`, `0ee4656ae66d`, `55a412b34bb0`, and
`3b470daf8ae0`, adding the check-registry preflight validator, Windows path
follow-up, CI label, guide coverage, and wording correction. Leaf 05 landed
across `7006d2032cbb`, `b116a8257c67`, `73ee478d65c7`, `c0e401b6d65a`,
`e6026bae81bc`, and `0e120502ffca`, adding the PR comment formatter,
state-aware report footer, CI step-summary/sticky-comment wiring, and guide
coverage. Leaf 04 landed across
`2b4f91003d4d` and `eb591d3bee0f`, adding the baseline summary command and
guide coverage. Leaf 03 landed across
`e2c42988`, `61364eca`, `23f0a583`, `1efca5bd`, and `6df8f428`, adding CI
workflow parity, diagnostics artifact capture, step-summary output, and
portable CI guidance. Leaf `06` remains parked pending human input on
licensing. `lint:ratchet` remains clean at 89 current findings.

## Active

Lint-ratchet sharing Leaves 01, 02, 03, 04, 05, and 07 are done on
`feature/lint-ratchet-sharing-backlog`. Leaf `06` in
`backlog/lint-ratchet-sharing/` remains parked pending human input on the
license + reference-repo decision.

Lint-hardening review follow-up Tier 2 remains the broader follow-up queue in
`backlog/lint-followups/00-index.md`. Broad-shallow Leaf 41 coverage is
**complete enough** after Leaf 41j; the next promoted hardening work should be
a named drain or deeper-rule leaf, not a broad-shallow re-audit.

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
