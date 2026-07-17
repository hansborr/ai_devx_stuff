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
# file runs (`bun run test -- <file>`) fall back to one direct Vitest invocation.
# Admission remains cheap only when every positional selector is an explicit,
# existing test file inside the repository. Directories, projects, globs, and
# ambiguous argument shapes reserve the full-suite peak.
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VITEST_RUNNER="$SCRIPT_DIR/vitest.sh"
CLIENT_TEST_RUNNER="$SCRIPT_DIR/client-test-isolation-runner.ts"
# shellcheck source=scripts/lib/tool-memory-admission.sh
. "$SCRIPT_DIR/lib/tool-memory-admission.sh"

musi_test_parse_cli_max_workers "$@" || exit $?
musi_test_translate_cli_max_workers_to_native_env

test_selector_is_focused_file() {
  local selector="$1" selector_file
  case "/$selector/" in
    */../*) return 1 ;;
  esac
  case "$selector" in
    *.test.* | *.spec.*) ;;
    *) return 1 ;;
  esac
  [ -f "$selector" ] || return 1
  selector_file="$(cd "$(dirname "$selector")" && pwd -P)/$(basename "$selector")"
  case "$selector_file" in
    "$REPO_ROOT"/*) return 0 ;;
    *) return 1 ;;
  esac
}

test_run_scope() {
  local arg selector_found=0

  while [ "$#" -gt 0 ]; do
    arg="$1"
    shift
    case "$arg" in
      --project | --project=* | -c | --config | --config=* | -r | --root | --root=*)
        printf 'full\n'
        return 0
        ;;
      --reporter | --outputFile | -t | --testNamePattern | --dir | --shard | \
        --exclude | --environment | \
        --pool | --maxWorkers | --max-workers | --testTimeout | --hookTimeout | --bail | \
        --retry | --mode | --sequence.seed | --slowTestThreshold | \
        --teardownTimeout)
        [ "$#" -gt 0 ] || { printf 'full\n'; return 0; }
        shift
        ;;
      --reporter=* | --outputFile=* | --outputFile.*=* | \
        --testNamePattern=* | --dir=* | --shard=* | --exclude=* | \
        --environment=* | --pool=* | --maxWorkers=* | --max-workers=* | --testTimeout=* | \
        --hookTimeout=* | --bail=* | --retry=* | --mode=* | \
        --sequence.seed=* | --slowTestThreshold=* | --teardownTimeout=*)
        ;;
      --)
        while [ "$#" -gt 0 ]; do
          test_selector_is_focused_file "$1" || { printf 'full\n'; return 0; }
          selector_found=1
          shift
        done
        ;;
      -*)
        printf 'full\n'
        return 0
        ;;
      *)
        test_selector_is_focused_file "$arg" || { printf 'full\n'; return 0; }
        selector_found=1
        ;;
    esac
  done

  if [ "$selector_found" -eq 1 ]; then
    printf 'focused\n'
    return 0
  fi

  printf 'full\n'
}

TEST_RUN_SCOPE="$(test_run_scope "$@")"
if musi_tool_memory_admission_needed "$TEST_RUN_SCOPE"; then
  musi_tool_memory_run_admitted test test:direct bash "$SCRIPT_DIR/test-all.sh" "$@"
  exit $?
fi

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
