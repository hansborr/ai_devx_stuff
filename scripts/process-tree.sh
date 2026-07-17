#!/bin/bash
# process-tree.sh — shared process-tree signal helpers.
#
# Sourced by verify.sh, .husky/pre-commit, and verify-async.sh to ensure
# timeout cleanup kills the full child process tree, not just the wrapper PID.
#
# POSIX-compatible: pre-commit can be invoked via sh.

musi_is_integer() {
  case "${1:-}" in
    [0-9]|[0-9]*[0-9]) ;;
    -[0-9]|-[0-9]*[0-9]) ;;
    *) return 1 ;;
  esac
  case "${1#-}" in
    *[!0-9]*) return 1 ;;
  esac
  return 0
}

musi_child_pids() {
  local pid="$1"
  musi_is_integer "$pid" || return 0
  [ "$pid" -gt 0 ] || return 0
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -P "$pid" 2>/dev/null || true
    return 0
  fi
  ps -o pid= --ppid "$pid" 2>/dev/null | awk '{print $1}' || true
}

musi_process_is_running() {
  local pid="$1"
  musi_is_integer "$pid" || return 1
  [ "$pid" -gt 0 ] || return 1
  kill -0 "$pid" 2>/dev/null
}

musi_process_group_is_running() {
  local pgid="$1"
  musi_is_integer "$pgid" || return 1
  [ "$pgid" -gt 0 ] || return 1
  kill -0 -- "-$pgid" 2>/dev/null
}

# Run a payload in a process group distinct from the verification wrapper so a
# later group signal reaches descendants forked from signal handlers. setsid is
# preferred; Bash job control provides the same isolation on hosts without it.
musi_run_in_isolated_process_group() {
  if command -v setsid >/dev/null 2>&1; then
    setsid --wait "$@"
    return $?
  fi

  (
    local child status
    set -m
    "$@" &
    child=$!
    status=0
    wait "$child" || status=$?
    set +m
    exit "$status"
  )
}

musi_signal_process_tree() {
  local pid="$1" signal="${2:-TERM}" child
  musi_is_integer "$pid" || return 0
  [ "$pid" -gt 0 ] || return 0
  musi_child_pids "$pid" | while IFS= read -r child; do
    [ -n "$child" ] || continue
    musi_signal_process_tree "$child" "$signal"
  done
  kill "-$signal" "$pid" 2>/dev/null || true
}

musi_process_tree_pids() {
  local pid="$1" child
  musi_is_integer "$pid" || return 0
  [ "$pid" -gt 0 ] || return 0
  musi_child_pids "$pid" | while IFS= read -r child; do
    [ -n "$child" ] || continue
    musi_process_tree_pids "$child"
  done
  printf '%s\n' "$pid"
}

musi_process_needs_signal() {
  local pid="$1" state
  musi_process_is_running "$pid" || return 1
  state=$(ps -o stat= -p "$pid" 2>/dev/null | awk 'NR == 1 { print $1 }')
  case "$state" in
    Z*) return 1 ;;
  esac
  return 0
}

# Reap a terminated direct child only after it stops running. A process stuck
# in uninterruptible sleep can survive SIGKILL, so never enter an unbounded
# builtin wait while it still needs a signal.
musi_wait_for_pid_exit_bounded() {
  local pid="$1" attempts="${MUSI_PROCESS_TREE_KILL_WAIT_TENTHS:-50}"
  local elapsed=0

  musi_is_integer "$pid" || return 1
  [ "$pid" -gt 0 ] || return 1
  musi_is_integer "$attempts" || attempts=50
  [ "$attempts" -ge 0 ] || attempts=50

  while [ "$elapsed" -lt "$attempts" ]; do
    if ! musi_process_needs_signal "$pid"; then
      wait "$pid" 2>/dev/null || true
      return 0
    fi
    sleep 0.1 || true
    elapsed=$((elapsed + 1))
  done
  if ! musi_process_needs_signal "$pid"; then
    wait "$pid" 2>/dev/null || true
    return 0
  fi
  return 1
}

musi_process_group_id() {
  local pid="$1"
  musi_is_integer "$pid" || return 1
  [ "$pid" -gt 0 ] || return 1
  ps -o pgid= -p "$pid" 2>/dev/null | awk 'NR == 1 { print $1 }'
}

musi_isolated_process_groups_for_pids() {
  local pids="$1" own_pgid target pgid seen=""
  own_pgid=$(musi_process_group_id "$$") || own_pgid=""
  for target in $pids; do
    pgid=$(musi_process_group_id "$target") || continue
    [ -n "$pgid" ] || continue
    [ "$pgid" != "$own_pgid" ] || continue
    case " $seen " in
      *" $pgid "*) continue ;;
    esac
    seen="$seen $pgid"
    printf '%s\n' "$pgid"
  done
}

musi_group_list_contains() {
  local groups="$1" candidate="$2" group
  for group in $groups; do
    [ "$group" = "$candidate" ] && return 0
  done
  return 1
}

musi_signal_process_snapshot() {
  local pids="$1" groups="$2" signal="$3" group target pgid
  for group in $groups; do
    musi_signal_process_group "$group" "$signal"
  done
  for target in $pids; do
    pgid=$(musi_process_group_id "$target") || pgid=""
    if [ -n "$pgid" ] && musi_group_list_contains "$groups" "$pgid"; then
      continue
    fi
    if [ "$signal" = KILL ] && ! musi_process_needs_signal "$target"; then
      continue
    fi
    kill "-$signal" "$target" 2>/dev/null || true
  done
}

# Snapshot descendants and their isolated process groups before TERM. Group
# signaling covers descendants forked during a TERM handler, while a second
# tree collection catches late children on platforms without setsid. The caller
# still owns wait/reaping for its direct child.
musi_terminate_process_tree() {
  local pid="$1" grace_tenths="${MUSI_PROCESS_TREE_TERM_GRACE_TENTHS:-10}"
  local pids groups late_pids late_groups all_pids all_groups
  local target group elapsed any_running

  musi_is_integer "$pid" || return 0
  [ "$pid" -gt 0 ] || return 0
  musi_is_integer "$grace_tenths" || grace_tenths=10
  [ "$grace_tenths" -ge 0 ] || grace_tenths=10

  pids=$(musi_process_tree_pids "$pid")
  [ -n "$pids" ] || return 0
  groups=$(musi_isolated_process_groups_for_pids "$pids")
  musi_signal_process_snapshot "$pids" "$groups" TERM

  elapsed=0
  while [ "$elapsed" -lt "$grace_tenths" ]; do
    any_running=0
    for target in $pids; do
      if musi_process_needs_signal "$target"; then
        any_running=1
        break
      fi
    done
    if [ "$any_running" -eq 0 ]; then
      for group in $groups; do
        if musi_process_group_is_running "$group"; then
          any_running=1
          break
        fi
      done
    fi
    [ "$any_running" -eq 1 ] || break
    sleep 0.1 || true
    elapsed=$((elapsed + 1))
  done

  late_pids=$(musi_process_tree_pids "$pid")
  late_groups=$(musi_isolated_process_groups_for_pids "$late_pids")
  all_pids="$pids
$late_pids"
  all_groups="$groups
$late_groups"
  musi_signal_process_snapshot "$all_pids" "$all_groups" KILL
  return 0
}

musi_signal_process_group() {
  local pgid="$1" signal="${2:-TERM}"
  musi_is_integer "$pgid" || return 0
  [ "$pgid" -gt 0 ] || return 0
  kill "-$signal" -- "-$pgid" 2>/dev/null || true
}
