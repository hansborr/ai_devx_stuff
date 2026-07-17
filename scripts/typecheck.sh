#!/usr/bin/env bash
# Run package, scripts, and eslint-config-JS TypeScript checks concurrently
# while keeping output readable.
set -eu

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Resolve the TypeScript compiler explicitly so `bash scripts/typecheck.sh`
# works without Bun's PATH injection (mirrors scripts/vitest.sh). Falls back to
# bare `tsc` so environments that already have it on PATH do not regress.
if [ -n "${MUSI_TSC_BIN:-}" ]; then
  TSC=("$MUSI_TSC_BIN")
elif [ -x "$REPO_ROOT/node_modules/.bin/tsc" ]; then
  TSC=("$REPO_ROOT/node_modules/.bin/tsc")
else
  TSC=(tsc)
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/musi-typecheck.XXXXXX")"
RUN_PID=""
RUN_LOG=""
build_pid=""
scripts_pid=""
eslint_js_pid=""
build_log=""
scripts_log=""
eslint_js_log=""
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
  kill_pid "$eslint_js_pid"
  for pid in "${reader_pids[@]}"; do
    kill_pid "$pid"
  done
  wait_pid "$build_pid"
  wait_pid "$scripts_pid"
  wait_pid "$eslint_js_pid"
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
  local log_file="$2"
  local line
  local formatted

  while IFS= read -r line || [ -n "$line" ]; do
    formatted="[$label] $line"
    printf '%s\n' "$formatted"
    printf '%s\n' "$formatted" >> "$log_file"
  done
}

start_typecheck() {
  local label="$1"
  local key="$2"
  local stdout_fifo="$TMP_DIR/$key.stdout"
  local stderr_fifo="$TMP_DIR/$key.stderr"
  local log_file="$TMP_DIR/$key.log"

  shift 2
  mkfifo "$stdout_fifo" "$stderr_fifo"
  : > "$log_file"

  prefix_stream "$label" "$log_file" < "$stdout_fifo" &
  reader_pids+=("$!")
  prefix_stream "$label" "$log_file" < "$stderr_fifo" >&2 &
  reader_pids+=("$!")

  printf '=== %s ===\n' "$label"
  "$@" > "$stdout_fifo" 2> "$stderr_fifo" &
  RUN_PID=$!
  RUN_LOG="$log_file"
}

print_indented_file() {
  sed 's/^/  /' "$1" >&2
}

print_excerpt_file() {
  local file="$1"
  local total="$2"
  local head_count=15
  local tail_count=15
  local omitted

  if [ "$total" -le $((head_count + tail_count)) ]; then
    print_indented_file "$file"
    return 0
  fi

  head -n "$head_count" "$file" | sed 's/^/  /' >&2
  omitted=$((total - head_count - tail_count))
  printf '  ... %s middle line(s) omitted ...\n' "$omitted" >&2
  tail -n "$tail_count" "$file" | sed 's/^/  /' >&2
}

print_failure_summary() {
  local label="$1"
  local exit_code="$2"
  local log_file="$3"
  local diagnostics_file="$TMP_DIR/${label//[^A-Za-z0-9]/_}.diagnostics"
  local excerpt_file="$log_file"
  local excerpt_kind="log"
  local error_count=0
  local line_count

  printf 'typecheck: %s failed with exit %s\n' "$label" "$exit_code" >&2
  grep -E '(^|[[:space:]])error TS[0-9]+:' "$log_file" > "$diagnostics_file" || true
  error_count="$(wc -l < "$diagnostics_file" | tr -d '[:space:]')"
  printf 'typecheck: %s diagnostics: %s TypeScript error line(s)\n' \
    "$label" "$error_count" >&2

  if [ "$error_count" -gt 0 ]; then
    excerpt_file="$diagnostics_file"
    excerpt_kind="diagnostic"
  fi
  line_count="$(wc -l < "$excerpt_file" | tr -d '[:space:]')"
  [ "$line_count" -gt 0 ] || return 0
  printf 'typecheck: %s %s excerpt (%s line(s)):\n' \
    "$label" "$excerpt_kind" "$line_count" >&2
  print_excerpt_file "$excerpt_file" "$line_count"
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

start_typecheck "tsc -b" "packages" "${TSC[@]}" -b
build_pid="$RUN_PID"
build_log="$RUN_LOG"
start_typecheck "tsc -p tsconfig.scripts.json" "scripts" "${TSC[@]}" -p tsconfig.scripts.json
scripts_pid="$RUN_PID"
scripts_log="$RUN_LOG"
start_typecheck "tsc -p tsconfig.eslint-js.json" "eslint-js" "${TSC[@]}" -p tsconfig.eslint-js.json
eslint_js_pid="$RUN_PID"
eslint_js_log="$RUN_LOG"

build_exit=0
scripts_exit=0
eslint_js_exit=0
wait "$build_pid" || build_exit=$?
wait "$scripts_pid" || scripts_exit=$?
wait "$eslint_js_pid" || eslint_js_exit=$?
wait_readers
trap - INT TERM

if [ "$build_exit" -eq 0 ] && [ "$scripts_exit" -eq 0 ] && [ "$eslint_js_exit" -eq 0 ]; then
  exit 0
fi

if [ "$build_exit" -ne 0 ]; then
  print_failure_summary "tsc -b" "$build_exit" "$build_log"
fi
if [ "$scripts_exit" -ne 0 ]; then
  print_failure_summary "tsc -p tsconfig.scripts.json" "$scripts_exit" "$scripts_log"
fi
if [ "$eslint_js_exit" -ne 0 ]; then
  print_failure_summary "tsc -p tsconfig.eslint-js.json" "$eslint_js_exit" "$eslint_js_log"
fi

# Failing lanes agreeing on one exit code propagate it; disagreement falls
# back to 1.
final_exit=0
for lane_exit in "$build_exit" "$scripts_exit" "$eslint_js_exit"; do
  [ "$lane_exit" -ne 0 ] || continue
  if [ "$final_exit" -eq 0 ]; then
    final_exit="$lane_exit"
  elif [ "$final_exit" -ne "$lane_exit" ]; then
    final_exit=1
    break
  fi
done

exit "$final_exit"
