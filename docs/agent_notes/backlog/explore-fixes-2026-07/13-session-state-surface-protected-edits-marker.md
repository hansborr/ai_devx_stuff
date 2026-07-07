# 13 — Surface an active `.allow-protected-edits` marker in session state

Status: Ready
Track: T (tooling) · Priority: P1 · Size: XS

## Evidence (verified 2026-07-03; re-verify before implementing)

- `scripts/ai-hooks/protected-files.sh:27` — the override marker.
- `scripts/ai-hooks/protected-files.sh:198` — a warning is emitted only when
  an edit actually touches a protected file.
- `scripts/ai-hooks/session-state.sh:63` — the safety-switch report
  (`ai_session_state_active_kill_switches`) lists kill switches but omits the
  protected-edits marker, so a repo-wide override can stay active silently
  across sessions/compactions.

Not an overlap with `harness-review-2026-07/54` (advisory/deny split): that
leaf landed the tiering; this is about *visibility* of the override marker in
session state.

## Do

Add the `.allow-protected-edits` marker to the session-state safety-switch
listing (same style as the fast-commit and kill-switch reporting), with a
test in `test-session-state.sh`.

## Verify

```
bash scripts/ai-hooks/test-session-state.sh
```

## Acceptance

With the marker present, session-state output names it as an active safety
override; without it, output is unchanged.
