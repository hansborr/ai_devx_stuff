#!/bin/bash
# Thin adapter - semantics documented in scripts/ai-hooks/stop-reminder.sh.
# The shared body signals "block" via exit 2 with the reason on stderr; the
# Copilot agentStop event expects {decision, reason} JSON on stdout instead.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo /workspace)

# The body ignores the payload; drain stdin so Copilot never blocks on write.
cat > /dev/null 2>&1 || true

# AI_COPILOT_STOP_BODY is a test seam for scripts/ai-hooks/test-copilot-wiring.sh.
STOP_BODY="${AI_COPILOT_STOP_BODY:-$REPO_ROOT/scripts/ai-hooks/stop-reminder.sh}"
REASON=$(bash "$STOP_BODY" 2>&1 >/dev/null)
STATUS=$?

if [ "$STATUS" -eq 2 ] && [ -n "$REASON" ]; then
  jq -Rn --arg r "$REASON" '{decision: "block", reason: $r}' 2>/dev/null || true
fi
exit 0
