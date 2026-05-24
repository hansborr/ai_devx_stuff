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
