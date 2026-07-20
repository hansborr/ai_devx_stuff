#!/bin/bash
# Wraps single-command `bun run <script>` invocations for whitelisted scripts:
# on success, collapses to a one-line confirmation via hookSpecificOutput.updatedInput;
# on failure, replaces the command output with a tail of the captured log.
#
# Keeps verbose tool output out of Claude's context window without hiding errors.
# Only matches standalone invocations — compound commands (&&, ||, ;, |) pass
# through unchanged so this hook never swallows something like
# `bun run lint:changed && echo next`.
#
# Single-writer invariant: manual verification commands should run
# SEQUENTIALLY. A blocking flock queues accidental overlap inside the same
# interactive budget used by verify/pre-commit, then denies with holder details.
#
# Content-keyed idempotency: a per-script marker caches (fingerprint, exit,
# timestamp). Re-invocations within 3600s on an unchanged worktree short-circuit
# — success replays "cached OK", failure replays the tail of the previous log.
# The fingerprint is the real gate; TTL just bounds how long "nothing changed"
# is trusted when clocks/state go weird. Bypass with FORCE_VERIFY=1.
#
# Signals: an internal watchdog (MUSI_GATE_INTERACTIVE_TIMEOUT_DEFAULT by
# default, minus lock wait) plus
# INT/TERM traps kill the wrapped bash -c
# child so the old zombie-process pattern can't re-emerge if the hook itself
# is signalled. An early TERM trap covers the flock-wait window before the
# main traps install. The generated harness timeout is slightly larger so this
# wrapper can emit JSON first.
#
# Full per-run logs live in the worktree-scoped AI_BUN_LOG_DIR default.

set -u

HOOK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_REPO_ROOT=$(git -C "$HOOK_LIB" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
# Tests can point the wrapped command/cache target at a fixture repo; hook code
# and helper libraries still load from this checkout.
REPO_ROOT="${AI_BUN_REPO_ROOT:-$HOOK_REPO_ROOT}"
# shellcheck source=/dev/null
. "$HOOK_LIB/common.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/policy.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/cache.sh"
# shellcheck source=/dev/null
. "$HOOK_REPO_ROOT/scripts/process-tree.sh"
# shellcheck source=/dev/null
. "$HOOK_REPO_ROOT/scripts/ai-hooks/hook-timeouts.generated.sh"

# Read the hook payload once — stdin is consumed on first read, and we need
# both .tool_input.command and .tool_input.run_in_background.
PAYLOAD=$(ai_read_payload)

CMD=$(ai_payload_command "$PAYLOAD")
BACKGROUND=$(ai_payload_background "$PAYLOAD")

# Allow `FORCE_VERIFY=1` as a command prefix so the wrapper can strip it
# before matching the whitelist (otherwise the env assignment pushes the
# command out of the regex). The stripped CMD is what actually runs.
FORCE_VERIFY_REQ=""
if ai_has_force_verify_prefix "$CMD"; then
  FORCE_VERIFY_REQ=1
  CMD=$(ai_strip_force_verify_prefix "$CMD")
fi

# Scripts this hook wraps. Watch/dev/db/studio commands are intentionally
# excluded: they stream output Claude needs to see live, or they have
# side-effects on shared infrastructure that deserve visible output.
if ! ai_is_wrapped_bun_cmd "$CMD"; then
  echo '{"continue":true}'
  exit 0
fi

# Extract the script name for a readable summary.
SCRIPT=$(ai_bun_script_from_cmd "$CMD")

# --- Block background invocation ------------------------------------------
# Claude's pathological pattern: start `bun run test:changed` in the
# background, then Read the log repeatedly while it runs, burning tokens on
# incomplete output. Enforce foreground execution here.
if [ "$BACKGROUND" = "true" ]; then
  REASON="\`bun run $SCRIPT\` must run in the foreground, not in the background.

Run verification commands in the foreground, one at a time. Backgrounding them and polling the log wastes tokens on partial output and usually triggers a parallel-invocation conflict when you try to re-run.

This hook already caches results (${SCRIPT} on an unchanged worktree replays the previous run instantly) and caps output at a 40-line tail on failure, so there is no context benefit to backgrounding it.

Retry with run_in_background: false."
  jq -Rn --arg r "$REASON" '{decision:"block", reason:$r}'
  exit 0
fi

# Live-output/cache-bypass commands are still recognized by this hook so
# package-subdirectory invocations get rewritten to the repo root, but their
# output must remain live and uncached.
if ai_bun_cmd_bypasses_lock "$CMD"; then
  printf -v ROOT_CMD 'cd %q && %s' "$REPO_ROOT" "$CMD"
  ai_claude_updated_command "$ROOT_CMD"
fi

BUN_ACTIVE_PROCESS_STATE="${AI_BUN_ACTIVE_PROCESS_STATE:-$AI_BUN_STATE_DIR/active-process}"

ai_bun_wrapper_process_is_running() {
  local pid="$1"
  local args

  musi_process_is_running "$pid" || return 1
  args=$(ps -o args= -p "$pid" 2>/dev/null || true)
  case "$args" in
    *bun-run-quiet.sh*) return 0 ;;
  esac
  return 1
}

ai_bun_block_if_orphaned_child_active() {
  local wrapper_pid child_pid pgid script started cmd process_ref=""

  [ -f "$BUN_ACTIVE_PROCESS_STATE" ] || return 0

  wrapper_pid=$(ai_read_state_value "$BUN_ACTIVE_PROCESS_STATE" WRAPPER_PID || true)
  child_pid=$(ai_read_state_value "$BUN_ACTIVE_PROCESS_STATE" CHILD_PID || true)
  pgid=$(ai_read_state_value "$BUN_ACTIVE_PROCESS_STATE" CHILD_PGID || true)
  script=$(ai_read_state_value "$BUN_ACTIVE_PROCESS_STATE" SCRIPT || true)
  started=$(ai_read_state_value "$BUN_ACTIVE_PROCESS_STATE" STARTED || true)
  cmd=$(ai_read_state_value "$BUN_ACTIVE_PROCESS_STATE" CMD || true)

  if [ -n "$pgid" ] && musi_process_group_is_running "$pgid"; then
    process_ref="PGID=$pgid"
  elif [ -n "$child_pid" ] && musi_process_is_running "$child_pid"; then
    process_ref="PID=$child_pid"
  else
    rm -f "$BUN_ACTIVE_PROCESS_STATE"
    return 0
  fi

  if ai_bun_wrapper_process_is_running "$wrapper_pid"; then
    return 0
  fi

  REASON="Previous bun-run-quiet.sh wrapper died while \`bun run ${script:-unknown}\` was still running ($process_ref, child PID=${child_pid:-unknown}, started=${started:-unknown}).

The worktree lock is free because the wrapper process exited, but the recorded child process is still active; starting another verification run in this worktree could race the orphan.

Wait for the recorded process to finish, or inspect and terminate it before retrying.

Command: ${cmd:-unknown}"
  jq -Rn --arg r "$REASON" '{decision:"block", reason:$r}'
  exit 0
}

ai_bun_write_active_process_state() {
  mkdir -p "$(dirname "$BUN_ACTIVE_PROCESS_STATE")"
  {
    printf 'WRAPPER_PID=%s\n' "$$"
    printf 'CHILD_PID=%s\n' "$CHILD"
    [ -n "${CHILD_PGID:-}" ] && printf 'CHILD_PGID=%s\n' "$CHILD_PGID"
    printf 'SCRIPT=%s\n' "$SCRIPT"
    printf 'CMD=%s\n' "$CMD"
    printf 'STARTED=%s\n' "$(date -Iseconds)"
  } > "$BUN_ACTIVE_PROCESS_STATE"
}

# --- Single-writer lock ----------------------------------------------------
# Use the same default interactive budget as verify/pre-commit. Explicit
# AI_BUN_LOCK_WAIT and AI_BUN_TIMEOUT overrides remain honored for tests and
# one-off diagnostics.
ai_bun_block_if_orphaned_child_active
LOCK="${AI_BUN_LOCK:-$(musi_standard_bun_lock "$REPO_ROOT")}"
# Sourced from hook/ai-bun-run-quiet's generated harness timeout.
BUN_RUN_QUIET_TIMEOUT_MARGIN=60
TOTAL_TIMEOUT=$(ai_clamp_timeout_below_harness \
  "bun-run-quiet" \
  "${AI_BUN_TIMEOUT:-${MUSI_INTERACTIVE_TIMEOUT:-$MUSI_GATE_INTERACTIVE_TIMEOUT_DEFAULT}}" \
  "$BUN_RUN_QUIET_HOOK_TIMEOUT" \
  "$BUN_RUN_QUIET_TIMEOUT_MARGIN")
LOCK_WAIT="${AI_BUN_LOCK_WAIT:-$TOTAL_TIMEOUT}"
if [ "$LOCK_WAIT" -gt "$TOTAL_TIMEOUT" ]; then
  LOCK_WAIT="$TOTAL_TIMEOUT"
fi
mkdir -p "$(dirname "$LOCK")"
exec 9<>"$LOCK"

# Early TERM/INT trap: covers the flock-wait window before the main traps
# install below. Without this, a harness SIGTERM during the wait exits the
# hook non-zero without a decision JSON, and Claude Code falls through to
# running the original command raw (the round-4 bug, now reachable again
# because the wait window is long enough to hit the harness timeout).
on_early_signal() {
  local holder
  holder=$(cat "$LOCK" 2>/dev/null || echo '<holder info unavailable>')
  jq -Rn --arg r "bun-run-quiet.sh killed while waiting for $LOCK (holder: $holder). Retry once the in-flight run completes." \
    '{decision:"block", reason:$r}'
  exit 0
}
trap on_early_signal TERM INT

LOCK_START=$(date +%s)
if ! flock -w "$LOCK_WAIT" 9; then
  HOLDER=$(cat "$LOCK" 2>/dev/null || echo '<holder info unavailable>')
  REASON="Waited ${LOCK_WAIT}s for another \`bun run\` invocation to finish but it is still running ($HOLDER). That's long enough that the in-flight run may be hung — this is not the usual accidental-parallelization case.

Run verification commands sequentially: one at a time, not as parallel Bash tool calls in a single message.

Wait for the in-flight run to finish before retrying this command. If the holder PID above is stuck, inspect it first."
  jq -Rn --arg r "$REASON" '{decision:"block", reason:$r}'
  exit 0
fi
LOCK_WAITED=$(( $(date +%s) - LOCK_START ))
[ "$LOCK_WAITED" -gt 5 ] && echo "bun-run-quiet: waited ${LOCK_WAITED}s for $LOCK" >&2

# Clear the early traps — the main INT/TERM traps install after the watchdog
# starts. Between here and there, the window is tiny (a few file writes);
# a signal in that gap falls back to bash's default behavior, which is fine.
trap - TERM INT
{ printf 'PID=%s SCRIPT=%s STARTED=%s\n' "$$" "$SCRIPT" "$(date -Iseconds)"; } > "$LOCK"

LOG_DIR="$AI_BUN_LOG_DIR"
mkdir -p "$LOG_DIR"
SCRIPT_SAFE=$(ai_safe_script_name "$SCRIPT")
LOG="$LOG_DIR/$SCRIPT_SAFE.log"
# Marker is keyed on the EXACT argv tail, not just the script name (H1/H2), so a
# broader or corrected command can't replay a narrower/older run's cached state.
MARKER="$LOG_DIR/$(ai_bun_marker_name "$CMD")"

cd "$REPO_ROOT" || exit 1

# --- Content-keyed idempotency --------------------------------------------
# Fingerprint: HEAD + tracked-file diff + hashes of untracked files. Captures
# anything the :changed scripts would see. The fingerprint — not the TTL —
# is the real gate; TTL just bounds how long a "nothing changed" claim is
# trusted when clocks/state get weird.
CUR_FP_VALID=1
if ! CUR_FP=$(musi_require_fingerprint \
  "bun-run cache" ai_worktree_fingerprint "$REPO_ROOT"); then
  CUR_FP_VALID=0
  CUR_FP=""
fi
TTL="$AI_BUN_TTL"

if [ "$CUR_FP_VALID" -eq 1 ] \
  && ai_read_bun_marker "$MARKER" \
  && [ -z "$FORCE_VERIFY_REQ" ] \
  && [ "${FORCE_VERIFY:-}" != "1" ]; then
  NOW=$(date +%s)
  AGE=$((NOW - AI_MARKER_LAST_TS))
  if ai_marker_age_within_ttl "$AGE" "$TTL" && [ "$AI_MARKER_LAST_FP" = "$CUR_FP" ]; then
    if [ "$AI_MARKER_LAST_EXIT" -eq 0 ]; then
      MSG="$SCRIPT cached OK (${AGE}s ago, unchanged worktree) - prefix command with FORCE_VERIFY=1 to re-run. Full log: $LOG"
      ai_claude_result_command "$MSG" "$AI_BUN_RESULT_TMP_PREFIX"
    fi
    # Cached failure — replay the tail so Claude doesn't lose context.
    SUMMARY=$(ai_bun_cached_failure_summary "$SCRIPT" "$LOG" "$AGE" "$AI_MARKER_LAST_EXIT")
    jq -Rn --arg r "$SUMMARY" '{decision:"block", reason:$r}'
    exit 0
  fi
fi

# --- Signal handling / watchdog -------------------------------------------
# Without these, a harness timeout (or Ctrl-C) orphans the bash -c child —
# the exact zombie-process pattern the old verify.sh produced. Pattern
# mirrors .husky/pre-commit. The generated harness timeout is only a final
# backstop if this script wedges before its own cleanup path.
HOOK_PID=$$
TIMEOUT=$(( TOTAL_TIMEOUT - LOCK_WAITED ))
if [ "$TIMEOUT" -le 0 ]; then
  HOLDER=$(cat "$LOCK" 2>/dev/null || echo '<holder info unavailable>')
  REASON="Waited ${LOCK_WAITED}s for the \`bun run\` lock, exhausting the ${TOTAL_TIMEOUT}s interactive budget before \`bun run $SCRIPT\` could start ($HOLDER).

Retry after the in-flight run completes, or raise AI_BUN_TIMEOUT for this invocation if the wait was intentional."
  jq -Rn --arg r "$REASON" '{decision:"block", reason:$r}'
  exit 0
fi
(
  # Close FD 9 so our own `sleep` child doesn't inherit the flock: otherwise
  # when the parent kills us and exits, `sleep` orphans to init still holding
  # the lock, blocking the NEXT bun-run invocation until TIMEOUT elapses.
  exec 9<&-
  SLEEP_PID=""
  # On TERM/INT, kill the sleep child before exiting (otherwise it orphans).
  trap '[ -n "$SLEEP_PID" ] && kill "$SLEEP_PID" 2>/dev/null; exit 0' TERM INT
  sleep "$TIMEOUT" &
  SLEEP_PID=$!
  wait "$SLEEP_PID"
  kill -TERM "$HOOK_PID" 2>/dev/null
) &
WD=$!

START=$(date +%s)
# Close FD 9 in the child so forked test workers don't hold the lock past
# our exit. The active-process state below guards the SIGKILL window where the
# wrapper cannot run traps but the fd-9-free child group may continue.
if command -v setsid >/dev/null 2>&1; then
  setsid bash -c "$CMD" > "$LOG" 2>&1 9>&- &
  CHILD=$!
  CHILD_PGID="$CHILD"
else
  bash -c "$CMD" > "$LOG" 2>&1 9>&- &
  CHILD=$!
  CHILD_PGID=""
fi
ai_bun_write_active_process_state

ai_bun_signal_child() {
  local signal="${1:-TERM}"

  if [ -n "${CHILD_PGID:-}" ] && musi_process_group_is_running "$CHILD_PGID"; then
    musi_signal_process_group "$CHILD_PGID" "$signal"
    return 0
  fi
  musi_signal_process_tree "$CHILD" "$signal"
}

# INT (user cancel) and TERM (watchdog / external kill): emit a block JSON
# and exit 0, NOT exit 130/124. If the hook exits non-zero without a
# decision, Claude Code treats it as a non-blocking error and runs the
# ORIGINAL bun command raw — doubling the runtime we just timed out and
# streaming the very verbose output the hook exists to suppress. A proper
# block keeps the tool call blocked with a readable explanation.
on_sigterm() {
  ai_bun_signal_child TERM
  kill "$WD" 2>/dev/null
  wait "$CHILD" 2>/dev/null
  local el=$(( $(date +%s) - START ))
  local summary
  summary="$SCRIPT killed by watchdog at ${TIMEOUT}s (${el}s elapsed). Likely a hung test or slow dev server, not a genuine failure — investigate the slow step, or raise AI_BUN_TIMEOUT for this invocation. Full log: $LOG

--- last 40 lines ---
$(tail -n 40 "$LOG" 2>/dev/null)"
  jq -Rn --arg r "$summary" '{decision:"block", reason:$r}'
  exit 0
}

on_sigint() {
  ai_bun_signal_child TERM
  kill "$WD" 2>/dev/null
  wait "$CHILD" 2>/dev/null
  local el=$(( $(date +%s) - START ))
  jq -Rn --arg r "$SCRIPT cancelled (${el}s elapsed). Full log: $LOG" '{decision:"block", reason:$r}'
  exit 0
}

trap on_sigint INT
trap on_sigterm TERM
ai_bun_cleanup() {
  kill "$WD" 2>/dev/null
  rm -f "$BUN_ACTIVE_PROCESS_STATE"
}
trap ai_bun_cleanup EXIT

wait "$CHILD"
EXIT=$?
ELAPSED=$(( $(date +%s) - START ))

# Record result for idempotency — but only for real exits. Signal exits
# (EXIT >= 128) mean the command was killed; don't poison the cache with
# a "failure" that would just be retried.
if [ "$EXIT" -lt 128 ] && [ "$CUR_FP_VALID" -eq 1 ]; then
  ai_write_bun_marker "$MARKER" "$CUR_FP" "$EXIT"
fi

if [ "$EXIT" -eq 0 ]; then
  MSG="$SCRIPT OK (${ELAPSED}s) - full log: $LOG"
  # Per-invocation file — no shared-state race if flock ever fails open.
  ai_claude_result_command "$MSG" "$AI_BUN_RESULT_TMP_PREFIX"
fi

# Failure path: return a bounded tail of the full log.
SUMMARY=$(ai_bun_failure_summary "$SCRIPT" "$LOG" "$EXIT" "$ELAPSED" "$(cat "$LOG" 2>/dev/null)")

jq -Rn --arg r "$SUMMARY" '{decision:"block", reason:$r}'
