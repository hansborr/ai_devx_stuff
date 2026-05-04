#!/usr/bin/env bash
# verify-async.sh — detached manual verification runner.
#
# The starter returns immediately; the detached child takes the same verify
# lock used by pre-commit/verify.sh, writes private logs and marker files, and
# records status under /tmp/musi-verify-async/<repo-key>/.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

# shellcheck source=/dev/null
. "$SCRIPT_DIR/ai-hooks/cache.sh"

STATE_ROOT="${MUSI_VERIFY_ASYNC_STATE_ROOT:-/tmp/musi-verify-async}"
LOCK="${MUSI_VERIFY_LOCK:-/tmp/musi-pre-commit.lock}"
ASYNC_TIMEOUT="${MUSI_ASYNC_VERIFY_TIMEOUT:-1800}"
RETENTION_SECONDS="${MUSI_VERIFY_ASYNC_RETENTION_SECONDS:-604800}"
TAIL_LINES=200

repo_key() {
  printf '%s' "$REPO_ROOT" | sha256sum | awk '{print $1}'
}

state_dir() {
  printf '%s/%s' "$STATE_ROOT" "$(repo_key)"
}

runs_dir() {
  printf '%s/runs' "$(state_dir)"
}

latest_file() {
  printf '%s/latest' "$(state_dir)"
}

usage() {
  cat >&2 <<'EOF'
usage:
  verify-async.sh start [verify|changed|slow]
  verify-async.sh start --command <cmd> [args...]
  verify-async.sh status [--short]
  verify-async.sh tail [-n lines]
  verify-async.sh stop
EOF
}

is_integer() {
  [[ "${1:-}" =~ ^-?[0-9]+$ ]]
}

iso_now() {
  date -Iseconds
}

iso_at() {
  date -Iseconds -d "@$1" 2>/dev/null || date -Iseconds
}

state_get() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 1
  while IFS='=' read -r k v; do
    if [ "$k" = "$key" ]; then
      printf '%s' "$v"
      return 0
    fi
  done < "$file"
  return 1
}

write_state() {
  local file="$1" pid="$2" started_epoch="$3" started_at="$4" command="$5"
  local head="$6" fp="$7" log_dir="$8" exit_code="$9" finished_epoch="${10}"
  local finished_at="${11}" dir base tmp

  dir=$(dirname "$file")
  base=$(basename "$file")
  mkdir -p "$dir" || return 1
  tmp=$(mktemp "$dir/.${base}.tmp.XXXXXX") || return 1
  if ! {
    printf 'pid=%s\n' "$pid"
    printf 'started_epoch=%s\n' "$started_epoch"
    printf 'started_at=%s\n' "$started_at"
    printf 'command=%s\n' "$command"
    printf 'head=%s\n' "$head"
    printf 'worktree_fingerprint=%s\n' "$fp"
    printf 'log_dir=%s\n' "$log_dir"
    printf 'exit_code=%s\n' "$exit_code"
    printf 'finished_epoch=%s\n' "$finished_epoch"
    printf 'finished_at=%s\n' "$finished_at"
  } > "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  if ! mv -f "$tmp" "$file"; then
    rm -f "$tmp"
    return 1
  fi
}

update_finished_state() {
  local file="$1" exit_code="$2" finished_epoch="$3" finished_at="$4"
  local pid started_epoch started_at command head fp log_dir

  pid=$(state_get "$file" pid || printf '')
  started_epoch=$(state_get "$file" started_epoch || printf '')
  started_at=$(state_get "$file" started_at || printf '')
  command=$(state_get "$file" command || printf '')
  head=$(state_get "$file" head || printf '')
  fp=$(state_get "$file" worktree_fingerprint || printf '')
  log_dir=$(state_get "$file" log_dir || printf '')
  write_state "$file" "$pid" "$started_epoch" "$started_at" "$command" \
    "$head" "$fp" "$log_dir" "$exit_code" "$finished_epoch" "$finished_at" || true
}

command_display() {
  local out="" part
  for part in "$@"; do
    printf -v part '%q' "$part"
    out="${out:+$out }$part"
  done
  printf '%s' "$out"
}

command_for_mode() {
  case "${1:-verify}" in
    verify) printf '%s\0%s\0%s\0' bun run verify ;;
    changed) printf '%s\0%s\0%s\0' bun run verify:changed ;;
    slow) printf '%s\0%s\0%s\0' bun run verify:slow ;;
    *) return 1 ;;
  esac
}

load_command() {
  local mode="${1:-verify}"
  CMD=()
  if [ "$mode" = "--command" ]; then
    shift
    [ "$#" -gt 0 ] || return 1
    CMD=("$@")
    return 0
  fi
  [ "$#" -le 1 ] || return 1
  command_for_mode "$mode" >/dev/null || return 1
  while IFS= read -r -d '' part; do
    CMD+=("$part")
  done < <(command_for_mode "$mode")
  [ "${#CMD[@]}" -gt 0 ]
}

latest_state_file() {
  local latest state
  latest=$(latest_file)
  if [ -f "$latest" ]; then
    state=$(cat "$latest" 2>/dev/null || true)
    if [ -n "$state" ] && [ -f "$state" ]; then
      printf '%s' "$state"
      return 0
    fi
  fi
  find "$(runs_dir)" -mindepth 2 -maxdepth 2 -name state -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr | awk 'NR == 1 {print $2}'
}

pid_alive() {
  local pid="$1"
  is_integer "$pid" || return 1
  [ "$pid" -gt 0 ] || return 1
  kill -0 "$pid" 2>/dev/null
}

signal_run_process_group() {
  local pid="$1" signal="${2:-TERM}"
  is_integer "$pid" || return 0
  [ "$pid" -gt 0 ] || return 0
  kill "-$signal" -- "-$pid" 2>/dev/null || kill "-$signal" "$pid" 2>/dev/null || true
}

process_running() {
  local pid="$1" stat
  is_integer "$pid" || return 1
  [ "$pid" -gt 0 ] || return 1
  stat=$(ps -o stat= -p "$pid" 2>/dev/null | awk '{print $1}')
  [ -n "$stat" ] && [[ "$stat" != Z* ]]
}

child_pids() {
  local pid="$1"
  is_integer "$pid" || return 0
  [ "$pid" -gt 0 ] || return 0
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -P "$pid" 2>/dev/null || true
    return 0
  fi
  ps -o pid= --ppid "$pid" 2>/dev/null | awk '{print $1}' || true
}

signal_process_tree() {
  local pid="$1" signal="${2:-TERM}" child
  is_integer "$pid" || return 0
  [ "$pid" -gt 0 ] || return 0
  while IFS= read -r child; do
    [ -n "$child" ] || continue
    signal_process_tree "$child" "$signal"
  done < <(child_pids "$pid")
  kill "-$signal" "$pid" 2>/dev/null || true
}

state_status() {
  local file="$1" pid exit_code
  pid=$(state_get "$file" pid || printf '')
  exit_code=$(state_get "$file" exit_code || printf '')
  if [ -z "$exit_code" ]; then
    if pid_alive "$pid"; then
      printf 'running'
    else
      printf 'failed'
    fi
    return 0
  fi
  if [ "$exit_code" = "0" ]; then
    printf 'passed'
  else
    printf 'failed'
  fi
}

elapsed_seconds() {
  local file="$1" started finished now
  started=$(state_get "$file" started_epoch || printf '')
  finished=$(state_get "$file" finished_epoch || printf '')
  is_integer "$started" || { printf '0'; return 0; }
  if is_integer "$finished" && [ "$finished" -gt 0 ]; then
    printf '%s' "$((finished - started))"
    return 0
  fi
  now=$(date +%s)
  printf '%s' "$((now - started))"
}

refresh_dead_state() {
  local file="$1" pid exit_code now
  pid=$(state_get "$file" pid || printf '')
  exit_code=$(state_get "$file" exit_code || printf '')
  [ -z "$exit_code" ] || return 1
  pid_alive "$pid" && return 1
  now=$(date +%s)
  update_finished_state "$file" -1 "$now" "$(iso_at "$now")"
}

gc_old_runs() {
  local now cutoff pruned=0 state run_dir status finished started exit_before
  mkdir -p "$(runs_dir)"
  now=$(date +%s)
  cutoff=$((now - RETENTION_SECONDS))
  while IFS= read -r state; do
    [ -n "$state" ] || continue
    exit_before=$(state_get "$state" exit_code || printf '')
    started=$(state_get "$state" started_epoch || printf '')
    refresh_dead_state "$state" || true
    status=$(state_status "$state")
    [ "$status" = "running" ] && continue
    finished=$(state_get "$state" finished_epoch || printf '')
    if is_integer "$finished" && [ "$finished" -gt 0 ]; then
      if [ -z "$exit_before" ] && is_integer "$started" && [ "$started" -le "$cutoff" ]; then
        :
      else
        [ "$finished" -le "$cutoff" ] || continue
      fi
    elif is_integer "$started"; then
      [ "$started" -le "$cutoff" ] || continue
    else
      continue
    fi
    run_dir=$(dirname "$state")
    rm -rf "$run_dir"
    pruned=$((pruned + 1))
  done < <(find "$(runs_dir)" -mindepth 2 -maxdepth 2 -name state 2>/dev/null)
  if [ "$pruned" -gt 0 ]; then
    printf 'verify:async: pruned %d old run(s)\n' "$pruned"
  fi
}

start_run() {
  load_command "$@" || { usage; exit 2; }
  mkdir -p "$(runs_dir)"

  local now started_at run_id run_dir log_dir state command head fp child run_mode
  now=$(date +%s)
  started_at=$(iso_at "$now")
  run_id="$(date -u +%Y%m%dT%H%M%SZ).$$"
  run_dir="$(runs_dir)/$run_id"
  log_dir="$run_dir/logs"
  state="$run_dir/state"
  command=$(command_display "${CMD[@]}")
  head=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo none)
  fp=$(ai_worktree_fingerprint "$REPO_ROOT")
  mkdir -p "$log_dir" "$run_dir/markers"
  write_state "$state" 0 "$now" "$started_at" "$command" "$head" "$fp" "$log_dir" "" "" ""

  if command -v setsid >/dev/null 2>&1; then
    run_mode="setsid"
    nohup setsid bash "$0" __run "$state" "$ASYNC_TIMEOUT" "$LOCK" "$run_mode" -- "${CMD[@]}" >/dev/null 2>&1 </dev/null &
  else
    run_mode="direct"
    nohup bash "$0" __run "$state" "$ASYNC_TIMEOUT" "$LOCK" "$run_mode" -- "${CMD[@]}" >/dev/null 2>&1 </dev/null &
  fi
  child=$!
  write_state "$state" "$child" "$now" "$started_at" "$command" "$head" "$fp" "$log_dir" "" "" ""
  printf '%s\n' "$state" > "$(latest_file)"
  disown "$child" 2>/dev/null || true

  printf 'verify:async: started PID %s\n' "$child"
  printf 'command: %s\n' "$command"
  printf 'status: bun run verify:async:status\n'
  printf 'log_dir: %s\n' "$log_dir"
}

run_child() {
  local state="$1" timeout="$2" lock="$3" run_mode="$4"
  shift 5
  local expected_pid log_dir command current_pid="" watchdog="" timeout_marker="" exit_code=0
  expected_pid="$BASHPID"
  for _ in $(seq 1 50); do
    [ "$(state_get "$state" pid || printf '')" = "$expected_pid" ] && break
    sleep 0.1
  done

  log_dir=$(state_get "$state" log_dir || printf '')
  command=$(state_get "$state" command || printf '')
  mkdir -p "$log_dir"
  timeout_marker="$log_dir/.timeout"
  rm -f "$timeout_marker"
  exec > "$log_dir/async.log" 2>&1

  finish_child() {
    local code="$1" now
    now=$(date +%s)
    update_finished_state "$state" "$code" "$now" "$(iso_at "$now")"
  }

  signal_payload() {
    local signal="${1:-TERM}"
    [ -n "$current_pid" ] && signal_process_tree "$current_pid" "$signal"
  }

  wait_for_payload_exit() {
    local pid="$1" attempts="${2:-30}"
    for _ in $(seq 1 "$attempts"); do
      if ! process_running "$pid"; then
        wait "$pid" 2>/dev/null || true
        return 0
      fi
      sleep 0.1
    done
    return 1
  }

  cleanup_payload() {
    [ -n "$current_pid" ] || return 0
    signal_payload TERM
    if ! wait_for_payload_exit "$current_pid" 30; then
      signal_payload KILL
      wait_for_payload_exit "$current_pid" 50 || return 1
    fi
    current_pid=""
  }

  on_term() {
    trap '' TERM INT
    cleanup_payload || true
    [ -n "$watchdog" ] && kill "$watchdog" 2>/dev/null || true
    if [ -f "$timeout_marker" ]; then
      finish_child 124
      exit 124
    fi
    finish_child 143
    exit 143
  }
  trap on_term TERM INT

  printf 'verify:async: started_at=%s pid=%s timeout=%ss\n' "$(state_get "$state" started_at || printf '')" "$expected_pid" "$timeout"
  printf 'verify:async: command=%s\n' "$command"

  local lock_start waited exec_timeout
  exec 8<>"$lock"
  lock_start=$(date +%s)
  if ! flock -w "$timeout" 8; then
    printf 'verify:async: failed to acquire %s within %ss\n' "$lock" "$timeout" >&2
    finish_child 2
    exit 2
  fi
  waited=$(( $(date +%s) - lock_start ))
  exec_timeout=$((timeout - waited))
  if [ "$exec_timeout" -le 0 ]; then
    printf 'verify:async: no execution budget remains after waiting %ss for %s\n' "$waited" "$lock" >&2
    finish_child 124
    exit 124
  fi
  {
    printf 'PID=%s LABEL=verify:async STARTED=%s\n' "$expected_pid" "$(iso_now)"
    printf 'COMMAND=%s\n' "$command"
  } > "$lock"
  printf 'verify:async: acquired %s after %ss; execution timeout=%ss\n' "$lock" "$waited" "$exec_timeout"

  (
    exec 8<&-
    env -u MUSI_VERIFY_TIMEOUT \
      MUSI_VERIFY_LOCK_ALREADY_HELD=1 \
      MUSI_INTERACTIVE_TIMEOUT="$exec_timeout" \
      MUSI_VERIFY_LOCK="$lock" \
      MUSI_VERIFY_LOG_DIR="$log_dir/verify" \
      MUSI_VERIFY_MARKER_CHANGED="$(dirname "$state")/markers/verify-changed-last" \
      MUSI_VERIFY_MARKER_FULL="$(dirname "$state")/markers/verify-last" \
      "$@"
  ) &
  current_pid=$!

  (
    exec 8<&-
    sleep_pid=""
    trap '[ -n "$sleep_pid" ] && kill "$sleep_pid" 2>/dev/null; exit 0' TERM INT
    sleep "$exec_timeout" &
    sleep_pid=$!
    wait "$sleep_pid"
    printf 'verify:async: timed out after %ss\n' "$exec_timeout" >&2
    : > "$timeout_marker"
    if [ "$run_mode" = "setsid" ]; then
      signal_run_process_group "$expected_pid" TERM
    else
      kill -TERM "$expected_pid" 2>/dev/null || true
    fi
  ) &
  watchdog=$!

  if wait "$current_pid"; then
    exit_code=0
  else
    exit_code=$?
  fi
  current_pid=""
  kill "$watchdog" 2>/dev/null || true
  watchdog=""

  if [ -f "$timeout_marker" ]; then
    finish_child 124
    exit 124
  fi

  finish_child "$exit_code"
  exit "$exit_code"
}

print_status() {
  local short=0
  case "${1:-}" in
    --short) short=1 ;;
    '') ;;
    *) usage; exit 2 ;;
  esac

  mkdir -p "$(runs_dir)"
  [ "$short" -eq 1 ] || gc_old_runs

  local state status pid started_at elapsed head fp exit_code log_dir finished_at
  state=$(latest_state_file)
  if [ -z "$state" ] || [ ! -f "$state" ]; then
    [ "$short" -eq 1 ] && return 1
    printf 'status: none\n'
    printf 'state_dir: %s\n' "$(state_dir)"
    return 0
  fi
  refresh_dead_state "$state" || true

  status=$(state_status "$state")
  pid=$(state_get "$state" pid || printf '')
  started_at=$(state_get "$state" started_at || printf '')
  elapsed=$(elapsed_seconds "$state")
  head=$(state_get "$state" head || printf '')
  fp=$(state_get "$state" worktree_fingerprint || printf '')
  exit_code=$(state_get "$state" exit_code || printf '')
  log_dir=$(state_get "$state" log_dir || printf '')
  finished_at=$(state_get "$state" finished_at || printf '')

  if [ "$short" -eq 1 ]; then
    printf 'async verify %s (PID %s, elapsed %ss' "$status" "$pid" "$elapsed"
    [ -n "$exit_code" ] && printf ', exit %s' "$exit_code"
    printf '). Log: %s\n' "$log_dir/async.log"
    return 0
  fi

  printf 'status: %s\n' "$status"
  printf 'pid: %s\n' "$pid"
  printf 'command: %s\n' "$(state_get "$state" command || printf '')"
  printf 'started_at: %s\n' "$started_at"
  printf 'elapsed: %ss\n' "$elapsed"
  printf 'head: %s\n' "$head"
  printf 'worktree_fingerprint: %s\n' "$fp"
  printf 'exit_code: %s\n' "$exit_code"
  printf 'finished_at: %s\n' "$finished_at"
  printf 'log_dir: %s\n' "$log_dir"
  printf 'state_dir: %s\n' "$(state_dir)"
}

tail_latest() {
  local lines="$TAIL_LINES"
  if [ "${1:-}" = "-n" ]; then
    lines="${2:-}"
    is_integer "$lines" && [ "$lines" -gt 0 ] || { usage; exit 2; }
    shift 2
  fi
  [ "$#" -eq 0 ] || { usage; exit 2; }

  local state log_dir log
  state=$(latest_state_file)
  if [ -z "$state" ] || [ ! -f "$state" ]; then
    printf 'verify:async: no async run state found\n' >&2
    exit 1
  fi
  log_dir=$(state_get "$state" log_dir || printf '')
  log="$log_dir/async.log"
  if [ ! -f "$log" ]; then
    printf 'verify:async: log not ready yet: %s\n' "$log" >&2
    exit 1
  fi
  tail -n "$lines" "$log"
}

stop_latest() {
  local state pid status
  state=$(latest_state_file)
  if [ -z "$state" ] || [ ! -f "$state" ]; then
    printf 'verify:async: no async run state found\n'
    return 0
  fi
  refresh_dead_state "$state" || true
  status=$(state_status "$state")
  pid=$(state_get "$state" pid || printf '')
  if [ "$status" != "running" ]; then
    printf 'verify:async: no running async job (latest status: %s)\n' "$status"
    return 0
  fi
  signal_run_process_group "$pid" TERM
  for _ in $(seq 1 30); do
    if [ -n "$(state_get "$state" exit_code || printf '')" ]; then
      printf 'verify:async: stopped PID %s\n' "$pid"
      return 0
    fi
    if ! pid_alive "$pid"; then
      printf 'verify:async: stopped PID %s\n' "$pid"
      return 0
    fi
    sleep 0.1
  done
  signal_run_process_group "$pid" KILL
  update_finished_state "$state" 137 "$(date +%s)" "$(iso_now)"
  printf 'verify:async: stopped PID %s with SIGKILL\n' "$pid"
}

case "${1:-}" in
  start)
    shift
    start_run "$@"
    ;;
  status)
    shift
    print_status "$@"
    ;;
  tail)
    shift
    tail_latest "$@"
    ;;
  stop)
    shift
    [ "$#" -eq 0 ] || { usage; exit 2; }
    stop_latest
    ;;
  __run)
    shift
    [ "$#" -ge 6 ] || exit 2
    state="$1"; timeout="$2"; lock="$3"; run_mode="$4"; sep="$5"
    [ "$sep" = "--" ] || exit 2
    shift 5
    run_child "$state" "$timeout" "$lock" "$run_mode" -- "$@"
    ;;
  *)
    usage
    exit 2
    ;;
esac
