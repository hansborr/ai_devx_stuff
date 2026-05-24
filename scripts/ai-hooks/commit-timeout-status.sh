#!/bin/bash

# Reports the result of a git commit whose hook wrapper timed out. The default
# wait is capped at 240s to stay inside Claude Code's token-cache window.

set -u

HEAD_BEFORE="${1:-}"
WAIT_SECONDS="${2:-${MUSI_COMMIT_STATUS_WAIT:-240}}"
LOCK="${MUSI_COMMIT_STATUS_LOCK:-${MUSI_VERIFY_LOCK:-/tmp/musi-pre-commit.lock}}"

if ! [[ "$WAIT_SECONDS" =~ ^[0-9]+$ ]]; then
  printf 'commit-timeout-status: wait seconds must be a non-negative integer, got %s\n' "$WAIT_SECONDS" >&2
  exit 64
fi

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  printf 'commit-timeout-status: run from inside a git worktree.\n' >&2
  exit 1
}
cd "$REPO_ROOT" || exit 1

current_head() {
  git rev-parse HEAD 2>/dev/null || printf 'none'
}

commit_landed() {
  local head_after="$1"

  if [ -z "$HEAD_BEFORE" ]; then
    return 1
  fi
  [ "$head_after" != "$HEAD_BEFORE" ]
}

print_repo_status() {
  local status

  printf 'latest commit: %s\n' "$(git log -1 --oneline 2>/dev/null || printf 'none')"
  status=$(git status --short)
  if [ -n "$status" ]; then
    printf 'status:\n%s\n' "$status"
  else
    printf 'status: clean\n'
  fi
}

retry_command() {
  local head_arg wait_arg lock_arg

  printf -v head_arg '%q' "$HEAD_BEFORE"
  printf -v wait_arg '%q' "$WAIT_SECONDS"
  printf -v lock_arg '%q' "$LOCK"
  printf 'MUSI_COMMIT_STATUS_LOCK=%s bash "$(git rev-parse --show-toplevel)/scripts/ai-hooks/commit-timeout-status.sh" %s %s' \
    "$lock_arg" "$head_arg" "$wait_arg"
}

report_landed() {
  local head_after="$1"

  printf 'Commit finished: HEAD moved'
  if [ -n "$HEAD_BEFORE" ]; then
    printf ' from %s' "$HEAD_BEFORE"
  fi
  printf ' to %s.\n' "$head_after"
  print_repo_status
}

HEAD_AFTER=$(current_head)
if commit_landed "$HEAD_AFTER"; then
  report_landed "$HEAD_AFTER"
  exit 0
fi

if [ -n "$HEAD_BEFORE" ]; then
  printf 'HEAD has not moved from %s yet.\n' "$HEAD_BEFORE"
else
  printf 'No starting HEAD was provided; current status is all this script can report.\n'
fi

exec 9<>"$LOCK" || {
  printf 'Could not open pre-commit lock %s.\n' "$LOCK" >&2
  print_repo_status
  exit 1
}

if flock -n 9; then
  HEAD_AFTER=$(current_head)
  if commit_landed "$HEAD_AFTER"; then
    report_landed "$HEAD_AFTER"
    exit 0
  fi

  printf 'No commit has landed, and the pre-commit lock is not held.\n'
  print_repo_status
  printf 'The timed-out commit is no longer running through the pre-commit lock. Retry the original git commit command if the staged changes are still intended.\n'
  exit 1
fi

printf 'A commit/pre-commit process still appears to be running; %s is locked.\n' "$LOCK"
if [ -s "$LOCK" ]; then
  printf 'lock holder:\n'
  cat "$LOCK"
  printf '\n'
fi
printf 'Waiting up to %ss for the lock to release.\n' "$WAIT_SECONDS"

if ! flock -w "$WAIT_SECONDS" 9; then
  printf 'Commit still is not finished after waiting %ss; the pre-commit lock is still held.\n' "$WAIT_SECONDS"
  printf 'Do not retry git commit yet. Try this status command again:\n'
  printf '  %s\n' "$(retry_command)"
  exit 2
fi

HEAD_AFTER=$(current_head)
if commit_landed "$HEAD_AFTER"; then
  report_landed "$HEAD_AFTER"
  exit 0
fi

printf 'The pre-commit lock released, but no commit has landed.\n'
print_repo_status
printf 'Retry the original git commit command if the staged changes are still intended.\n'
exit 1
