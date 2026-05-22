#!/usr/bin/env bash
# Shared helpers for wrappers that run labeled child commands concurrently.
set -euo pipefail

MUSI_PARALLEL_TMP_DIR=""
MUSI_PARALLEL_RUN_PID=""
MUSI_PARALLEL_RUNNING=0
MUSI_PARALLEL_EXIT=0
MUSI_PARALLEL_READER_PIDS=()
MUSI_PARALLEL_PIDS=()
MUSI_PARALLEL_LABELS=()

musi_parallel_init() {
  local tmp_prefix="$1"

  MUSI_PARALLEL_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/${tmp_prefix}.XXXXXX")"
  MUSI_PARALLEL_RUN_PID=""
  MUSI_PARALLEL_RUNNING=0
  MUSI_PARALLEL_EXIT=0
  MUSI_PARALLEL_READER_PIDS=()
  MUSI_PARALLEL_PIDS=()
  MUSI_PARALLEL_LABELS=()
}

musi_parallel_kill_pid() {
  local pid="$1"

  [ -n "$pid" ] || return 0
  kill "$pid" 2>/dev/null || true
}

musi_parallel_wait_pid() {
  local pid="$1"

  [ -n "$pid" ] || return 0
  wait "$pid" 2>/dev/null || true
}

musi_parallel_cleanup_children() {
  local pid

  trap - INT TERM
  for pid in "${MUSI_PARALLEL_PIDS[@]}"; do
    musi_parallel_kill_pid "$pid"
  done
  for pid in "${MUSI_PARALLEL_READER_PIDS[@]}"; do
    musi_parallel_kill_pid "$pid"
  done
  for pid in "${MUSI_PARALLEL_PIDS[@]}"; do
    musi_parallel_wait_pid "$pid"
  done
  for pid in "${MUSI_PARALLEL_READER_PIDS[@]}"; do
    musi_parallel_wait_pid "$pid"
  done
  MUSI_PARALLEL_RUNNING=0
}

musi_parallel_cleanup_all() {
  if [ "$MUSI_PARALLEL_RUNNING" -eq 1 ]; then
    musi_parallel_cleanup_children
  fi
  if [ -n "$MUSI_PARALLEL_TMP_DIR" ]; then
    rm -rf "$MUSI_PARALLEL_TMP_DIR"
  fi
}

musi_parallel_on_sigint() {
  musi_parallel_cleanup_children
  exit 130
}

musi_parallel_on_sigterm() {
  musi_parallel_cleanup_children
  exit 143
}

musi_parallel_install_traps() {
  trap 'musi_parallel_cleanup_all' EXIT
  trap 'musi_parallel_on_sigint' INT
  trap 'musi_parallel_on_sigterm' TERM
}

musi_parallel_prefix_stream() {
  local label="$1"
  local line

  while IFS= read -r line || [ -n "$line" ]; do
    printf '[%s] %s\n' "$label" "$line"
  done
}

musi_parallel_start() {
  local label="$1"
  local key="$2"
  local stdout_fifo="$MUSI_PARALLEL_TMP_DIR/$key.stdout"
  local stderr_fifo="$MUSI_PARALLEL_TMP_DIR/$key.stderr"

  shift 2
  mkfifo "$stdout_fifo" "$stderr_fifo"

  musi_parallel_prefix_stream "$label" < "$stdout_fifo" &
  MUSI_PARALLEL_READER_PIDS+=("$!")
  musi_parallel_prefix_stream "$label" < "$stderr_fifo" >&2 &
  MUSI_PARALLEL_READER_PIDS+=("$!")

  printf '=== %s ===\n' "$label"
  "$@" > "$stdout_fifo" 2> "$stderr_fifo" &
  MUSI_PARALLEL_RUN_PID=$!
  MUSI_PARALLEL_PIDS+=("$MUSI_PARALLEL_RUN_PID")
  MUSI_PARALLEL_LABELS+=("$label")
  MUSI_PARALLEL_RUNNING=1
}

musi_parallel_wait_readers() {
  local pid

  for pid in "${MUSI_PARALLEL_READER_PIDS[@]}"; do
    musi_parallel_wait_pid "$pid"
  done
  MUSI_PARALLEL_READER_PIDS=()
}

musi_parallel_record_exit() {
  local exit_code="$1"

  [ "$exit_code" -ne 0 ] || return 0
  if [ "$MUSI_PARALLEL_EXIT" -eq 0 ]; then
    MUSI_PARALLEL_EXIT="$exit_code"
  elif [ "$MUSI_PARALLEL_EXIT" -ne "$exit_code" ]; then
    MUSI_PARALLEL_EXIT=1
  fi
}

musi_parallel_wait_all() {
  local context="$1"
  local exit_code index pid
  local -a statuses=()

  MUSI_PARALLEL_EXIT=0
  for index in "${!MUSI_PARALLEL_PIDS[@]}"; do
    pid="${MUSI_PARALLEL_PIDS[$index]}"
    exit_code=0
    wait "$pid" || exit_code=$?
    statuses+=("$exit_code")
  done
  musi_parallel_wait_readers
  MUSI_PARALLEL_RUNNING=0
  trap - INT TERM

  for index in "${!statuses[@]}"; do
    exit_code="${statuses[$index]}"
    if [ "$exit_code" -ne 0 ]; then
      printf '%s: %s failed with exit %s\n' "$context" "${MUSI_PARALLEL_LABELS[$index]}" "$exit_code" >&2
      musi_parallel_record_exit "$exit_code"
    fi
  done
}
