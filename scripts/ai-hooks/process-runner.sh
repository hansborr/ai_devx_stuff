#!/bin/bash

# Shared process runner for hook-managed commands that need bounded runtime and
# child cleanup. Callers own lock/cache policy; this file only manages the
# process lifecycle and log capture.

# shellcheck disable=SC2034
# AI_RUN_* globals are intentional status outputs for scripts that source this file.
AI_RUN_EXIT=0
AI_RUN_ELAPSED=0
AI_RUN_TIMED_OUT=0

ai_run_terminate_process() {
  local pid="$1"
  local process_group="${2:-0}"

  if [ -z "$pid" ]; then
    return 0
  fi

  if [ "$process_group" -eq 1 ]; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    sleep 2
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    return 0
  fi

  kill -TERM "$pid" 2>/dev/null || true
  sleep 2
  kill -KILL "$pid" 2>/dev/null || true
}

ai_run_logged_with_watchdog() {
  local log="$1"
  local timeout="$2"
  shift 2

  local child="" watchdog="" timeout_marker start exit_code process_group=0
  local log_dir

  AI_RUN_EXIT=0
  AI_RUN_ELAPSED=0
  AI_RUN_TIMED_OUT=0

  log_dir=$(dirname "$log")
  mkdir -p "$log_dir" || return 1
  timeout_marker=$(mktemp "$log_dir/.watchdog.XXXXXX") || return 1
  rm -f "$timeout_marker"

  start=$(date +%s)

  if command -v setsid >/dev/null 2>&1; then
    setsid "$@" > "$log" 2>&1 &
    child=$!
    process_group=1
  else
    "$@" > "$log" 2>&1 &
    child=$!
  fi

  ai_run_on_signal() {
    ai_run_terminate_process "$child" "$process_group"
    if [ -n "$watchdog" ]; then
      kill "$watchdog" 2>/dev/null || true
      wait "$watchdog" 2>/dev/null || true
    fi
    rm -f "$timeout_marker"
    exit "$1"
  }

  trap 'ai_run_on_signal 130' INT
  trap 'ai_run_on_signal 143' TERM

  (
    sleep_pid=""
    trap '[ -n "$sleep_pid" ] && kill "$sleep_pid" 2>/dev/null; exit 0' TERM INT
    sleep "$timeout" &
    sleep_pid=$!
    wait "$sleep_pid" 2>/dev/null || exit 0
    printf 'timeout\n' > "$timeout_marker"
    ai_run_terminate_process "$child" "$process_group"
  ) &
  watchdog=$!

  wait "$child"
  exit_code=$?

  kill "$watchdog" 2>/dev/null || true
  wait "$watchdog" 2>/dev/null || true
  trap - INT TERM

  AI_RUN_ELAPSED=$(( $(date +%s) - start ))
  if [ -f "$timeout_marker" ]; then
    AI_RUN_TIMED_OUT=1
    exit_code=124
  fi
  rm -f "$timeout_marker"

  AI_RUN_EXIT=$exit_code
  return "$exit_code"
}
