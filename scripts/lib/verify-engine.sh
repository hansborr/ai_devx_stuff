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
# gets its diagnostics excerpt), the lint/format repair hints, and a one-line
# failure-logs footer. The footer is deliberately the summary's LAST line: the
# per-slot log pointers above are section HEADERS, so a truncated capture
# (`... 2>&1 | tail -N`) would otherwise keep only boilerplate and lose the
# breadcrumb. Its wipe warning is folded in so `tail -1` still carries the
# path; test-timings.json is named only when it exists (early failures may not
# write it). The caller still owns the failure run-metadata write and the exit.
musi_verify_print_failure_summary() {
  local banner_label="$1" elapsed="$2" log_dir="$3" passed="$4" failed="$5"
  local task timings_note=""
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
  if [ -e "$log_dir/test-timings.json" ]; then
    timings_note=", test-timings.json"
  fi
  printf '\nverify: failure logs: %s (per-slot <slot>.log%s; wiped by the next verify/pre-commit run — read or copy first)\n' \
    "$log_dir" "$timings_note"
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

# --- Gate lifecycle --------------------------------------------------------
# Policy adapters pass an associative array by name. The engine owns mechanics;
# callers retain preflight policy, identity providers, and small callbacks.

MUSI_VERIFY_EXIT_DISPATCHER_INSTALLED=0
MUSI_VERIFY_EXIT_DISPATCHED=0
MUSI_VERIFY_EXIT_HOOK=""
MUSI_VERIFY_GATE_ACTIVE=0
MUSI_VERIFY_GATE_CLEANED=0
MUSI_VERIFY_GATE_WATCHDOG_PID=""
MUSI_VERIFY_GATE_CURRENT_PID=""
MUSI_VERIFY_GATE_PARALLEL_PIDS=()

musi_verify_gate_trace_event() {
  if declare -F musi_verify_gate_trace >/dev/null 2>&1; then
    musi_verify_gate_trace "$1"
  fi
}

musi_verify_cleanup_gate() {
  [ "$MUSI_VERIFY_GATE_CLEANED" -eq 0 ] || return 0
  MUSI_VERIFY_GATE_CLEANED=1

  if [ -n "$MUSI_VERIFY_GATE_CURRENT_PID" ]; then
    musi_terminate_process_tree "$MUSI_VERIFY_GATE_CURRENT_PID"
    musi_wait_for_pid_exit_bounded "$MUSI_VERIFY_GATE_CURRENT_PID" || true
  fi
  local pid
  for pid in ${MUSI_VERIFY_GATE_PARALLEL_PIDS[@]+"${MUSI_VERIFY_GATE_PARALLEL_PIDS[@]}"}; do
    [ -n "$pid" ] && musi_terminate_process_tree "$pid"
  done
  for pid in ${MUSI_VERIFY_GATE_PARALLEL_PIDS[@]+"${MUSI_VERIFY_GATE_PARALLEL_PIDS[@]}"}; do
    [ -n "$pid" ] && musi_wait_for_pid_exit_bounded "$pid" || true
  done
  [ -z "$MUSI_VERIFY_GATE_WATCHDOG_PID" ] \
    || kill "$MUSI_VERIFY_GATE_WATCHDOG_PID" 2>/dev/null \
    || true
  musi_verify_gate_trace_event cleanup
}

musi_verify_dispatch_exit() {
  local exit_code="$1"
  trap - EXIT
  if [ "$MUSI_VERIFY_GATE_ACTIVE" -eq 1 ]; then
    musi_verify_cleanup_gate
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

musi_verify_gate_policy_error() {
  printf 'verify engine: invalid gate policy: %s\n' "$1" >&2
  return 2
}

musi_verify_gate_path_absolute() {
  local repo_root="$1" path="$2"
  if command -v realpath >/dev/null 2>&1; then
    if [[ "$path" = /* ]]; then
      realpath -m -- "$path"
    else
      realpath -m -- "${repo_root%/}/$path"
    fi
  elif [[ "$path" = /* ]]; then
    printf '%s\n' "${path%/}"
  else
    printf '%s/%s\n' "${repo_root%/}" "${path%/}"
  fi
}

musi_verify_gate_path_is_at_or_beneath() {
  local path="$1" protected_root="$2"
  [ -n "$protected_root" ] || return 1
  [ "$path" = "$protected_root" ] || [[ "$path" = "$protected_root/"* ]]
}

musi_verify_validate_log_target() {
  local repo_root="$1" log_dir="$2" repo_abs log_abs git_dir common_dir
  [ -n "$log_dir" ] || {
    musi_verify_gate_policy_error 'log_dir must not be empty'
    return 2
  }
  [ "$log_dir" != / ] || {
    musi_verify_gate_policy_error 'log_dir must not be /'
    return 2
  }
  repo_abs=$(musi_verify_gate_path_absolute "$repo_root" .) || return 2
  log_abs=$(musi_verify_gate_path_absolute "$repo_root" "$log_dir") || return 2
  [ "$log_abs" != / ] && [ "$log_abs" != "$repo_abs" ] || {
    musi_verify_gate_policy_error "unsafe log_dir target: $log_dir"
    return 2
  }
  git_dir=$(git -C "$repo_root" rev-parse --absolute-git-dir 2>/dev/null || true)
  common_dir=$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
  if [ -n "$git_dir" ]; then
    git_dir=$(musi_verify_gate_path_absolute "$repo_root" "$git_dir") || return 2
  fi
  if [ -n "$common_dir" ]; then
    common_dir=$(musi_verify_gate_path_absolute "$repo_root" "$common_dir") || return 2
  fi
  if [ "$log_abs" = "$repo_abs/.git" ] \
     || musi_verify_gate_path_is_at_or_beneath "$log_abs" "$git_dir" \
     || musi_verify_gate_path_is_at_or_beneath "$log_abs" "$common_dir"; then
    musi_verify_gate_policy_error "log_dir must not target a Git directory: $log_dir"
    return 2
  fi
}

musi_verify_validate_gate_policy() {
  local policy_name="$1" key value
  if ! declare -p "$policy_name" 2>/dev/null | grep -q '^declare -A'; then
    musi_verify_gate_policy_error 'argument must name an associative array'
    return 2
  fi
  local -n policy_ref="$policy_name"
  local allowed=' label banner_label step_label wrapper_command repo_root lock_mode lock_path lock_already_held commit_queue_mode commit_queue_lock commit_queue_already_held commit_queue_timeout total_timeout warn_after marker_path marker_freshness cache_head_provider cache_fingerprint_provider run_head_provider run_fingerprint_provider final_fingerprint_provider marker_head_provider execution_mode consumer steps_array signal_mode failure_mode success_mode_provider log_dir history_dir marker_hit_hook marker_miss_hook bridge_predicate prepare_slots_hook after_slots_hook exit_hook '
  for key in "${!policy_ref[@]}"; do
    case "$allowed" in
      *" $key "*) ;;
      *) musi_verify_gate_policy_error "unknown field $key"; return 2 ;;
    esac
  done
  local required='label banner_label wrapper_command repo_root lock_mode lock_path lock_already_held commit_queue_mode commit_queue_already_held commit_queue_timeout total_timeout warn_after marker_path marker_freshness cache_head_provider cache_fingerprint_provider run_head_provider run_fingerprint_provider final_fingerprint_provider marker_head_provider execution_mode consumer steps_array signal_mode failure_mode success_mode_provider log_dir history_dir prepare_slots_hook'
  for key in $required; do
    value="${policy_ref[$key]:-}"
    [ -n "$value" ] || {
      musi_verify_gate_policy_error "missing field $key"
      return 2
    }
  done
  case "${policy_ref[lock_mode]}" in blocking|nonblocking) ;; *)
    musi_verify_gate_policy_error "unknown lock_mode ${policy_ref[lock_mode]}"; return 2 ;;
  esac
  case "${policy_ref[commit_queue_mode]}" in none|blocking) ;; *)
    musi_verify_gate_policy_error "unknown commit_queue_mode ${policy_ref[commit_queue_mode]}"; return 2 ;;
  esac
  case "${policy_ref[execution_mode]}" in serial|parallel) ;; *)
    musi_verify_gate_policy_error "unknown execution_mode ${policy_ref[execution_mode]}"; return 2 ;;
  esac
  for key in lock_already_held commit_queue_already_held; do
    case "${policy_ref[$key]}" in 0|1) ;; *)
      musi_verify_gate_policy_error "$key must be 0 or 1"; return 2 ;;
    esac
  done
  for key in commit_queue_timeout total_timeout warn_after marker_freshness; do
    case "${policy_ref[$key]}" in ''|*[!0-9]*)
      musi_verify_gate_policy_error "$key must be a whole number"; return 2 ;;
    esac
  done
  if [ "${policy_ref[commit_queue_mode]}" = blocking ] \
     && [ -z "${policy_ref[commit_queue_lock]:-}" ]; then
    musi_verify_gate_policy_error 'commit_queue_lock is required for blocking queue mode'
    return 2
  fi
  for key in cache_head_provider cache_fingerprint_provider run_head_provider \
    run_fingerprint_provider final_fingerprint_provider marker_head_provider \
    success_mode_provider prepare_slots_hook; do
    value="${policy_ref[$key]}"
    declare -F "$value" >/dev/null 2>&1 || {
      musi_verify_gate_policy_error "$key function is not defined: $value"
      return 2
    }
  done
  for key in marker_hit_hook marker_miss_hook bridge_predicate after_slots_hook exit_hook; do
    value="${policy_ref[$key]:-}"
    [ -z "$value" ] || declare -F "$value" >/dev/null 2>&1 || {
      musi_verify_gate_policy_error "$key function is not defined: $value"
      return 2
    }
  done
  musi_verify_validate_log_target "${policy_ref[repo_root]}" "${policy_ref[log_dir]}"
}

musi_verify_gate_capture_provider() {
  local label="$1" provider="$2" value
  if ! value=$("$provider") || [ -z "$value" ]; then
    printf 'verify engine: %s provider failed: %s\n' "$label" "$provider" >&2
    return 2
  fi
  printf '%s\n' "$value"
}

musi_verify_gate_acquire_locks() {
  local policy_name="$1"
  local -n policy_ref="$policy_name"
  local lock_start holder lock_waited=0 queue_start queue_waited=0 queue_wait

  MUSI_VERIFY_GATE_EXEC_TIMEOUT="${policy_ref[total_timeout]}"
  if [ "${policy_ref[lock_already_held]}" != 1 ]; then
    mkdir -p "$(dirname "${policy_ref[lock_path]}")"
    exec 9<>"${policy_ref[lock_path]}"
    if [ "${policy_ref[lock_mode]}" = nonblocking ]; then
      if ! flock -n 9; then
        holder=$(cat "${policy_ref[lock_path]}" 2>/dev/null || true)
        cat >&2 <<EOF
=== ${policy_ref[banner_label]} ALREADY RUNNING ===
${holder:-<holder info unavailable>}

Another pre-commit is in progress. Do NOT re-run git commit — it will
fail here again and waste tokens on repeated polling.

Wait for the in-progress run to finish before retrying git commit. If the
original run failed, its summary is already in the earlier tool output.
EOF
        return 2
      fi
    else
      lock_start=$(date +%s)
      if ! flock -w "${policy_ref[total_timeout]}" 9; then
        holder=$(cat "${policy_ref[lock_path]}" 2>/dev/null || true)
        cat >&2 <<EOF
=== ${policy_ref[label]}: another verification is still running after ${policy_ref[total_timeout]}s ===
${holder:-<holder info unavailable>}

That is long enough to suggest a hang, not the usual queue. Inspect the
holder above before retrying.
EOF
        return 2
      fi
      lock_waited=$(( $(date +%s) - lock_start ))
      MUSI_VERIFY_GATE_EXEC_TIMEOUT=$(( policy_ref[total_timeout] - lock_waited ))
      if [ "$MUSI_VERIFY_GATE_EXEC_TIMEOUT" -le 0 ]; then
        cat >&2 <<EOF
=== ${policy_ref[label]}: no execution budget remains after waiting ${lock_waited}s for ${policy_ref[lock_path]} ===
logs: ${policy_ref[log_dir]}
inspect: bun run verify:logs budget
EOF
        return 124
      fi
      if [ "$lock_waited" -gt 0 ]; then
        printf '%s: waited %ds for %s; execution watchdog budget is %ds (interactive budget %ds)\n' \
          "${policy_ref[label]}" "$lock_waited" "${policy_ref[lock_path]}" \
          "$MUSI_VERIFY_GATE_EXEC_TIMEOUT" "${policy_ref[total_timeout]}" >&2
      fi
    fi
    if [ "${policy_ref[lock_mode]}" = blocking ]; then
      printf 'PID=%s LABEL=%s STARTED=%s\n' "$$" "${policy_ref[label]}" "$(date -Iseconds)" > "${policy_ref[lock_path]}"
    else
      printf 'PID=%s STARTED=%s\n' "$$" "$(date -Iseconds)" > "${policy_ref[lock_path]}"
    fi
  fi

  if [ "${policy_ref[commit_queue_mode]}" = blocking ] \
     && [ "${policy_ref[commit_queue_already_held]}" != 1 ]; then
    queue_wait="${policy_ref[commit_queue_timeout]}"
    [ "$queue_wait" -le "$MUSI_VERIFY_GATE_EXEC_TIMEOUT" ] \
      || queue_wait="$MUSI_VERIFY_GATE_EXEC_TIMEOUT"
    mkdir -p "$(dirname "${policy_ref[commit_queue_lock]}")"
    exec 8<>"${policy_ref[commit_queue_lock]}"
    queue_start=$(date +%s)
    if ! flock -w "$queue_wait" 8; then
      holder=$(cat "${policy_ref[commit_queue_lock]}" 2>/dev/null || true)
      cat >&2 <<EOF
=== COMMIT QUEUE BUSY ===
Waited ${queue_wait}s for the shared commit queue lock:
${policy_ref[commit_queue_lock]}

${holder:-<holder info unavailable>}

Another worktree is already running pre-commit for this repository. Wait for
that commit to finish, inspect the holder if it appears stuck, then retry.
EOF
      return 2
    fi
    queue_waited=$(( $(date +%s) - queue_start ))
    [ "$queue_waited" -le 5 ] \
      || printf '%s: waited %ss for shared commit queue %s\n' \
        "${policy_ref[label]}" "$queue_waited" "${policy_ref[commit_queue_lock]}" >&2
    printf 'PID=%s WORKTREE=%s STARTED=%s\n' "$$" "${policy_ref[repo_root]}" \
      "$(date -Iseconds)" > "${policy_ref[commit_queue_lock]}"
    MUSI_VERIFY_GATE_EXEC_TIMEOUT=$(( MUSI_VERIFY_GATE_EXEC_TIMEOUT - queue_waited ))
    if [ "$MUSI_VERIFY_GATE_EXEC_TIMEOUT" -le 0 ]; then
      printf '=== %s TIMED OUT (%ss budget spent waiting for commit queue) ===\n' \
        "${policy_ref[banner_label]}" "${policy_ref[total_timeout]}" >&2
      printf 'Timed out before checks could start.\n' >&2
      printf 'inspect: bun run verify:logs budget\n' >&2
      return 124
    fi
  fi
}

musi_verify_gate_handle_signal() {
  local exit_code="$1"
  musi_verify_cleanup_gate
  musi_verify_write_signal_meta "$exit_code" "$MUSI_VERIFY_GATE_META_DIR" \
    "$MUSI_VERIFY_GATE_SIGNAL_MODE" "${MUSI_VERIFY_GATE_START_TS:-}" \
    "${MUSI_VERIFY_GATE_START_TIME:-}" "$MUSI_VERIFY_GATE_WRAPPER_COMMAND" \
    "$MUSI_VERIFY_GATE_RUN_HEAD" "$MUSI_VERIFY_GATE_RUN_FINGERPRINT" \
    "$MUSI_VERIFY_GATE_LOG_DIR" "$MUSI_VERIFY_GATE_HISTORY_DIR"
  if [ "$exit_code" -eq 124 ]; then
    musi_verify_report_timeout_budget "$MUSI_VERIFY_GATE_LOG_DIR"
  fi
  exit "$exit_code"
}

musi_verify_gate_run_serial_step() {
  local slot="$1" consumer="$2" label="$3" meta_mode="$4" log_dir="$5" meta_dir="$6"
  local resolve_rc=0 name log step_start step_start_time step_end step_end_time
  local exit_code command reservation_token reserve_rc=0
  musi_resolve_slot_cmd "$consumer" "$slot" || resolve_rc=$?
  if [ "$resolve_rc" -eq "$MUSI_VERIFY_SLOT_SKIP_RC" ]; then
    return 0
  fi
  if [ "$resolve_rc" -ne 0 ]; then
    printf '%s: failed to resolve %s step for %s (rc=%s)\n' \
      "$label" "$slot" "$consumer" "$resolve_rc" > "$log_dir/${slot}.log"
    MUSI_VERIFY_GATE_FAILED="$MUSI_VERIFY_GATE_FAILED $slot"
    return 1
  fi
  name="$slot"
  log="$log_dir/${name}.log"
  command="$(musi_meta_command_string "${MUSI_RESOLVED_SLOT_CMD[@]}")"
  [ -z "$label" ] || printf '%s: running %s...\n' "$label" "$name"
  musi_memory_budget_wait_and_reserve "$name" "$label" || reserve_rc=$?
  if [ "$reserve_rc" -ne 0 ]; then
    printf '%s: memory admission failed for %s (rc=%s)\n' \
      "$label" "$name" "$reserve_rc" > "$log"
    MUSI_VERIFY_GATE_FAILED="$MUSI_VERIFY_GATE_FAILED $name"
    return 1
  fi
  reservation_token="$MUSI_VERIFY_MEMORY_RESERVATION_TOKEN"
  step_start=$(date +%s)
  step_start_time=$(date -Iseconds)
  musi_run_in_isolated_process_group env -u MUSI_VERIFY_LOCK_ALREADY_HELD \
    "MUSI_VERIFY_MEMORY_ADMISSION_TOKEN=$reservation_token" \
    bash "$MUSI_VERIFY_MEMORY_ADMITTED_COMMAND" \
    "${MUSI_RESOLVED_SLOT_CMD[@]}" > "$log" 2>&1 9>&- &
  MUSI_VERIFY_GATE_CURRENT_PID=$!
  if wait "$MUSI_VERIFY_GATE_CURRENT_PID"; then
    exit_code=0
  else
    exit_code=$?
  fi
  MUSI_VERIFY_GATE_CURRENT_PID=""
  musi_memory_budget_release "$reservation_token"
  step_end=$(date +%s)
  step_end_time=$(date -Iseconds)
  musi_write_step_meta "$meta_dir/${name}.json" "$name" "$meta_mode" \
    "$step_start" "$step_start_time" "$step_end" "$step_end_time" "$exit_code" "$command"
  if [ "$exit_code" -eq 0 ]; then
    MUSI_VERIFY_GATE_PASSED="$MUSI_VERIFY_GATE_PASSED $name"
    return 0
  fi
  MUSI_VERIFY_GATE_FAILED="$MUSI_VERIFY_GATE_FAILED $name"
  return 1
}

musi_verify_run_gate() {
  local policy_name="${1:-}"
  [ -n "$policy_name" ] || {
    musi_verify_gate_policy_error 'usage: musi_verify_run_gate <policy-map-name>'
    return 2
  }
  musi_verify_validate_gate_policy "$policy_name" || return 2
  local -n policy_ref="$policy_name"
  musi_verify_gate_trace_event validated
  musi_verify_install_exit_dispatcher "${policy_ref[exit_hook]:-}" || return 2

  musi_verify_gate_acquire_locks "$policy_name" || return $?
  musi_verify_gate_trace_event lock

  local cache_head cache_fingerprint marker_rc bridge_rc
  if [ -f "${policy_ref[marker_path]}" ] && [ "${FORCE_VERIFY:-}" != 1 ]; then
    cache_head=$(musi_verify_gate_capture_provider cache-head "${policy_ref[cache_head_provider]}") || return 2
    cache_fingerprint=$(musi_verify_gate_capture_provider cache-fingerprint "${policy_ref[cache_fingerprint_provider]}") || return 2
    marker_rc=0
    musi_success_marker_matches "${policy_ref[marker_path]}" "$cache_head" \
      "$cache_fingerprint" "${policy_ref[marker_freshness]}" || marker_rc=$?
    if [ "$marker_rc" -eq 0 ]; then
      # shellcheck disable=SC2034 # Marker-hit callbacks read the cache identity.
      MUSI_VERIFY_GATE_CACHE_HEAD="$cache_head"
      # shellcheck disable=SC2034 # Marker-hit callbacks may read the cache identity.
      MUSI_VERIFY_GATE_CACHE_FINGERPRINT="$cache_fingerprint"
      [ -z "${policy_ref[marker_hit_hook]:-}" ] \
        || "${policy_ref[marker_hit_hook]}" \
        || return 2
      musi_verify_gate_trace_event marker-hit
      return 0
    fi
  fi
  musi_verify_gate_trace_event marker-miss
  [ -z "${policy_ref[marker_miss_hook]:-}" ] \
    || "${policy_ref[marker_miss_hook]}" \
    || return 2

  if [ -n "${policy_ref[bridge_predicate]:-}" ]; then
    bridge_rc=0
    "${policy_ref[bridge_predicate]}" || bridge_rc=$?
    case "$bridge_rc" in
      0) musi_verify_gate_trace_event bridge-hit; return 0 ;;
      1) musi_verify_gate_trace_event bridge-miss ;;
      2) printf 'verify engine: bridge predicate failed operationally\n' >&2; return 2 ;;
      *) printf 'verify engine: bridge predicate returned invalid status %s\n' "$bridge_rc" >&2; return 2 ;;
    esac
  fi

  rm -rf -- "${policy_ref[log_dir]}"
  mkdir -p "${policy_ref[log_dir]}/meta"
  musi_verify_gate_trace_event log-setup
  "${policy_ref[prepare_slots_hook]}" || return 2
  declare -p "${policy_ref[steps_array]}" >/dev/null 2>&1 || {
    printf 'verify engine: generated steps array is missing: %s\n' "${policy_ref[steps_array]}" >&2
    return 2
  }
  musi_verify_gate_trace_event prepared

  MUSI_VERIFY_GATE_RUN_HEAD=$(musi_verify_gate_capture_provider run-head "${policy_ref[run_head_provider]}") || return 2
  MUSI_VERIFY_GATE_RUN_FINGERPRINT=$(musi_verify_gate_capture_provider run-fingerprint "${policy_ref[run_fingerprint_provider]}") || return 2
  MUSI_VERIFY_GATE_START_TS=$(date +%s)
  MUSI_VERIFY_GATE_START_TIME=$(date -Iseconds)
  MUSI_VERIFY_GATE_LOG_DIR="${policy_ref[log_dir]}"
  MUSI_VERIFY_GATE_META_DIR="${policy_ref[log_dir]}/meta"
  MUSI_VERIFY_GATE_HISTORY_DIR="${policy_ref[history_dir]}"
  MUSI_VERIFY_GATE_SIGNAL_MODE="${policy_ref[signal_mode]}"
  MUSI_VERIFY_GATE_WRAPPER_COMMAND="${policy_ref[wrapper_command]}"
  MUSI_VERIFY_GATE_CURRENT_PID=""
  MUSI_VERIFY_GATE_PARALLEL_PIDS=()
  MUSI_VERIFY_GATE_CLEANED=0
  MUSI_VERIFY_GATE_ACTIVE=1
  musi_verify_gate_trace_event timestamp

  trap 'musi_verify_gate_handle_signal 130' INT
  trap 'musi_verify_gate_handle_signal 124' TERM
  musi_verify_gate_trace_event traps
  musi_verify_start_watchdog "${policy_ref[banner_label]}" \
    "$MUSI_VERIFY_GATE_EXEC_TIMEOUT" "$$"
  MUSI_VERIFY_GATE_WATCHDOG_PID="$MUSI_VERIFY_WATCHDOG_PID"
  musi_verify_gate_trace_event watchdog

  MUSI_VERIFY_GATE_PASSED=""
  MUSI_VERIFY_GATE_FAILED=""
  if [ "${policy_ref[execution_mode]}" = parallel ]; then
    local -a step_names=()
    # shellcheck disable=SC2034 # Filled by name by the parallel runner.
    local -a step_pids=()
    local -a step_exits=()
    local index slot exit_code
    musi_run_parallel_verify_steps "${policy_ref[consumer]}" "${policy_ref[steps_array]}" \
      "${policy_ref[failure_mode]}" "${policy_ref[step_label]:-}" \
      "${policy_ref[repo_root]}" step_names step_pids step_exits \
      MUSI_VERIFY_GATE_PARALLEL_PIDS
    for index in "${!step_names[@]}"; do
      slot="${step_names[$index]}"
      exit_code="${step_exits[$index]}"
      [ -n "$exit_code" ] || exit_code=1
      if [ "$exit_code" -eq 0 ]; then
        MUSI_VERIFY_GATE_PASSED="$MUSI_VERIFY_GATE_PASSED $slot"
      else
        MUSI_VERIFY_GATE_FAILED="$MUSI_VERIFY_GATE_FAILED $slot"
      fi
    done
    MUSI_VERIFY_GATE_PARALLEL_PIDS=()
  else
    local -n steps_ref="${policy_ref[steps_array]}"
    for slot in "${steps_ref[@]}"; do
      musi_verify_gate_run_serial_step "$slot" "${policy_ref[consumer]}" \
        "${policy_ref[step_label]:-}" "${policy_ref[failure_mode]}" \
        "${policy_ref[log_dir]}" "$MUSI_VERIFY_GATE_META_DIR" || break
    done
  fi
  musi_verify_gate_trace_event slots
  [ -z "${policy_ref[after_slots_hook]:-}" ] \
    || "${policy_ref[after_slots_hook]}" \
    || return 2
  musi_verify_gate_trace_event after-slots

  local elapsed end_ts end_time success_mode final_fingerprint marker_head
  elapsed=$(( $(date +%s) - MUSI_VERIFY_GATE_START_TS ))
  end_ts=$(date +%s)
  end_time=$(date -Iseconds)
  musi_verify_gate_trace_event aggregation
  if [ -n "$MUSI_VERIFY_GATE_FAILED" ]; then
    musi_verify_persist_run_meta "$MUSI_VERIFY_GATE_META_DIR" \
      "${policy_ref[failure_mode]}" "$MUSI_VERIFY_GATE_START_TS" \
      "$MUSI_VERIFY_GATE_START_TIME" "$end_ts" "$end_time" 1 \
      "${policy_ref[wrapper_command]}" "$MUSI_VERIFY_GATE_RUN_HEAD" \
      "$MUSI_VERIFY_GATE_RUN_FINGERPRINT" "${policy_ref[log_dir]}" \
      "${policy_ref[history_dir]}"
    musi_verify_gate_trace_event metadata
    musi_verify_print_failure_summary "${policy_ref[banner_label]}" "$elapsed" \
      "${policy_ref[log_dir]}" "$MUSI_VERIFY_GATE_PASSED" "$MUSI_VERIFY_GATE_FAILED"
    return 1
  fi

  success_mode=$(musi_verify_gate_capture_provider success-mode "${policy_ref[success_mode_provider]}") || return 2
  final_fingerprint=$(musi_verify_gate_capture_provider final-fingerprint "${policy_ref[final_fingerprint_provider]}") || return 2
  marker_head=$(musi_verify_gate_capture_provider marker-head "${policy_ref[marker_head_provider]}") || return 2
  musi_verify_persist_run_meta "$MUSI_VERIFY_GATE_META_DIR" "$success_mode" \
    "$MUSI_VERIFY_GATE_START_TS" "$MUSI_VERIFY_GATE_START_TIME" "$end_ts" \
    "$end_time" 0 "${policy_ref[wrapper_command]}" "$MUSI_VERIFY_GATE_RUN_HEAD" \
    "$final_fingerprint" "${policy_ref[log_dir]}" "${policy_ref[history_dir]}"
  musi_verify_gate_trace_event metadata
  musi_verify_finalize_success "${policy_ref[label]}" "${policy_ref[marker_path]}" \
    "$marker_head" "$final_fingerprint" "$elapsed" "${policy_ref[warn_after]}" \
    "$MUSI_VERIFY_GATE_EXEC_TIMEOUT" "$MUSI_VERIFY_GATE_PASSED"
  musi_verify_gate_trace_event finalize
}
