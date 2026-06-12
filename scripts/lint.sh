#!/usr/bin/env bash
# Composite lint floor: ShellCheck for maintained shell scripts, config-file
# sensors for YAML/TOML/Dockerfile/workflows, then ESLint for the normal
# TypeScript/JavaScript/JSON lint surface.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ "${1:-}" = "--" ]; then
  shift
fi

# shellcheck source=scripts/lib/lint-dist-preflight.sh
. "$SCRIPT_DIR/lib/lint-dist-preflight.sh"
# shellcheck source=scripts/lib/parallel-runner.sh
. "$SCRIPT_DIR/lib/parallel-runner.sh"

musi_lint_dist_preflight "$REPO_ROOT"

musi_parallel_init "musi-lint"
musi_parallel_install_traps

musi_parallel_start "ShellCheck" "shell" bash "$SCRIPT_DIR/lint-shell.sh"
musi_parallel_start "config sensors" "config" bash "$SCRIPT_DIR/lint-config-sensors.sh"
musi_parallel_start "ESLint" "eslint" eslint . --max-warnings=0 "$@"

musi_parallel_wait_all "lint"
exit "$MUSI_PARALLEL_EXIT"
