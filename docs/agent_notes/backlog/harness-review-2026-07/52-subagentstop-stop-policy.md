# 52. Subagents run with no Stop-policy nudge, so delegated work can end with uncommitted changes or failing cached gates silently

Status: Done — SubagentStop stop-policy adapter + manifest entry landed (`f58262ac`); systemMessage output rationale recorded (`4285af0f`). Open follow-up: empirically verify `systemMessage` renders for SubagentStop; else switch adapter to `additionalContext` (could not verify live — rationale in the adapter script).
Lens: hooks · Area: hooks-stop · Severity: med · Size: S-M · Confidence: med
Theme: subagent-guardrails · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

Depends on: leaf 50 (`SubagentStop` is not expressible in the wiring schema).

## Problem
The repo actively uses delegated agents — `.claude/settings.json` enables experimental agent teams — but the entire Stop-policy surface (uncommitted-changes reminder, failing cached verify, e2e/async status) fires only on the *main* loop's `Stop` event. A subagent that finishes a task with a dirty tree or on top of a red cached `verify:changed` ends silently; the parent sees only the subagent's final message, and the main agent's own Stop nudge may fire much later (or be consumed by throttling) after context about which delegation caused the problem is gone. `SubagentStop` is an official event; wiring a scoped-down stop policy to it closes the gap at the moment the responsible agent still has the context to fix it.

## Evidence
- `.claude/settings.json:2-4` — `"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }` (verified); subagent/team usage is a first-class workflow here.
- `.claude/settings.json:154-164` — the only Stop wiring is `stop-reminder.sh` on the main `Stop` event; no `SubagentStop` anywhere (and it cannot be added — `scripts/harness/hook-wiring-schema.ts:2`).
- `scripts/ai-hooks/stop-reminder.sh:17-20` — adapter: exits 2 with the policy message on stderr when `ai_stop_policy_messages` returns one.
- `scripts/ai-hooks/stop-policy.sh:655-695` — `ai_stop_policy_messages` composes four sources: uncommitted changes (`:117-144`), e2e status (`:213-259`), async verify (`:377-436`), cached verify (`:581-653`).
- Marker/counter keying is per *repo*, not per agent: `ai_stop_marker_path` keys on a hash of the repo root only (`scripts/ai-hooks/stop-policy.sh:17-27`), and the verify/e2e/async counters likewise (`:151-153`, `:313-315`, `:444-446`). A subagent nudge would consume the main loop's one-shot marker (and vice versa).
- Precedent for session-scoped keying already exists: `ai_throttle_key` hashes `session:<id>:repo:<root>` when the payload carries a session id (`scripts/ai-hooks/throttle-state.sh:12-26`).

## Proposed direction
Add a `SubagentStop` manifest entry pointing at a new thin adapter (`.claude/hooks/subagent-stop-reminder.sh` → `scripts/ai-hooks/`) that calls a scoped-down composer, e.g. `ai_stop_policy_messages_subagent`:
- **Keep:** uncommitted-changes reminder and failing-cached-verify status — both are cheap metadata reads and directly actionable by the finishing subagent ("commit your work" / "your delegated change left the gate red").
- **Skip:** e2e and async-verify nudges — they concern long-horizon main-loop state, not a single delegation, and would mostly be noise or double-fire.
Key the one-shot markers/counters per agent where the payload allows: fold the session/agent id into the marker path the way `ai_throttle_key` does, falling back to today's repo-only key when absent, so subagent nudges stop consuming the main loop's suppression state. Extend `scripts/ai-hooks/test-stop-policy.sh` with the subagent composer and keying cases.

## Scope / caveats
Verify the actual `SubagentStop` payload shape (agent id field name, whether `stop_hook_active` appears) against the official docs before implementing — the keying design depends on it. Keep the subagent variant advisory/throttled exactly like the main one; do not make it blocking (that interacts with leaf 55's design gate, not this leaf). Codex side: dual-agent parity likely impossible (`notes.codex` per leaf 50). One commit: composer + adapter + manifest entry + generated wiring + tests; if marker re-keying grows, split it out as a preparatory commit.
