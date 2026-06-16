#!/bin/bash
# Root test orchestrator for `bun run test`.
#
# Runs the non-client Vitest projects in one direct invocation and the client
# jsdom suite through the fast/compatibility isolation lanes
# (scripts/client-test-isolation-runner.ts). This keeps the full client suite
# on the no-isolate fast lane the split rollout introduced while
# shared/server/eslint-rules/scripts stay on a single Vitest run, matching how
# scripts/test-changed.sh already routes changed client tests.
#
# Coverage, explicit --project, output-file reporters, and focused positional
# file runs (`bun run test -- <file>`) fall back to one direct Vitest invocation
# across every project: the split runner has no merged coverage/report output,
# always pins --project=client, and classifies the whole client tree (so a
# positional file selector cannot narrow it). Those invocations use plain
# Vitest, matching the pre-split `bun run test`.
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VITEST_RUNNER="$SCRIPT_DIR/vitest.sh"
CLIENT_TEST_RUNNER="$SCRIPT_DIR/client-test-isolation-runner.ts"

# The split runner rejects coverage (no merged cross-lane output), pins
# --project=client, and always classifies the full client tree. So any
# coverage/--project request, or any positional file selector that the lanes
# cannot honor, must run as a single direct Vitest invocation across all
# projects — the pre-split `bun run test`.
client_split_supports_user_args() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --coverage|--coverage=*|--coverage.*|--project|--project=*|--outputFile|--outputFile=*|--outputFile.*)
        return 1
        ;;
      -*)
        ;;
      *)
        # Positional (file path / glob) test selector. The split runner runs the
        # full classified client suite regardless of positionals, so a focused
        # `bun run test -- <file>` must use plain Vitest to filter precisely.
        return 1
        ;;
    esac
  done
  return 0
}

if ! client_split_supports_user_args "$@"; then
  exec bash "$VITEST_RUNNER" run --passWithNoTests "$@"
fi

run_and_remember_failure() {
  local exit_code_ref="$1"
  shift
  local status=0

  "$@" || status=$?
  if [ "$status" -ne 0 ] && [ "${!exit_code_ref}" -eq 0 ]; then
    printf -v "$exit_code_ref" '%s' "$status"
  fi
}

EXIT_CODE=0
# Non-client projects in one direct run. The `!client` filter keeps any project
# added to vitest.config.ts covered here without re-listing the set.
run_and_remember_failure EXIT_CODE \
  bash "$VITEST_RUNNER" run --passWithNoTests --project='!client' "$@"
# Client jsdom suite through the fast/compatibility isolation lanes.
run_and_remember_failure EXIT_CODE \
  bun "$CLIENT_TEST_RUNNER" "$@"

exit "$EXIT_CODE"
