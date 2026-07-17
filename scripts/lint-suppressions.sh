#!/usr/bin/env bash
# Run the suppression policy registers as one commit-gate slot.

set -uo pipefail

MODE_ARGS=()
if [ "${1:-}" = "--changed" ]; then
  MODE_ARGS=(--changed)
  shift
  if [ "$#" -gt 0 ]; then
    MODE_ARGS+=("$1")
    shift
  fi
fi
if [ "$#" -gt 0 ]; then
  printf 'lint:suppressions: unknown argument: %s\n' "$1" >&2
  exit 2
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  printf 'WARN: suppression policy registers unavailable — not inside a git repository\n' >&2
  exit 0
}

# Run both registers unconditionally and aggregate (the lint-config-sensors
# accumulator pattern): a commit carrying both an eslint-disable violation and
# a TS/Stryker suppression violation must surface both classes in one gate
# run, not one per gate/fix cycle.
failed=0
bash "$REPO_ROOT/scripts/eslint-disable-register.sh" "${MODE_ARGS[@]}" "$REPO_ROOT" || failed=1
bash "$REPO_ROOT/scripts/suppression-register.sh" "${MODE_ARGS[@]}" "$REPO_ROOT" || failed=1
exit "$failed"
