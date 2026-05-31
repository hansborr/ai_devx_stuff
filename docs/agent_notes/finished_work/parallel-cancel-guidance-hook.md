# Finished: de-spiral parallel sibling cancellations

Landed 2026-05-31 on `feature/parallel-cancel-guidance-hook`. Mitigates the
upstream Claude Code parallel-sibling-cancellation bug (anthropics/claude-code
#22264, #25773) with two Claude-only, low-risk nudges. Durable decision lives in
`docs/agent_notes/decisions-build.md` ("Soft AI-hook nudges must not hard-deny in
Claude" → In-repo mitigation). This note keeps the empirical Phase 0 findings,
which are the expensive-to-rederive part.

## What shipped

- `scripts/ai-hooks/claude-guidance.sh` — new Claude-only helper (never sourced
  by shared code or `.codex/`). Holds `AI_CLAUDE_CANCEL_INOCULATION` (the single
  canonical wording) and `ai_claude_cancel_inoculation`.
- **Phase 1 (Idea D):** `.claude/hooks/no-direct-db.sh` appends the inoculation
  suffix to every HARD block reason. Soft grep guidance keeps the
  rewrite-to-success path and gets no suffix. Shared `ai_emit_block` / `policy.sh`
  untouched (Codex output unchanged — asserted by test).
- **Phase 2E (Idea E):** `.claude/hooks/parallel-cancel-note.sh` on
  `PostToolBatch`. Detects a real cancelled sibling and injects the same wording
  once per batch as `additionalContext`. Kill switch `.no-parallel-cancel-note`.
  Wired in `.claude/settings.json` (new `PostToolBatch` block, 10s timeout).
- Tests: `scripts/ai-hooks/test-parallel-cancel.sh` (focused) + new assertions in
  `scripts/ai-hooks/test.sh` (hard block carries suffix; soft grep does not; Codex
  block unchanged). Gates: `bash scripts/ai-hooks/test.sh`, `shellcheck
  --severity=warning`, `bun run verify:changed`.

## Detection rule (the subtle part — do not loosen)

A real cancelled sibling's `tool_response` is a STRING whose ENTIRE value is the
wrapper, verbatim:
`<tool_use_error>Cancelled: parallel tool call Bash(...) errored</tool_use_error>`.
2E matches the wrapper at the ABSOLUTE start (`\A`, Oniguruma — `^` is multiline
and would match interior lines). Matching the bare phrase, or the wrapper
anywhere, false-fires on:
- commands that merely PRINT the phrase (several repo docs quote it verbatim;
  this bit the first two cuts of the regex during development);
- our own hard-block reasons (the Phase-1 suffix quotes the phrase, but the
  wrapper sits at the start of the reason prose, not adjacent to "Cancelled").
Residual (accepted): a Bash command whose stdout BEGINS with the exact wrapped
marker would still inject — contrived and harmless.

Phase-1 secondary block sites (`bun-run-quiet.sh`, `git-commit-quiet.sh`) were
intentionally NOT wrapped: they fire on single sequential verification commands
(rarely co-batched), and 2E already covers cascades from ANY trigger.

## Phase 0 spike results (verified 2026-05-31, CLI 2.1.158)

Throwaway catch-all hook logged every event's stdin; cascade reproduced with a
fast bare failure beside slow `sleep` siblings. Hook + settings took effect
mid-session (no restart). Spike removed afterward.

- **`PostToolBatch` fires — one event per batch, full visibility.** Envelope:
  `{ session_id, transcript_path, cwd, permission_mode, effort,
  hook_event_name:"PostToolBatch", tool_calls:[…] }`; each `tool_calls[]` entry
  is `{ tool_name, tool_input, tool_use_id, tool_response }`. Cancelled siblings
  appear here with `tool_response` = the wrapped marker string; the originating
  error appears as the failing call's `tool_response` (`"Exit code 4"`).
- **`additionalContext` from `PostToolBatch` reaches the model the SAME turn**,
  immediately after the batch results (a `PostToolBatch hook additional context:
  …` system-reminder) — at the moment of alarm, not a turn late. This is why E
  beats a Stop backstop (Phase 3) and why Phase 3 was not built.
- **`PostToolUseFailure` fires only for the genuinely erroring call** (top-level
  `.error:"Exit code 4"`), NEVER for cancelled siblings. Cancelled siblings get
  NO per-call events (`PreToolUse`/`PostToolUse`/`PostToolUseFailure`) — the only
  place they are observable is `PostToolBatch`.
- **Gate 5 confirmed:** `PreToolUse` payload has no batch/sibling fields.
- **Trigger is a dispatch-timing race, not an exit code.** exit 1, 2, 3, 4 all
  cascaded a still-queued later sibling; `cat`/`grep` on a missing path (exit
  1/2, but slower to resolve) did NOT — the later siblings dispatched first and
  completed. The first-listed slow sibling always survives. `exit 0` is never
  "errored". The PreToolUse policy block (docker) did NOT cascade on 2.1.158.

## Dropped ideas (with reasons)

- **Idea C** (rewrite dangerous blocks to a non-erroring result): reintroduces
  the safety inversion `decisions-build.md` forbids — a dropped `updatedInput`
  re-runs the original docker/psql under an explicit allow.
- **Idea F** (switch hard block to `permissionDecision:"deny"`): the bug
  cascades on denied OR errored, so deny still cancels; and Codex depends on the
  shared root block shape.

## Worth-it note

This mitigates an upstream bug; an upstream fix would make 2E dead code. Phase 1
is cheap insurance regardless. If #22264 is fixed upstream, both can be removed.
