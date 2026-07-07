# 31. Stop-hook live ESLint scan has no internal timeout against the 30s Stop budget

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: stop-policy · Area: hooks-stop · Severity: med · Size: S-M · Confidence: high
Theme: timeout-coherence · Source: harness review 2026-07-06 (Sonnet breadth + Codex CONFIRMED)

## Problem
`ai_stop_lint_warnings_reminder` runs a live `node_modules/.bin/eslint -f
json` over up to 10 changed files synchronously inside the Stop hook — the
only stop-policy subcheck that spawns real work instead of reading a
cached marker. The Stop wiring allots 30s total, shared with the four
other subchecks. A cold ESLint start over 10 files can plausibly exceed
that, and the hook layer then times the whole Stop policy out silently —
losing the *other* reminders (dirty tree, failing verify) along with the
lint one. The prior pack's leaf 56 explicitly required measuring this
before committing to the cap; no measurement artifact exists.

## Evidence
- `scripts/ai-hooks/stop-policy.sh:868-927` (reminder), `:903` (eslint
  invocation, `2>/dev/null || return 1` — crash indistinguishable from
  clean), `:1001` (wired into `ai_stop_policy_messages`).
- `.claude/settings.json:189-198` — Stop timeout 30s.
- Codex verification: CONFIRMED (`stop-reminder.sh:24` call path).

## Proposed direction
Three cheap moves, any subset: (a) wrap the eslint call in
`timeout <budget>s` with a budget well under 30s, treating overrun as
"no message" for the lint check only; (b) order the lint check last in
`ai_stop_policy_messages` so cached checks always land first (verify
current ordering); (c) measure a realistic cold run and, if it cannot fit,
raise the Stop wiring timeout via `harness.controls.json` (regenerating
settings.json) rather than shrinking coverage silently — leaf 56's own
prescription. Distinguish eslint-crash from zero-warnings while there
(the `|| return 1` conflates them).

## Scope / caveats
Keep the file cap (`AI_TIDY_STOP_WARNING_FILE_CAP`) as-is; this leaf is
about bounding wall-clock, not coverage. One commit (stop-policy.sh +
possibly manifest + regen).
