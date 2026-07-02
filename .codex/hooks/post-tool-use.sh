#!/bin/bash
# Thin adapter - semantics documented in scripts/ai-hooks/bash-post-tool-use.sh.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo /workspace)
exec bash "$REPO_ROOT/scripts/ai-hooks/bash-post-tool-use.sh"
