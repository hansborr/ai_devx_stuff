# 13. Debt accounting runs only in full verify/CI — a hand-edited baseline passes the local commit path

Status: Done — implemented on 2026-07-04 by wiring debt-accounting into verify:changed and pre-commit; skip visibility was already present and covered when re-verified.
Lens: ratchet · Area: debt accounting · Severity: med · Size: S-M · Confidence: high
Theme: gate-wiring · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
`lint:ratchet:check-debt-accounting` (the integrity gate from
harness-review-2026-07 leaf 14) is wired into full `verify`, `verify:parallel`,
and CI — but not into `MUSI_PRE_COMMIT_STEPS` or `MUSI_VERIFY_CHANGED_STEPS`.
The commit that stages a worse baseline without a debt-log line therefore
passes the normal local loop (pre-commit + verify:changed) and fails only in
CI or a later full verify — exactly the late-failure shape the changed gates
exist to avoid. Two hardening details while there: the accounting check
returns success when no comparable base ref exists, so the protection can
silently vanish in unusual git states (shallow clones, no origin/main); make
that an explicit reported skip.

## Evidence
- `scripts/verify/steps.generated.sh:12-15` — slot arrays: `debt-accounting` present in `MUSI_VERIFY_STEPS`/`MUSI_VERIFY_PARALLEL_STEPS`, absent from changed/pre-commit. Verified 2026-07-04 (Explore trace + Codex lanes A/C independently).
- `scripts/lint-ratchet/baseline-debt-accounting-git.ts:82-96` — missing-base success path.
- `.github/workflows/ci.yml` "Lint ratchet debt accounting" step — CI backstop exists.

## Proposed direction
Add the slot to the changed/pre-commit consumers, gated on cheapness: the
check is git-plumbing + JSON diff (no ESLint), so it can run unconditionally;
if measured overhead matters, run it only when `lint-ratchet.baseline.json`
or `lint-ratchet.debt-log.jsonl` is staged. Emit an explicit `SKIP (no
comparable base)` line instead of silent success, and cover that path with a
test. Slot changes go through `harness.controls.json` +
`scripts/harness/generate-verify-steps.ts` regeneration (never hand-edit
`steps.generated.sh`).

## Scope / caveats
- The threat actor here is "agent under gate pressure", which is local — CI
  catching it later means a broken push, not prevention; early local failure
  is the point.
- One commit: manifest change + regenerated steps + skip-visibility tweak +
  test.
