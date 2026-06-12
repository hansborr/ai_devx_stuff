#!/bin/bash
# Hook: block hook bypasses and direct DB/infrastructure CLI commands.

set -u

HOOK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$HOOK_LIB/common.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/policy.sh"

PAYLOAD=$(ai_read_payload)
CMD=$(ai_payload_command "$PAYLOAD")
[ -z "$CMD" ] && ai_emit_continue

if REASON=$(ai_policy_violation_reason "$CMD"); then
  if ai_policy_is_soft_guidance "$REASON"; then
    # Soft nudges should return guidance without turning advisory policy into a
    # hard block.
    ai_claude_result_command "$REASON" /tmp/musi-policy-guidance
  fi
  ai_emit_block "$REASON"
fi

ai_emit_continue
