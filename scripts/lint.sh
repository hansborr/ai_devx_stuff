#!/usr/bin/env bash
# Composite lint floor: ShellCheck for maintained shell scripts, config-file
# sensors for YAML/TOML/Dockerfile/workflows, then ESLint for the normal
# TypeScript/JavaScript/JSON lint surface.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${1:-}" = "--" ]; then
  shift
fi

# shellcheck source=scripts/parallel-runner.sh
. "$SCRIPT_DIR/parallel-runner.sh"

musi_parallel_init "musi-lint"
musi_parallel_install_traps

musi_parallel_start "ShellCheck" "shell" bash "$SCRIPT_DIR/lint-shell.sh"
musi_parallel_start "config sensors" "config" bash "$SCRIPT_DIR/lint-config-sensors.sh"
musi_parallel_start "ESLint" "eslint" eslint . --cache --cache-location node_modules/.cache/eslint/ --max-warnings=0 "$@"

musi_parallel_wait_all "lint"
exit "$MUSI_PARALLEL_EXIT"
