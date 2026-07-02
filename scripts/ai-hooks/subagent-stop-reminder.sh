#!/bin/bash

set -u

HOOK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$HOOK_LIB/common.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/cache.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/stop-policy.sh"

payload=$(ai_read_payload)
if printf '%s' "$payload" | jq -e '.stop_hook_active == true' >/dev/null 2>&1; then
  exit 0
fi

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")

if message=$(ai_stop_policy_messages_subagent "$REPO_ROOT" "$payload"); then
  ai_emit_additional_context "SubagentStop" "$message"
fi

exit 0
