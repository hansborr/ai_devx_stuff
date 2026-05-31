#!/bin/bash
# Hook: block hook bypasses and direct DB/infrastructure CLI commands.

set -u

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
HOOK_LIB="$REPO_ROOT/scripts/ai-hooks"
# shellcheck source=/dev/null
. "$HOOK_LIB/common.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/policy.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/claude-guidance.sh"

PAYLOAD=$(ai_read_payload)
CMD=$(ai_payload_command "$PAYLOAD")
[ -z "$CMD" ] && ai_emit_continue

if REASON=$(ai_policy_violation_reason "$CMD"); then
  if ai_policy_is_soft_guidance "$REASON"; then
    # A PreToolUse deny can cascade-cancel sibling Bash calls in Claude's
    # parallel batch. Replace soft nudges with successful guidance output.
    ai_claude_result_command "$REASON" /tmp/musi-policy-guidance
  fi
  # Hard block: a denied call can still cascade-cancel queued sibling Bash calls
  # in the same parallel batch (claude-code#22264). Append a calm pointer so the
  # model attributes those `Cancelled: …` results to this block, not a broken
  # shell. Claude-only; the shared block shape Codex uses stays untouched.
  ai_emit_block "$(ai_claude_cancel_inoculation "$REASON")"
fi

ai_emit_continue
