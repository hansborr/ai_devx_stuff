#!/bin/bash
# Hook: PostToolBatch. When a parallel Bash batch cascade-cancels still-queued
# siblings (claude-code#22264), one or more sibling results carry
# `Cancelled: parallel tool call … errored` with no reason. The model then sees
# one real denial/error plus N opaque cancellations and can conclude the shell
# is broken or hostile and spiral.
#
# This re-injects a single calm pointer as PostToolBatch additionalContext,
# which the harness delivers to the model in the SAME turn, immediately after
# the batch results (verified on CLI 2.1.158) — i.e. at the moment of alarm.
#
# Claude-only: PostToolBatch is a Claude Code event; Codex never reproduces the
# cascade. One event fires per batch, so emitting once per fire is its own
# de-dup — no marker files needed. Disable with `touch <repo>/.no-parallel-cancel-note`.

set -u

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
HOOK_LIB="$REPO_ROOT/scripts/ai-hooks"
# shellcheck source=/dev/null
. "$HOOK_LIB/common.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/claude-guidance.sh"

AI_PARALLEL_CANCEL_KILL_SWITCH=".no-parallel-cancel-note"
[ -f "$REPO_ROOT/$AI_PARALLEL_CANCEL_KILL_SWITCH" ] && ai_emit_continue

PAYLOAD=$(ai_read_payload)
[ -z "$PAYLOAD" ] && ai_emit_continue

# Detect a real cancelled sibling among `tool_calls[]`. Phase 0 recorded that a
# cancelled sibling's `tool_response` is a string whose ENTIRE value is the
# harness wrapper, verbatim:
#   "<tool_use_error>Cancelled: parallel tool call Bash(...) errored</tool_use_error>"
# So we require the wrapper at the ABSOLUTE start of the string (\A, after
# optional leading whitespace). This is the discriminator that avoids three
# false-positive vectors, all of which embed the phrase but never START a
# tool_response with the wrapper:
#   1. A command that PRINTS the marker (cat-ing this repo's docs — several quote
#      it verbatim; a Read carries a line-number prefix, a cat puts it mid-output).
#   2. Our own hard-block reasons: the inoculation suffix quotes the phrase, so a
#      blocked call's tool_response (`<tool_use_error>Do not run docker…Cancelled…`)
#      has the wrapper, but "Cancelled" is deep in the prose, not at the start.
#   3. Objects/other tool shapes — only the recorded bare-string shape matches.
# `\A` (not `^`, which Oniguruma treats as multiline) keeps a marker on an
# interior line of a multi-line response from matching. Keying on the marker
# shape stays trigger-agnostic: the cascade is a dispatch-timing race, not a
# function of any exit code or our specific policy blocks.
if printf '%s' "$PAYLOAD" | jq -e '
    (.tool_calls // [])
    | map(.tool_response)
    | any((type == "string") and test("\\A\\s*<tool_use_error>\\s*Cancelled: parallel tool call .* errored"))
  ' >/dev/null 2>&1; then
  ai_emit_additional_context "PostToolBatch" "$AI_CLAUDE_CANCEL_INOCULATION"
fi

ai_emit_continue
