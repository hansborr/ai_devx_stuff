# 61. Small state leaks: ai_claude_result_command temp files; stop-state dirs never GC'd

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: docs-hygiene · Area: hooks-state · Severity: low · Size: S · Confidence: med
Theme: state-lifecycle · Source: harness review 2026-07-06 (Sonnet breadth; not Codex-verified — low stakes)

## Problem
Two slow, bounded-impact leaks:
1. `ai_claude_result_command` mktemps a summary file and relies on the
   *rewritten tool command* (`cat …; rm -f …`) to self-clean. If the tool
   call is denied or never executes, the file persists forever — no
   TTL/sweep exists. (Also: the path is interpolated unquoted into the
   command; safe today because mktemp paths have no metacharacters, but
   only by circumstance.)
2. Stop-policy state dirs are keyed by worktree under
   `/tmp/musi-ai-hooks.<key>/stop/*` with no TTL (bun markers have
   `AI_BUN_TTL`; stop markers do not). Dropped worktrees leave orphan
   dirs for the container's lifetime.

## Evidence
- `scripts/ai-hooks/common.sh:80-88` (`ai_claude_result_command`).
- `scripts/ai-hooks/stop-policy.sh:21-44` (state pathing; no GC caller
  found in `cache.sh`'s `ai_cache_init`).

## Proposed direction
Piggyback a cheap sweep on an existing periodic touchpoint (e.g.
`ai_cache_init` or session-state): delete result-command temp files and
stop-state entries older than a generous TTL (days). Quote the temp path
in the constructed command while there. No new hook events, no cron.

## Scope / caveats
`/tmp` clutter only — correctness is unaffected (new worktrees get new
keys). Fine to reject as won't-fix if the sweep costs more review than
the litter; record that verdict here if so. One commit.
