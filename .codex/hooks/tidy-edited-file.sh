#!/bin/bash
set -u

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo /workspace)
exec bash "$REPO_ROOT/scripts/ai-hooks/tidy-edited-file.sh"
