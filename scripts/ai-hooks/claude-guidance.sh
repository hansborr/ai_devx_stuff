#!/bin/bash

# Claude-only hook guidance helpers. Sourced EXCLUSIVELY by `.claude/` adapters
# — never by shared code (common.sh / policy.sh / stop-policy.sh) or `.codex/`
# hooks. Keep Claude-specific reason shaping here so the shared `ai_emit_block`
# and `policy.sh` reason strings stay agent-neutral; Codex depends on those
# verbatim and must not gain this text.

# Suffix appended to Claude hard-block reasons. When a denied/errored Bash call
# cascade-cancels still-queued sibling calls in the same parallel batch, the
# model sees one real reason plus N opaque `Cancelled: parallel tool call …
# errored` results and can conclude the shell is broken or hostile and spiral.
# This pointer re-attributes those cancellations to the block at the moment of
# alarm. See anthropics/claude-code#22264 and docs/agent_notes/decisions-build.md.
#
# Single-quoted so the literal backticks and em dashes survive verbatim. Keep
# this wording identical to the PostToolBatch injector
# (.claude/hooks/parallel-cancel-note.sh) — one consistent story.
AI_CLAUDE_CANCEL_INOCULATION='If sibling Bash calls in this batch show `Cancelled: parallel tool call … errored`, that is this denial/error cascading (known Claude Code bug #22264), not a broken or hostile shell. Do NOT assume the cancelled calls did not run — because the trigger is a dispatch-timing race, a cancelled call may not have run, may have partially run, or may have completed. Verify the current state with sequential (non-parallel) tool calls before continuing, then re-run what is actually needed one at a time.'

# Append the cancellation inoculation suffix to a hard-block reason, separated
# by a blank line. Echoes the combined reason on stdout (no trailing newline) so
# callers can pass it straight to `ai_emit_block`.
ai_claude_cancel_inoculation() {
  local reason="$1"
  printf '%s\n\n%s' "$reason" "$AI_CLAUDE_CANCEL_INOCULATION"
}
