#!/usr/bin/env bash
# Commit-queue waiter tickets: the per-lane files parked beside a shared
# commit-queue lock so a waiting lane can report how many peers are queued
# ahead of it, and so an abandoned wait self-heals for the next lane.
#
# Owns: musi_commit_queue_waiter_dir, musi_register_commit_queue_waiter,
# musi_remove_commit_queue_waiter, musi_count_commit_queue_waiters.
# Does NOT own the lock path itself (musi_standard_commit_queue_lock) — the
# waiter dir is derived from whatever lock path the caller passes in, so the
# MUSI_COMMIT_QUEUE_LOCK test seam carries its waiters with it.
#
# Source order: none — this leaf calls nothing outside itself. Leaf libs never
# source each other; scripts/lib/verify-metadata.sh is the sole public entry
# point and owns the ordering. Consumers keep sourcing that aggregator.
#
# Standing invariant: function definitions only, no source-time side effects
# (the re-source guard below is the sole exception).

if [ -n "${__MUSI_VERIFY_COMMIT_QUEUE_SOURCED:-}" ]; then
  return 0
fi
__MUSI_VERIFY_COMMIT_QUEUE_SOURCED=1

# Directory of waiter tickets parked on a shared commit-queue lock. Keyed off the
# lock path itself (not the repo root) so an MUSI_COMMIT_QUEUE_LOCK override — the
# test seam and any bespoke lock — carries its waiters alongside it.
musi_commit_queue_waiter_dir() {
  local queue_lock="$1"

  printf '%s.waiters' "$queue_lock"
}

# Register this lane's waiter ticket: one file named by PID, recording the target
# worktree and the start epoch. Peers read it to report queue depth; the epoch
# lets them expire an abandoned ticket. Best-effort — a failed registration only
# costs an under-count in someone's heartbeat, never correctness.
musi_register_commit_queue_waiter() {
  local waiter_dir="$1"
  local pid="$2"
  local worktree="$3"

  mkdir -p "$waiter_dir" 2>/dev/null || return 1
  printf 'PID=%s WORKTREE=%s STARTED=%s\n' "$pid" "$worktree" "$(date +%s)" \
    > "$waiter_dir/$pid" 2>/dev/null || return 1
}

musi_remove_commit_queue_waiter() {
  local waiter_dir="$1"
  local pid="$2"

  rm -f "$waiter_dir/$pid" 2>/dev/null || true
}

# Prune dead/expired tickets from a waiter dir and print the count of live
# waiters other than self_pid. A ticket is dead when its owner PID is gone (the
# SIGKILLed-lane case — the lane could not run its own cleanup) or when it is
# older than max_age (a backstop so a reused PID cannot keep a ghost ticket alive
# forever). Pruning on read means an abandoned wait self-heals for the next lane.
#
# NOTE: the 3600s max_age default is a different semantic from the gate timing
# budgets (a reused-PID ghost-ticket bound, not verify freshness) and is
# intentionally *not* one of the MUSI_GATE_* constants.
musi_count_commit_queue_waiters() {
  local waiter_dir="$1"
  local self_pid="$2"
  local max_age="${3:-3600}"
  local now count ticket pid started age

  [ -d "$waiter_dir" ] || { printf '0'; return 0; }
  now=$(date +%s)
  count=0
  for ticket in "$waiter_dir"/*; do
    [ -e "$ticket" ] || continue
    pid=$(basename "$ticket")
    case "$pid" in
      ''|*[!0-9]*) rm -f "$ticket" 2>/dev/null; continue ;;
    esac
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$ticket" 2>/dev/null
      continue
    fi
    started=$(sed -n 's/.*STARTED=\([0-9][0-9]*\).*/\1/p' "$ticket" 2>/dev/null)
    case "$started" in
      ''|*[!0-9]*) : ;;
      *)
        age=$((now - started))
        if [ "$age" -gt "$max_age" ]; then
          rm -f "$ticket" 2>/dev/null
          continue
        fi
        ;;
    esac
    [ "$pid" = "$self_pid" ] && continue
    count=$((count + 1))
  done
  printf '%s' "$count"
}
