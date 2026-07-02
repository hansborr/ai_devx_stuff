#!/bin/bash
# Thin adapter - semantics documented in scripts/ai-hooks/lint-coverage-check.sh; Copilot
# payload/response translation in scripts/ai-hooks/copilot-adapter.sh.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo /workspace)
HOOK_LIB="$REPO_ROOT/scripts/ai-hooks"
# shellcheck source=/dev/null
. "$HOOK_LIB/common.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/copilot-adapter.sh"

ai_copilot_dispatch post-edit edit "$HOOK_LIB/lint-coverage-check.sh"
