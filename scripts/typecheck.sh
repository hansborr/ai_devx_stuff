#!/usr/bin/env bash
# Run package and scripts TypeScript checks concurrently while keeping output readable.
set -eu

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/musi-typecheck.XXXXXX")"
RUN_PID=""
build_pid=""
scripts_pid=""
reader_pids=()

cleanup_tmp() {
  rm -rf "$TMP_DIR"
}

kill_pid() {
  local pid="$1"

  [ -n "$pid" ] || return 0
  kill "$pid" 2>/dev/null || true
}

wait_pid() {
  local pid="$1"

  [ -n "$pid" ] || return 0
  wait "$pid" 2>/dev/null || true
}

cleanup_children() {
  local pid

  trap - INT TERM
  kill_pid "$build_pid"
  kill_pid "$scripts_pid"
  for pid in "${reader_pids[@]}"; do
    kill_pid "$pid"
  done
  wait_pid "$build_pid"
  wait_pid "$scripts_pid"
  for pid in "${reader_pids[@]}"; do
    wait_pid "$pid"
  done
}

on_sigint() {
  cleanup_children
  exit 130
}

on_sigterm() {
  cleanup_children
  exit 143
}

prefix_stream() {
  local label="$1"
  local line

  while IFS= read -r line || [ -n "$line" ]; do
    printf '[%s] %s\n' "$label" "$line"
  done
}

start_typecheck() {
  local label="$1"
  local key="$2"
  local stdout_fifo="$TMP_DIR/$key.stdout"
  local stderr_fifo="$TMP_DIR/$key.stderr"

  shift 2
  mkfifo "$stdout_fifo" "$stderr_fifo"

  prefix_stream "$label" < "$stdout_fifo" &
  reader_pids+=("$!")
  prefix_stream "$label" < "$stderr_fifo" >&2 &
  reader_pids+=("$!")

  printf '=== %s ===\n' "$label"
  "$@" > "$stdout_fifo" 2> "$stderr_fifo" &
  RUN_PID=$!
}

wait_readers() {
  local pid

  for pid in "${reader_pids[@]}"; do
    wait_pid "$pid"
  done
  reader_pids=()
}

trap cleanup_tmp EXIT
trap on_sigint INT
trap on_sigterm TERM

start_typecheck "tsc -b" "packages" tsc -b
build_pid="$RUN_PID"
start_typecheck "tsc -p tsconfig.scripts.json" "scripts" tsc -p tsconfig.scripts.json
scripts_pid="$RUN_PID"

build_exit=0
scripts_exit=0
wait "$build_pid" || build_exit=$?
wait "$scripts_pid" || scripts_exit=$?
wait_readers
trap - INT TERM

if [ "$build_exit" -eq 0 ] && [ "$scripts_exit" -eq 0 ]; then
  exit 0
fi

if [ "$build_exit" -ne 0 ]; then
  printf 'typecheck: tsc -b failed with exit %s\n' "$build_exit" >&2
fi
if [ "$scripts_exit" -ne 0 ]; then
  printf 'typecheck: tsc -p tsconfig.scripts.json failed with exit %s\n' "$scripts_exit" >&2
fi

final_exit=1
if [ "$build_exit" -ne 0 ] && [ "$scripts_exit" -eq 0 ]; then
  final_exit="$build_exit"
elif [ "$scripts_exit" -ne 0 ] && [ "$build_exit" -eq 0 ]; then
  final_exit="$scripts_exit"
elif [ "$build_exit" -eq "$scripts_exit" ]; then
  final_exit="$build_exit"
fi

exit "$final_exit"
