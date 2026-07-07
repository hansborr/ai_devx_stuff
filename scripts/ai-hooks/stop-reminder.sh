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

ai_cache_init

if REASON=$(ai_stop_policy_messages "$REPO_ROOT"); then
  jq -Rn --arg m "$REASON" '{systemMessage:$m}'
fi

exit 0
