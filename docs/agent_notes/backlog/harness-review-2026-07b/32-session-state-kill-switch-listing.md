# 32. session-state omits the lint-warnings kill switch and fires only on compaction

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: stop-policy · Area: hooks-session · Severity: low-med · Size: S · Confidence: high
Theme: state-visibility · Source: harness review 2026-07-06 (Sonnet breadth + Codex PARTLY-confirmed)

## Problem
Two visibility gaps in `session-state.sh`:
1. Its active-kill-switch table lists the commit/e2e/async/verify/edit
   switches but omits `AI_STOP_LINT_WARNINGS_KILL_SWITCH`
   (`.no-stop-lint-warnings`) — a set-and-forgotten marker there never
   surfaces. (Codex confirmed the omission; it also confirmed
   `.allow-protected-edits` IS surfaced, as a safety override — an
   earlier draft of this finding wrongly claimed otherwise.)
2. The hook is wired with `matcher: "compact"` only, so the summary
   (branch, dirty state, kill switches, cached verify failure) appears
   after compaction but never on an ordinary fresh session start — a
   kill switch or stale `.allow-protected-edits` left by a previous
   session gets no nudge unless a compaction happens.

## Evidence
- `scripts/ai-hooks/stop-policy.sh:16` (switch defined),
  `scripts/ai-hooks/session-state.sh:69-78` (listing without it), `:85`
  (safety-override listing — the part that works).
- `.claude/settings.json:93-104` — SessionStart matcher `compact` only.
- Codex verification: PARTLY (omission confirmed; override-surfacing
  claim corrected).

## Proposed direction
Add the missing switch to the table (one line, plus a
`test-session-state.sh` case). For (2), extend the SessionStart wiring in
`harness.controls.json` to also fire on `startup`/`resume` (schema
already models the event; regen settings.json). The "only when
interesting" gate already keeps clean sessions silent, so broader firing
adds no steady-state noise.

## Scope / caveats
Check the prior pack's harness-presentation R11 (SessionStart
rehydration) for overlap before implementing (2) — it may be the same
work item under another name. One commit.
