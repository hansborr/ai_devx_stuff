#!/bin/bash

set -u

HOOK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$HOOK_LIB/common.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/cache.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/stop-policy.sh"

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")

# Key the scoped-down Stop policy per finishing subagent so its one-shot markers
# never consume the main loop's Stop suppression state (and vice versa).
PAYLOAD=$(ai_read_payload)
SCOPE=$(ai_subagent_stop_scope "$PAYLOAD")

ai_cache_init

# Deliver via systemMessage + exit 0, mirroring stop-reminder.sh: an advisory,
# non-blocking, user-facing nudge that does not wake the agent. This matches the
# repo's Stop-family output convention (hook-wiring-schema models the Stop family
# as systemMessage, not the conversation-continuing hookSpecificOutput.additional
# Context). systemMessage is a documented universal field but the Claude Code
# hooks docs carry no SubagentStop-specific example, so if a real SubagentStop
# event ever shows it is silently dropped, switch to hookSpecificOutput.additional
# Context (which also needs SubagentStop added to the schema's claude
# additionalContext support).
if REASON=$(ai_stop_policy_messages_subagent "$REPO_ROOT" "$SCOPE"); then
  jq -Rn --arg m "$REASON" '{systemMessage:$m}'
fi

exit 0
