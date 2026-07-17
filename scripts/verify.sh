#!/bin/bash
# verify.sh — manual lint/ratchet/typecheck/test umbrella for humans and AIs.
#
# Mirrors `.husky/pre-commit`: changed-mode runs checks in parallel for the
# edit-loop budget, while full verify stays sequential so a human or AI can
# read one failure at a time. Reuses pre-commit's lock and log directory so
# manual runs queue cleanly behind any in-flight commit.
# Full manual verify markers watch the full worktree state. Changed manual
# verify markers watch staged content after the source-relevant preflight.
# Pre-commit uses its own staged/relevant-input marker first, then may bridge
# from a fresh matching manual marker.
#
# Usage:
#   bash scripts/verify.sh            # full lint, typecheck, test
#   bash scripts/verify.sh --changed  # lint:changed, typecheck, test:changed
#
# Env:
#   FORCE_VERIFY=1     bypass the last-verified short-circuit.
#   MUSI_VERIFY_STATE_ROOT
#                      base directory for worktree-scoped default state
#                      (defaults to /tmp).
#   MUSI_VERIFY_LOCK / MUSI_VERIFY_LOG_DIR / MUSI_VERIFY_MARKER_CHANGED /
#   MUSI_VERIFY_MARKER_FULL
#                      override derived paths for tests; avoid in production.
#
# Why mixed mode: the pre-commit hook and changed-mode verify are edit-loop
# gates, so wall time matters most and each step logs separately. Full verify
# remains sequential because release-shaped failures are easier to act on one
# step at a time.

set -u

LABEL=verify
MODE=full
case "${1:-}" in
  --changed)
    MODE=changed
    LABEL='verify:changed'
    ;;
  --parallel)
    MODE=parallel
    LABEL='verify:parallel'
    ;;
  '')
    ;;
  *)
    printf 'verify: unknown argument: %s\n' "$1" >&2
    printf 'usage: verify.sh [--changed|--parallel]\n' >&2
    exit 2
    ;;
esac
WRAPPER_COMMAND="$0 ${1:-}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT" || exit 1

# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/lib/gate-env.sh"

# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/ai-hooks/cache.sh"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/lib/verify-metadata.sh"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/lib/changed-base.sh"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/process-tree.sh"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/lib/parallel-step.sh"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/lib/lint-dist-preflight.sh"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/lib/verify-engine.sh"

LOCK="${MUSI_VERIFY_LOCK:-$(musi_standard_verify_lock "$REPO_ROOT")}"
LOG_DIR="${MUSI_VERIFY_LOG_DIR:-$(musi_standard_verify_log_dir "$REPO_ROOT")}"
HISTORY_DIR="${MUSI_VERIFY_HISTORY_DIR:-$(musi_standard_verify_history_dir "$REPO_ROOT")}"
# DX7.0a Vitest timing capture: pair the dot reporter with Vitest's json
# reporter so every wrapper-driven test run leaves a parseable timings file
# alongside test.log. The file lives in $LOG_DIR so it shares the same
# wipe/lifecycle as the test log itself; a future viewer (DX7.0b) reads
# `testResults[].assertionResults[].duration` from it. The default
# `bun run test` script is unchanged — only the wrapper-injected command
# carries the json reporter.
# shellcheck disable=SC2034 # Consumed by scripts/verify/steps.generated.sh.
TIMINGS_FILE="$LOG_DIR/test-timings.json"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/verify/steps.generated.sh"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/verify/steps-lib.sh"
META_DIR="$LOG_DIR/meta"
INTERACTIVE_TIMEOUT="${MUSI_INTERACTIVE_TIMEOUT:-$MUSI_GATE_INTERACTIVE_TIMEOUT_DEFAULT}"
WARN_AFTER="${MUSI_INTERACTIVE_WARN_AFTER:-1080}"
case "$MODE" in
  changed)
    MARKER="${MUSI_VERIFY_MARKER_CHANGED:-$(musi_standard_verify_changed_marker "$REPO_ROOT")}"
    VERIFY_CONSUMER=verify_changed
    VERIFY_STEPS_ARRAY=MUSI_VERIFY_CHANGED_STEPS
    META_MODE=parallel-verify-changed
    ;;
  parallel)
    MARKER="${MUSI_VERIFY_MARKER_FULL:-$(musi_standard_verify_full_marker "$REPO_ROOT")}"
    VERIFY_CONSUMER=verify_parallel
    VERIFY_STEPS_ARRAY=MUSI_VERIFY_PARALLEL_STEPS
    META_MODE=parallel-verify
    ;;
  *)
    MARKER="${MUSI_VERIFY_MARKER_FULL:-$(musi_standard_verify_full_marker "$REPO_ROOT")}"
    VERIFY_CONSUMER=verify
    VERIFY_STEPS_ARRAY=MUSI_VERIFY_STEPS
    META_MODE=serial-verify
    ;;
esac

if [ "$MODE" = changed ]; then
  musi_changed_gate_fail_if_unstaged "$REPO_ROOT" "$LABEL" || exit $?
  if musi_resolve_changed_base main; then
    changed_input=$(mktemp "${TMPDIR:-/tmp}/musi-verify-changed-input.XXXXXX") || {
      printf '%s: failed to allocate changed-input selection state.\n' "$LABEL" >&2
      exit 2
    }
    if ! git diff -z --name-only --diff-filter=ACMRD "$MUSI_CHANGED_BASE"...HEAD > "$changed_input" \
       || ! git diff -z --name-only --diff-filter=ACMRD --cached >> "$changed_input"; then
      printf '%s: failed to inspect committed and staged changes.\n' "$LABEL" >&2
      rm -f "$changed_input"
      exit 2
    fi
    if [ ! -s "$changed_input" ]; then
      rm -f "$changed_input"
      printf '%s: no committed changes vs %s and no staged files — nothing to verify.\n' \
        "$LABEL" "$MUSI_CHANGED_BASE"
      printf '%s: stage intended work and rerun, or use `bun run verify` for an intentional full-tree verification.\n' \
        "$LABEL"
      exit 0
    fi
    rm -f "$changed_input"
  fi
fi

# --- 1. Single-writer lock -------------------------------------------------
# Blocking flock: a manual run is fine to queue behind an in-flight pre-commit
# or another verify. The wait ceiling is the same interactive budget used by
# the command watchdog, and the post-lock watchdog subtracts any time spent
# waiting so lock contention plus execution cannot exceed one budget window.
if [ "${MUSI_VERIFY_LOCK_ALREADY_HELD:-}" = "1" ]; then
  LOCK_WAITED=0
  EXEC_TIMEOUT="$INTERACTIVE_TIMEOUT"
else
  LOCK_WAIT="$INTERACTIVE_TIMEOUT"
  mkdir -p "$(dirname "$LOCK")"
  exec 9<>"$LOCK"
  LOCK_START=$(date +%s)
  if ! flock -w "$LOCK_WAIT" 9; then
    HOLDER=$(cat "$LOCK" 2>/dev/null || true)
    cat >&2 <<EOF
=== $LABEL: another verification is still running after ${LOCK_WAIT}s ===
${HOLDER:-<holder info unavailable>}

That is long enough to suggest a hang, not the usual queue. Inspect the
holder above before retrying.
EOF
    exit 2
  fi
  LOCK_WAITED=$(( $(date +%s) - LOCK_START ))
  EXEC_TIMEOUT=$((INTERACTIVE_TIMEOUT - LOCK_WAITED))
  if [ "$EXEC_TIMEOUT" -le 0 ]; then
    cat >&2 <<EOF
=== $LABEL: no execution budget remains after waiting ${LOCK_WAITED}s for ${LOCK} ===
logs: $LOG_DIR
inspect: bun run verify:logs budget
EOF
    exit 124
  fi
  if [ "$LOCK_WAITED" -gt 0 ]; then
    printf '%s: waited %ds for %s; execution watchdog budget is %ds (interactive budget %ds)\n' \
      "$LABEL" "$LOCK_WAITED" "$LOCK" "$EXEC_TIMEOUT" "$INTERACTIVE_TIMEOUT" >&2
  fi
  { printf 'PID=%s LABEL=%s STARTED=%s\n' "$$" "$LABEL" "$(date -Iseconds)"; } > "$LOCK"
fi

# --- 2. Last-verified short-circuit ----------------------------------------
# Same key format as pre-commit's marker (LAST_TS / LAST_HEAD / LAST_HASH);
# full verify keys on the worktree fingerprint, changed verify keys on the
# staged fingerprint.
# Parsed line-by-line by verify-metadata.sh — never eval /tmp files.
CUR_HEAD=$(git rev-parse HEAD 2>/dev/null || echo none)
if [ "$MODE" = changed ]; then
  CUR_HASH=$(musi_require_fingerprint "$LABEL" ai_staged_fingerprint "$REPO_ROOT") || exit 2
else
  CUR_HASH=$(musi_require_fingerprint "$LABEL" ai_worktree_fingerprint "$REPO_ROOT") || exit 2
fi

if [ -f "$MARKER" ] \
   && [ "${FORCE_VERIFY:-}" != "1" ] \
   && musi_success_marker_matches "$MARKER" "$CUR_HEAD" "$CUR_HASH" "$MUSI_GATE_MARKER_FRESHNESS_SECONDS"; then
  printf '%s: already verified %ds ago at %s — skipping (set FORCE_VERIFY=1 to re-run).\n' \
    "$LABEL" "$MUSI_MARKER_MATCH_AGE" "$CUR_HEAD"
  exit 0
fi

# --- 3. Watchdog ------------------------------------------------------------
# Mirrors pre-commit. Changed-mode verification runs its gate checks in
# parallel while the default watchdog still bounds the full run. The wrapper
# cuts the run on overrun and prints log paths plus a
# `verify:logs budget` pointer. Callers should tune the hard and soft budgets
# with `MUSI_INTERACTIVE_TIMEOUT` and `MUSI_INTERACTIVE_WARN_AFTER`.
TIMEOUT="$EXEC_TIMEOUT"
HOOK_PID=$$
musi_verify_start_watchdog "$LABEL" "$TIMEOUT" "$HOOK_PID"
WD="$MUSI_VERIFY_WATCHDOG_PID"

CURRENT_PID=""
PARALLEL_PIDS=()
cleanup_children() {
  if [ -n "$CURRENT_PID" ]; then
    musi_terminate_process_tree "$CURRENT_PID"
    musi_wait_for_pid_exit_bounded "$CURRENT_PID" || true
  fi
  local pid
  for pid in "${PARALLEL_PIDS[@]}"; do
    musi_terminate_process_tree "$pid"
  done
  for pid in "${PARALLEL_PIDS[@]}"; do
    musi_wait_for_pid_exit_bounded "$pid" || true
  done
  kill "$WD" 2>/dev/null || true
}
write_signal_wrapper_meta() {
  musi_verify_write_signal_meta "$1" "$META_DIR" "$META_MODE" \
    "${START_TS:-}" "${START_TIME:-}" "$WRAPPER_COMMAND" "$CUR_HEAD" "$CUR_HASH" \
    "$LOG_DIR" "$HISTORY_DIR"
}
trap 'cleanup_children; write_signal_wrapper_meta 130; exit 130' INT
trap 'cleanup_children; write_signal_wrapper_meta 124; musi_verify_report_timeout_budget "$LOG_DIR"; exit 124' TERM
trap 'kill "$WD" 2>/dev/null' EXIT

# --- 4. Sequential runs ----------------------------------------------------
# Wipe the shared log dir so a stale typecheck.log from an earlier run that
# halted at lint cannot mislead readers (DX3.6 verify:logs leans on these
# files being from the most recent run only). Pre-commit does the same.
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR" "$META_DIR"

START_TS=$(date +%s)
START_TIME=$(date -Iseconds)
passed=""; failed=""

# Run a step in a backgrounded child so traps reach it via $CURRENT_PID.
# Output goes to a log file (matching pre-commit) — the failure summary at
# the bottom prints a 30-line tail when something breaks.
run_step() {
  local name="$1"; shift
  local log="$LOG_DIR/${name}.log"
  local step_start step_start_time step_end step_end_time exit_code command reservation_token reserve_rc=0
  command="$(musi_meta_command_string "$@")"
  printf '%s: running %s...\n' "$LABEL" "$name"
  musi_memory_budget_wait_and_reserve "$name" "$LABEL" || reserve_rc=$?
  if [ "$reserve_rc" -ne 0 ]; then
    printf '%s: memory admission failed for %s (rc=%s)\n' \
      "$LABEL" "$name" "$reserve_rc" > "$log"
    failed="$failed $name"
    return 1
  fi
  reservation_token="$MUSI_VERIFY_MEMORY_RESERVATION_TOKEN"
  step_start=$(date +%s)
  step_start_time=$(date -Iseconds)
  # Close FD 9 in the child so test workers don't hold the lock past our exit;
  # mirrors bun-run-quiet.sh's `9>&-` redirect on its wrapped child.
  musi_run_in_isolated_process_group env -u MUSI_VERIFY_LOCK_ALREADY_HELD \
    "MUSI_VERIFY_MEMORY_ADMISSION_TOKEN=$reservation_token" \
    bash "$MUSI_VERIFY_MEMORY_ADMITTED_COMMAND" "$@" > "$log" 2>&1 9>&- &
  CURRENT_PID=$!
  if wait "$CURRENT_PID"; then
    exit_code=0
    CURRENT_PID=""
    musi_memory_budget_release "$reservation_token"
    step_end=$(date +%s)
    step_end_time=$(date -Iseconds)
    musi_write_step_meta "$META_DIR/${name}.json" "$name" "$META_MODE" \
      "$step_start" "$step_start_time" "$step_end" "$step_end_time" "$exit_code" "$command"
    passed="$passed $name"
    return 0
  fi
  exit_code=$?
  CURRENT_PID=""
  musi_memory_budget_release "$reservation_token"
  step_end=$(date +%s)
  step_end_time=$(date -Iseconds)
  musi_write_step_meta "$META_DIR/${name}.json" "$name" "$META_MODE" \
    "$step_start" "$step_start_time" "$step_end" "$step_end_time" "$exit_code" "$command"
  failed="$failed $name"
  return 1
}

run_steps_parallel() {
  # shellcheck disable=SC2034 # step_pids is passed by name to musi_run_parallel_verify_steps.
  local -a step_names=() step_pids=() step_exits=()
  local slot index exit_code

  musi_run_parallel_verify_steps "$VERIFY_CONSUMER" "$VERIFY_STEPS_ARRAY" "$META_MODE" \
    "$LABEL" "$REPO_ROOT" step_names step_pids step_exits PARALLEL_PIDS

  for index in "${!step_names[@]}"; do
    slot="${step_names[$index]}"
    exit_code="${step_exits[$index]}"
    [ -n "$exit_code" ] || exit_code=1
    [ "$exit_code" -eq 0 ] && passed="$passed $slot" || failed="$failed $slot"
  done

  [ -z "$failed" ]
}

run_resolved_step() {
  local slot="$1" resolve_rc=0

  musi_resolve_slot_cmd "$VERIFY_CONSUMER" "$slot" || resolve_rc=$?
  if [ "$resolve_rc" -eq "$MUSI_VERIFY_SLOT_SKIP_RC" ]; then
    return 0
  fi
  if [ "$resolve_rc" -ne 0 ]; then
    printf '%s: failed to resolve %s step for %s (rc=%s)\n' \
      "$LABEL" "$slot" "$VERIFY_CONSUMER" "$resolve_rc" > "$LOG_DIR/${slot}.log"
    failed="$failed $slot"
    return 1
  fi

  run_step "$slot" "${MUSI_RESOLVED_SLOT_CMD[@]}"
}

# Full manual verification remains sequential and stops at the first failure.
# Changed and parallel modes run in parallel to preserve edit-loop feedback
# while still writing the same per-step logs.
overall=0
if [ "$MODE" = changed ] || [ "$MODE" = parallel ]; then
  run_steps_parallel || overall=1
else
  declare -n verify_steps_ref="$VERIFY_STEPS_ARRAY"
  for step in "${verify_steps_ref[@]}"; do
    [ "$overall" -eq 0 ] || break
    run_resolved_step "$step" || overall=1
  done
fi

ELAPSED=$(( $(date +%s) - START_TS ))
END_TS=$(date +%s)
END_TIME=$(date -Iseconds)

if [ -n "$failed" ]; then
  musi_verify_persist_run_meta "$META_DIR" "$META_MODE" \
    "$START_TS" "$START_TIME" "$END_TS" "$END_TIME" 1 "$WRAPPER_COMMAND" \
    "$CUR_HEAD" "$CUR_HASH" "$LOG_DIR" "$HISTORY_DIR"
  musi_verify_print_failure_summary "$LABEL" "$ELAPSED" "$LOG_DIR" "$passed" "$failed"
  exit 1
fi

musi_verify_persist_run_meta "$META_DIR" "$META_MODE" \
  "$START_TS" "$START_TIME" "$END_TS" "$END_TIME" 0 "$WRAPPER_COMMAND" \
  "$CUR_HEAD" "$CUR_HASH" "$LOG_DIR" "$HISTORY_DIR"

# --- 5. Success marker (same format as pre-commit's) -----------------------
musi_verify_finalize_success "$LABEL" "$MARKER" "$CUR_HEAD" "$CUR_HASH" \
  "$ELAPSED" "$WARN_AFTER" "$INTERACTIVE_TIMEOUT" "$passed"
