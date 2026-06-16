#!/bin/bash
# Client test orchestrator for `bun run test:client`.
#
# Default invocations use the split no-isolate/compatibility client lanes. Args
# that the split runner cannot safely honor fall back to one direct client
# Vitest invocation, preserving focused file selectors and single output files.
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VITEST_RUNNER="$SCRIPT_DIR/vitest.sh"
CLIENT_TEST_RUNNER="$SCRIPT_DIR/client-test-isolation-runner.ts"

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
        return 1
        ;;
    esac
  done
  return 0
}

if client_split_supports_user_args "$@"; then
  exec bun "$CLIENT_TEST_RUNNER" "$@"
fi

exec bash "$VITEST_RUNNER" run --passWithNoTests --project=client "$@"
