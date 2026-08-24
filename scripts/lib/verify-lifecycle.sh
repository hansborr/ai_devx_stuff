#!/usr/bin/env bash
# Process lifecycle and cleanup for the shared verification engine.
#
# Owns watchdog creation, timeout reporting, runtime activation and signal
# traps, exit dispatch, child-process cleanup, starting-load reporting, and the
# mutable state those lifecycle paths coordinate.
#
# Source order: after scripts/lib/verify-evidence-transaction.sh. This leaf
# resolves evidence, metadata, process-tree, provider, and trace helpers at
# invocation time. Consumers must source scripts/lib/verify-engine.sh, which
# re-exports the complete engine API.

MUSI_VERIFY_EXIT_DISPATCHER_INSTALLED=0
MUSI_VERIFY_EXIT_DISPATCHED=0
MUSI_VERIFY_EXIT_HOOK=""
MUSI_VERIFY_GATE_ACTIVE=0
MUSI_VERIFY_GATE_CLEANED=0
MUSI_VERIFY_GATE_CLEANUP_IN_PROGRESS=0
MUSI_VERIFY_GATE_WATCHDOG_PID=""
MUSI_VERIFY_GATE_CURRENT_PID=""
MUSI_VERIFY_GATE_PARALLEL_PIDS=()
MUSI_VERIFY_GATE_STARTING_LOAD_SAMPLE=""
MUSI_VERIFY_GATE_STARTING_LOAD_PRINTED=0

# --- Watchdog --------------------------------------------------------------
# Start a background budget watchdog that TERMs the given hook PID after
# `timeout` seconds and prints a labeled banner to stderr. Sets
# MUSI_VERIFY_WATCHDOG_PID to the watchdog job PID so the caller can kill it on
# cleanup/exit. Closes FDs 8 and 9 in the watchdog subshell so its `sleep` child
# never inherits either flock: a killed watchdog must not orphan a lock holder.
# FD 8 is the pre-commit commit-queue lock; verify.sh never opens it, so closing
# it there is a harmless no-op.
#
# Optional 4th arg `on_timeout`: the name of a shell function/command run when
# the budget expires. When given it fully owns the on-timeout tail (its own
# banner plus whatever termination it needs) and the default banner + `kill
# -TERM "$hook_pid"` are skipped; verify:async uses it to keep its distinct
# banner and inject the timeout-marker touch and mode-aware process-group signal.
# The watchdog subshell is a fork of the caller, so the callback sees the
# caller's functions and locals (bash dynamic scope) — no arguments are passed.
musi_verify_start_watchdog() {
  local banner_label="$1" timeout="$2" hook_pid="$3" on_timeout="${4:-}"
  (
    exec 9<&-
    exec 8<&-
    local sleep_pid=""
    trap '[ -n "$sleep_pid" ] && kill "$sleep_pid" 2>/dev/null; exit 0' TERM INT
    sleep "$timeout" &
    sleep_pid=$!
    wait "$sleep_pid"
    if [ -n "$on_timeout" ]; then
      "$on_timeout"
    else
      printf '\n=== %s TIMED OUT (%ds) ===\n' "$banner_label" "$timeout" >&2
      kill -TERM "$hook_pid" 2>/dev/null
    fi
  ) &
  # shellcheck disable=SC2034 # Read by the caller (verify.sh / pre-commit) to kill the watchdog.
  MUSI_VERIFY_WATCHDOG_PID=$!
}

# --- Timeout-budget report -------------------------------------------------
# Printed to stderr on the TERM path (watchdog fired or external kill).
musi_verify_report_timeout_budget() {
  local log_dir="$1"
  printf 'Timed out and stopped the verification process tree.\n' >&2
  printf 'For deliberate long verification, use bun run verify:async[:changed] and check bun run verify:async:status.\n' >&2
  printf 'logs: %s\n' "$log_dir" >&2
  printf 'inspect: bun run verify:logs budget\n' >&2
}

musi_verify_print_starting_load() {
  [ "$MUSI_VERIFY_GATE_STARTING_LOAD_PRINTED" -eq 0 ] || return 0
  [ -n "$MUSI_VERIFY_GATE_STARTING_LOAD_SAMPLE" ] || return 0
  MUSI_VERIFY_GATE_STARTING_LOAD_PRINTED=1
  printf '\n%s\n' "$MUSI_VERIFY_GATE_STARTING_LOAD_SAMPLE"
}

musi_verify_cleanup_gate() {
  [ "$MUSI_VERIFY_GATE_CLEANED" -eq 0 ] || return 0
  [ "$MUSI_VERIFY_GATE_CLEANUP_IN_PROGRESS" -eq 0 ] || return 0
  MUSI_VERIFY_GATE_CLEANUP_IN_PROGRESS=1

  if [ -n "$MUSI_VERIFY_GATE_CURRENT_PID" ]; then
    musi_terminate_process_tree "$MUSI_VERIFY_GATE_CURRENT_PID"
    musi_wait_for_pid_exit_bounded "$MUSI_VERIFY_GATE_CURRENT_PID" || true
    MUSI_VERIFY_GATE_CURRENT_PID=""
  fi
  local pid
  for pid in ${MUSI_VERIFY_GATE_PARALLEL_PIDS[@]+"${MUSI_VERIFY_GATE_PARALLEL_PIDS[@]}"}; do
    [ -n "$pid" ] && musi_terminate_process_tree "$pid"
  done
  for pid in ${MUSI_VERIFY_GATE_PARALLEL_PIDS[@]+"${MUSI_VERIFY_GATE_PARALLEL_PIDS[@]}"}; do
    [ -n "$pid" ] && musi_wait_for_pid_exit_bounded "$pid" || true
  done
  MUSI_VERIFY_GATE_PARALLEL_PIDS=()
  [ -z "$MUSI_VERIFY_GATE_WATCHDOG_PID" ] \
    || kill "$MUSI_VERIFY_GATE_WATCHDOG_PID" 2>/dev/null \
    || true
  MUSI_VERIFY_GATE_WATCHDOG_PID=""
  if [ -n "$MUSI_VERIFY_GATE_LIVE_EVIDENCE_BACKUP" ]; then
    if ! musi_verify_gate_restore_live_evidence_dir "$MUSI_VERIFY_GATE_LIVE_EVIDENCE_LOG_DIR"; then
      printf 'verify engine: failed to restore prior verification evidence in %s\n' \
        "$MUSI_VERIFY_GATE_LIVE_EVIDENCE_LOG_DIR" >&2
      MUSI_VERIFY_GATE_CLEANUP_IN_PROGRESS=0
      return 2
    fi
  fi
  MUSI_VERIFY_GATE_CLEANED=1
  MUSI_VERIFY_GATE_CLEANUP_IN_PROGRESS=0
  musi_verify_gate_trace_event cleanup
}

musi_verify_dispatch_exit() {
  local exit_code="$1"
  trap - EXIT
  if [ "$MUSI_VERIFY_GATE_ACTIVE" -eq 1 ]; then
    if ! musi_verify_cleanup_gate; then
      # Keep restoration retryable and give transient filesystem failures one
      # bounded second attempt on every process-exit path.
      musi_verify_cleanup_gate || true
    fi
  fi
  if [ "$exit_code" -ne 0 ] && [ "$MUSI_VERIFY_GATE_ACTIVE" -eq 1 ]; then
    musi_verify_print_starting_load
  fi
  if [ "$MUSI_VERIFY_EXIT_DISPATCHED" -eq 0 ]; then
    MUSI_VERIFY_EXIT_DISPATCHED=1
    if [ -n "$MUSI_VERIFY_EXIT_HOOK" ]; then
      "$MUSI_VERIFY_EXIT_HOOK" "$exit_code" || true
    fi
    musi_verify_gate_trace_event exit
  fi
  return "$exit_code"
}

# Pre-commit installs this before advisories and source preflight so its
# provenance callback also covers exits that happen before musi_verify_run_gate.
# Reinstalling with the same callback is idempotent; changing ownership fails.
musi_verify_install_exit_dispatcher() {
  local exit_hook="${1:-}"
  if [ -n "$exit_hook" ] && ! declare -F "$exit_hook" >/dev/null 2>&1; then
    printf 'verify engine: exit hook is not defined: %s\n' "$exit_hook" >&2
    return 2
  fi
  if [ "$MUSI_VERIFY_EXIT_DISPATCHER_INSTALLED" -eq 1 ]; then
    if [ "$MUSI_VERIFY_EXIT_HOOK" != "$exit_hook" ]; then
      printf 'verify engine: EXIT dispatcher already has a different owner\n' >&2
      return 2
    fi
    return 0
  fi
  MUSI_VERIFY_EXIT_HOOK="$exit_hook"
  MUSI_VERIFY_EXIT_DISPATCHER_INSTALLED=1
  MUSI_VERIFY_EXIT_DISPATCHED=0
  trap 'musi_verify_dispatch_exit "$?"' EXIT
}

musi_verify_gate_handle_signal() {
  local exit_code="$1"
  # A different signal may interrupt the active handler while its evidence
  # swap is between the live-tree move and state commit. The outer handler
  # owns cleanup and the eventual exit status; nested handlers resume it.
  [ "$MUSI_VERIFY_GATE_CLEANUP_IN_PROGRESS" -eq 0 ] || return 0
  if ! musi_verify_cleanup_gate; then
    # EXIT dispatch owns the bounded retry. Never write signal metadata onto
    # a tree whose prior evidence has not been restored successfully.
    musi_verify_print_starting_load >&2
    exit "$exit_code"
  fi
  if [ "$MUSI_VERIFY_GATE_PRIOR_EVIDENCE_RESTORED" -ne 1 ]; then
    musi_verify_write_signal_meta "$exit_code" "$MUSI_VERIFY_GATE_META_DIR" \
      "$MUSI_VERIFY_GATE_SIGNAL_MODE" "${MUSI_VERIFY_GATE_START_TS:-}" \
      "${MUSI_VERIFY_GATE_START_TIME:-}" "$MUSI_VERIFY_GATE_WRAPPER_COMMAND" \
      "$MUSI_VERIFY_GATE_RUN_HEAD" "$MUSI_VERIFY_GATE_RUN_FINGERPRINT" \
      "$MUSI_VERIFY_GATE_LOG_DIR" "$MUSI_VERIFY_GATE_HISTORY_DIR"
  fi
  musi_verify_print_starting_load >&2
  if [ "$exit_code" -eq 124 ]; then
    musi_verify_report_timeout_budget "$MUSI_VERIFY_GATE_LOG_DIR"
  fi
  exit "$exit_code"
}

musi_verify_gate_activate_runtime() {
  local policy_name="$1"
  local -n policy_ref="$policy_name"
  local starting_load starting_cores
  MUSI_VERIFY_GATE_STARTING_LOAD_SAMPLE=""
  MUSI_VERIFY_GATE_STARTING_LOAD_PRINTED=0
  MUSI_VERIFY_GATE_RUN_HEAD=$(musi_verify_gate_capture_provider run-head "${policy_ref[run_head_provider]}") || return 2
  MUSI_VERIFY_GATE_RUN_FINGERPRINT=$(musi_verify_gate_capture_provider run-fingerprint "${policy_ref[run_fingerprint_provider]}") || return 2
  MUSI_VERIFY_GATE_START_TS=$(date +%s)
  MUSI_VERIFY_GATE_START_TIME=$(date -Iseconds)
  # Diagnostic evidence only: this host-scoped pair never feeds admission,
  # budgets, slot classification, or exit status. Keep awk as the deterministic
  # fixture seam instead of shell read. getconf matches /proc/loadavg's host
  # scope, unlike affinity-scoped nproc.
  starting_load=$(awk 'NR == 1 { print $1; exit }' /proc/loadavg 2>/dev/null) \
    || starting_load=""
  starting_cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null) || starting_cores=""
  if [[ "$starting_load" =~ ^[0-9]+([.][0-9]+)?$ ]] \
     && [[ "$starting_cores" =~ ^[1-9][0-9]*$ ]]; then
    MUSI_VERIFY_GATE_STARTING_LOAD_SAMPLE="starting load was $starting_load on $starting_cores cores"
  fi
  MUSI_VERIFY_GATE_LOG_DIR="${policy_ref[log_dir]}"
  MUSI_VERIFY_GATE_META_DIR="${policy_ref[log_dir]}/meta"
  MUSI_VERIFY_GATE_HISTORY_DIR="${policy_ref[history_dir]}"
  MUSI_VERIFY_GATE_SIGNAL_MODE="${policy_ref[signal_mode]}"
  MUSI_VERIFY_GATE_WRAPPER_COMMAND="${policy_ref[wrapper_command]}"
  MUSI_VERIFY_GATE_CURRENT_PID=""
  MUSI_VERIFY_GATE_PARALLEL_PIDS=()
  MUSI_VERIFY_GATE_CLEANED=0
  MUSI_VERIFY_GATE_CLEANUP_IN_PROGRESS=0
  MUSI_VERIFY_GATE_ACTIVE=1
  musi_verify_gate_trace_event timestamp

  trap 'musi_verify_gate_handle_signal 130' INT
  trap 'musi_verify_gate_handle_signal 124' TERM
  musi_verify_gate_trace_event traps
  musi_verify_start_watchdog "${policy_ref[banner_label]}" \
    "$MUSI_VERIFY_GATE_EXEC_TIMEOUT" "$$"
  MUSI_VERIFY_GATE_WATCHDOG_PID="$MUSI_VERIFY_WATCHDOG_PID"
  musi_verify_gate_trace_event watchdog
}
