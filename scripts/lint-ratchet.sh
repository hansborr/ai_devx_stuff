#!/usr/bin/env bash
# Memory-admitted full lint-ratchet entry point.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/tool-memory-admission.sh
. "$SCRIPT_DIR/lib/tool-memory-admission.sh"

if musi_tool_memory_admission_needed full; then
  musi_tool_memory_run_admitted ratchet lint:ratchet:direct \
    bash "$SCRIPT_DIR/lint-ratchet.sh" "$@"
  exit $?
fi

exec bun "$SCRIPT_DIR/lint-ratchet.ts" "$@"
