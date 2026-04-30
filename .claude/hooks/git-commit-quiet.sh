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

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
HOOK_LIB="$REPO_ROOT/scripts/ai-hooks"
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

# --- Single-writer lock ----------------------------------------------------
LOCK=/tmp/musi-git-commit-lock
exec 9<>"$LOCK"
if ! flock -n 9; then
  HOLDER=$(cat "$LOCK" 2>/dev/null || echo '<holder info unavailable>')
  REASON="Another git commit is in progress ($HOLDER).

Do NOT retry — it will fail here again and waste tokens on repeated polling. To wait for the in-flight commit WITHOUT polling, launch this command in the background and attach Monitor:

  flock /tmp/musi-git-commit-lock true && echo FREE

When Monitor reports FREE, check git status before retrying — the previous commit may already have succeeded."
  jq -Rn --arg r "$REASON" '{decision:"deny", reason:$r}'
  exit 0
fi
{ printf 'PID=%s STARTED=%s\n' "$$" "$(date -Iseconds)"; } > "$LOCK"

OUTFILE=$(mktemp /tmp/musi-git-commit.XXXXXX)
trap 'rm -f "$OUTFILE"' EXIT

cd "$REPO_ROOT"

# Snapshot HEAD before the commit. Cross-checking HEAD_BEFORE != HEAD_AFTER
# catches the case where CMD swallows the real exit code (e.g. `git commit ...
# || echo foo`, a compound with a trailing no-op, or `--dry-run`): bash -c
# returns 0 but no commit landed. Without this check, the wrapper would then
# read `git log -1` and cheerfully report the PREVIOUS commit as if it were
# the new one — exactly the "misleading success" bug this guards against.
HEAD_BEFORE=$(git rev-parse HEAD 2>/dev/null || echo none)

# Close FD 9 in the child so anything it spawns doesn't inherit the flock.
bash -c "$CMD" > "$OUTFILE" 2>&1 9>&-
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
FAILED_TASKS=$(ai_precommit_failed_tasks "$OUTPUT")

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

jq -Rn --arg r "$SUMMARY" '{decision:"deny", reason:$r}'
