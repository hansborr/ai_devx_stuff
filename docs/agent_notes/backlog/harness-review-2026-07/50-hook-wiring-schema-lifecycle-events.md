# 50. The hook-wiring schema hard-codes three lifecycle events, making the officially supported session/compaction/subagent/failure hooks structurally impossible to wire

Status: Proposed — from the 2026-07-01 AI-harness review; NOT implemented. Re-verify file:line before acting.
Lens: hooks · Area: harness-wiring · Severity: high · Size: M · Confidence: high
Theme: hook-lifecycle-coverage · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
Hook wiring is generated: `harness.controls.json` `hookWiring` entries → `scripts/harness/generate-hook-wiring.ts` → `.claude/settings.json` hooks + `.codex/hooks.json`. The schema hard-codes exactly three events, so `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreCompact`/`PostCompact`, `SubagentStart`/`SubagentStop`, `PostToolUseFailure`, `PermissionRequest`/`PermissionDenied`, `Setup`, and `Notification` — all in the current official Claude Code hooks reference (code.claude.com/docs/en/hooks, verified 2026-07-01) — cannot even be *expressed* in the manifest. The repo's own research explicitly recommends several of them (SessionStart/post-compaction context injection, Notification pings), and the already-tracked SessionStart rehydration follow-up (item R11 in the harness-presentation pack) is blocked on this same wall. This is the prerequisite leaf for 51, 52, and 58 in this pack.

## Evidence
- `scripts/harness/hook-wiring-schema.ts:2` — `export const HOOK_EVENTS = ["PreToolUse", "PostToolUse", "Stop"] as const;` — the single choke point.
- `scripts/harness/hook-wiring-schema.ts:130-131` — `resolveHookWiring` throws `hookWiring.event must be one of: PreToolUse, PostToolUse, Stop` for anything else.
- `scripts/harness/hook-wiring-schema.ts:85-87` — `matcher` is required for every non-`Stop` event; lifecycle events (SessionStart, PreCompact, SubagentStop, …) have no tool matcher, so this rule needs per-event treatment (SessionStart uses source matchers such as `compact`).
- `scripts/harness/generate-hook-wiring.ts:66` and `:86` — sorting and rendering iterate `HOOK_EVENTS`; new events flow through automatically once listed.
- `scripts/harness/hook-wiring-schema.ts:114-126` (`assertHarnessCoverage`) + `generate-hook-wiring.ts:91` — a harness may already be omitted per entry when a `notes.<harness>` explanation is present; i.e. Claude-only wiring for events with no Codex equivalent is *already expressible* without breaking parity checks — no parity-mechanism change needed, only the event list.
- `harness.controls.json:1058-1339` — all 12 `hookWiring` entries use only the three events (5× PreToolUse, 6× PostToolUse, 1× Stop). `.claude/settings.json:92-165` mirrors this.
- There is no standalone JSON Schema for the manifest; validation lives in TS: `hook-wiring-schema.ts` plus `scripts/harness/harness-check-validation.ts` / `control-field-validation.ts`, exercised by `scripts/harness-check.ts` (freshness of generated wiring is checked there, lines 10-11).
- `scripts/ai-hooks/check-wiring.sh:38-61` — event-agnostic (walks every `.type == "command"` object via jq), so it needs no structural change for new events.
- `docs/agent_notes/harness-engineering-research/12-custom-hooks.md` — §6 recommends SessionStart/post-compaction context injection, §5 Notification hooks, and notes Claude Code now has ~31 events plus `if` matchers; it also warns Codex is a separate implementation with overlapping event names, command hooks only, and known PreToolUse gaps.
- `docs/agent_notes/backlog/harness-presentation-2026-06/03-improvement-suggestions.md:46` — item #6, "SessionStart/PreCompact rehydration hook to re-seed handoff state … Parked (rec R11 / principle 20)"; also `01-research-report.md:216`. Cross-reference, do not duplicate.

## Proposed direction
Extend `HOOK_EVENTS` in `scripts/harness/hook-wiring-schema.ts` to the current official event list, then:
1. Replace the blanket "matcher required unless Stop" rule with a per-event matcher policy (tool-matcher events require one; lifecycle events allow an optional source matcher; Stop/SubagentStop none).
2. Add a per-event Codex-support map: events Codex supports get normal dual wiring; events with no Codex equivalent must carry `notes.codex` (existing mechanism) so `assertHarnessCoverage` stays honest. Derive the map from `.codex/hooks.json` reality plus the research doc's Codex caveats, and record it as comments next to the map.
3. Update `scripts/harness/generate-hook-wiring.test.ts` with one fixture per new event class, re-run `bun run harness:wiring` (output should be byte-identical until a manifest entry adopts a new event), and confirm `bun run harness:check` and `scripts/ai-hooks/check-wiring.sh` stay green.

Split: this leaf is schema+generator+tests only (one commit). Actual adoption of new events happens in leaves 51/52/58 and the R11 item.

## Scope / caveats
Do not wire any new event here — an empty-diff generation run is the acceptance test. Re-verify the official event list against code.claude.com/docs/en/hooks at implementation time (the internal research doc counts ~31 events; the list above is the review-verified subset worth supporting). Keep `HOOK_EVENTS` ordering stable for existing events so generated output ordering does not churn. The `.codex/hooks.json` consumer is Codex's own hooks runtime (`.codex/config.toml:2` `hooks = true`); do not emit events into it that its runtime would reject — fail at generation time instead via the support map.
