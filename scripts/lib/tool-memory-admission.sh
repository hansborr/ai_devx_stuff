#!/usr/bin/env bash
# Full-suite admission for heavy tools invoked outside verify/pre-commit.

MUSI_TOOL_MEMORY_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../verify/memory-budget.sh
. "$MUSI_TOOL_MEMORY_LIB_DIR/../verify/memory-budget.sh"
# shellcheck source=../process-tree.sh
. "$MUSI_TOOL_MEMORY_LIB_DIR/../process-tree.sh"

musi_tool_memory_admission_needed() {
  local scope="$1"
  [ "$scope" = full ] || return 1
  [ "${MUSI_TOOL_MEMORY_ADMISSION_BYPASS:-}" != 1 ] || return 1
  ! musi_memory_budget_reservation_is_live \
    "${MUSI_VERIFY_MEMORY_ADMISSION_TOKEN:-}" || return 1
}

musi_tool_memory_run_admitted() (
  local slot="$1" label="$2"
  shift 2
  local reservation_token="" child_pid="" exit_code=0

  trap '
    if [ -n "$child_pid" ]; then
      musi_terminate_process_tree "$child_pid"
      musi_wait_for_pid_exit_bounded "$child_pid" || true
    fi
    musi_memory_budget_release "$reservation_token"
  ' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  musi_memory_budget_wait_and_reserve "$slot" "$label" || return $?
  reservation_token="$MUSI_VERIFY_MEMORY_RESERVATION_TOKEN"

  musi_run_in_isolated_process_group \
    env "MUSI_VERIFY_MEMORY_ADMISSION_TOKEN=$reservation_token" \
    bash "$MUSI_VERIFY_MEMORY_ADMITTED_COMMAND" "$@" &
  child_pid=$!
  musi_memory_budget_attach_pid "$reservation_token" "$child_pid" || {
    printf '%s: failed to attach %s reservation to pid %s\n' \
      "$label" "$slot" "$child_pid" >&2
  }
  wait "$child_pid" || exit_code=$?
  child_pid=""
  return "$exit_code"
)
