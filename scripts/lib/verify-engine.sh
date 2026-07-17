#!/bin/bash
# Shared verify engine for scripts/verify.sh and .husky/pre-commit.
#
# Both runners bound a parallel/sequential gate with the same load-bearing
# machinery: a budget watchdog, a timeout-budget report, run-metadata writes on
# signal/failure/success, the failure summary with lint/format repair hints, and
# the success marker + soft-budget warning. That machinery used to be hand-copied
# between the two highest-churn files and drifted independently. It lives here
# once now, parameterized by consumer so behavior stays byte-for-byte identical:
# same markers, same signals, same summaries.
#
# These functions define behavior only; they resolve the metadata/marker/excerpt
# helpers (musi_write_wrapper_meta, musi_combine_run_meta,
# musi_persist_run_meta_history, musi_write_success_marker,
# ai_ratchet_failure_excerpt, ai_filtered_task_log_excerpt) at call time, so a
# consumer must source scripts/lib/verify-metadata.sh and the output-filter
# helpers before invoking them.

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

# --- Run-metadata persistence ----------------------------------------------
# Write the wrapper fragment, combine the run-meta.json, and persist history.
# Load-bearing: land.sh provenance re-stamp and the pre-push freshness window
# both read this metadata.
musi_verify_persist_run_meta() {
  local meta_dir="$1" meta_mode="$2" start_ts="$3" start_time="$4" end_ts="$5" \
    end_time="$6" exit_code="$7" wrapper_command="$8" head="$9" hash="${10}" \
    log_dir="${11}" history_dir="${12}"
  musi_write_wrapper_meta "$meta_dir/wrapper.json" "$meta_mode" \
    "$start_ts" "$start_time" "$end_ts" "$end_time" "$exit_code" "$wrapper_command" \
    "$head" "$hash"
  musi_combine_run_meta "$log_dir" "$meta_mode" "$meta_dir/wrapper.json"
  musi_persist_run_meta_history "$log_dir" "$history_dir"
}

# Persist run metadata from a signal handler, stamping the current time as the
# end and falling back to it for a start that a very early signal may predate.
musi_verify_write_signal_meta() {
  local exit_code="$1" meta_dir="$2" meta_mode="$3" start_ts="$4" start_time="$5" \
    wrapper_command="$6" head="$7" hash="$8" log_dir="$9" history_dir="${10}"
  local end_ts end_time
  end_ts=$(date +%s)
  end_time=$(date -Iseconds)
  musi_verify_persist_run_meta "$meta_dir" "$meta_mode" \
    "${start_ts:-$end_ts}" "${start_time:-$end_time}" "$end_ts" "$end_time" \
    "$exit_code" "$wrapper_command" "$head" "$hash" "$log_dir" "$history_dir"
}

# --- Failure summary -------------------------------------------------------
# Print the FAILED banner, Passed/Failed lines, per-task log excerpts (ratchet
# gets its diagnostics excerpt), and the lint/format repair hints. The caller
# still owns the failure run-metadata write and the exit.
musi_verify_print_failure_summary() {
  local banner_label="$1" elapsed="$2" log_dir="$3" passed="$4" failed="$5"
  local task
  printf '\n=== %s FAILED (%ds) ===\n' "$banner_label" "$elapsed"
  printf 'Passed:%s\n' "$passed"
  printf 'Failed:%s\n' "$failed"
  for task in $failed; do
    printf '\n--- %s (full log: %s/%s.log) ---\n' "$task" "$log_dir" "$task"
    if [ "$task" = ratchet ]; then
      ai_ratchet_failure_excerpt "$log_dir/ratchet-diagnostics.json" "$log_dir/${task}.log" 30
    else
      ai_filtered_task_log_excerpt "$task" "$log_dir/${task}.log" 30
    fi
  done
  case "$failed" in
    *lint*) printf "\nHint: try 'bun run lint:fix' to auto-fix formatting issues.\n" ;;
  esac
  case "$failed" in
    *format-check*) printf "\nHint: run 'bun run format:changed' to apply Prettier to changed files, or 'bun run format' for the full tree.\n" ;;
  esac
}

# --- Success finalization --------------------------------------------------
# Write the success marker (warning if that fails), emit the soft-budget warning
# when elapsed exceeds the warn threshold, and print the OK line.
musi_verify_finalize_success() {
  local banner_label="$1" marker="$2" head="$3" hash="$4" elapsed="$5" \
    warn_after="$6" hard_timeout="$7" passed="$8"
  if ! musi_write_success_marker "$marker" "$head" "$hash"; then
    printf '%s: WARN: failed to write marker %s\n' "$banner_label" "$marker" >&2
  fi
  if [ "$elapsed" -gt "$warn_after" ]; then
    printf '%s: WARN: elapsed=%ds exceeds soft budget %ds (hard=%ds). Inspect: bun run verify:logs budget\n' \
      "$banner_label" "$elapsed" "$warn_after" "$hard_timeout" >&2
  fi
  printf '%s: OK (%ds) —%s\n' "$banner_label" "$elapsed" "$passed"
}
