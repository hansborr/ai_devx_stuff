# shellcheck shell=bash
# shellcheck disable=SC2034
# Static resolvers for manifest-backed verify slots.
#
# Contract:
#   musi_resolve_slot_cmd <consumer> <slot>
#
# On success, populates MUSI_RESOLVED_SLOT_CMD as a shell array and returns 0.
# If a dynamic resolver decides the slot should not run, it returns
# MUSI_VERIFY_SLOT_SKIP_RC. Consumers must source steps.generated.sh first so
# the base *_CMD arrays and metadata maps exist. This library never returns raw
# command strings and does not use eval.

# shellcheck source=./memory-budget.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/memory-budget.sh"

MUSI_VERIFY_SLOT_SKIP_RC=100
MUSI_RESOLVED_SLOT_CMD=()

if ! declare -p MUSI_VERIFY_CONSUMERS >/dev/null 2>&1; then
  printf 'verify steps: generated consumer list is missing; source steps.generated.sh before steps-lib.sh\n' >&2
  return 2 2>/dev/null || exit 2
fi
if ! declare -p MUSI_VERIFY_DYNAMIC_RESOLVER_FUNC >/dev/null 2>&1; then
  printf 'verify steps: generated dynamic resolver map is missing; source steps.generated.sh before steps-lib.sh\n' >&2
  return 2 2>/dev/null || exit 2
fi

musi_verify_has_pre_commit_consumer=0
for musi_verify_consumer in "${MUSI_VERIFY_CONSUMERS[@]}"; do
  if [ "$musi_verify_consumer" = "pre_commit" ]; then
    musi_verify_has_pre_commit_consumer=1
    break
  fi
done
if [ "$musi_verify_has_pre_commit_consumer" -ne 1 ]; then
  printf 'verify steps: generated consumer list must include pre_commit for hook-only dynamic resolvers\n' >&2
  return 2 2>/dev/null || exit 2
fi
unset musi_verify_consumer musi_verify_has_pre_commit_consumer

musi_verify_steps_print_regen_guidance() {
  printf '%s\n' 'verify steps: run `bun run verify:steps:check` (and `bun run harness:wiring:check` for hook wiring); regenerate with `bun run verify:steps`, fallback direct script: scripts/harness/generate-verify-steps.ts' >&2
}

musi_resolve_base_slot_cmd() {
  local consumer="$1" slot="$2" key cmd_var

  key="$consumer:$slot"
  cmd_var="${MUSI_VERIFY_SLOT_CMD_VAR[$key]:-}"
  if [ -z "$cmd_var" ]; then
    printf 'verify steps: unknown slot %s for consumer %s\n' "$slot" "$consumer" >&2
    musi_verify_steps_print_regen_guidance
    return 2
  fi
  if ! declare -p "$cmd_var" >/dev/null 2>&1; then
    printf 'verify steps: generated command array is missing: %s\n' "$cmd_var" >&2
    musi_verify_steps_print_regen_guidance
    return 2
  fi

  local -n base_cmd="$cmd_var"
  MUSI_RESOLVED_SLOT_CMD=("${base_cmd[@]}")
}

musi_resolve_precommit_test_timing_cmd() {
  local consumer="$1" slot="$2"

  musi_resolve_base_slot_cmd "$consumer" "$slot" || return $?
  if [ "$consumer" = "pre_commit" ] && [ "${MUSI_CAPTURE_TEST_TIMINGS:-}" = "1" ]; then
    MUSI_RESOLVED_SLOT_CMD+=(
      "--reporter=json"
      "--outputFile.json=${TIMINGS_FILE:?scripts/verify/steps-lib.sh requires TIMINGS_FILE}"
    )
  fi
}

musi_resolve_staged_script_cmd() {
  local consumer="$1" slot="$2" classifier_rc=0

  if ! declare -F musi_classify_staged_script_input >/dev/null 2>&1; then
    printf 'verify steps: musi_classify_staged_script_input is not defined\n' >&2
    return 2
  fi

  musi_classify_staged_script_input || classifier_rc=$?
  # rc 2 means "classifier could not decide". The manual changed gate still
  # runs the base smoke because it can fall back to git diff, while pre-commit
  # skips this optional scripts slot to avoid blocking a commit on classifier
  # uncertainty.
  case "$classifier_rc" in
    0)
      musi_resolve_base_slot_cmd "$consumer" "$slot" || return $?
      MUSI_RESOLVED_SLOT_CMD=(
        env
        "MUSI_SCRIPTS_CHANGED_FILES=$MUSI_STAGED_SCRIPT_ALL"
        "MUSI_SCRIPTS_DELETED_FILES=$MUSI_STAGED_SCRIPT_DELETED"
        "${MUSI_RESOLVED_SLOT_CMD[@]}"
      )
      ;;
    1)
      musi_resolve_base_slot_cmd "$consumer" "$slot"
      ;;
    2)
      if [ "$consumer" = "pre_commit" ]; then
        printf 'verify steps: SKIP scripts (classifier uncertain — CI runs the full suite)\n' >&2
        MUSI_RESOLVED_SLOT_CMD=()
        return "$MUSI_VERIFY_SLOT_SKIP_RC"
      fi
      musi_resolve_base_slot_cmd "$consumer" "$slot"
      ;;
    *)
      printf 'verify steps: staged script classifier returned unexpected rc %s\n' \
        "$classifier_rc" >&2
      MUSI_RESOLVED_SLOT_CMD=()
      return 2
      ;;
  esac
}

# Returns 0 when fast-commit mode is on, i.e. the slow pre-commit test slots
# should be skipped. MUSI_FAST_COMMIT_MARKER overrides the path (tests); the
# default marker lives in the Git common dir so it is never tracked and never
# trips the changed gate. The pre-commit gate supplies its under-lock snapshot;
# standalone callers resolve the marker relative to the current directory,
# which is the repo root whenever git invokes the hook.
musi_fast_commit_enabled() {
  case "${MUSI_FAST_COMMIT_ENABLED_SNAPSHOT:-}" in
    1) return 0 ;;
    0) return 1 ;;
  esac
  local marker="${MUSI_FAST_COMMIT_MARKER:-}"
  if [ -z "$marker" ]; then
    local common_dir
    common_dir="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
    marker="$common_dir/musi-fast-commit"
  fi
  [ -f "$marker" ]
}

musi_resolve_slot_cmd() {
  if [ "$#" -ne 2 ]; then
    printf 'usage: musi_resolve_slot_cmd <consumer> <slot>\n' >&2
    return 2
  fi

  local consumer="$1" slot="$2" key dynamic resolver_func fast_skip_slot

  key="$consumer:$slot"

  # Opt-in fast-commit mode: skip only the slots the manifest declares
  # fastCommitSkip (generated into MUSI_FAST_COMMIT_SKIP_SLOTS), and only for
  # the pre-commit consumer. Manual `verify` / `verify:changed` (the merge gate)
  # always run them so their success markers stay trustworthy.
  if [ "$consumer" = "pre_commit" ] && musi_fast_commit_enabled; then
    # ${arr[@]+...} guard: an adopter manifest with no fastCommitSkip slots
    # generates an empty array, and "${empty[@]}" under set -u is an unbound-
    # variable abort on bash < 4.4 (macOS system bash 3.2).
    for fast_skip_slot in ${MUSI_FAST_COMMIT_SKIP_SLOTS[@]+"${MUSI_FAST_COMMIT_SKIP_SLOTS[@]}"}; do
      [ "$fast_skip_slot" = "$slot" ] || continue
      printf 'verify steps: fast-commit mode — skipping %s slot (remove the musi-fast-commit marker in the Git common dir to disable)\n' "$slot" >&2
      # Outcome signal for fast-commit provenance: MUSI_VERIFY_SLOT_SKIP_RC
      # alone is ambiguous (condition-based slot skips return the same RC),
      # so record the fast-commit skip here, at the only place it happens.
      # The parallel runner executes in the hook shell, so this global
      # reaches pre-commit's EXIT trap.
      MUSI_FAST_COMMIT_SKIPPED=1
      MUSI_RESOLVED_SLOT_CMD=()
      return "$MUSI_VERIFY_SLOT_SKIP_RC"
    done
  fi

  dynamic="${MUSI_VERIFY_SLOT_DYNAMIC[$key]:-}"
  if [ -z "$dynamic" ]; then
    musi_resolve_base_slot_cmd "$consumer" "$slot"
    return $?
  fi

  resolver_func="${MUSI_VERIFY_DYNAMIC_RESOLVER_FUNC[$dynamic]:-}"
  if [ -z "$resolver_func" ]; then
    printf 'verify steps: unknown dynamic resolver %s for %s\n' "$dynamic" "$key" >&2
    return 2
  fi
  if ! declare -F "$resolver_func" >/dev/null 2>&1; then
    printf 'verify steps: generated dynamic resolver function is missing: %s\n' "$resolver_func" >&2
    musi_verify_steps_print_regen_guidance
    return 2
  fi
  "$resolver_func" "$consumer" "$slot"
}

musi_parallel_display_label() {
  local label="$1"
  if [ -n "$label" ]; then
    printf '%s\n' "$label"
  else
    printf '%s\n' "pre-commit"
  fi
}

musi_defer_dist_slot() {
  local slot="$1"
  case "$slot" in
    lint | ratchet) return 0 ;;
    *) return 1 ;;
  esac
}

musi_record_pending_dist_failure() {
  local slot="$1" index="$2" message="$3" step_exits_name="$4"
  local -n step_exits_ref="$step_exits_name"

  printf '%s\n' "$message" > "$LOG_DIR/${slot}.log"
  step_exits_ref[$index]=1
}

musi_wait_parallel_verify_index() {
  local index="$1" step_pids_name="$2" step_exits_name="$3" memory_tokens_name="$4"
  local -n wait_pids_ref="$step_pids_name"
  local -n wait_exits_ref="$step_exits_name"
  local -n wait_tokens_ref="$memory_tokens_name"
  local pid token

  pid="${wait_pids_ref[$index]:-}"
  [ -n "$pid" ] || return 0
  if [ -z "${wait_exits_ref[$index]:-}" ]; then
    if wait "$pid"; then
      wait_exits_ref[$index]=0
    else
      wait_exits_ref[$index]=$?
    fi
  fi
  token="${wait_tokens_ref[$index]:-}"
  musi_memory_budget_release "$token"
  wait_tokens_ref[$index]=""
}

musi_drain_memory_pending_slots() {
  if [ "$#" -ne 13 ]; then
    printf 'usage: musi_drain_memory_pending_slots <meta-mode> <label> <display-label> <pending-indexes> <step-names> <command-tokens> <command-starts> <command-lengths> <step-pids> <step-exits> <memory-tokens> <parallel-pids> <wait-timeout>\n' >&2
    return 2
  fi

  local meta_mode="$1" label="$2" display_label="$3" pending_name="$4"
  local step_names_name="$5" command_tokens_name="$6" command_starts_name="$7"
  local command_lengths_name="$8" step_pids_name="$9" step_exits_name="${10}"
  local memory_tokens_name="${11}" parallel_pids_name="${12}" wait_timeout="${13}"
  local -n pending_ref="$pending_name"
  local -n drain_names_ref="$step_names_name"
  local -n drain_commands_ref="$command_tokens_name"
  local -n drain_starts_ref="$command_starts_name"
  local -n drain_lengths_ref="$command_lengths_name"
  local -n drain_pids_ref="$step_pids_name"
  local -n drain_exits_ref="$step_exits_name"
  local -n drain_tokens_ref="$memory_tokens_name"
  local -n drain_parallel_ref="$parallel_pids_name"
  local -a still_pending=()
  local -A announced=()
  local index slot reserve_rc progress start now token command_start command_length

  case "$wait_timeout" in
    '' | *[!0-9]*)
      printf '%s: invalid MUSI_VERIFY_MEMORY_WAIT_TIMEOUT=%s; expected whole seconds\n' \
        "$display_label" "$wait_timeout" >&2
      return 2
      ;;
  esac
  start="$SECONDS"
  while [ "${#pending_ref[@]}" -gt 0 ]; do
    still_pending=()
    progress=0
    for index in "${pending_ref[@]}"; do
      slot="${drain_names_ref[$index]}"
      reserve_rc=0
      musi_memory_budget_try_reserve "$slot" || reserve_rc=$?
      if [ "$reserve_rc" -eq 1 ]; then
        if [ -z "${announced[$index]:-}" ]; then
          printf '%s: deferring %s until memory budget is available (expected peak %s MB)\n' \
            "$display_label" "$slot" "$(musi_verify_slot_expected_peak_mb "$slot")" >&2
          announced[$index]=1
        fi
        still_pending+=("$index")
        continue
      fi
      if [ "$reserve_rc" -ne 0 ]; then
        printf '%s: memory admission failed for %s (rc=%s)\n' \
          "$display_label" "$slot" "$reserve_rc" > "$LOG_DIR/${slot}.log"
        drain_exits_ref[$index]="$reserve_rc"
        progress=1
        continue
      fi

      musi_memory_budget_report_solo_fallback "$display_label" "$slot"
      token="$MUSI_VERIFY_MEMORY_RESERVATION_TOKEN"
      command_start="${drain_starts_ref[$index]}"
      command_length="${drain_lengths_ref[$index]}"
      musi_run_parallel_step "$meta_mode" "$label" "$slot" \
        "${drain_commands_ref[@]:command_start:command_length}"
      drain_pids_ref[$index]="$STEP_PID"
      drain_tokens_ref[$index]="$token"
      drain_parallel_ref+=("$STEP_PID")
      musi_memory_budget_attach_pid "$token" "$STEP_PID" || {
        printf '%s: failed to attach %s reservation to pid %s\n' \
          "$display_label" "$slot" "$STEP_PID" >&2
      }
      progress=1
    done
    pending_ref=("${still_pending[@]}")
    [ "${#pending_ref[@]}" -gt 0 ] || break
    if [ "$progress" -eq 1 ]; then
      continue
    fi

    now="$SECONDS"
    if [ "$((now - start))" -ge "$wait_timeout" ]; then
      for index in "${pending_ref[@]}"; do
        slot="${drain_names_ref[$index]}"
        printf '%s: memory wait timed out after %ss for %s (expected peak %s MB); no slot was launched\n' \
          "$display_label" "$wait_timeout" "$slot" \
          "$(musi_verify_slot_expected_peak_mb "$slot")" > "$LOG_DIR/${slot}.log"
        drain_exits_ref[$index]=1
      done
      printf '%s: memory wait timed out after %ss; failing pending slots instead of holding the gate indefinitely\n' \
        "$display_label" "$wait_timeout" >&2
      pending_ref=()
      break
    fi
    sleep "$(musi_memory_budget_poll_seconds)"
  done
}

musi_run_parallel_verify_steps() {
  if [ "$#" -ne 9 ]; then
    printf 'usage: musi_run_parallel_verify_steps <consumer> <steps-array> <meta-mode> <label> <repo-root> <step-names-array> <step-pids-array> <step-exits-array> <parallel-pids-array>\n' >&2
    return 2
  fi

  local consumer="$1" steps_array_name="$2" meta_mode="$3" label="$4" repo_root="$5"
  local step_names_name="$6" step_pids_name="$7" step_exits_name="$8" parallel_pids_name="$9"
  local -n steps_ref="$steps_array_name"
  local -n step_names_ref="$step_names_name"
  local -n step_pids_ref="$step_pids_name"
  # shellcheck disable=SC2178 # Nameref target is the caller's step exits array.
  local -n step_exits_ref="$step_exits_name"
  local -n parallel_pids_ref="$parallel_pids_name"
  local -a pending_indexes=() dist_pending_indexes=() command_tokens=()
  local -a command_starts=() command_lengths=() memory_tokens=()
  local slot resolve_rc index display_label command_start wait_timeout
  local defer_dist_slots=0 pending_lint_index=-1 pending_ratchet_index=-1 pending_dist_count=0
  local typecheck_index=-1 dist_ready

  display_label="$(musi_parallel_display_label "$label")"
  if ! musi_lint_dist_outputs_present "$repo_root"; then
    defer_dist_slots=1
  fi

  for slot in "${steps_ref[@]}"; do
    resolve_rc=0
    musi_resolve_slot_cmd "$consumer" "$slot" || resolve_rc=$?
    if [ "$resolve_rc" -eq "$MUSI_VERIFY_SLOT_SKIP_RC" ]; then
      continue
    fi
    if [ "$resolve_rc" -ne 0 ]; then
      if [ -n "$label" ]; then
        printf '%s: failed to resolve %s step for %s (rc=%s)\n' \
          "$label" "$slot" "$consumer" "$resolve_rc" > "$LOG_DIR/${slot}.log"
      else
        printf 'pre-commit: failed to resolve %s step (rc=%s)\n' \
          "$slot" "$resolve_rc" > "$LOG_DIR/${slot}.log"
      fi
      step_names_ref+=("$slot")
      step_pids_ref+=("")
      step_exits_ref+=("$resolve_rc")
      break
    fi
    index="${#step_names_ref[@]}"
    command_start="${#command_tokens[@]}"
    command_starts[$index]="$command_start"
    command_lengths[$index]="${#MUSI_RESOLVED_SLOT_CMD[@]}"
    command_tokens+=("${MUSI_RESOLVED_SLOT_CMD[@]}")
    step_names_ref+=("$slot")
    step_pids_ref+=("")
    step_exits_ref+=("")
    memory_tokens+=("")
    if [ "$defer_dist_slots" -eq 1 ] && musi_defer_dist_slot "$slot"; then
      case "$slot" in
        lint) pending_lint_index="$index" ;;
        ratchet) pending_ratchet_index="$index" ;;
      esac
      pending_dist_count=$((pending_dist_count + 1))
      dist_pending_indexes+=("$index")
      continue
    fi
    pending_indexes+=("$index")
    if [ "$slot" = typecheck ]; then
      typecheck_index="$index"
    fi
  done

  wait_timeout="${MUSI_VERIFY_MEMORY_WAIT_TIMEOUT:-120}"
  musi_drain_memory_pending_slots "$meta_mode" "$label" "$display_label" \
    pending_indexes "$step_names_name" command_tokens command_starts command_lengths \
    "$step_pids_name" "$step_exits_name" memory_tokens "$parallel_pids_name" "$wait_timeout"

  if [ "$pending_dist_count" -gt 0 ]; then
    dist_ready=1
    if [ "$typecheck_index" -lt 0 ] || [ -z "${step_pids_ref[$typecheck_index]}" ]; then
      if [ "$pending_lint_index" -ge 0 ]; then
        musi_record_pending_dist_failure lint "$pending_lint_index" \
          "$display_label: cannot run lint because required dist outputs are missing and $consumer has no typecheck slot to produce them" \
          "$step_exits_name"
      fi
      if [ "$pending_ratchet_index" -ge 0 ]; then
        musi_record_pending_dist_failure ratchet "$pending_ratchet_index" \
          "$display_label: cannot run ratchet because required dist outputs are missing and $consumer has no typecheck slot to produce them" \
          "$step_exits_name"
      fi
      dist_ready=0
    elif [ "$typecheck_index" -ge 0 ] && [ -n "${step_pids_ref[$typecheck_index]}" ]; then
      musi_wait_parallel_verify_index "$typecheck_index" "$step_pids_name" \
        "$step_exits_name" memory_tokens
      if [ "${step_exits_ref[$typecheck_index]}" -ne 0 ]; then
        dist_ready=0
      fi
    fi

    if [ "$dist_ready" -eq 1 ]; then
      pending_indexes=("${dist_pending_indexes[@]}")
      musi_drain_memory_pending_slots "$meta_mode" "$label" "$display_label" \
        pending_indexes "$step_names_name" command_tokens command_starts command_lengths \
        "$step_pids_name" "$step_exits_name" memory_tokens "$parallel_pids_name" "$wait_timeout"
    elif [ "$typecheck_index" -ge 0 ] && [ -n "${step_pids_ref[$typecheck_index]}" ]; then
      if [ "$pending_lint_index" -ge 0 ]; then
        musi_record_pending_dist_failure lint "$pending_lint_index" \
          "$display_label: skipped lint because typecheck failed before required dist outputs were available" \
          "$step_exits_name"
      fi
      if [ "$pending_ratchet_index" -ge 0 ]; then
        musi_record_pending_dist_failure ratchet "$pending_ratchet_index" \
          "$display_label: skipped ratchet because typecheck failed before required dist outputs were available" \
          "$step_exits_name"
      fi
    fi
  fi

  for index in "${!step_names_ref[@]}"; do
    [ -n "${step_exits_ref[$index]}" ] && continue
    musi_wait_parallel_verify_index "$index" "$step_pids_name" \
      "$step_exits_name" memory_tokens
  done
  parallel_pids_ref=()
}
