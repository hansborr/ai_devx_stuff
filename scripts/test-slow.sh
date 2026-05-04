#!/bin/bash
# test-slow.sh — run the explicit slow-test tier.
#
# Default vitest configs exclude `**/*.slow.test.*` so the standard
# `bun run test`, `test:changed`, `verify`, and IDE runners never touch
# the slow tier. This wrapper is the documented entry point for running
# them deliberately:
#
#   bun run test:slow                # run every *.slow.test.{ts,tsx}
#   bun run test:slow --project=server  # forwards extra flags to vitest
#
# The wrapper:
#   - sets MUSI_RUN_SLOW_TESTS=1 so test code can gate slow-only setup,
#   - passes `--config vitest.slow.config.ts` so the slow projects are used,
#   - reuses scripts/vitest.sh so output noise filtering matches the
#     default test path.
#
# Slow tests are kept out of pre-commit, `verify`, and `verify:changed` by
# design. Run this command locally before landing changes that touch a
# slow test, or use `bun run verify:slow` for the lint/typecheck/test +
# slow tier combination.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || {
  cd "$SCRIPT_DIR/.."
  pwd
})"

export MUSI_RUN_SLOW_TESTS=1

exec bash "$SCRIPT_DIR/vitest.sh" run --passWithNoTests \
  --config "$REPO_ROOT/vitest.slow.config.ts" "$@"
