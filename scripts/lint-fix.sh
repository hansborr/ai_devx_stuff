#!/usr/bin/env bash
# ESLint-only repair path with the same TypeScript build-output prerequisite
# diagnostic as the lint wrappers.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ "${1:-}" = "--" ]; then
  shift
fi

# Raise the Node heap so a direct `bun run lint:fix` full-tree repair gets the
# same OOM mitigation the gates do; idempotent when NODE_OPTIONS already sets it.
# shellcheck source=scripts/lib/gate-env.sh
. "$SCRIPT_DIR/lib/gate-env.sh"
# shellcheck source=scripts/lib/lint-dist-preflight.sh
. "$SCRIPT_DIR/lib/lint-dist-preflight.sh"

musi_lint_dist_require_outputs "$REPO_ROOT" "lint:fix"

exec eslint . --fix "$@"
