#!/usr/bin/env bash
# Shared validation and CLI parsing for every supported Vitest worker-count input.

# shellcheck disable=SC2034 # Read by scripts that source this shared contract.
MUSI_TEST_DEFAULT_MAX_WORKERS=6
MUSI_TEST_MAX_SUPPORTED_WORKERS=8
# shellcheck disable=SC2034 # Read by test-changed.sh and memory-budget.sh.
MUSI_TEST_CHANGED_CLIENT_DEFAULT_MAX_WORKERS=4

musi_test_positive_integer_lte() {
  local value="$1" limit="$2"
  case "$value" in
    '' | 0 | 0* | *[!0-9]*) return 1 ;;
  esac
  if [ "${#value}" -lt "${#limit}" ]; then
    return 0
  fi
  if [ "${#value}" -gt "${#limit}" ]; then
    return 1
  fi
  [[ "$value" == "$limit" || "$value" < "$limit" ]]
}

musi_test_validate_worker_count() {
  local label="$1" value="$2"
  if musi_test_positive_integer_lte "$value" "$MUSI_TEST_MAX_SUPPORTED_WORKERS"; then
    return 0
  fi
  printf '%s must be a positive integer from 1 to %s, received "%s"\n' \
    "$label" "$MUSI_TEST_MAX_SUPPORTED_WORKERS" "$value" >&2
  return 2
}

musi_test_parse_cli_max_workers() {
  local arg value worker_flag_seen=0
  unset MUSI_TEST_CLI_MAX_WORKERS
  while [ "$#" -gt 0 ]; do
    arg="$1"
    shift
    case "$arg" in
      --maxWorkers | --max-workers)
        if [ "$worker_flag_seen" -eq 1 ]; then
          printf '%s\n' 'maxWorkers may be specified only once' >&2
          return 2
        fi
        worker_flag_seen=1
        if [ "$#" -eq 0 ]; then
          printf '%s\n' 'maxWorkers must be a positive integer from 1 to 8, received "<missing>"' >&2
          return 2
        fi
        value="$1"
        shift
        musi_test_validate_worker_count maxWorkers "$value" || return $?
        # shellcheck disable=SC2034 # Read by memory-budget.sh after parsing.
        MUSI_TEST_CLI_MAX_WORKERS="$value"
        ;;
      --maxWorkers=* | --max-workers=*)
        if [ "$worker_flag_seen" -eq 1 ]; then
          printf '%s\n' 'maxWorkers may be specified only once' >&2
          return 2
        fi
        worker_flag_seen=1
        value="${arg#*=}"
        musi_test_validate_worker_count maxWorkers "$value" || return $?
        # shellcheck disable=SC2034 # Read by memory-budget.sh after parsing.
        MUSI_TEST_CLI_MAX_WORKERS="$value"
        ;;
    esac
  done
}

musi_test_translate_cli_max_workers_to_native_env() {
  if [ -z "${MUSI_TEST_CLI_MAX_WORKERS+x}" ]; then
    unset MUSI_TEST_TRANSLATED_CLI_MAX_WORKERS
    return 0
  fi
  if [ -n "${VITEST_MAX_WORKERS+x}" ]; then
    if [ "${MUSI_TEST_TRANSLATED_CLI_MAX_WORKERS-}" != "$MUSI_TEST_CLI_MAX_WORKERS" ] \
      || [ "$VITEST_MAX_WORKERS" != "$MUSI_TEST_CLI_MAX_WORKERS" ]; then
      unset MUSI_TEST_TRANSLATED_CLI_MAX_WORKERS
    fi
    return 0
  fi
  VITEST_MAX_WORKERS="$MUSI_TEST_CLI_MAX_WORKERS"
  MUSI_TEST_TRANSLATED_CLI_MAX_WORKERS="$MUSI_TEST_CLI_MAX_WORKERS"
  export VITEST_MAX_WORKERS MUSI_TEST_TRANSLATED_CLI_MAX_WORKERS
}
