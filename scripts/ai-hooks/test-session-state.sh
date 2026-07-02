#!/bin/bash

# Focused tests for the compact SessionStart session-state hook. Runs standalone
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
touch "$SESSION_REPO/.no-edit-lint" "$SESSION_REPO/.no-stop-verify-changed"
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

STATE_OUT=$(run_session_state_hook "$SESSION_REPO" '{"hook_event_name":"SessionStart","source":"compact"}' "$SESSION_REPO/subdir")
assert_hook_json "$STATE_OUT"
[ "$(jq -r '.hookSpecificOutput.hookEventName // empty' <<< "$STATE_OUT")" = "SessionStart" ] \
  || fail "session state hook should emit SessionStart context: $STATE_OUT"
STATE_CONTEXT=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$STATE_OUT")
assert_contains "$STATE_CONTEXT" "Harness state after compaction"
assert_contains "$STATE_CONTEXT" "branch: feature/session-state"
assert_contains "$STATE_CONTEXT" "worktree: dirty"
assert_contains "$STATE_CONTEXT" "fast-commit: active"
assert_contains "$STATE_CONTEXT" "active kill switches: .no-edit-lint, .no-stop-verify-changed"
assert_contains "$STATE_CONTEXT" "cached verify: serial-verify-changed exit 1"
assert_contains "$STATE_CONTEXT" "failing gate(s): lint"
assert_contains "$STATE_CONTEXT" "async verify: running"
[ "$(printf '%s\n' "$STATE_CONTEXT" | wc -l)" -le 20 ] \
  || fail "session state context should stay within 20 lines: $STATE_CONTEXT"

echo "session-state ai-hooks tests passed"
