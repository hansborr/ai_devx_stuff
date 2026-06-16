#!/bin/bash
# Wraps `git commit` to keep the pre-commit hook's verbose output
# (lint:changed, typecheck, test:changed running in parallel) out of
# Claude's context window.
#
# On success: replaces the command with a one-line commit summary via
#   hookSpecificOutput.updatedInput.
# On failure: parses the Passed:/Failed: lines the pre-commit hook emits
#   and returns only the tails of failed tasks. Full per-task logs live
#   at /tmp/musi-pre-commit-logs/<task>.log.
#
# Single-writer invariant: mirrors .husky/pre-commit — a non-blocking
# flock prevents two Claude sessions (or a racing retry) from commiting
# concurrently. Contention yields a Monitor-wait incantation.
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

PAYLOAD=$(ai_read_payload)
CMD=$(ai_payload_command "$PAYLOAD")

# Only wrap `git commit` invocations; pass everything else through.
ai_is_git_commit_cmd "$CMD" || {
  echo '{"continue":true}'
  exit 0
}

# Self-block forbidden commits BEFORE running them. This hook executes the
# command itself (bash -c "$CMD" below), so a `git commit --amend` would rewrite
# HEAD here even though no-direct-db.sh / the deny glob report it as "blocked"
# (G1). The gate above only matches an adjacent `git commit`, so the `git -c …
# commit --amend` form never reaches this hook — it is closed at the policy
# layer (widened regex) before the harness dispatches it. ai_emit_block exits.
ai_preflight_or_block "$CMD"

# --- Single-writer lock ----------------------------------------------------
LOCK="${AI_GIT_COMMIT_LOCK:-/tmp/musi-git-commit-lock}"
exec 9<>"$LOCK"
if ! flock -n 9; then
  HOLDER=$(cat "$LOCK" 2>/dev/null || echo '<holder info unavailable>')
  REASON="Another git commit is in progress ($HOLDER).

Do NOT retry — it will fail here again and waste tokens on repeated polling. To wait for the in-flight commit WITHOUT polling, launch this command in the background and attach Monitor:

  flock $LOCK true && echo FREE

When Monitor reports FREE, check git status before retrying — the previous commit may already have succeeded."
  jq -Rn --arg r "$REASON" '{decision:"block", reason:$r}'
  exit 0
fi
{ printf 'PID=%s STARTED=%s\n' "$$" "$(date -Iseconds)"; } > "$LOCK"

OUTFILE=$(mktemp /tmp/musi-git-commit.XXXXXX)

cd "$REPO_ROOT" || exit 1

# Snapshot HEAD before the commit. Cross-checking HEAD_BEFORE != HEAD_AFTER
# catches the case where CMD swallows the real exit code (e.g. `git commit ...
# || echo foo`, a compound with a trailing no-op, or `--dry-run`): bash -c
# returns 0 but no commit landed. Without this check, the wrapper would then
# read `git log -1` and cheerfully report the PREVIOUS commit as if it were
# the new one — exactly the "misleading success" bug this guards against.
HEAD_BEFORE=$(git rev-parse HEAD 2>/dev/null || echo none)

# Run in background so TERM/INT traps fire immediately (foreground children
# block trap delivery until they exit, defeating timeout handling).
HOOK_PID=$$
START=$(date +%s)
bash -c "$CMD" > "$OUTFILE" 2>&1 9>&- &
CHILD=$!

# Watchdog: 270s internal keeps us under the 300s cache-warm window. The
# pre-commit hook's own 240s watchdog covers the common case; this catches
# hangs in git itself or between the pre-commit exit and our wait.
TIMEOUT="${AI_GIT_COMMIT_TIMEOUT:-270}"
(
  exec 9<&-
  SLEEP_PID=""
  trap '[ -n "$SLEEP_PID" ] && kill "$SLEEP_PID" 2>/dev/null; exit 0' TERM INT
  sleep "$TIMEOUT" &
  SLEEP_PID=$!
  wait "$SLEEP_PID"
  kill -TERM "$HOOK_PID" 2>/dev/null
) &
WD=$!

on_sigterm() {
  kill "$CHILD" "$WD" 2>/dev/null
  wait "$CHILD" 2>/dev/null
  local el=$(( $(date +%s) - START ))
  local summary output
  output=$(cat "$OUTFILE" 2>/dev/null || true)
  summary=$(ai_commit_maybe_running_summary \
    "git commit wrapper timed out at ${TIMEOUT}s (${el}s elapsed)." \
    "$HEAD_BEFORE" \
    "$output" \
    "Claude Code may have backgrounded the original command. The wrapper stopped waiting before Claude's 600s hook timeout, but commit/pre-commit descendants may still finish.")
  jq -Rn --arg r "$summary" '{decision:"block", reason:$r}' \
    || printf '{"decision":"block","reason":"git commit status unknown after timeout (%ss). Check git status and git log before retrying."}\n' "$TIMEOUT"
  exit 0
}

on_sigint() {
  kill "$CHILD" "$WD" 2>/dev/null
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

HEAD_AFTER=$(git rev-parse HEAD 2>/dev/null || echo none)

if [ "$EXIT_CODE" -eq 0 ] && [ "$HEAD_AFTER" != "$HEAD_BEFORE" ]; then
  MSG=$(ai_commit_success_summary "$REPO_ROOT" "$HEAD_BEFORE" "$HEAD_AFTER")
  # Per-invocation result file — no shared-state race if flock ever fails open.
  ai_claude_result_command "$MSG" /tmp/musi-commit-result
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
  # bash -c reported success but HEAD didn't move. The command's real git
  # commit exit code was swallowed (most commonly by `|| echo ...`, a
  # trailing no-op in a compound command, or `--dry-run`) — or nothing was
  # staged. Surface this explicitly so the agent doesn't trust a stale
  # "Commit succeeded: <old-hash>" report. Full child output is tailed below.
  SUMMARY=$(ai_commit_no_landing_summary "$HEAD_BEFORE" "$OUTPUT")
else
  # No structured lines — pre-commit died before aggregation (lock
  # contention, watchdog timeout, or short-circuit marker mismatch).
  SUMMARY=$(ai_commit_generic_summary "Commit failed (exit $EXIT_CODE)." "$OUTPUT")
fi

jq -Rn --arg r "$SUMMARY" '{decision:"block", reason:$r}' \
  || printf '{"decision":"block","reason":"Pre-commit failed. Hook summary generation also failed — see logs at %s"}\n' "$LOG_DIR"
