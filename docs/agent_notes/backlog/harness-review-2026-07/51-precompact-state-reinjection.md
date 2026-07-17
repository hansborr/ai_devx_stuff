# 51. Long sessions lose harness state at compaction; a PostCompact hook should re-inject a bounded harness-state snapshot

Status: Done — `.claude/settings.json` SessionStart matcher `startup|resume|compact` → `scripts/ai-hooks/session-state.sh` (also satisfies the R11 SessionStart item).
Lens: hooks · Area: hooks-lifecycle · Severity: med-high · Size: S-M · Confidence: med
Theme: compaction-rehydration · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

Depends on: leaf 50 (schema cannot express compaction events today).

## Problem
When a long session compacts, the summary routinely drops load-bearing harness state: which branch is checked out and how dirty it is, whether fast-commit mode is on, which kill-switches are active, and what the last cached verify/pre-commit run said. The agent then re-discovers these by re-running commands (burning the caches' whole point) or, worse, acts on stale assumptions (e.g. keeps fast-committing after the marker was meant to be removed, or trusts a verify that is now red). The repo's own research names post-compaction context injection as the highest-value variant of session hooks, and the SessionStart flavor is already tracked as item R11 — this leaf is the compaction-time sibling and should share its emitter.

## Evidence
- `scripts/harness/hook-wiring-schema.ts:2` — neither `PreCompact` nor `PostCompact` is expressible (leaf 50).
- `docs/agent_notes/harness-engineering-research/12-custom-hooks.md` §6 — "The highest-value variant uses matcher `compact`: after compaction summarizes/loses detail, re-inject the non-negotiable rules"; also: prefer hooks for *dynamic* state, CLAUDE.md for static rules.
- `docs/agent_notes/backlog/harness-presentation-2026-06/03-improvement-suggestions.md:46` — R11: SessionStart/PreCompact rehydration, Parked. Cross-reference; this leaf covers the compaction event, R11 covers session start; one shared state-snapshot script should serve both.
- Fast-commit marker: `scripts/verify/steps-lib.sh:117` — `marker="$common_dir/musi-fast-commit"`; also folded into the pre-commit fingerprint at `scripts/lib/verify-metadata.sh:305`.
- Kill-switch names (verified): `.no-stop-uncommitted`, `.no-stop-e2e`, `.no-stop-async-verify`, `.no-stop-verify-changed`, `.no-stop-verify` (`scripts/ai-hooks/stop-policy.sh:7-14`) and `.no-edit-lint` (`scripts/ai-hooks/ratchet-regression-check.sh:34`).
- Cached verify result readers already exist: `ai_stop_verify_meta_string`/`ai_stop_verify_meta_int` over `$LOG_DIR/meta/wrapper.json` (`scripts/ai-hooks/stop-policy.sh:508-544`, used at `:581-653`) — mode, head, fingerprint, exit_code.
- Pending async verify readers: `ai_stop_async_latest_state` + `ai_stop_async_state_value` (`scripts/ai-hooks/stop-policy.sh:261-306`; state root `/tmp/musi-verify-async`, line 12).
- Output bounding helper: `ai_limit_lines` (`scripts/ai-hooks/common.sh:109-121`).

## Proposed direction
Pick **PostCompact** (or SessionStart with the `compact` source matcher if PostCompact proves unavailable — re-verify against the official docs at implementation time): context injected *before* compaction is itself subject to summarization, so re-injecting into the fresh window after compaction is the only placement that guarantees survival. Add `scripts/ai-hooks/session-state.sh` emitting one bounded block (~20 lines hard cap via `ai_limit_lines`):
- current branch + one-line dirty summary (`git status --porcelain` counts, not file lists);
- fast-commit marker present/absent (git-common-dir `musi-fast-commit`);
- any active kill-switch files from the list above;
- last cached verify/pre-commit result via the existing `wrapper.json` readers (mode, exit, head, failing gates via `ai_stop_verify_failing_gates`);
- pending/failed async verify via the existing async readers.
Wire it through a new `hookWiring` manifest entry (Claude-only with `notes.codex` if Codex has no equivalent event), shim in `.claude/hooks/`, body in `scripts/ai-hooks/`, smoke coverage in `scripts/ai-hooks/test.sh` style. Design it so the same body serves the R11 SessionStart entry later.

## Scope / caveats
Read-only and fast (<1s): metadata file reads plus two cheap git calls; never run verification. Emit nothing when the state is entirely boring (clean tree, no markers, no cached failures) to avoid post-compaction noise. One commit: script + manifest entry + generated wiring + test. Do not implement R11's SessionStart wiring here — only keep the emitter reusable for it.
