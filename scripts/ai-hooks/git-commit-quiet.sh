#!/bin/bash
# Wraps `git commit` to keep the pre-commit hook's verbose output
# (lint:changed, typecheck, test:changed running in parallel) out of
# Claude's context window.
#
# On success: replaces the command with a one-line commit summary via
#   hookSpecificOutput.updatedInput.
# On failure: parses the Passed:/Failed: lines the pre-commit hook emits
#   and returns only the tails of failed tasks. Full per-task logs live
#   in the worktree-scoped pre-commit log directory.
#
# Single-writer invariant: a non-blocking worktree flock prevents two Claude
# sessions (or a racing retry) from committing concurrently in the same
# worktree. A second Git-common-dir queue lock serializes commits across sibling
# worktrees for the full wrapped `git commit` process. Contention reports the
# current lock holder.
#
# Per-invocation result file: mktemp avoids the /tmp/musi-commit-result
# race when two commits land in parallel.

set -u

HOOK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git -C "$HOOK_LIB" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
# shellcheck source=/dev/null
. "$HOOK_LIB/common.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/policy.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/cache.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/commit-output.sh"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/process-tree.sh"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/ai-hooks/hook-timeouts.generated.sh"

PAYLOAD=$(ai_read_payload)
CMD=$(ai_payload_command "$PAYLOAD")
PAYLOAD_CWD=$(ai_payload_cwd "$PAYLOAD")
[ -n "$PAYLOAD_CWD" ] || PAYLOAD_CWD=$(pwd -P)

# Only wrap `git commit` invocations; pass everything else through.
ai_is_git_commit_cmd "$CMD" || {
  echo '{"continue":true}'
  exit 0
}

# WORK_ROOT is the checkout the commit lands in — resolved from the command's
# leading `cd`/`git -C` forms or the payload cwd, NOT from REPO_ROOT (the hook
# file's own checkout, used only to source the libraries below). A /workspace
# session committing in a linked worktree via `cd <wt> && git commit` must key
# its locks, HEAD snapshots, branch policy, and success summary on the worktree;
# keying them on REPO_ROOT is J (false "no commit landed", mis-keyed locks).
TARGET_DIR=$(ai_resolve_target_dir "$CMD" "$PAYLOAD_CWD" "$REPO_ROOT")
WORK_ROOT=$(git -C "$TARGET_DIR" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$REPO_ROOT")

# Self-block forbidden commits BEFORE running them. This hook executes the
# command itself (bash -c "$CMD" below), so a `git commit --amend` would rewrite
# HEAD here even though no-direct-db.sh / the deny glob report it as "blocked"
# (G1). The gate above only matches an adjacent `git commit`, so the `git -c …
# commit --amend` form never reaches this hook — it is closed at the policy
# layer (widened regex) before the harness dispatches it. ai_emit_block exits.
ai_preflight_or_block "$CMD" "$WORK_ROOT"

# Fail closed when the commit names a checkout that could not be resolved.
# WORK_ROOT above has silently become REPO_ROOT (this hook's own checkout, and
# this wrapper EXECUTES the command), so without this the branch guard clears a
# repository it never looked at and the commit runs.
if TARGET_REASON=$(ai_unverifiable_commit_target_reason \
  "$CMD" "$PAYLOAD_CWD" "$REPO_ROOT"); then
  ai_emit_block "$TARGET_REASON"
fi

# --- Single-writer lock ----------------------------------------------------
LOCK="${AI_GIT_COMMIT_LOCK:-$(musi_standard_git_commit_lock "$WORK_ROOT")}"
mkdir -p "$(dirname "$LOCK")"
exec 9<>"$LOCK"
if ! flock -n 9; then
  HOLDER=$(cat "$LOCK" 2>/dev/null || echo '<holder info unavailable>')
  REASON="Another git commit is in progress ($HOLDER).

Do NOT retry — it will fail here again and waste tokens on repeated polling.
Wait for the in-flight commit to finish, then check git status before retrying — the previous commit may already have succeeded."
  jq -Rn --arg r "$REASON" '{decision:"block", reason:$r}'
  exit 0
fi
{ printf 'PID=%s STARTED=%s\n' "$$" "$(date -Iseconds)"; } > "$LOCK"

# Sourced from hook/ai-git-commit-quiet's generated harness timeout.
GIT_COMMIT_QUIET_TIMEOUT_MARGIN=60
TOTAL_TIMEOUT=$(ai_clamp_timeout_below_harness \
  "git-commit-quiet" \
  "${AI_GIT_COMMIT_TIMEOUT:-${MUSI_INTERACTIVE_TIMEOUT:-$MUSI_GATE_INTERACTIVE_TIMEOUT_DEFAULT}}" \
  "$GIT_COMMIT_QUIET_HOOK_TIMEOUT" \
  "$GIT_COMMIT_QUIET_TIMEOUT_MARGIN")

# --- Cross-worktree commit queue -------------------------------------------
# Sibling worktrees serialize on a common-dir-keyed lock. Rather than a single
# opaque `flock -w`, wait in a bounded FOREGROUND poll loop (`flock -n` + short
# sleeps) so a parked lane is not invisible: every heartbeat interval it prints
# the current holder, how long it has waited, and how many peer lanes are queued
# behind the same lock. Visibility comes from a per-lane ticket under
# `<lock>.waiters/`; peers count live tickets (and expire a SIGKILLed lane's
# stale one via `kill -0`). Deliberately no background heartbeat child: the queue
# wait runs before the wrapper's EXIT trap is installed, so a detached heartbeat
# could outlive a killed lane and print forever — the foreground loop cannot.
COMMIT_QUEUE_LOCK="${MUSI_COMMIT_QUEUE_LOCK:-$(musi_standard_commit_queue_lock "$WORK_ROOT")}"
COMMIT_QUEUE_WAIT="${MUSI_COMMIT_QUEUE_TIMEOUT:-$TOTAL_TIMEOUT}"
if [ "$COMMIT_QUEUE_WAIT" -gt "$TOTAL_TIMEOUT" ]; then
  COMMIT_QUEUE_WAIT="$TOTAL_TIMEOUT"
fi
COMMIT_QUEUE_POLL_INTERVAL="${MUSI_COMMIT_QUEUE_POLL_INTERVAL:-1}"
COMMIT_QUEUE_HEARTBEAT_INTERVAL="${MUSI_COMMIT_QUEUE_HEARTBEAT_INTERVAL:-60}"
mkdir -p "$(dirname "$COMMIT_QUEUE_LOCK")"
exec 8<>"$COMMIT_QUEUE_LOCK"

# Register this lane so peers can see it, and guarantee the ticket is dropped on
# any catchable exit during the wait. The wrapper's own EXIT/INT/TERM traps are
# installed later (post-acquire); these interim traps cover only the wait window
# so a normally-terminated wait never leaves a ghost ticket. A SIGKILL cannot run
# them — peers expire the orphan via `kill -0` on its PID.
WAITER_DIR=$(musi_commit_queue_waiter_dir "$COMMIT_QUEUE_LOCK")
WAITER_TICKET="$WAITER_DIR/$$"
musi_cleanup_waiter_ticket() {
  [ -n "${WAITER_TICKET:-}" ] && rm -f "$WAITER_TICKET" 2>/dev/null
}
trap 'musi_cleanup_waiter_ticket' EXIT
trap 'musi_cleanup_waiter_ticket; exit 130' INT
trap 'musi_cleanup_waiter_ticket; exit 143' TERM
musi_register_commit_queue_waiter "$WAITER_DIR" "$$" "$WORK_ROOT" || true

QUEUE_START=$(date +%s)
QUEUE_NEXT_HEARTBEAT=$(( QUEUE_START + COMMIT_QUEUE_HEARTBEAT_INTERVAL ))
QUEUE_ACQUIRED=0
while :; do
  if flock -n 8; then
    QUEUE_ACQUIRED=1
    break
  fi
  NOW=$(date +%s)
  QUEUE_WAITED=$(( NOW - QUEUE_START ))
  [ "$QUEUE_WAITED" -ge "$COMMIT_QUEUE_WAIT" ] && break
  if [ "$NOW" -ge "$QUEUE_NEXT_HEARTBEAT" ]; then
    HOLDER=$(cat "$COMMIT_QUEUE_LOCK" 2>/dev/null || echo '<holder info unavailable>')
    OTHERS=$(musi_count_commit_queue_waiters "$WAITER_DIR" "$$")
    printf 'git-commit-quiet: still waiting for shared commit queue (%ss) — holder: %s, %s other waiter(s)\n' \
      "$QUEUE_WAITED" "$HOLDER" "$OTHERS" >&2
    QUEUE_NEXT_HEARTBEAT=$(( NOW + COMMIT_QUEUE_HEARTBEAT_INTERVAL ))
  fi
  sleep "$COMMIT_QUEUE_POLL_INTERVAL"
done

QUEUE_WAITED=$(( $(date +%s) - QUEUE_START ))
if [ "$QUEUE_ACQUIRED" -ne 1 ]; then
  HOLDER=$(cat "$COMMIT_QUEUE_LOCK" 2>/dev/null || echo '<holder info unavailable>')
  OTHERS=$(musi_count_commit_queue_waiters "$WAITER_DIR" "$$")
  musi_cleanup_waiter_ticket
  REASON="Waited ${QUEUE_WAITED}s for the shared commit queue lock but another worktree is still committing ($HOLDER). Queue depth: ${OTHERS} other waiter(s).

Wait for the in-flight commit to finish, then check git status before retrying."
  jq -Rn --arg r "$REASON" '{decision:"block", reason:$r}'
  exit 0
fi

# Acquired: drop our waiter ticket and hand trap ownership to the commit phase
# (its EXIT/INT/TERM handlers install below). No ticket remains once we hold the
# lock — we are the holder now, recorded in the lock file for peers to read.
musi_remove_commit_queue_waiter "$WAITER_DIR" "$$"
WAITER_TICKET=""
trap - EXIT INT TERM
[ "$QUEUE_WAITED" -gt 5 ] && printf 'git-commit-quiet: waited %ss for shared commit queue %s\n' "$QUEUE_WAITED" "$COMMIT_QUEUE_LOCK" >&2
{
  printf 'PID=%s WORKTREE=%s CMD=%s STARTED=%s\n' "$$" "$WORK_ROOT" "$CMD" "$(date -Iseconds)"
} > "$COMMIT_QUEUE_LOCK"

TIMEOUT=$(( TOTAL_TIMEOUT - QUEUE_WAITED ))
if [ "$TIMEOUT" -le 0 ]; then
  HOLDER=$(cat "$COMMIT_QUEUE_LOCK" 2>/dev/null || echo '<holder info unavailable>')
  REASON="Waited ${QUEUE_WAITED}s for the shared commit queue, exhausting the ${TOTAL_TIMEOUT}s git commit budget before this commit could start ($HOLDER).

Retry after the in-flight commit completes, or raise AI_GIT_COMMIT_TIMEOUT for this invocation if the wait was intentional."
  jq -Rn --arg r "$REASON" '{decision:"block", reason:$r}'
  exit 0
fi

OUTFILE=$(mktemp /tmp/musi-git-commit.XXXXXX)

# Replay from the shell cwd reported with the payload. WORK_ROOT is observation
# state only: using it as the child cwd would apply a relative leading `cd` or
# `git -C` twice and change the command the agent actually issued.
cd "$PAYLOAD_CWD" || exit 1

# Snapshot HEAD before the commit. Cross-checking HEAD_BEFORE != HEAD_AFTER
# catches the case where CMD swallows the real exit code (e.g. `git commit ...
# || echo foo`, a compound with a trailing no-op, or `--dry-run`): bash -c
# returns 0 but no commit landed. Without this check, the wrapper would then
# read `git log -1` and cheerfully report the PREVIOUS commit as if it were
# the new one — exactly the "misleading success" bug this guards against.
HEAD_BEFORE=$(git -C "$WORK_ROOT" rev-parse HEAD 2>/dev/null || echo none)

# Run in background so TERM/INT traps fire immediately (foreground children
# block trap delivery until they exit, defeating timeout handling).
HOOK_PID=$$
START=$(date +%s)
MUSI_COMMIT_QUEUE_LOCK_ALREADY_HELD=1 \
  MUSI_COMMIT_QUEUE_LOCK="$COMMIT_QUEUE_LOCK" \
  bash -c "$CMD" > "$OUTFILE" 2>&1 9>&- &
CHILD=$!

# Watchdog: match the 40-minute pre-commit budget. The Claude hook adapter has
# a slightly larger generated timeout so this wrapper can emit JSON first.
(
  exec 9<&-
  exec 8<&-
  SLEEP_PID=""
  trap '[ -n "$SLEEP_PID" ] && kill "$SLEEP_PID" 2>/dev/null; exit 0' TERM INT
  sleep "$TIMEOUT" &
  SLEEP_PID=$!
  wait "$SLEEP_PID"
  kill -TERM "$HOOK_PID" 2>/dev/null
) &
WD=$!

on_sigterm() {
  musi_signal_process_tree "$CHILD" TERM
  kill "$WD" 2>/dev/null
  wait "$CHILD" 2>/dev/null
  local el=$(( $(date +%s) - START ))
  local summary output
  output=$(cat "$OUTFILE" 2>/dev/null || true)
  summary=$(ai_commit_maybe_running_summary \
    "git commit wrapper timed out at ${TIMEOUT}s (${el}s elapsed)." \
    "$HEAD_BEFORE" \
    "$output" \
    "The wrapper signalled the git commit process tree before returning.")
  jq -Rn --arg r "$summary" '{decision:"block", reason:$r}' \
    || printf '{"decision":"block","reason":"git commit status unknown after timeout (%ss). Check git status and git log before retrying."}\n' "$TIMEOUT"
  exit 0
}

on_sigint() {
  musi_signal_process_tree "$CHILD" TERM
  kill "$WD" 2>/dev/null
  wait "$CHILD" 2>/dev/null
  local el=$(( $(date +%s) - START ))
  jq -Rn --arg r "git commit cancelled (${el}s elapsed). Full output: $OUTFILE" '{decision:"block", reason:$r}' \
    || printf '{"decision":"block","reason":"git commit cancelled."}\n'
  exit 0
}

trap on_sigint INT
trap on_sigterm TERM
trap 'kill "$WD" 2>/dev/null; rm -f "$OUTFILE"' EXIT

wait "$CHILD"
EXIT_CODE=$?

HEAD_AFTER=$(git -C "$WORK_ROOT" rev-parse HEAD 2>/dev/null || echo none)

# Both preconditions for stating anything about a commit, established once. A
# moved HEAD is only evidence when WORK_ROOT is the checkout the command acted
# on; with an unattributable target it may be an unrelated concurrent commit in
# the fallback checkout, which would credit this command with someone else's work.
REAL_COMMIT=0
ai_is_real_git_commit_cmd "$CMD" && REAL_COMMIT=1
ATTRIBUTED=1
ai_target_is_unattributable "$CMD" "$PAYLOAD_CWD" "$REPO_ROOT" && ATTRIBUTED=0

if [ "$EXIT_CODE" -eq 0 ] && [ "$REAL_COMMIT" -eq 1 ] && [ "$ATTRIBUTED" -eq 1 ] \
  && [ "$HEAD_AFTER" != "$HEAD_BEFORE" ]; then
  MSG=$(ai_commit_success_summary "$WORK_ROOT" "$HEAD_BEFORE" "$HEAD_AFTER")
  # .husky/post-commit runs the lint-ratchet / knip / max-lines baseline
  # truth-up scripts as the commit lands and prints operator-facing advisories
  # (e.g. "merge produced a stale baseline" after a hand-completed merge) to the
  # captured OUTFILE. The quiet summary replaces the whole tool output, so those
  # advisories would otherwise be silently discarded on exactly the flow the
  # truth-up hooks exist for. Forward just the `post-commit: ` lines.
  SUCCESS_OUTPUT=$(cat "$OUTFILE" 2>/dev/null || true)
  TRUTH_UP_LINES=$(ai_commit_truth_up_lines "$SUCCESS_OUTPUT")
  if [ -n "$TRUTH_UP_LINES" ]; then
    MSG="$MSG
$TRUTH_UP_LINES"
  fi
  # Per-invocation result file — no shared-state race if flock ever fails open.
  ai_claude_result_command "$MSG" "$AI_RESULT_COMMAND_TMP_PREFIX"
fi

# --- Failure path ---
# Reached when EXIT_CODE != 0 OR HEAD didn't move. The OUTFILE may still
# contain the pre-commit's structured Passed:/Failed: lines even when
# EXIT_CODE is 0 (CMD swallowed the real exit), so parse first and fall
# back to a raw tail only if there's no structured output.
LOG_DIR="$AI_PRECOMMIT_LOG_DIR"
OUTPUT=$(cat "$OUTFILE" 2>/dev/null)

if SUMMARY=$(ai_precommit_failure_summary "$OUTPUT" "$LOG_DIR"); then
  :
elif [ "$EXIT_CODE" -eq 0 ] && [ "$HEAD_AFTER" = "$HEAD_BEFORE" ]; then
  # bash -c reported success but HEAD didn't move in WORK_ROOT. That is only
  # evidence of a failed commit when BOTH halves of the comparison are
  # trustworthy: the command really is a `git commit` invocation, and WORK_ROOT
  # really is the checkout it acted on. Routing above over-matches on purpose,
  # and the target can be unreadable, so check each before making the claim.
  if [ "$REAL_COMMIT" -eq 0 ]; then
    # Text that merely CONTAINS a commit (a grep for an assertion string, a
    # printf appending an example command to a log) reached the wrapper through
    # the deliberately wide routing gate. It ran fine; hand its output back
    # without a commit verdict attached.
    SUMMARY=$(ai_commit_generic_summary "Command completed (exit $EXIT_CODE)." "$OUTPUT")
  elif [ "$ATTRIBUTED" -eq 0 ]; then
    SUMMARY=$(ai_commit_landing_unknown_summary "$WORK_ROOT" "$OUTPUT")
  else
    # The command's real git commit exit code was swallowed (most commonly by
    # `|| echo ...`, a trailing no-op in a compound command, or `--dry-run`) —
    # or nothing was staged. Surface this explicitly so the agent doesn't trust
    # a stale "Commit succeeded: <old-hash>" report.
    SUMMARY=$(ai_commit_no_landing_summary "$HEAD_BEFORE" "$OUTPUT")
  fi
else
  # No structured lines — pre-commit died before aggregation (lock
  # contention, watchdog timeout, or short-circuit marker mismatch).
  SUMMARY=$(ai_commit_generic_summary "Commit failed (exit $EXIT_CODE)." "$OUTPUT")
fi

jq -Rn --arg r "$SUMMARY" '{decision:"block", reason:$r}' \
  || printf '{"decision":"block","reason":"Pre-commit failed. Hook summary generation also failed — see logs at %s"}\n' "$LOG_DIR"
