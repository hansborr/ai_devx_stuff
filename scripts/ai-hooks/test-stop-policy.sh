#!/bin/bash

# Focused ai-hooks shell tests for the stop-policy hook family. Extracted from
# scripts/ai-hooks/test.sh so this behavior family can be run on its own
# (`bash scripts/ai-hooks/test-stop-policy.sh`); the aggregate runner invokes it
# as one step. Shares the generic assertions in test-support.sh.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../tests/lib/test-git-env.sh
. "$SCRIPT_DIR/../tests/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)

TMP_ROOT=$(mktemp -d /tmp/musi-ai-hooks-stop-policy-test.XXXXXX)
trap 'rm -rf "$TMP_ROOT"' EXIT

export AI_STATE_ROOT="$TMP_ROOT/state"
AI_BUN_LOG_DIR="$TMP_ROOT/bun-logs"
export AI_PRECOMMIT_LOG_DIR="$TMP_ROOT/pre-commit-logs"
MUSI_VERIFY_ASYNC_STATE_ROOT="$TMP_ROOT/verify-async"

# shellcheck source=test-support.sh
. "$SCRIPT_DIR/test-support.sh"
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"
# shellcheck source=cache.sh
. "$SCRIPT_DIR/cache.sh"
# shellcheck source=stop-policy.sh
. "$SCRIPT_DIR/stop-policy.sh"

assert_stop_status_reporters_have_loop_protection() {
  local reporters fn body output_line kill_line pass_line

  mapfile -t reporters < <(declare -F | awk '$3 ~ /^ai_stop_.*_status$/ {print $3}' | sort)
  [ "${#reporters[@]}" -gt 0 ] || fail "no stop status reporters discovered"

  for fn in "${reporters[@]}"; do
    body=$(declare -f "$fn")
    output_line=$(awk '/printf '\''%s\\n\\n%s'\''/ {print NR; exit}' <<< "$body")
    [ -n "$output_line" ] || fail "$fn must emit reporter messages through the shared two-paragraph printf shape"

    kill_line=$(awk '/_disabled "\$repo_root" && return 1/ {print NR; exit}' <<< "$body")
    [ -n "$kill_line" ] || fail "$fn must call its kill-switch disabled helper and return early"
    [ "$kill_line" -lt "$output_line" ] || fail "$fn kill-switch check must run before notification output"

    pass_line=$(awk '/\[[^]]*(exit_code[^]]*0|status[^]]*passed)[^]]*\]/ {print NR; exit}' <<< "$body")
    [ -n "$pass_line" ] || fail "$fn must explicitly skip a passing or clean state"
    [ "$pass_line" -lt "$output_line" ] || fail "$fn passing/clean state check must run before notification output"
    awk -v start="$pass_line" -v end="$output_line" \
      'NR > start && NR < end && /return 1/ {found=1} END {exit found ? 0 : 1}' \
      <<< "$body" || fail "$fn passing/clean state must return without emitting"
    grep -qE 'rm -f "?\$counter"?' <<< "$body" || fail "$fn must clear its counter on a passing or clean state"

    grep -q '_read_counter' <<< "$body" || fail "$fn must read a per-state dedup counter"
    grep -q '_write_counter' <<< "$body" || fail "$fn must write a per-state dedup counter"
    grep -q 'MAX_NOTIFY' <<< "$body" || fail "$fn must use a max-notify bound"
    grep -qE 'COUNTER_COUNT.*-ge.*MAX_NOTIFY' <<< "$body" \
      || fail "$fn must suppress repeats after the max-notify counter is reached"
  done
}

ai_cache_init

# Enforce that every Stop status reporter has loop protection before it can notify.
assert_stop_status_reporters_have_loop_protection

STOP_REPO="$TMP_ROOT/stop-repo"
git init -b main "$STOP_REPO" >/dev/null 2>&1 || fail "failed to init stop hook test repo"
git -C "$STOP_REPO" config user.email hooks@example.test
git -C "$STOP_REPO" config user.name "Hook Test"
printf 'base\n' > "$STOP_REPO/file.txt"
git -C "$STOP_REPO" add file.txt
git -C "$STOP_REPO" commit -m "base" >/dev/null 2>&1 || fail "failed to commit stop hook fixture"

if ai_stop_commit_reminder "$STOP_REPO" >/dev/null; then
  fail "clean repo should not emit stop reminder"
fi

mkdir -p "$STOP_REPO/subdir"
printf 'one\n' > "$STOP_REPO/untracked.txt"
STOP_MSG=$(cd "$STOP_REPO/subdir" && ai_stop_commit_reminder "$STOP_REPO") \
  || fail "untracked dirty repo should emit stop reminder from subdir"
assert_contains "$STOP_MSG" "uncommitted changes on main"
if (cd "$STOP_REPO/subdir" && ai_stop_commit_reminder "$STOP_REPO" >/dev/null); then
  fail "same untracked dirty fingerprint should not emit stop reminder twice"
fi
printf 'two\n' > "$STOP_REPO/untracked.txt"
STOP_MSG=$(cd "$STOP_REPO/subdir" && ai_stop_commit_reminder "$STOP_REPO") \
  || fail "changed untracked fingerprint should emit stop reminder"
assert_contains "$STOP_MSG" "uncommitted changes on main"
rm "$STOP_REPO/untracked.txt"
if ai_stop_commit_reminder "$STOP_REPO" >/dev/null; then
  fail "clean repo after removing untracked file should not emit stop reminder"
fi

printf 'dirty\n' > "$STOP_REPO/file.txt"
STOP_MSG=$(ai_stop_commit_reminder "$STOP_REPO") || fail "dirty main repo should emit stop reminder"
assert_contains "$STOP_MSG" "uncommitted changes on main"
assert_contains "$STOP_MSG" "Check out a new branch"
assert_contains "$STOP_MSG" "touch $STOP_REPO/$AI_STOP_COMMIT_KILL_SWITCH"
if ai_stop_commit_reminder "$STOP_REPO" >/dev/null; then
  fail "same dirty fingerprint should not emit stop reminder twice"
fi

git -C "$STOP_REPO" checkout -b feature/dirty >/dev/null 2>&1 || fail "failed to create feature branch"
STOP_MSG=$(ai_stop_commit_reminder "$STOP_REPO") \
  || fail "same dirty fingerprint should emit again after branch checkout"
assert_contains "$STOP_MSG" "uncommitted changes on branch 'feature/dirty'"
if ai_stop_commit_reminder "$STOP_REPO" >/dev/null; then
  fail "same dirty fingerprint on same branch should not emit stop reminder twice"
fi

git -C "$STOP_REPO" checkout main >/dev/null 2>&1 || fail "failed to return to main"
STOP_MSG=$(ai_stop_commit_reminder "$STOP_REPO") \
  || fail "same dirty fingerprint should emit again after returning to main"
assert_contains "$STOP_MSG" "uncommitted changes on main"
git -C "$STOP_REPO" checkout feature/dirty >/dev/null 2>&1 || fail "failed to return to feature branch"

printf 'more\n' >> "$STOP_REPO/file.txt"
STOP_MSG=$(ai_stop_commit_reminder "$STOP_REPO") || fail "changed dirty fingerprint should emit stop reminder"
assert_contains "$STOP_MSG" "uncommitted changes on branch 'feature/dirty'"
assert_contains "$STOP_MSG" "Commit the work"

touch "$STOP_REPO/$AI_STOP_COMMIT_KILL_SWITCH"
if ai_stop_commit_reminder "$STOP_REPO" >/dev/null; then
  fail "commit kill switch should suppress stop reminder"
fi
[ ! -f "$(ai_stop_marker_path "$STOP_REPO")" ] || fail "commit kill switch should clear reminder marker"
rm -f "$STOP_REPO/$AI_STOP_COMMIT_KILL_SWITCH"
STOP_MSG=$(ai_stop_commit_reminder "$STOP_REPO") || fail "removing commit kill switch should re-enable stop reminder"
assert_contains "$STOP_MSG" "uncommitted changes on branch 'feature/dirty'"

git -C "$STOP_REPO" add file.txt
git -C "$STOP_REPO" commit -m "dirty work" >/dev/null 2>&1 || fail "failed to commit dirty fixture"
if ai_stop_commit_reminder "$STOP_REPO" >/dev/null; then
  fail "clean repo after commit should not emit stop reminder"
fi

printf 'write-fail\n' >> "$STOP_REPO/file.txt"
STOP_MARKER=$(ai_stop_marker_path "$STOP_REPO")
rm -f "$STOP_MARKER"
STOP_MSG=$(
  mv() { return 1; }
  ai_stop_commit_reminder "$STOP_REPO"
) || fail "marker write failure should not suppress reminder"
assert_contains "$STOP_MSG" "uncommitted changes on branch 'feature/dirty'"
[ ! -f "$STOP_MARKER" ] || fail "failed marker write should not leave a marker behind"
git -C "$STOP_REPO" checkout -- file.txt >/dev/null 2>&1 || fail "failed to clean stop fixture"

printf 'hard-stop dirty\n' >> "$STOP_REPO/file.txt"
STOP_MSG=$(ai_stop_commit_reminder "$STOP_REPO") \
  || fail "dirty repo should emit before hard-stop marker test"
if ai_stop_commit_reminder "$STOP_REPO" >/dev/null; then
  fail "soft dirty reminder should still suppress repeated unchanged stops"
fi
STOP_HARD_MARKER=$(ai_stop_hard_marker_path "$STOP_REPO")
touch "$STOP_HARD_MARKER"
STOP_MSG=$(ai_stop_policy_messages "$STOP_REPO") \
  || fail "hard-stop dirty repo should keep blocking after soft reminder suppression"
assert_contains "$STOP_MSG" "uncommitted changes on branch 'feature/dirty'"
assert_contains "$STOP_MSG" "hard-stop mode is on"
assert_contains "$STOP_MSG" "$STOP_HARD_MARKER"
STOP_MSG=$(ai_stop_policy_messages "$STOP_REPO") \
  || fail "hard-stop dirty repo should repeat for unchanged dirty state"
assert_contains "$STOP_MSG" "hard-stop mode is on"
touch "$STOP_REPO/$AI_STOP_COMMIT_KILL_SWITCH"
if ai_stop_policy_messages "$STOP_REPO" >/dev/null; then
  fail "commit kill switch should suppress hard-stop dirty reminder"
fi
rm -f "$STOP_REPO/$AI_STOP_COMMIT_KILL_SWITCH" "$STOP_HARD_MARKER"
git -C "$STOP_REPO" checkout -- file.txt >/dev/null 2>&1 || fail "failed to clean hard-stop fixture"

# --- ai_stop_policy_messages_subagent -----------------------------------------
SUBAGENT_REPO="$TMP_ROOT/subagent-repo"
git init -b feature/subagent "$SUBAGENT_REPO" >/dev/null 2>&1 \
  || fail "failed to init subagent fixture"
git -C "$SUBAGENT_REPO" config user.email hooks@example.test
git -C "$SUBAGENT_REPO" config user.name "Hook Test"
printf 'base\n' > "$SUBAGENT_REPO/file.txt"
git -C "$SUBAGENT_REPO" add file.txt
git -C "$SUBAGENT_REPO" commit -m base >/dev/null 2>&1 \
  || fail "failed to commit subagent fixture"

SUBAGENT_PAYLOAD_A='{"session_id":"session-1","agent_id":"agent-a","agent_type":"Explore","stop_hook_active":false}'
SUBAGENT_PAYLOAD_B='{"session_id":"session-1","agent_id":"agent-b","agent_type":"Explore","stop_hook_active":false}'
SUBAGENT_PAYLOAD_C='{"session_id":"session-1","agent_id":"agent-c","agent_type":"Explore","stop_hook_active":false}'
printf 'dirty\n' >> "$SUBAGENT_REPO/file.txt"
SUBAGENT_E2E_MARKER="$AI_BUN_LOG_DIR/last.e2e.subagent"
ai_write_bun_marker "$SUBAGENT_E2E_MARKER" "$(ai_worktree_fingerprint "$SUBAGENT_REPO")" 1

SUBAGENT_MSG=$(ai_stop_policy_messages_subagent "$SUBAGENT_REPO" "$SUBAGENT_PAYLOAD_A") \
  || fail "dirty subagent repo should emit subagent stop reminder"
assert_contains "$SUBAGENT_MSG" "uncommitted changes on branch 'feature/subagent'"
assert_not_contains "$SUBAGENT_MSG" "e2e tests are failing"
if ai_stop_policy_messages_subagent "$SUBAGENT_REPO" "$SUBAGENT_PAYLOAD_A" >/dev/null; then
  fail "same subagent dirty fingerprint should not emit twice"
fi
SUBAGENT_MSG=$(ai_stop_policy_messages_subagent "$SUBAGENT_REPO" "$SUBAGENT_PAYLOAD_B") \
  || fail "different subagent should get its own dirty reminder"
assert_contains "$SUBAGENT_MSG" "uncommitted changes on branch 'feature/subagent'"
STOP_MSG=$(ai_stop_policy_messages "$SUBAGENT_REPO") \
  || fail "subagent reminder should not consume the main stop reminder"
assert_contains "$STOP_MSG" "uncommitted changes on branch 'feature/subagent'"

git -C "$SUBAGENT_REPO" add file.txt
git -C "$SUBAGENT_REPO" commit -m dirty >/dev/null 2>&1 \
  || fail "failed to clean subagent dirty fixture"

SUBAGENT_VERIFY_LOG_DIR="$TMP_ROOT/subagent-verify-logs"
SUBAGENT_VERIFY_META_DIR="$SUBAGENT_VERIFY_LOG_DIR/meta"
SUBAGENT_VERIFY_WRAPPER="$SUBAGENT_VERIFY_META_DIR/wrapper.json"
mkdir -p "$SUBAGENT_VERIFY_META_DIR"
SUBAGENT_VERIFY_HEAD=$(git -C "$SUBAGENT_REPO" rev-parse HEAD)
SUBAGENT_VERIFY_FP=$(ai_worktree_fingerprint "$SUBAGENT_REPO")
printf '{"name":"wrapper","mode":"serial-verify","exit_code":1,"head":"%s","fingerprint":"%s"}\n' \
  "$SUBAGENT_VERIFY_HEAD" "$SUBAGENT_VERIFY_FP" > "$SUBAGENT_VERIFY_WRAPPER"
printf '{"name":"typecheck","exit_code":1}\n' > "$SUBAGENT_VERIFY_META_DIR/typecheck.json"

SUBAGENT_MSG=$(
  MUSI_VERIFY_LOG_DIR="$SUBAGENT_VERIFY_LOG_DIR" \
    ai_stop_policy_messages_subagent "$SUBAGENT_REPO" "$SUBAGENT_PAYLOAD_A"
) || fail "failing cached verify should emit to subagent"
assert_contains "$SUBAGENT_MSG" "cached verify"
assert_contains "$SUBAGENT_MSG" "failing gate(s): typecheck"
SUBAGENT_MSG=$(
  MUSI_VERIFY_LOG_DIR="$SUBAGENT_VERIFY_LOG_DIR" \
    ai_stop_policy_messages_subagent "$SUBAGENT_REPO" "$SUBAGENT_PAYLOAD_A"
) || fail "second cached verify notice should still emit to same subagent"
if MUSI_VERIFY_LOG_DIR="$SUBAGENT_VERIFY_LOG_DIR" \
    ai_stop_policy_messages_subagent "$SUBAGENT_REPO" "$SUBAGENT_PAYLOAD_A" >/dev/null; then
  fail "subagent cached verify should suppress after max notices for same subagent"
fi
SUBAGENT_MSG=$(
  MUSI_VERIFY_LOG_DIR="$SUBAGENT_VERIFY_LOG_DIR" \
    ai_stop_policy_messages_subagent "$SUBAGENT_REPO" "$SUBAGENT_PAYLOAD_B"
) || fail "different subagent should get independent cached verify notice"
assert_contains "$SUBAGENT_MSG" "cached verify"
VERIFY_MSG=$(
  MUSI_VERIFY_LOG_DIR="$SUBAGENT_VERIFY_LOG_DIR" \
    ai_stop_verify_status "$SUBAGENT_REPO"
) || fail "subagent cached verify notices should not consume main stop verify counter"
assert_contains "$VERIFY_MSG" "cached verify"

SUBAGENT_WRAPPER="$REPO_ROOT/scripts/ai-hooks/subagent-stop-reminder.sh"
SUBAGENT_ACTIVE_OUT=$(
  cd "$SUBAGENT_REPO"
  printf '%s' '{"session_id":"session-1","agent_id":"agent-c","agent_type":"Explore","stop_hook_active":true}' \
    | MUSI_VERIFY_LOG_DIR="$SUBAGENT_VERIFY_LOG_DIR" bash "$SUBAGENT_WRAPPER"
)
[ -z "$SUBAGENT_ACTIVE_OUT" ] || fail "active SubagentStop loop should emit nothing"
SUBAGENT_WRAPPER_OUT=$(
  cd "$SUBAGENT_REPO"
  printf '%s' "$SUBAGENT_PAYLOAD_C" \
    | MUSI_VERIFY_LOG_DIR="$SUBAGENT_VERIFY_LOG_DIR" bash "$SUBAGENT_WRAPPER"
)
assert_hook_json "$SUBAGENT_WRAPPER_OUT"
[ "$(jq -r '.hookSpecificOutput.hookEventName // empty' <<< "$SUBAGENT_WRAPPER_OUT")" = "SubagentStop" ] \
  || fail "subagent wrapper should emit SubagentStop additional context: $SUBAGENT_WRAPPER_OUT"
SUBAGENT_WRAPPER_CONTEXT=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$SUBAGENT_WRAPPER_OUT")
assert_contains "$SUBAGENT_WRAPPER_CONTEXT" "cached verify"

WRAPPER="$REPO_ROOT/scripts/ai-hooks/stop-reminder.sh"
WRAPPER_ERR="$TMP_ROOT/wrapper.err"
WRAPPER_STATE="$TMP_ROOT/wrapper-state"
mkdir -p "$WRAPPER_STATE"
# Suppress the e2e check for wrapper plumbing tests; it has dedicated coverage below.
# Track the gitignore so the kill switch itself doesn't dirty the fixture.
printf '%s\n%s\n' "$AI_STOP_COMMIT_KILL_SWITCH" "$AI_STOP_E2E_KILL_SWITCH" > "$STOP_REPO/.gitignore"
git -C "$STOP_REPO" add .gitignore
git -C "$STOP_REPO" commit -m "gitignore" >/dev/null 2>&1 || fail "failed to commit fixture gitignore"
touch "$STOP_REPO/$AI_STOP_E2E_KILL_SWITCH"

WRAPPER_EXIT=0
WRAPPER_OUT=$(cd "$STOP_REPO" && AI_STATE_ROOT="$WRAPPER_STATE" bash "$WRAPPER" 2>"$WRAPPER_ERR") \
  || WRAPPER_EXIT=$?
[ "$WRAPPER_EXIT" -eq 0 ] || fail "wrapper on clean repo should exit 0 (got $WRAPPER_EXIT)"
[ -z "$WRAPPER_OUT" ] || fail "wrapper on clean repo should produce no stdout"
[ ! -s "$WRAPPER_ERR" ] || fail "wrapper on clean repo should produce no stderr"

printf 'wrapper-dirty\n' >> "$STOP_REPO/file.txt"
WRAPPER_EXIT=0
WRAPPER_OUT=$(cd "$STOP_REPO" && AI_STATE_ROOT="$WRAPPER_STATE" bash "$WRAPPER" 2>"$WRAPPER_ERR") \
  || WRAPPER_EXIT=$?
[ "$WRAPPER_EXIT" -eq 2 ] || fail "wrapper on dirty repo should exit 2 (got $WRAPPER_EXIT)"
[ -z "$WRAPPER_OUT" ] || fail "wrapper on dirty repo should produce no stdout"
assert_contains "$(cat "$WRAPPER_ERR")" "uncommitted changes on branch 'feature/dirty'"
assert_contains "$(cat "$WRAPPER_ERR")" "until the change set or branch changes"
touch "$(ai_stop_hard_marker_path "$STOP_REPO")"
WRAPPER_ACTIVE_EXIT=0
WRAPPER_ACTIVE_OUT=$(
  cd "$STOP_REPO"
  printf '%s' '{"stop_hook_active":true}' | AI_STATE_ROOT="$WRAPPER_STATE" bash "$WRAPPER" 2>"$WRAPPER_ERR"
) || WRAPPER_ACTIVE_EXIT=$?
[ "$WRAPPER_ACTIVE_EXIT" -eq 0 ] \
  || fail "wrapper should pass through active Stop continuation (got $WRAPPER_ACTIVE_EXIT)"
[ -z "$WRAPPER_ACTIVE_OUT" ] || fail "active Stop continuation should produce no stdout"
[ ! -s "$WRAPPER_ERR" ] || fail "active Stop continuation should produce no stderr"
rm -f "$(ai_stop_hard_marker_path "$STOP_REPO")"
git -C "$STOP_REPO" checkout -- file.txt >/dev/null 2>&1 || fail "failed to reclean stop fixture"
rm -f "$STOP_REPO/$AI_STOP_E2E_KILL_SWITCH"

E2E_REPO="$TMP_ROOT/e2e-repo"
git init -b feature/e2e "$E2E_REPO" >/dev/null 2>&1 || fail "failed to init e2e fixture"
git -C "$E2E_REPO" config user.email hooks@example.test
git -C "$E2E_REPO" config user.name "Hook Test"
printf 'base\n' > "$E2E_REPO/file.txt"
git -C "$E2E_REPO" add file.txt
git -C "$E2E_REPO" commit -m "base" >/dev/null 2>&1 || fail "failed to commit e2e fixture"

E2E_MARKER="$AI_BUN_LOG_DIR/last.e2e"
E2E_COUNTER=$(ai_stop_e2e_counter_path "$E2E_REPO")
E2E_FP=$(ai_worktree_fingerprint "$E2E_REPO")

# Cache miss: no stop-hook e2e launch, no message, no marker churn.
rm -f "$E2E_MARKER" "$E2E_COUNTER"
FAKE_BUN_CALL="$TMP_ROOT/stop-hook-bun-called"
PATH="$TMP_ROOT/no-such-bin:$PATH" ai_stop_e2e_status "$E2E_REPO" >/dev/null \
  && fail "e2e cache miss should not emit reminder"
[ ! -f "$FAKE_BUN_CALL" ] || fail "stop hook should not launch bun on e2e cache miss"
[ ! -f "$E2E_MARKER" ] || fail "e2e cache miss should not write marker"

# Cached failure: surfaces failure, increments counter to 1.
ai_write_bun_marker "$E2E_MARKER" "$E2E_FP" 1
STOP_E2E_MSG=$(ai_stop_e2e_status "$E2E_REPO") \
  || fail "cached failing e2e should emit reminder"
assert_contains "$STOP_E2E_MSG" "e2e tests are failing"
assert_contains "$STOP_E2E_MSG" "exit 1"
ai_stop_e2e_read_counter "$E2E_COUNTER" || fail "expected counter file after first failure"
[ "$AI_STOP_E2E_COUNTER_COUNT" = "1" ] || fail "first failure should set count=1 (got $AI_STOP_E2E_COUNTER_COUNT)"

# Cache hit, same fp: counter goes to 2 and still emits.
STOP_E2E_MSG=$(ai_stop_e2e_status "$E2E_REPO") \
  || fail "second failure on same fp should still emit reminder"
ai_stop_e2e_read_counter "$E2E_COUNTER" || fail "counter file missing after second failure"
[ "$AI_STOP_E2E_COUNTER_COUNT" = "2" ] || fail "second failure should set count=2 (got $AI_STOP_E2E_COUNTER_COUNT)"

# Third stop on same fp: suppressed.
if ai_stop_e2e_status "$E2E_REPO" >/dev/null; then
  fail "third failure on same fp should be suppressed"
fi
ai_stop_e2e_read_counter "$E2E_COUNTER" || fail "counter file missing after suppression"
[ "$AI_STOP_E2E_COUNTER_COUNT" = "2" ] || fail "suppressed stop should not increment counter past max"

# Fingerprint change: counter resets to 1, emits again.
printf 'change\n' >> "$E2E_REPO/file.txt"
git -C "$E2E_REPO" add file.txt
git -C "$E2E_REPO" commit -m "change" >/dev/null 2>&1 || fail "failed to commit fp change"
E2E_FP=$(ai_worktree_fingerprint "$E2E_REPO")
ai_write_bun_marker "$E2E_MARKER" "$E2E_FP" 1
STOP_E2E_MSG=$(ai_stop_e2e_status "$E2E_REPO") \
  || fail "failing e2e on new fingerprint should emit reminder"
ai_stop_e2e_read_counter "$E2E_COUNTER" || fail "counter file missing after fp change"
[ "$AI_STOP_E2E_COUNTER_COUNT" = "1" ] || fail "fp change should reset count to 1 (got $AI_STOP_E2E_COUNTER_COUNT)"

# Branch change: counter resets to 1.
git -C "$E2E_REPO" checkout -b feature/other >/dev/null 2>&1 || fail "failed to switch e2e branch"
STOP_E2E_MSG=$(ai_stop_e2e_status "$E2E_REPO") \
  || fail "failing e2e on new branch should emit reminder"
ai_stop_e2e_read_counter "$E2E_COUNTER" || fail "counter file missing after branch change"
[ "$AI_STOP_E2E_COUNTER_COUNT" = "1" ] || fail "branch change should reset count to 1"
[ "$AI_STOP_E2E_COUNTER_BRANCH" = "feature/other" ] || fail "counter branch should track current branch"

# Success: counter cleared, no message.
ai_write_bun_marker "$E2E_MARKER" "$E2E_FP" 0
if ai_stop_e2e_status "$E2E_REPO" >/dev/null; then
  fail "passing e2e should not emit reminder"
fi
[ ! -f "$E2E_COUNTER" ] || fail "passing e2e should clear counter"
[ "$AI_MARKER_LAST_EXIT" = "0" ] || fail "cached e2e marker should record exit 0"

# Kill switch suppresses e2e check entirely (commit reminder still fires elsewhere).
touch "$E2E_REPO/$AI_STOP_E2E_KILL_SWITCH"
rm -f "$E2E_MARKER" "$E2E_COUNTER"
ai_write_bun_marker "$E2E_MARKER" "$E2E_FP" 1
if ai_stop_e2e_status "$E2E_REPO" >/dev/null; then
  fail "kill switch should suppress e2e check even on failure"
fi
[ ! -f "$E2E_COUNTER" ] || fail "kill switch should not write counter"
rm -f "$E2E_REPO/$AI_STOP_E2E_KILL_SWITCH"

ASYNC_REPO="$TMP_ROOT/async-repo"
git init -b feature/async "$ASYNC_REPO" >/dev/null 2>&1 || fail "failed to init async fixture"
git -C "$ASYNC_REPO" config user.email hooks@example.test
git -C "$ASYNC_REPO" config user.name "Hook Test"
printf 'base\n' > "$ASYNC_REPO/file.txt"
git -C "$ASYNC_REPO" add file.txt
git -C "$ASYNC_REPO" commit -m "base" >/dev/null 2>&1 || fail "failed to commit async fixture"

ASYNC_STATE_DIR="$MUSI_VERIFY_ASYNC_STATE_ROOT/$(ai_stop_repo_key "$ASYNC_REPO")"
ASYNC_RUN_DIR="$ASYNC_STATE_DIR/runs/run-1"
ASYNC_STATE="$ASYNC_RUN_DIR/state"
ASYNC_COUNTER=$(ai_stop_async_counter_path "$ASYNC_REPO")
mkdir -p "$ASYNC_RUN_DIR/logs"
ASYNC_STARTED=$(( $(date +%s) - 4 ))

write_async_state() {
  local exit_code="$1"
  local finished_epoch="$2"
  cat > "$ASYNC_STATE" <<EOF
pid=$$
started_epoch=$ASYNC_STARTED
started_at=$(date -Iseconds -d "@$ASYNC_STARTED")
command=bun run verify:changed
head=$(git -C "$ASYNC_REPO" rev-parse HEAD)
worktree_fingerprint=$(printf 'c%.0s' {1..64})
log_dir=$ASYNC_RUN_DIR/logs
exit_code=$exit_code
finished_epoch=$finished_epoch
finished_at=${finished_epoch:+$(date -Iseconds -d "@$finished_epoch")}
EOF
}

write_async_state "" ""
printf '%s\n' "$ASYNC_STATE" > "$ASYNC_STATE_DIR/latest"

# Running: emits up to MAX_NOTIFY times, then suppresses.
rm -f "$ASYNC_COUNTER"
ASYNC_MSG=$(ai_stop_async_verify_status "$ASYNC_REPO") \
  || fail "running async verify should emit status (call 1)"
assert_contains "$ASYNC_MSG" "async verify running"
assert_contains "$ASYNC_MSG" "PID $$"
assert_contains "$ASYNC_MSG" "elapsed"
assert_contains "$ASYNC_MSG" "$AI_STOP_ASYNC_KILL_SWITCH"
ai_stop_async_read_counter "$ASYNC_COUNTER" || fail "running counter missing after first emit"
[ "$AI_STOP_ASYNC_COUNTER_COUNT" = "1" ] || fail "running counter should be 1 after first emit"

ASYNC_MSG=$(ai_stop_async_verify_status "$ASYNC_REPO") \
  || fail "running async verify should still emit on call 2"
ai_stop_async_read_counter "$ASYNC_COUNTER" || fail "running counter missing after second emit"
[ "$AI_STOP_ASYNC_COUNTER_COUNT" = "2" ] || fail "running counter should be 2 after second emit"

if ai_stop_async_verify_status "$ASYNC_REPO" >/dev/null; then
  fail "running async verify should suppress after $AI_STOP_ASYNC_MAX_NOTIFY notices"
fi

# Passing: emits nothing and clears any stale counter.
ASYNC_FINISHED=$((ASYNC_STARTED + 3))
write_async_state 0 "$ASYNC_FINISHED"
if ai_stop_async_verify_status "$ASYNC_REPO" >/dev/null; then
  fail "passed async verify should not emit status"
fi
[ ! -f "$ASYNC_COUNTER" ] || fail "passed async verify should clear counter"

# Failed: emits up to MAX_NOTIFY times, then suppresses.
write_async_state 1 "$ASYNC_FINISHED"
ASYNC_MSG=$(ai_stop_async_verify_status "$ASYNC_REPO") \
  || fail "failed async verify should emit status (call 1)"
assert_contains "$ASYNC_MSG" "async verify failed"
assert_contains "$ASYNC_MSG" "exit 1"
ASYNC_MSG=$(ai_stop_async_verify_status "$ASYNC_REPO") \
  || fail "failed async verify should still emit on call 2"
if ai_stop_async_verify_status "$ASYNC_REPO" >/dev/null; then
  fail "failed async verify should suppress after $AI_STOP_ASYNC_MAX_NOTIFY notices"
fi

# Exit-code change resets the counter, for example exit 1 to exit 2 from a re-run.
write_async_state 2 "$ASYNC_FINISHED"
ASYNC_MSG=$(ai_stop_async_verify_status "$ASYNC_REPO") \
  || fail "different exit code should re-emit"
assert_contains "$ASYNC_MSG" "exit 2"
ai_stop_async_read_counter "$ASYNC_COUNTER" || fail "counter missing after re-emit"
[ "$AI_STOP_ASYNC_COUNTER_COUNT" = "1" ] || fail "exit-code change should reset count to 1"

# New state file (a fresh run) resets the counter.
ASYNC_RUN_DIR_2="$ASYNC_STATE_DIR/runs/run-2"
ASYNC_STATE_2="$ASYNC_RUN_DIR_2/state"
mkdir -p "$ASYNC_RUN_DIR_2/logs"
ASYNC_STATE="$ASYNC_STATE_2"
ASYNC_RUN_DIR="$ASYNC_RUN_DIR_2"
write_async_state 1 "$ASYNC_FINISHED"
printf '%s\n' "$ASYNC_STATE_2" > "$ASYNC_STATE_DIR/latest"
ASYNC_MSG=$(ai_stop_async_verify_status "$ASYNC_REPO") \
  || fail "new state file should re-emit"
ai_stop_async_read_counter "$ASYNC_COUNTER" || fail "counter missing after new state emit"
[ "$AI_STOP_ASYNC_COUNTER_COUNT" = "1" ] || fail "new state file should reset count to 1"
[ "$AI_STOP_ASYNC_COUNTER_STATE" = "$ASYNC_STATE_2" ] || fail "counter should track latest state path"

# Kill switch suppresses the reporter entirely, even on a failed run.
touch "$ASYNC_REPO/$AI_STOP_ASYNC_KILL_SWITCH"
if ai_stop_async_verify_status "$ASYNC_REPO" >/dev/null; then
  fail "kill switch should suppress async status"
fi
rm -f "$ASYNC_REPO/$AI_STOP_ASYNC_KILL_SWITCH"

rm -rf "$ASYNC_STATE_DIR"
rm -f "$ASYNC_COUNTER"
if ai_stop_async_verify_status "$ASYNC_REPO" >/dev/null; then
  fail "missing async state should not emit status"
fi

# --- ai_stop_verify_status ----------------------------------------------------
VERIFY_REPO="$TMP_ROOT/verify-repo"
git init -b feature/verify "$VERIFY_REPO" >/dev/null 2>&1 \
  || fail "failed to init verify fixture"
git -C "$VERIFY_REPO" config user.email hooks@example.test
git -C "$VERIFY_REPO" config user.name "Hook Test"
printf 'base\n' > "$VERIFY_REPO/file.txt"
git -C "$VERIFY_REPO" add file.txt
git -C "$VERIFY_REPO" commit -m base >/dev/null 2>&1 \
  || fail "failed to commit verify fixture"

VERIFY_LOG_DIR="$TMP_ROOT/verify-logs"
VERIFY_META_DIR="$VERIFY_LOG_DIR/meta"
VERIFY_WRAPPER="$VERIFY_META_DIR/wrapper.json"
VERIFY_COUNTER=$(ai_stop_verify_counter_path "$VERIFY_REPO")
mkdir -p "$VERIFY_META_DIR"
VERIFY_WORKTREE_FP=$(ai_worktree_fingerprint "$VERIFY_REPO")
VERIFY_PRECOMMIT_FP=$(ai_precommit_fingerprint "$VERIFY_REPO")
VERIFY_HEAD=$(git -C "$VERIFY_REPO" rev-parse HEAD)

write_verify_wrapper() {
  local mode="$1" exit_code="$2" fp="$3"
  printf '{"name":"wrapper","mode":"%s","start_time":"2026-05-05T00:00:00+00:00","end_time":"2026-05-05T00:00:30+00:00","elapsed_seconds":30,"exit_code":%s,"head":"%s","fingerprint":"%s","command":"bash scripts/verify.sh"}\n' \
    "$mode" "$exit_code" "$VERIFY_HEAD" "$fp" > "$VERIFY_WRAPPER"
}

write_verify_step_meta() {
  local name="$1" exit_code="$2"
  printf '{"name":"%s","mode":"parallel-precommit","start_time":"2026-05-05T00:00:00+00:00","end_time":"2026-05-05T00:00:05+00:00","elapsed_seconds":5,"exit_code":%s,"command":"bun run %s"}\n' \
    "$name" "$exit_code" "$name" > "$VERIFY_META_DIR/$name.json"
}

# Missing wrapper.json: silent.
rm -f "$VERIFY_WRAPPER" "$VERIFY_COUNTER"
if MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO" >/dev/null; then
  fail "missing wrapper should not emit status"
fi

# Same HEAD/content in a sibling worktree must not read this worktree's default
# cached verify wrapper. The default log path is worktree-scoped, so only the
# worktree that produced the failed metadata sees the stop reminder.
VERIFY_SIBLING="$TMP_ROOT/verify-sibling"
git -C "$VERIFY_REPO" worktree add -q -b feature/verify-sibling "$VERIFY_SIBLING" HEAD \
  || fail "failed to create sibling verify worktree"
VERIFY_DEFAULT_STATE_ROOT="$TMP_ROOT/verify-default-state"
VERIFY_SIBLING_LOG_DIR=$(
  MUSI_VERIFY_STATE_ROOT="$VERIFY_DEFAULT_STATE_ROOT" \
    musi_standard_verify_log_dir "$VERIFY_SIBLING"
)
VERIFY_PRIMARY_LOG_DIR=$(
  MUSI_VERIFY_STATE_ROOT="$VERIFY_DEFAULT_STATE_ROOT" \
    musi_standard_verify_log_dir "$VERIFY_REPO"
)
[ "$VERIFY_PRIMARY_LOG_DIR" != "$VERIFY_SIBLING_LOG_DIR" ] \
  || fail "same-HEAD worktrees should not share default verify log dirs"
VERIFY_WRAPPER="$VERIFY_SIBLING_LOG_DIR/meta/wrapper.json"
mkdir -p "$(dirname "$VERIFY_WRAPPER")"
VERIFY_HEAD=$(git -C "$VERIFY_SIBLING" rev-parse HEAD)
write_verify_wrapper parallel-precommit 1 "$(ai_precommit_fingerprint "$VERIFY_SIBLING")"
if MUSI_VERIFY_STATE_ROOT="$VERIFY_DEFAULT_STATE_ROOT" ai_stop_verify_status "$VERIFY_REPO" >/dev/null; then
  fail "primary worktree should not emit sibling cached verify status"
fi
VERIFY_MSG=$(
  MUSI_VERIFY_STATE_ROOT="$VERIFY_DEFAULT_STATE_ROOT" \
    ai_stop_verify_status "$VERIFY_SIBLING"
) || fail "sibling worktree should emit its own cached verify status"
assert_contains "$VERIFY_MSG" "cached pre-commit"
VERIFY_HEAD=$(git -C "$VERIFY_REPO" rev-parse HEAD)
VERIFY_WRAPPER="$VERIFY_META_DIR/wrapper.json"

# Failing pre-commit run: emits up to MAX_NOTIFY, then suppresses.
rm -f "$VERIFY_COUNTER"
write_verify_wrapper parallel-precommit 1 "$VERIFY_PRECOMMIT_FP"
VERIFY_MSG=$(MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO") \
  || fail "failing pre-commit should emit status (call 1)"
assert_contains "$VERIFY_MSG" "cached pre-commit"
assert_contains "$VERIFY_MSG" "exit 1"
assert_contains "$VERIFY_MSG" "$AI_STOP_VERIFY_KILL_SWITCH"
assert_contains "$VERIFY_MSG" "verify:logs"
ai_stop_verify_read_counter "$VERIFY_COUNTER" \
  || fail "verify counter missing after first emit"
[ "$AI_STOP_VERIFY_COUNTER_COUNT" = "1" ] || fail "verify counter should be 1"

VERIFY_MSG=$(MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO") \
  || fail "failing pre-commit should still emit on call 2"
ai_stop_verify_read_counter "$VERIFY_COUNTER" \
  || fail "verify counter missing after second emit"
[ "$AI_STOP_VERIFY_COUNTER_COUNT" = "2" ] || fail "verify counter should be 2"

if MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO" >/dev/null; then
  fail "failing verify should suppress after $AI_STOP_VERIFY_MAX_NOTIFY notices"
fi
VERIFY_HARD_MARKER=$(ai_stop_hard_marker_path "$VERIFY_REPO")
touch "$VERIFY_HARD_MARKER"
VERIFY_MSG=$(
  MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" \
    ai_stop_policy_messages "$VERIFY_REPO"
) || fail "hard-stop cached verify should emit after soft counter suppression"
assert_contains "$VERIFY_MSG" "cached pre-commit"
assert_contains "$VERIFY_MSG" "hard-stop mode is on"
assert_contains "$VERIFY_MSG" "$VERIFY_HARD_MARKER"
VERIFY_MSG=$(
  MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" \
    ai_stop_policy_messages "$VERIFY_REPO"
) || fail "hard-stop cached verify should repeat for unchanged failed metadata"
assert_contains "$VERIFY_MSG" "cached pre-commit"
touch "$VERIFY_REPO/$AI_STOP_VERIFY_KILL_SWITCH"
if MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO" "" hard >/dev/null; then
  fail "verify kill switch should suppress hard-stop cached verify"
fi
rm -f "$VERIFY_REPO/$AI_STOP_VERIFY_KILL_SWITCH" "$VERIFY_HARD_MARKER"

# Passing wrapper: emits nothing and clears any stale counter.
write_verify_wrapper parallel-precommit 0 "$VERIFY_PRECOMMIT_FP"
if MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO" >/dev/null; then
  fail "passing verify should not emit status"
fi
[ ! -f "$VERIFY_COUNTER" ] || fail "passing verify should clear counter"

# Exit-code change resets the counter (e.g. 1 -> 2 from a re-run).
write_verify_wrapper parallel-precommit 2 "$VERIFY_PRECOMMIT_FP"
VERIFY_MSG=$(MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO") \
  || fail "exit-code change should re-emit"
assert_contains "$VERIFY_MSG" "exit 2"
ai_stop_verify_read_counter "$VERIFY_COUNTER" \
  || fail "counter missing after exit-code change emit"
[ "$AI_STOP_VERIFY_COUNTER_COUNT" = "1" ] || fail "exit-code change should reset count to 1"

# serial-verify mode reports a different label.
write_verify_wrapper serial-verify 1 "$VERIFY_WORKTREE_FP"
rm -f "$VERIFY_COUNTER"
VERIFY_MSG=$(MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO") \
  || fail "serial-verify failing should emit"
assert_contains "$VERIFY_MSG" "cached verify"

# changed verify modes key freshness to the staged fingerprint, not the full
# worktree fingerprint.
printf 'staged verify changed\n' > "$VERIFY_REPO/file.txt"
git -C "$VERIFY_REPO" add file.txt
VERIFY_STAGED_FP=$(ai_staged_fingerprint "$VERIFY_REPO")
mkdir -p "$VERIFY_REPO/docs"
printf 'scratch\n' > "$VERIFY_REPO/docs/scratch.md"
write_verify_wrapper serial-verify-changed 1 "$VERIFY_STAGED_FP"
rm -f "$VERIFY_COUNTER"
VERIFY_MSG=$(MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO") \
  || fail "serial-verify-changed failing should emit against staged fingerprint"
assert_contains "$VERIFY_MSG" "cached verify:changed"
write_verify_wrapper parallel-verify-changed 1 "$VERIFY_STAGED_FP"
rm -f "$VERIFY_COUNTER"
VERIFY_MSG=$(MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO") \
  || fail "parallel-verify-changed failing should emit against staged fingerprint"
assert_contains "$VERIFY_MSG" "cached verify:changed"
rm -f "$VERIFY_REPO/docs/scratch.md"
rmdir "$VERIFY_REPO/docs" 2>/dev/null || true
git -C "$VERIFY_REPO" reset -- file.txt >/dev/null 2>&1
git -C "$VERIFY_REPO" checkout -- file.txt

mkdir -p "$VERIFY_REPO/scripts"
printf 'echo before\n' > "$VERIFY_REPO/scripts/check.sh"
git -C "$VERIFY_REPO" add scripts/check.sh
git -C "$VERIFY_REPO" commit -m 'add script fixture' >/dev/null 2>&1 \
  || fail "failed to commit script fixture"
VERIFY_HEAD=$(git -C "$VERIFY_REPO" rev-parse HEAD)

# Unrelated untracked files are not pre-commit inputs and should not stale a
# cached pre-commit failure.
printf 'staged red\n' > "$VERIFY_REPO/file.txt"
git -C "$VERIFY_REPO" add file.txt
VERIFY_PRECOMMIT_FP=$(ai_precommit_fingerprint "$VERIFY_REPO")
write_verify_wrapper parallel-precommit 1 "$VERIFY_PRECOMMIT_FP"
rm -f "$VERIFY_COUNTER"
printf 'unstaged side edit\n' > "$VERIFY_REPO/side.txt"
mkdir -p "$VERIFY_REPO/docs"
printf 'scratch\n' > "$VERIFY_REPO/docs/scratch.md"
VERIFY_MSG=$(MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO") \
  || fail "untracked non-input edit should not stale a pre-commit failure"
assert_contains "$VERIFY_MSG" "cached pre-commit"

# Changing the staged diff after the failed pre-commit makes the cached result
# stale, even when the worktree still contains the original edit.
git -C "$VERIFY_REPO" reset -- file.txt >/dev/null 2>&1
rm -f "$VERIFY_COUNTER"
if MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO" >/dev/null; then
  fail "changed staged diff should stale a pre-commit failure"
fi
git -C "$VERIFY_REPO" checkout -- file.txt
rm -f "$VERIFY_REPO/side.txt" "$VERIFY_REPO/docs/scratch.md"
rmdir "$VERIFY_REPO/docs" 2>/dev/null || true

# A relevant unstaged source/config edit is a pre-commit input, so changing it
# after the failed run makes the cached result stale.
printf 'echo staged\n' > "$VERIFY_REPO/scripts/check.sh"
git -C "$VERIFY_REPO" add scripts/check.sh
VERIFY_PRECOMMIT_FP=$(ai_precommit_fingerprint "$VERIFY_REPO")
write_verify_wrapper parallel-precommit 1 "$VERIFY_PRECOMMIT_FP"
rm -f "$VERIFY_COUNTER"
printf 'echo unstaged changed\n' > "$VERIFY_REPO/scripts/check.sh"
if MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO" >/dev/null; then
  fail "relevant unstaged edit should stale a pre-commit failure"
fi
git -C "$VERIFY_REPO" reset -- scripts/check.sh >/dev/null 2>&1
git -C "$VERIFY_REPO" checkout -- scripts/check.sh

# A relevant tracked deletion is also a pre-commit input because pre-commit
# runs full typecheck. It must stale the cached failure even though there is no
# file left to hash.
mkdir -p "$VERIFY_REPO/packages/server/src"
printf 'delete me\n' > "$VERIFY_REPO/packages/server/src/delete-me.ts"
git -C "$VERIFY_REPO" add packages/server/src/delete-me.ts
git -C "$VERIFY_REPO" commit -m 'add deletion fixture' >/dev/null 2>&1 \
  || fail "failed to commit deletion fixture"
VERIFY_HEAD=$(git -C "$VERIFY_REPO" rev-parse HEAD)
printf 'staged red again\n' > "$VERIFY_REPO/file.txt"
git -C "$VERIFY_REPO" add file.txt
VERIFY_PRECOMMIT_FP=$(ai_precommit_fingerprint "$VERIFY_REPO")
write_verify_wrapper parallel-precommit 1 "$VERIFY_PRECOMMIT_FP"
rm -f "$VERIFY_COUNTER"
rm "$VERIFY_REPO/packages/server/src/delete-me.ts"
if MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO" >/dev/null; then
  fail "relevant tracked deletion should stale a pre-commit failure"
fi
git -C "$VERIFY_REPO" reset -- file.txt >/dev/null 2>&1
git -C "$VERIFY_REPO" checkout -- packages/server/src/delete-me.ts file.txt

VERIFY_WORKTREE_FP=$(ai_worktree_fingerprint "$VERIFY_REPO")
VERIFY_PRECOMMIT_FP=$(ai_precommit_fingerprint "$VERIFY_REPO")

# Stale fingerprint: silent, no counter write. The cached failure no longer
# describes the code the agent is editing.
write_verify_wrapper parallel-precommit 1 "$(printf 'd%.0s' {1..64})"
rm -f "$VERIFY_COUNTER"
if MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO" >/dev/null; then
  fail "stale fingerprint should not emit status"
fi
[ ! -f "$VERIFY_COUNTER" ] || fail "stale fingerprint should not write counter"

# Kill switch suppresses the reporter entirely, even on a matching failure.
write_verify_wrapper parallel-precommit 1 "$VERIFY_PRECOMMIT_FP"
rm -f "$VERIFY_COUNTER"
touch "$VERIFY_REPO/$AI_STOP_VERIFY_KILL_SWITCH"
if MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO" >/dev/null; then
  fail "kill switch should suppress verify status"
fi
[ ! -f "$VERIFY_COUNTER" ] || fail "kill switch should not write counter"
rm -f "$VERIFY_REPO/$AI_STOP_VERIFY_KILL_SWITCH"

write_verify_wrapper parallel-precommit 1 "$VERIFY_PRECOMMIT_FP"
touch "$VERIFY_REPO/$AI_STOP_VERIFY_LEGACY_KILL_SWITCH"
if MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO" >/dev/null; then
  fail "legacy kill switch should suppress verify status"
fi
rm -f "$VERIFY_REPO/$AI_STOP_VERIFY_LEGACY_KILL_SWITCH"

# R5/F7: name the failing gates from per-step meta so the agent can tell a
# lint/ratchet failure from a typecheck/test failure without opening verify:logs.
rm -f "$VERIFY_META_DIR"/*.json "$VERIFY_COUNTER"
VERIFY_PRECOMMIT_FP=$(ai_precommit_fingerprint "$VERIFY_REPO")
write_verify_wrapper parallel-precommit 1 "$VERIFY_PRECOMMIT_FP"
write_verify_step_meta lint 0
write_verify_step_meta ratchet 1
VERIFY_MSG=$(MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO") \
  || fail "failing run with step meta should emit status"
# Trailing period proves the passing lint gate (exit 0) was not appended.
assert_contains "$VERIFY_MSG" "failing gate(s): ratchet."

# Multiple non-zero gates are sorted and comma-joined; passing gates are omitted.
rm -f "$VERIFY_COUNTER"
write_verify_step_meta typecheck 1
VERIFY_MSG=$(MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO") \
  || fail "multi-failing run should emit status"
assert_contains "$VERIFY_MSG" "failing gate(s): ratchet, typecheck"

# No step meta present: fall back to the generic line without a gate clause.
rm -f "$VERIFY_META_DIR"/*.json "$VERIFY_COUNTER"
write_verify_wrapper parallel-precommit 1 "$VERIFY_PRECOMMIT_FP"
VERIFY_MSG=$(MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO") \
  || fail "failing run without step meta should still emit a generic status"
assert_contains "$VERIFY_MSG" "run is failing (exit 1"
assert_not_contains "$VERIFY_MSG" "failing gate(s):"
rm -f "$VERIFY_META_DIR"/*.json "$VERIFY_COUNTER"

# --- ai_stop_lint_warnings_reminder ------------------------------------------
STOP_LINT_REPO="$TMP_ROOT/stop-lint-repo"
git init -b feature/lint-warnings "$STOP_LINT_REPO" >/dev/null 2>&1 \
  || fail "failed to init stop lint fixture"
git -C "$STOP_LINT_REPO" config user.email hooks@example.test
git -C "$STOP_LINT_REPO" config user.name "Hook Test"
mkdir -p "$STOP_LINT_REPO/src" "$STOP_LINT_REPO/node_modules/.bin"
printf 'const clean = 1;\n' > "$STOP_LINT_REPO/src/warn.ts"
git -C "$STOP_LINT_REPO" add src/warn.ts
git -C "$STOP_LINT_REPO" commit -m base >/dev/null 2>&1 \
  || fail "failed to commit stop lint fixture"

STOP_LINT_LOG="$TMP_ROOT/stop-lint-eslint.log"
cat > "$STOP_LINT_REPO/node_modules/.bin/eslint" <<'EOF'
#!/bin/bash
set -u

for arg in "$@"; do
  printf '%s\n' "$arg" >> "$STOP_LINT_LOG"
done

printf '%s\n' '[{"filePath":"stub","errorCount":0,"warningCount":3,"messages":[{"ruleId":"no-console","severity":1,"line":3,"column":5},{"ruleId":"no-console","severity":1,"line":4,"column":5},{"ruleId":"max-lines","severity":1,"line":1,"column":1}]}]'
EOF
chmod +x "$STOP_LINT_REPO/node_modules/.bin/eslint"

printf 'console.log("warn");\n' > "$STOP_LINT_REPO/src/warn.ts"
: > "$STOP_LINT_LOG"
STOP_LINT_MSG=$(STOP_LINT_LOG="$STOP_LINT_LOG" ai_stop_lint_warnings_reminder "$STOP_LINT_REPO") \
  || fail "changed file with lint warnings should emit stop lint reminder"
assert_contains "$STOP_LINT_MSG" "3 eslint warning(s)"
assert_contains "$STOP_LINT_MSG" 'block `bun run lint`'
assert_contains "$STOP_LINT_MSG" "no-console: 2"
assert_contains "$STOP_LINT_MSG" "max-lines: 1"
assert_contains "$STOP_LINT_MSG" "src/warn.ts"
assert_contains "$(cat "$STOP_LINT_LOG")" "no-warn-ignored"

STOP_LINT_LOG_BEFORE=$(cat "$STOP_LINT_LOG")
if STOP_LINT_LOG="$STOP_LINT_LOG" ai_stop_lint_warnings_reminder "$STOP_LINT_REPO" >/dev/null; then
  fail "same stop lint warning fingerprint should not emit twice"
fi
[ "$(cat "$STOP_LINT_LOG")" = "$STOP_LINT_LOG_BEFORE" ] \
  || fail "same stop lint warning fingerprint should not spawn eslint twice"

printf 'console.log("warn again");\n' > "$STOP_LINT_REPO/src/warn.ts"
STOP_LINT_MSG=$(STOP_LINT_LOG="$STOP_LINT_LOG" ai_stop_lint_warnings_reminder "$STOP_LINT_REPO") \
  || fail "changed stop lint warning fingerprint should emit again"
assert_contains "$STOP_LINT_MSG" "3 eslint warning(s)"

touch "$STOP_LINT_REPO/${AI_STOP_LINT_WARNINGS_KILL_SWITCH:-.no-stop-lint-warnings}"
if STOP_LINT_LOG="$STOP_LINT_LOG" ai_stop_lint_warnings_reminder "$STOP_LINT_REPO" >/dev/null; then
  fail "stop lint warning kill switch should suppress reminder"
fi
rm -f "$STOP_LINT_REPO/${AI_STOP_LINT_WARNINGS_KILL_SWITCH:-.no-stop-lint-warnings}"

STOP_LINT_CAP_REPO="$TMP_ROOT/stop-lint-cap-repo"
git init -b feature/lint-cap "$STOP_LINT_CAP_REPO" >/dev/null 2>&1 \
  || fail "failed to init stop lint cap fixture"
git -C "$STOP_LINT_CAP_REPO" config user.email hooks@example.test
git -C "$STOP_LINT_CAP_REPO" config user.name "Hook Test"
mkdir -p "$STOP_LINT_CAP_REPO/src" "$STOP_LINT_CAP_REPO/node_modules/.bin"
printf 'a\n' > "$STOP_LINT_CAP_REPO/src/a.ts"
printf 'b\n' > "$STOP_LINT_CAP_REPO/src/b.ts"
git -C "$STOP_LINT_CAP_REPO" add src
git -C "$STOP_LINT_CAP_REPO" commit -m base >/dev/null 2>&1 \
  || fail "failed to commit stop lint cap fixture"
cp "$STOP_LINT_REPO/node_modules/.bin/eslint" "$STOP_LINT_CAP_REPO/node_modules/.bin/eslint"
printf 'a changed\n' > "$STOP_LINT_CAP_REPO/src/a.ts"
printf 'b changed\n' > "$STOP_LINT_CAP_REPO/src/b.ts"
: > "$STOP_LINT_LOG"
STOP_LINT_MSG=$(
  STOP_LINT_LOG="$STOP_LINT_LOG" AI_TIDY_STOP_WARNING_FILE_CAP=1 \
    ai_stop_lint_warnings_reminder "$STOP_LINT_CAP_REPO"
) || fail "capped stop lint warning run should still emit"
assert_contains "$STOP_LINT_MSG" "1 changed eslint-supported file(s) not scanned"
[ "$(grep -c '^src/' "$STOP_LINT_LOG")" = "1" ] \
  || fail "capped stop lint warning run should scan exactly one changed path: $(cat "$STOP_LINT_LOG")"

printf 'ai-hooks stop-policy tests passed\n'
