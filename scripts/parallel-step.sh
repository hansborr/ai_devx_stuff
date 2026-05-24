#!/bin/bash
# parallel-step.sh — shared parallel step runner for pre-commit and verify.sh.
#
# Callers must set: LOG_DIR, META_DIR (directories for logs and step metadata).
# Sets: STEP_PID (PID of the backgrounded subshell).

musi_run_parallel_step() {
  local meta_mode="$1" label="$2" name="$3"; shift 3
  local log="$LOG_DIR/${name}.log"
  local command
  command="$(musi_meta_command_string "$@")"
  [ -n "$label" ] && printf '%s: running %s...\n' "$label" "$name"
  (
    local step_start step_start_time step_end step_end_time exit_code
    step_start=$(date +%s)
    step_start_time=$(date -Iseconds)
    env -u MUSI_VERIFY_LOCK_ALREADY_HELD "$@" > "$log" 2>&1 9>&-
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
