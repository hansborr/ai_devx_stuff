#!/bin/bash
# Verify/pre-commit parallel step launcher.
#
# Called by scripts/verify.sh and .husky/pre-commit. Callers set LOG_DIR and
# META_DIR. Starts one labeled command in the background, captures stdout/stderr
# to $LOG_DIR/<step>.log, writes per-step metadata, scrubs Git-hook env from the
# child, and exposes STEP_PID. Keep separate from scripts/lib/parallel-runner.sh:
# callers own waiting, summaries, process-tree cleanup, and wrapper metadata;
# this helper does not stream FIFO-prefixed output, install traps, or aggregate
# exits into MUSI_PARALLEL_EXIT.

if ! declare -F musi_run_in_isolated_process_group >/dev/null 2>&1; then
  # shellcheck source=../process-tree.sh
  . "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/process-tree.sh"
fi

musi_run_parallel_step() {
  local meta_mode="$1" label="$2" name="$3"; shift 3
  local log="$LOG_DIR/${name}.log"
  local command reservation_token="${MUSI_VERIFY_MEMORY_RESERVATION_TOKEN:-}"
  local admitted_command="${MUSI_VERIFY_MEMORY_ADMITTED_COMMAND:-}"
  if [ -z "$admitted_command" ]; then
    admitted_command="$(cd "$(dirname "${BASH_SOURCE[0]}")/../verify" && pwd)/admitted-command.sh"
  fi
  command="$(musi_meta_command_string "$@")"
  [ -n "$label" ] && printf '%s: running %s...\n' "$label" "$name"
  (
    local step_start step_start_time step_end step_end_time exit_code
    if [ -n "$reservation_token" ]; then
      trap 'musi_memory_budget_release "$reservation_token"' EXIT
    fi
    step_start=$(date +%s)
    step_start_time=$(date -Iseconds)
    # Git hooks export repository metadata into child processes. Clear it so
    # fixture repos created by tests use their own .git directories and index.
    musi_run_in_isolated_process_group env -u MUSI_VERIFY_LOCK_ALREADY_HELD \
      -u MUSI_COMMIT_QUEUE_LOCK_ALREADY_HELD \
      -u MUSI_COMMIT_QUEUE_LOCK \
      -u GIT_DIR \
      -u GIT_INDEX_FILE \
      -u GIT_WORK_TREE \
      -u GIT_PREFIX \
      -u GIT_COMMON_DIR \
      "MUSI_VERIFY_MEMORY_ADMISSION_TOKEN=$reservation_token" \
      bash "$admitted_command" "$@" > "$log" 2>&1 9>&- 8>&-
    exit_code=$?
    step_end=$(date +%s)
    step_end_time=$(date -Iseconds)
    musi_write_step_meta "$META_DIR/${name}.json" "$name" "$meta_mode" \
      "$step_start" "$step_start_time" "$step_end" "$step_end_time" "$exit_code" "$command"
    exit "$exit_code"
  ) &
  # shellcheck disable=SC2034
  # callers read STEP_PID after invoking this function
  STEP_PID=$!
}
