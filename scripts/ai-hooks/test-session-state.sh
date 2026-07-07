#!/bin/bash

# Focused tests for the SessionStart session-state hook, which fires on
# startup/resume/compact. Runs standalone
# (`bash scripts/ai-hooks/test-session-state.sh`); the aggregate runner invokes
# it as one step.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../tests/lib/test-git-env.sh
. "$SCRIPT_DIR/../tests/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)

TMP_ROOT=$(mktemp -d /tmp/musi-ai-hooks-session-state-test.XXXXXX)
trap 'rm -rf "$TMP_ROOT"' EXIT

export AI_STATE_ROOT="$TMP_ROOT/state"
export MUSI_VERIFY_ASYNC_STATE_ROOT="$TMP_ROOT/verify-async"
export MUSI_VERIFY_LOG_DIR="$TMP_ROOT/verify-logs"

# shellcheck source=test-support.sh
. "$SCRIPT_DIR/test-support.sh"
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"
# shellcheck source=cache.sh
. "$SCRIPT_DIR/cache.sh"
# shellcheck source=stop-policy.sh
. "$SCRIPT_DIR/stop-policy.sh"

SESSION_REPO="$TMP_ROOT/session-repo"
git init -b main "$SESSION_REPO" >/dev/null 2>&1 || fail "failed to init session fixture"
git -C "$SESSION_REPO" config user.email hooks@example.test
git -C "$SESSION_REPO" config user.name "Hook Test"
printf 'base\n' > "$SESSION_REPO/file.txt"
git -C "$SESSION_REPO" add file.txt
git -C "$SESSION_REPO" commit -m "base" >/dev/null 2>&1 || fail "failed to commit session fixture"

run_session_state_hook() {
  local repo_root="$1"
  local payload="${2:-{\"hook_event_name\":\"SessionStart\",\"source\":\"compact\"}}"
  local cwd="${3:-$repo_root}"

  cd "$cwd"
  printf '%s' "$payload" | bash "$REPO_ROOT/scripts/ai-hooks/session-state.sh"
}

CLEAN_OUT=$(run_session_state_hook "$SESSION_REPO")
[ -z "$CLEAN_OUT" ] || fail "clean boring session state should emit nothing: $CLEAN_OUT"

git -C "$SESSION_REPO" checkout -b feature/session-state >/dev/null 2>&1 \
  || fail "failed to create session-state branch"
printf 'dirty\n' >> "$SESSION_REPO/file.txt"
printf 'untracked\n' > "$SESSION_REPO/new.txt"
mkdir -p "$SESSION_REPO/subdir"
touch "$SESSION_REPO/.no-edit-lint" "$SESSION_REPO/.no-stop-verify-changed" \
  "$SESSION_REPO/.no-stop-lint-warnings"
(cd "$SESSION_REPO" && touch "$(git rev-parse --git-common-dir)/musi-fast-commit")

HEAD_SHA=$(git -C "$SESSION_REPO" rev-parse HEAD)
mkdir -p "$MUSI_VERIFY_LOG_DIR/meta"
cat > "$MUSI_VERIFY_LOG_DIR/meta/wrapper.json" <<JSON
{"mode":"serial-verify-changed","head":"$HEAD_SHA","fingerprint":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","exit_code":1}
JSON
cat > "$MUSI_VERIFY_LOG_DIR/meta/lint.json" <<'JSON'
{"name":"lint","exit_code":1}
JSON

SESSION_REPO_KEY=$(ai_stop_repo_key "$SESSION_REPO")
ASYNC_STATE_DIR="$MUSI_VERIFY_ASYNC_STATE_ROOT/$SESSION_REPO_KEY/runs/run-1"
mkdir -p "$ASYNC_STATE_DIR" "$(dirname "$MUSI_VERIFY_ASYNC_STATE_ROOT/$SESSION_REPO_KEY/latest")"
cat > "$ASYNC_STATE_DIR/state" <<STATE
pid=$$
started_epoch=100
log_dir=$TMP_ROOT/async-log
STATE
printf '%s' "$ASYNC_STATE_DIR/state" > "$MUSI_VERIFY_ASYNC_STATE_ROOT/$SESSION_REPO_KEY/latest"

SESSION_GIT_SHIM="$TMP_ROOT/session-readonly-git-shim"
SESSION_GIT_LOG="$TMP_ROOT/session-readonly-git.log"
SESSION_REAL_GIT=$(command -v git)
SESSION_STATE_HOOK="$REPO_ROOT/scripts/ai-hooks/session-state.sh"
make_git_optional_locks_guard_shim "$SESSION_GIT_SHIM"
: > "$SESSION_GIT_LOG"
STATE_LOCK_OUT=$(
  cd "$SESSION_REPO/subdir"
  export PATH="$SESSION_GIT_SHIM:$PATH"
  export REPO_ROOT="$SESSION_REPO"
  export AI_TEST_REAL_GIT="$SESSION_REAL_GIT"
  export AI_TEST_GIT_OPTIONAL_LOCKS_LOG="$SESSION_GIT_LOG"
  printf '%s' '{"hook_event_name":"SessionStart","source":"compact"}' | bash "$SESSION_STATE_HOOK"
)
assert_hook_json "$STATE_LOCK_OUT"
SESSION_GIT_GUARD_LOG=$(cat "$SESSION_GIT_LOG")
assert_not_contains "$SESSION_GIT_GUARD_LOG" "MISSING"
assert_contains "$SESSION_GIT_GUARD_LOG" $'OK\trev-parse --show-toplevel'
assert_contains "$SESSION_GIT_GUARD_LOG" $'OK\t-C '"$SESSION_REPO"$' status --porcelain'

STATE_OUT_NO_MARKER=$(run_session_state_hook "$SESSION_REPO" '{"hook_event_name":"SessionStart","source":"compact"}' "$SESSION_REPO/subdir")
assert_hook_json "$STATE_OUT_NO_MARKER"
STATE_CONTEXT_NO_MARKER=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$STATE_OUT_NO_MARKER")
assert_contains "$STATE_CONTEXT_NO_MARKER" "active kill switches: .no-edit-lint, .no-stop-lint-warnings, .no-stop-verify-changed"
assert_not_contains "$STATE_CONTEXT_NO_MARKER" "active safety overrides"
assert_not_contains "$STATE_CONTEXT_NO_MARKER" ".allow-protected-edits"

touch "$SESSION_REPO/.allow-protected-edits"

STATE_OUT=$(run_session_state_hook "$SESSION_REPO" '{"hook_event_name":"SessionStart","source":"compact"}' "$SESSION_REPO/subdir")
assert_hook_json "$STATE_OUT"
[ "$(jq -r '.hookSpecificOutput.hookEventName // empty' <<< "$STATE_OUT")" = "SessionStart" ] \
  || fail "session state hook should emit SessionStart context: $STATE_OUT"
STATE_CONTEXT=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$STATE_OUT")
assert_contains "$STATE_CONTEXT" "Harness state after compaction"
assert_contains "$STATE_CONTEXT" "branch: feature/session-state"
assert_contains "$STATE_CONTEXT" "worktree: dirty"
assert_contains "$STATE_CONTEXT" "fast-commit: active"
assert_contains "$STATE_CONTEXT" "active kill switches: .no-edit-lint, .no-stop-lint-warnings, .no-stop-verify-changed"
assert_contains "$STATE_CONTEXT" "active safety overrides: .allow-protected-edits"
assert_contains "$STATE_CONTEXT" "cached verify: serial-verify-changed exit 1"
assert_contains "$STATE_CONTEXT" "failing gate(s): lint"
assert_contains "$STATE_CONTEXT" "async verify: running"
[ "$(printf '%s\n' "$STATE_CONTEXT" | wc -l)" -le 20 ] \
  || fail "session state context should stay within 20 lines: $STATE_CONTEXT"

# The hook now also fires on a fresh session start (source=startup), not only
# after compaction; the header wording reflects the source while the rest of
# the interesting-state snapshot is identical.
STARTUP_OUT=$(run_session_state_hook "$SESSION_REPO" '{"hook_event_name":"SessionStart","source":"startup"}' "$SESSION_REPO/subdir")
assert_hook_json "$STARTUP_OUT"
STARTUP_CONTEXT=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$STARTUP_OUT")
assert_contains "$STARTUP_CONTEXT" "Harness state at session start"
assert_not_contains "$STARTUP_CONTEXT" "after compaction"
assert_contains "$STARTUP_CONTEXT" "active kill switches: .no-edit-lint, .no-stop-lint-warnings, .no-stop-verify-changed"
assert_contains "$STARTUP_CONTEXT" "active safety overrides: .allow-protected-edits"

# resume source gets its own header wording.
RESUME_OUT=$(run_session_state_hook "$SESSION_REPO" '{"hook_event_name":"SessionStart","source":"resume"}' "$SESSION_REPO/subdir")
RESUME_CONTEXT=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$RESUME_OUT")
assert_contains "$RESUME_CONTEXT" "Harness state on session resume"

echo "session-state ai-hooks tests passed"
