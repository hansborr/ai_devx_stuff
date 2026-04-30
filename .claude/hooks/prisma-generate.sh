#!/bin/bash
set -u

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
exec bash "$REPO_ROOT/scripts/ai-hooks/prisma-generate.sh"
