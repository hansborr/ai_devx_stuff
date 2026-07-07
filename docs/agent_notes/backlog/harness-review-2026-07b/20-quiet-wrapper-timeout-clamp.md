# 20. Clamp quiet-wrapper internal watchdogs below the harness hook timeout

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: quiet-wrappers · Area: hooks-exec · Severity: med · Size: S · Confidence: high
Theme: timeout-coherence · Source: harness review 2026-07-06 (Sonnet breadth + Codex PARTLY-confirmed)

## Problem
`git-commit-quiet.sh` and `bun-run-quiet.sh` derive `TOTAL_TIMEOUT` from
env (`AI_GIT_COMMIT_TIMEOUT`/`AI_BUN_TIMEOUT` → `MUSI_VERIFY_TIMEOUT` →
`MUSI_INTERACTIVE_TIMEOUT` → 1200) while the harness-side hook timeout is
hardcoded at 1260s in `.claude/settings.json`. The 60s gap is deliberate
(internal SIGTERM first, wrapper gets 60s to emit JSON) — but nothing
enforces it. An operator raising `MUSI_INTERACTIVE_TIMEOUT` (a documented
repo knob) past ~1200 silently inverts the ordering: the harness kills
the wrapper before its trap-friendly watchdog fires, skipping the JSON
finalization path and reintroducing the orphan class of leaf 21.

## Evidence
- `scripts/ai-hooks/git-commit-quiet.sh:68`, `scripts/ai-hooks/bun-run-quiet.sh:102`
  — env-derived `TOTAL_TIMEOUT`, no upper clamp.
- `.claude/settings.json:115,120` — fixed 1260s hook timeouts.
- Codex verification: CONFIRMED the missing clamp (the orphan half of the
  original claim was narrowed — see leaf 21).

## Proposed direction
Clamp in both wrappers: `TOTAL_TIMEOUT = min(env-derived, DECLARED - 60)`
with `DECLARED` kept as a constant that the hook-wiring manifest also
sources (or at least a comment pairing it to `harness.controls.json`'s
`timeout` field so regeneration keeps them aligned). Emit a one-line
notice when clamping occurs so the operator learns the env override was
capped. Cover with a test in `scripts/ai-hooks/test.sh` using a large
`MUSI_INTERACTIVE_TIMEOUT`.

## Scope / caveats
Ideally the manifest becomes the single source for both numbers
(generator writes settings.json timeout AND a sourced shell constant);
if that is too much machinery, the min-clamp alone removes the hazard.
One commit.
