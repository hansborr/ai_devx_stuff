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
# Single-writer invariant: CLAUDE.md 'Checking your work' says to run
# verification commands SEQUENTIALLY. A short blocking flock queues brief
# accidental overlap, then denies with a Monitor/flock wait command instead of
# occupying the current tool call for minutes.
#
# Content-keyed idempotency: a per-script marker caches (fingerprint, exit,
# timestamp). Re-invocations within 1800s on an unchanged worktree short-circuit
# — success replays "cached OK", failure replays the tail of the previous log.
# The fingerprint is the real gate; TTL just bounds how long "nothing changed"
# is trusted when clocks/state go weird. Bypass with FORCE_VERIFY=1.
#
# Signals: an internal watchdog (210s, covering command execution only) plus
# INT/TERM traps kill the wrapped bash -c
# child so the old zombie-process pattern can't re-emerge if the hook itself
# is signalled. An early TERM trap covers the flock-wait window before the
# main traps install. Harness timeout is 280s as a final backstop.
#
# Full per-run logs live in /tmp/musi-bun-logs/<script>.log.

set -u

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
HOOK_LIB="$REPO_ROOT/scripts/ai-hooks"
# shellcheck source=/dev/null
. "$HOOK_LIB/common.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/policy.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/cache.sh"

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
# Claude's pathological pattern: start `bun run test:changed` in the background,
# then Read the log repeatedly while it runs, burning tokens on incomplete
# output. CLAUDE.md 'Checking your work' says foreground-only — enforce it.
if [ "$BACKGROUND" = "true" ]; then
  REASON="\`bun run $SCRIPT\` must run in the foreground, not in the background.

CLAUDE.md 'Checking your work' says: run lint:changed, typecheck, test:changed in the foreground, one-at-a-time. Backgrounding them and polling the log wastes tokens on partial output and usually triggers a parallel-invocation conflict when you try to re-run.

This hook already caches results (${SCRIPT} on an unchanged worktree replays the previous run instantly) and caps output at a 40-line tail on failure, so there is no context benefit to backgrounding it.

Retry with run_in_background: false."
  jq -Rn --arg r "$REASON" '{decision:"deny", reason:$r}'
  exit 0
fi

# Stateful verify viewers/controllers are still recognized by this hook so
# package-subdirectory invocations get rewritten to the repo root, but their
# output must remain live and uncached.
if ai_bun_cmd_bypasses_lock "$CMD"; then
  printf -v ROOT_CMD 'cd %q && %s' "$REPO_ROOT" "$CMD"
  ai_claude_updated_command "$ROOT_CMD"
fi

# --- Single-writer lock ----------------------------------------------------
# Short wait: brief accidental overlap queues, but a longer holder gets a
# denial plus an explicit Monitor/flock command so this hook stays inside the
# interactive budget.
LOCK="${AI_BUN_LOCK:-/tmp/musi-bun-lock}"
LOCK_WAIT="${AI_BUN_LOCK_WAIT:-25}"
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
    '{decision:"deny", reason:$r}'
  exit 0
}
trap on_early_signal TERM INT

LOCK_START=$(date +%s)
if ! flock -w "$LOCK_WAIT" 9; then
  HOLDER=$(cat "$LOCK" 2>/dev/null || echo '<holder info unavailable>')
  REASON="Waited ${LOCK_WAIT}s for another \`bun run\` invocation to finish but it is still running ($HOLDER). That's long enough that the in-flight run is almost certainly hung — this is not the usual accidental-parallelization case.

CLAUDE.md 'Checking your work' says: run lint:changed, typecheck, and test:changed SEQUENTIALLY — one-at-a-time, not as parallel Bash tool calls in a single message.

To wait for the in-flight run WITHOUT polling, launch this command in the background and attach Monitor:

  flock $LOCK true && echo FREE

When Monitor reports FREE, retry this command. If the holder PID above is stuck, inspect it first — don't just wait forever."
  jq -Rn --arg r "$REASON" '{decision:"deny", reason:$r}'
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
MARKER="$LOG_DIR/last.$SCRIPT_SAFE"

cd "$REPO_ROOT"

# --- Content-keyed idempotency --------------------------------------------
# Fingerprint: HEAD + tracked-file diff + hashes of untracked files. Captures
# anything the :changed scripts would see. The fingerprint — not the TTL —
# is the real gate; TTL just bounds how long a "nothing changed" claim is
# trusted when clocks/state get weird.
CUR_FP=$(ai_worktree_fingerprint "$REPO_ROOT")
TTL="$AI_BUN_TTL"

if ai_read_bun_marker "$MARKER" && [ -z "$FORCE_VERIFY_REQ" ] && [ "${FORCE_VERIFY:-}" != "1" ]; then
  NOW=$(date +%s)
  AGE=$((NOW - AI_MARKER_LAST_TS))
  if [ "$AGE" -lt "$TTL" ] && [ "$AI_MARKER_LAST_FP" = "$CUR_FP" ]; then
    if [ "$AI_MARKER_LAST_EXIT" -eq 0 ]; then
      MSG="$SCRIPT cached OK (${AGE}s ago, unchanged worktree) - prefix command with FORCE_VERIFY=1 to re-run. Full log: $LOG"
      ai_claude_result_command "$MSG" /tmp/musi-bun-result
    fi
    # Cached failure — replay the tail so Claude doesn't lose context.
    SUMMARY=$(ai_bun_cached_failure_summary "$SCRIPT" "$LOG" "$AGE" "$AI_MARKER_LAST_EXIT")
    jq -Rn --arg r "$SUMMARY" '{decision:"deny", reason:$r}'
    exit 0
  fi
fi

# --- Signal handling / watchdog -------------------------------------------
# Without these, a harness timeout (or Ctrl-C) orphans the bash -c child —
# the exact zombie-process pattern the old verify.sh produced. Pattern
# mirrors .husky/pre-commit. Internal watchdog stays under the 240s
# interactive budget; .claude/settings.json's 280s timeout is only a final
# backstop if this script wedges before its own cleanup path.
HOOK_PID=$$
TIMEOUT="${AI_BUN_TIMEOUT:-210}"
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
# our exit. Run async so the TERM trap can reach both child and watchdog.
bash -c "$CMD" > "$LOG" 2>&1 9>&- &
CHILD=$!

# INT (user cancel) and TERM (watchdog / external kill): emit a deny JSON
# and exit 0, NOT exit 130/124. If the hook exits non-zero without a
# decision, Claude Code treats it as a non-blocking error and runs the
# ORIGINAL bun command raw — doubling the runtime we just timed out and
# streaming the very verbose output the hook exists to suppress. A proper
# deny keeps the tool call blocked with a readable explanation.
on_sigterm() {
  kill "$CHILD" "$WD" 2>/dev/null
  wait "$CHILD" 2>/dev/null
  local el=$(( $(date +%s) - START ))
  local summary="$SCRIPT killed by watchdog at ${TIMEOUT}s (${el}s elapsed). Likely a hung test or slow dev server, not a genuine failure — investigate the slow step, or raise AI_BUN_TIMEOUT for this invocation. Full log: $LOG

--- last 40 lines ---
$(tail -n 40 "$LOG" 2>/dev/null)"
  jq -Rn --arg r "$summary" '{decision:"deny", reason:$r}'
  exit 0
}

on_sigint() {
  kill "$CHILD" "$WD" 2>/dev/null
  wait "$CHILD" 2>/dev/null
  local el=$(( $(date +%s) - START ))
  jq -Rn --arg r "$SCRIPT cancelled (${el}s elapsed). Full log: $LOG" '{decision:"deny", reason:$r}'
  exit 0
}

trap on_sigint INT
trap on_sigterm TERM
trap 'kill "$WD" 2>/dev/null' EXIT

wait "$CHILD"
EXIT=$?
ELAPSED=$(( $(date +%s) - START ))

# Record result for idempotency — but only for real exits. Signal exits
# (EXIT >= 128) mean the command was killed; don't poison the cache with
# a "failure" that would just be retried.
if [ "$EXIT" -lt 128 ]; then
  ai_write_bun_marker "$MARKER" "$CUR_FP" "$EXIT"
fi

if [ "$EXIT" -eq 0 ]; then
  MSG="$SCRIPT OK (${ELAPSED}s) - full log: $LOG"
  # Per-invocation file — no shared-state race if flock ever fails open.
  ai_claude_result_command "$MSG" /tmp/musi-bun-result
fi

# Failure path: return a bounded tail of the full log.
SUMMARY=$(ai_bun_failure_summary "$SCRIPT" "$LOG" "$EXIT" "$ELAPSED" "$(cat "$LOG" 2>/dev/null)")

jq -Rn --arg r "$SUMMARY" '{decision:"deny", reason:$r}'
