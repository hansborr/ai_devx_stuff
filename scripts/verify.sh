#!/bin/bash
# verify.sh — manual lint/ratchet/typecheck/test umbrella for humans and AIs.
#
# Mirrors `.husky/pre-commit` but runs steps sequentially so an AI session
# can read each step's output one at a time. Reuses pre-commit's lock and
# log directory so manual runs queue cleanly behind any in-flight commit.
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
#   MUSI_VERIFY_LOCK / MUSI_VERIFY_LOG_DIR / MUSI_VERIFY_MARKER_CHANGED /
#   MUSI_VERIFY_MARKER_FULL
#                      override paths for tests; do not use in production.
#
# Why sequential: the pre-commit hook runs the primitives in parallel
# because it is git-invoked and there is no benefit to spreading the output
# over time. Manual verification is read by an AI or a human as it streams,
# and a parallel failure summary is harder to act on than "stopped at step 2".

set -u

LABEL=verify
MODE=full
case "${1:-}" in
  --changed)
    MODE=changed
    LABEL='verify:changed'
    ;;
  '')
    ;;
  *)
    printf 'verify: unknown argument: %s\n' "$1" >&2
    printf 'usage: verify.sh [--changed]\n' >&2
    exit 2
    ;;
esac
WRAPPER_COMMAND="$0 ${1:-}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT" || exit 1

# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/ai-hooks/cache.sh"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/verify-metadata.sh"

LOCK="${MUSI_VERIFY_LOCK:-/tmp/musi-pre-commit.lock}"
LOG_DIR="${MUSI_VERIFY_LOG_DIR:-/tmp/musi-pre-commit-logs}"
HISTORY_DIR="${MUSI_VERIFY_HISTORY_DIR:-/tmp/musi-verify-history}"
# DX7.0a Vitest timing capture: pair the dot reporter with Vitest's json
# reporter so every wrapper-driven test run leaves a parseable timings file
# alongside test.log. The file lives in $LOG_DIR so it shares the same
# wipe/lifecycle as the test log itself; a future viewer (DX7.0b) reads
# `testResults[].assertionResults[].duration` from it. The default
# `bun run test` script is unchanged — only the wrapper-injected command
# carries the json reporter.
TIMINGS_FILE="$LOG_DIR/test-timings.json"
META_DIR="$LOG_DIR/meta"
INTERACTIVE_TIMEOUT="${MUSI_VERIFY_TIMEOUT:-${MUSI_INTERACTIVE_TIMEOUT:-240}}"
WARN_AFTER="${MUSI_INTERACTIVE_WARN_AFTER:-210}"
if [ "$MODE" = changed ]; then
  MARKER="${MUSI_VERIFY_MARKER_CHANGED:-/tmp/musi-verify-changed-last}"
  LINT_CMD=(bun run lint:changed)
  RATCHET_CMD=(bun run lint:ratchet)
  COVERAGE_MAP_CMD=(bun run docs:lint-coverage-map:check -- --staged)
  TEST_CMD=(bun run test:changed --reporter=dot --reporter=json --outputFile.json="$TIMINGS_FILE")
  SCRIPTS_CMD=(bun run test:scripts:changed)
  META_MODE=serial-verify-changed
else
  MARKER="${MUSI_VERIFY_MARKER_FULL:-/tmp/musi-verify-last}"
  LINT_CMD=(bun run lint)
  RATCHET_CMD=(bun run lint:ratchet)
  COVERAGE_MAP_CMD=(bun run docs:lint-coverage-map:check)
  TEST_CMD=(bun run test --reporter=dot --reporter=json --outputFile.json="$TIMINGS_FILE")
  SCRIPTS_CMD=(bun run test:scripts)
  META_MODE=serial-verify
fi
TYPECHECK_CMD=(bun run typecheck)

if [ "$MODE" = changed ]; then
  musi_changed_gate_fail_if_unstaged "$REPO_ROOT" "$LABEL" || exit 1
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
  CUR_HASH=$(ai_staged_fingerprint "$REPO_ROOT")
else
  CUR_HASH=$(ai_worktree_fingerprint "$REPO_ROOT")
fi

if [ -f "$MARKER" ] \
   && [ "${FORCE_VERIFY:-}" != "1" ] \
   && musi_success_marker_matches "$MARKER" "$CUR_HEAD" "$CUR_HASH" 120; then
  printf '%s: already verified %ds ago at %s — skipping (set FORCE_VERIFY=1 to re-run).\n' \
    "$LABEL" "$MUSI_MARKER_MATCH_AGE" "$CUR_HEAD"
  exit 0
fi

# --- 3. Watchdog ------------------------------------------------------------
# Mirrors pre-commit. The 240s default is the Claude Code session-cache
# budget: an interactive tool call that overruns it loses cache state, so the
# wrapper cuts the run before that happens and prints log paths plus a
# `verify:logs budget` pointer. `MUSI_VERIFY_TIMEOUT` stays as a back-compat
# override so existing tests / overrides keep working; new callers should
# prefer `MUSI_INTERACTIVE_TIMEOUT` and `MUSI_INTERACTIVE_WARN_AFTER`.
TIMEOUT="$EXEC_TIMEOUT"
HOOK_PID=$$
(
  # Close FD 9 so the sleep child does not inherit the flock — otherwise a
  # killed watchdog can orphan the lock.
  exec 9<&-
  SLEEP_PID=""
  trap '[ -n "$SLEEP_PID" ] && kill "$SLEEP_PID" 2>/dev/null; exit 0' TERM INT
  sleep "$TIMEOUT" &
  SLEEP_PID=$!
  wait "$SLEEP_PID"
  printf '\n=== %s TIMED OUT (%ds) ===\n' "$LABEL" "$TIMEOUT" >&2
  kill -TERM "$HOOK_PID" 2>/dev/null
) &
WD=$!

CURRENT_PID=""
cleanup_children() {
  if [ -n "$CURRENT_PID" ]; then
    kill "$CURRENT_PID" 2>/dev/null
    # Reap so the dying child's inherited fds (including the lock fd) close
    # before this hook exits. Mirrors bun-run-quiet.sh's on_sigterm pattern.
    wait "$CURRENT_PID" 2>/dev/null
  fi
  kill "$WD" 2>/dev/null
}
report_timeout_budget() {
  # Watchdog already printed the TIMED OUT banner. Add the breadcrumbs the
  # agent needs to investigate without rerunning the wrapper from scratch.
  printf 'logs: %s\n' "$LOG_DIR" >&2
  printf 'inspect: bun run verify:logs budget\n' >&2
}
write_signal_wrapper_meta() {
  local exit_code="$1" end_ts end_time
  end_ts=$(date +%s)
  end_time=$(date -Iseconds)
  musi_write_wrapper_meta "$META_DIR/wrapper.json" "$META_MODE" \
    "${START_TS:-$end_ts}" "${START_TIME:-$end_time}" "$end_ts" "$end_time" "$exit_code" "$WRAPPER_COMMAND" \
    "$CUR_HEAD" "$CUR_HASH"
  musi_combine_run_meta "$LOG_DIR" "$META_MODE" "$META_DIR/wrapper.json"
  musi_persist_run_meta_history "$LOG_DIR" "$HISTORY_DIR"
}
trap 'cleanup_children; write_signal_wrapper_meta 130; exit 130' INT
trap 'cleanup_children; write_signal_wrapper_meta 124; report_timeout_budget; exit 124' TERM
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
  local step_start step_start_time step_end step_end_time exit_code command
  command="$(musi_meta_command_string "$@")"
  printf '%s: running %s...\n' "$LABEL" "$name"
  step_start=$(date +%s)
  step_start_time=$(date -Iseconds)
  # Close FD 9 in the child so test workers don't hold the lock past our exit;
  # mirrors bun-run-quiet.sh's `9>&-` redirect on its wrapped child.
  env -u MUSI_VERIFY_LOCK_ALREADY_HELD "$@" > "$log" 2>&1 9>&- &
  CURRENT_PID=$!
  if wait "$CURRENT_PID"; then
    exit_code=0
    CURRENT_PID=""
    step_end=$(date +%s)
    step_end_time=$(date -Iseconds)
    musi_write_step_meta "$META_DIR/${name}.json" "$name" "$META_MODE" \
      "$step_start" "$step_start_time" "$step_end" "$step_end_time" "$exit_code" "$command"
    passed="$passed $name"
    return 0
  fi
  exit_code=$?
  CURRENT_PID=""
  step_end=$(date +%s)
  step_end_time=$(date -Iseconds)
  musi_write_step_meta "$META_DIR/${name}.json" "$name" "$META_MODE" \
    "$step_start" "$step_start_time" "$step_end" "$step_end_time" "$exit_code" "$command"
  failed="$failed $name"
  return 1
}

# Stop at the first failure. Manual verification is iterative — a contributor
# fixes one step then re-runs — so dragging on through the remaining steps
# just buries the actionable error under more output.
overall=0
run_step lint "${LINT_CMD[@]}" || overall=1
[ "$overall" -eq 0 ] && { run_step ratchet "${RATCHET_CMD[@]}" || overall=1; }
[ "$overall" -eq 0 ] && { run_step coverage-map "${COVERAGE_MAP_CMD[@]}" || overall=1; }
[ "$overall" -eq 0 ] && { run_step typecheck "${TYPECHECK_CMD[@]}" || overall=1; }
[ "$overall" -eq 0 ] && { run_step test "${TEST_CMD[@]}" || overall=1; }
[ "$overall" -eq 0 ] && { run_step scripts "${SCRIPTS_CMD[@]}" || overall=1; }

ELAPSED=$(( $(date +%s) - START_TS ))
END_TS=$(date +%s)
END_TIME=$(date -Iseconds)

if [ -n "$failed" ]; then
  musi_write_wrapper_meta "$META_DIR/wrapper.json" "$META_MODE" \
    "$START_TS" "$START_TIME" "$END_TS" "$END_TIME" 1 "$WRAPPER_COMMAND" \
    "$CUR_HEAD" "$CUR_HASH"
  musi_combine_run_meta "$LOG_DIR" "$META_MODE" "$META_DIR/wrapper.json"
  musi_persist_run_meta_history "$LOG_DIR" "$HISTORY_DIR"
  printf '\n=== %s FAILED (%ds) ===\n' "$LABEL" "$ELAPSED"
  printf 'Passed:%s\n' "$passed"
  printf 'Failed:%s\n' "$failed"
  for task in $failed; do
    printf '\n--- %s (full log: %s/%s.log) ---\n' "$task" "$LOG_DIR" "$task"
    ai_filtered_task_log_excerpt "$task" "$LOG_DIR/${task}.log" 30
  done
  case "$failed" in
    *lint*) printf "\nHint: try 'bun run lint:fix' to auto-fix formatting issues.\n" ;;
  esac
  exit 1
fi

musi_write_wrapper_meta "$META_DIR/wrapper.json" "$META_MODE" \
  "$START_TS" "$START_TIME" "$END_TS" "$END_TIME" 0 "$WRAPPER_COMMAND" \
  "$CUR_HEAD" "$CUR_HASH"
musi_combine_run_meta "$LOG_DIR" "$META_MODE" "$META_DIR/wrapper.json"
musi_persist_run_meta_history "$LOG_DIR" "$HISTORY_DIR"

# --- 5. Success marker (same format as pre-commit's) -----------------------
if ! musi_write_success_marker "$MARKER" "$CUR_HEAD" "$CUR_HASH"; then
  printf '%s: WARN: failed to write marker %s\n' "$LABEL" "$MARKER" >&2
fi

if [ "$ELAPSED" -gt "$WARN_AFTER" ]; then
  printf '%s: WARN: elapsed=%ds exceeds soft budget %ds (hard=%ds). Inspect: bun run verify:logs budget\n' \
    "$LABEL" "$ELAPSED" "$WARN_AFTER" "$INTERACTIVE_TIMEOUT" >&2
fi

printf '%s: OK (%ds) —%s\n' "$LABEL" "$ELAPSED" "$passed"
