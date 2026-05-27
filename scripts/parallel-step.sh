#!/bin/bash
# Verify/pre-commit parallel step launcher.
#
# Called by scripts/verify.sh and .husky/pre-commit. Callers set LOG_DIR and
# META_DIR. Starts one labeled command in the background, captures stdout/stderr
# to $LOG_DIR/<step>.log, writes per-step metadata, scrubs Git-hook env from the
# child, and exposes STEP_PID. Keep separate from scripts/parallel-runner.sh:
# callers own waiting, summaries, process-tree cleanup, and wrapper metadata;
# this helper does not stream FIFO-prefixed output, install traps, or aggregate
# exits into MUSI_PARALLEL_EXIT.

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
    # Git hooks export repository metadata into child processes. Clear it so
    # fixture repos created by tests use their own .git directories and index.
    env -u MUSI_VERIFY_LOCK_ALREADY_HELD \
      -u GIT_DIR \
      -u GIT_INDEX_FILE \
      -u GIT_WORK_TREE \
      -u GIT_PREFIX \
      -u GIT_COMMON_DIR \
      "$@" > "$log" 2>&1 9>&-
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
