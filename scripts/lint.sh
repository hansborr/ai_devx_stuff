#!/usr/bin/env bash
# Composite lint floor: ShellCheck for maintained shell scripts, config-file
# sensors for YAML/TOML/Dockerfile/workflows, then ESLint for the normal
# TypeScript/JavaScript/JSON lint surface.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${1:-}" = "--" ]; then
  shift
fi

bash "$SCRIPT_DIR/lint-shell.sh"
bash "$SCRIPT_DIR/lint-config-sensors.sh"
exec eslint . --cache --cache-location node_modules/.cache/eslint/ --max-warnings=0 "$@"
