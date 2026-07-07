# 30. SubagentStop path: missing cache init, marker writer assumes its dir, degenerate scope collapses onto the main agent's key

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: stop-policy · Area: hooks-stop · Severity: med · Size: S-M · Confidence: high
Theme: state-lifecycle · Source: harness review 2026-07-06 (Sonnet breadth + Codex CONFIRMED)

## Problem
Three related defects in the SubagentStop path:
1. `subagent-stop-reminder.sh` never calls `ai_cache_init` (its sibling
   `stop-reminder.sh` does), so if a SubagentStop is the first stop-family
   hook in a fresh state root, the state directory may not exist.
2. `ai_stop_write_marker` has no `mkdir -p` fallback (unlike
   `ai_stop_async_write_counter`), so its `mktemp` fails outright when the
   directory is missing — combining with (1) into a real first-fire
   failure. The `|| true` at call sites hides it, degrading to re-nagging.
3. `ai_stop_subagent_scope_key` returns empty when the payload has neither
   `agent_id` nor `session_id`+`agent_type`; empty scope collapses to the
   *unscoped* repo key, sharing dedup state with the main agent — a
   subagent can consume a marker and silently suppress a real main-agent
   reminder (or vice versa).

## Evidence
- `scripts/ai-hooks/subagent-stop-reminder.sh:7` (no `ai_cache_init`) vs
  `scripts/ai-hooks/stop-reminder.sh:22`.
- `scripts/ai-hooks/stop-policy.sh:76-99` (`ai_stop_write_marker`, no
  mkdir), `:743-762` (scope key can be empty), `:27-37` (empty scope →
  unscoped key), `:934` (subagent messages entry).
- Codex verification: CONFIRMED all three.
- Also noted: `subagent-stop-reminder.sh` lacks the `[ -p /dev/stdin ]`
  guard `stop-reminder.sh:13` has — harmless in harness use, inconsistent
  for manual/test invocation.

## Proposed direction
(1) Add `ai_cache_init` to `subagent-stop-reminder.sh`; (2) add
`mkdir -p "$(dirname …)"` inside `ai_stop_write_marker` matching the async
writer; (3) make `ai_stop_subagent_scope_key` return a sentinel scope
(e.g. `subagent-unknown`) instead of empty so degenerate payloads never
share the main key; mirror the stdin guard. Extend `test-stop-policy.sh`
with a fresh-state-root SubagentStop case and an empty-payload scope case.

## Scope / caveats
Pure defensive fixes, no behavior change for well-formed payloads. One
commit (two scripts + tests).
