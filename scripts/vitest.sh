#!/bin/bash
# Repo-owned Vitest runner.
#
# Package scripts call this instead of invoking Vitest directly so known
# third-party warning noise is filtered for humans and agents even when no AI
# hook adapter intercepts the command.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || {
  cd "$SCRIPT_DIR/.."
  pwd
})"

# shellcheck source=/dev/null
. "$SCRIPT_DIR/ai-hooks/output-filter.sh"

if [ -n "${MUSI_VITEST_BIN:-}" ]; then
  VITEST_CMD=("$MUSI_VITEST_BIN")
elif [ -x "$REPO_ROOT/node_modules/.bin/vitest" ]; then
  VITEST_CMD=("$REPO_ROOT/node_modules/.bin/vitest")
else
  VITEST_CMD=(vitest)
fi

"${VITEST_CMD[@]}" "$@" 2>&1 | ai_filter_known_output_noise
exit "${PIPESTATUS[0]}"
