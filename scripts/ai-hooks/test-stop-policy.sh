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

assert_system_message_only() {
  local output="$1"
  local keys

  assert_hook_json "$output"
  keys=$(jq -r 'keys | join(",")' <<< "$output")
  [ "$keys" = "systemMessage" ] \
    || fail "stop wrapper should emit systemMessage-only JSON, got keys: $keys; output: $output"
  [ -n "$(jq -r '.systemMessage // empty' <<< "$output")" ] \
    || fail "stop wrapper systemMessage should not be empty: $output"
}

assert_stop_readonly_git_uses_optional_locks() {
  local repo_root="$1"
  local shim_dir="$TMP_ROOT/stop-readonly-git-shim"
  local log="$TMP_ROOT/stop-readonly-git.log"
  local real_git guard_log

  real_git=$(command -v git)
  make_git_optional_locks_guard_shim "$shim_dir"
  : > "$log"
  printf 'optional-locks\n' > "$repo_root/optional-locks.ts"

  (
    export PATH="$shim_dir:$PATH"
    export AI_TEST_REAL_GIT="$real_git"
    export AI_TEST_GIT_OPTIONAL_LOCKS_LOG="$log"

    ai_stop_has_uncommitted_changes "$repo_root" >/dev/null
    ai_stop_commit_reminder "$repo_root" optional-locks >/dev/null
    ai_stop_current_branch "$repo_root" >/dev/null
    ai_stop_lint_warning_branch "$repo_root" >/dev/null
    ai_stop_lint_warning_changed_paths "$repo_root" >/dev/null
  ) || fail "stop-policy read-only git calls should run with GIT_OPTIONAL_LOCKS=0"

  guard_log=$(cat "$log")
  assert_not_contains "$guard_log" "MISSING"
  assert_contains "$guard_log" $'OK\t-C '"$repo_root"$' status --porcelain'
  assert_contains "$guard_log" $'OK\t-C '"$repo_root"$' diff --no-ext-diff --binary HEAD'
  assert_contains "$guard_log" $'OK\t-C '"$repo_root"$' diff -z --name-only'
  assert_contains "$guard_log" $'OK\t-C '"$repo_root"$' diff -z --cached'
  rm -f "$repo_root/optional-locks.ts"
}

# Enforce that every Stop status reporter has loop protection before it can notify.
assert_stop_status_reporters_have_loop_protection

STOP_REPO="$TMP_ROOT/stop-repo"
git init -b main "$STOP_REPO" >/dev/null 2>&1 || fail "failed to init stop hook test repo"
git -C "$STOP_REPO" config user.email hooks@example.test
git -C "$STOP_REPO" config user.name "Hook Test"
printf 'base\n' > "$STOP_REPO/file.txt"
git -C "$STOP_REPO" add file.txt
git -C "$STOP_REPO" commit -m "base" >/dev/null 2>&1 || fail "failed to commit stop hook fixture"

assert_stop_readonly_git_uses_optional_locks "$STOP_REPO"

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
printf 'ORIGINAL=1\n' > "$STOP_MARKER"
stop_marker_files_before="$(find "$(dirname "$STOP_MARKER")" -maxdepth 1 -type f -printf '%f\n' | sort)"
STOP_MSG=$(
  mv() { return 1; }
  ai_stop_commit_reminder "$STOP_REPO"
) || fail "marker write failure should not suppress reminder"
assert_contains "$STOP_MSG" "uncommitted changes on branch 'feature/dirty'"
[ "$(cat "$STOP_MARKER")" = "ORIGINAL=1" ] \
  || fail "failed marker write should preserve existing state"
[ "$(find "$(dirname "$STOP_MARKER")" -maxdepth 1 -type f -printf '%f\n' | sort)" = "$stop_marker_files_before" ] \
  || fail "failed marker write should clean up scratch files"
git -C "$STOP_REPO" checkout -- file.txt >/dev/null 2>&1 || fail "failed to clean stop fixture"

# --- fresh state root: marker writer must create its own directory ------------
# When the Stop state dir does not yet exist, the marker writer must mkdir -p
# so dedup persists instead of degrading to repeated warnings on every stop.
FRESH_STATE_REPO="$TMP_ROOT/fresh-state-repo"
git init -b feature/fresh "$FRESH_STATE_REPO" >/dev/null 2>&1 \
  || fail "failed to init fresh-state fixture"
git -C "$FRESH_STATE_REPO" config user.email hooks@example.test
git -C "$FRESH_STATE_REPO" config user.name "Hook Test"
printf 'base\n' > "$FRESH_STATE_REPO/file.txt"
git -C "$FRESH_STATE_REPO" add file.txt
git -C "$FRESH_STATE_REPO" commit -m base >/dev/null 2>&1 \
  || fail "failed to commit fresh-state fixture"
printf 'dirty\n' >> "$FRESH_STATE_REPO/file.txt"
FRESH_STOP_STATE_DIR="$TMP_ROOT/fresh-stop-state/missing/deeper"
rm -rf "$TMP_ROOT/fresh-stop-state"
[ ! -d "$FRESH_STOP_STATE_DIR" ] || fail "fresh state dir precondition failed"
FRESH_MSG=$(AI_STOP_STATE_DIR="$FRESH_STOP_STATE_DIR" ai_stop_commit_reminder "$FRESH_STATE_REPO") \
  || fail "dirty repo should emit reminder on a fresh state root"
assert_contains "$FRESH_MSG" "uncommitted changes on branch 'feature/fresh'"
[ -d "$FRESH_STOP_STATE_DIR" ] \
  || fail "marker writer should have created the missing Stop state dir"
if AI_STOP_STATE_DIR="$FRESH_STOP_STATE_DIR" ai_stop_commit_reminder "$FRESH_STATE_REPO" >/dev/null; then
  fail "second stop on a fresh state root should be deduped by the persisted marker"
fi

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
[ "$WRAPPER_EXIT" -eq 0 ] || fail "wrapper on dirty repo should exit 0 (got $WRAPPER_EXIT)"
assert_system_message_only "$WRAPPER_OUT"
[ ! -s "$WRAPPER_ERR" ] || fail "wrapper on dirty repo should produce no stderr"
WRAPPER_MESSAGE=$(jq -r '.systemMessage' <<< "$WRAPPER_OUT")
assert_contains "$WRAPPER_MESSAGE" "uncommitted changes on branch 'feature/dirty'"
assert_contains "$WRAPPER_MESSAGE" "touch $STOP_REPO/$AI_STOP_COMMIT_KILL_SWITCH"
assert_not_contains "$WRAPPER_MESSAGE" "stop again"

printf 'wrapper-active-payload\n' >> "$STOP_REPO/file.txt"
WRAPPER_ACTIVE_EXIT=0
WRAPPER_ACTIVE_OUT=$(
  cd "$STOP_REPO"
  printf '%s' '{"stop_hook_active":true}' | AI_STATE_ROOT="$WRAPPER_STATE" bash "$WRAPPER" 2>"$WRAPPER_ERR"
) || WRAPPER_ACTIVE_EXIT=$?
[ "$WRAPPER_ACTIVE_EXIT" -eq 0 ] \
  || fail "active Stop payload should not block user-only delivery (got $WRAPPER_ACTIVE_EXIT)"
assert_system_message_only "$WRAPPER_ACTIVE_OUT"
[ ! -s "$WRAPPER_ERR" ] || fail "active Stop payload should produce no stderr"
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

# The e2e counter writer must create a fresh state directory like the other
# Stop counter writers do.
FRESH_E2E_COUNTER="$TMP_ROOT/fresh-e2e-counter/missing/e2e.counter"
ai_stop_e2e_write_counter "$FRESH_E2E_COUNTER" "$E2E_FP" feature/e2e 1 \
  || fail "e2e counter writer should create a missing state directory"
[ -f "$FRESH_E2E_COUNTER" ] \
  || fail "e2e counter writer should persist into the newly created directory"

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

# fast-commit pre-commit runs carry the -fast mode suffix (leaf 3.10 relabels
# the passing run so bridged/fast landings are greppable) but must be treated
# exactly like parallel-precommit: failing still reports "cached pre-commit",
# passing clears the counter rather than falling through to no-op.
rm -f "$VERIFY_COUNTER"
write_verify_wrapper parallel-precommit-fast 1 "$VERIFY_PRECOMMIT_FP"
VERIFY_MSG=$(MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO") \
  || fail "failing parallel-precommit-fast should emit status"
assert_contains "$VERIFY_MSG" "cached pre-commit"
write_verify_wrapper parallel-precommit-fast 0 "$VERIFY_PRECOMMIT_FP"
if MUSI_VERIFY_LOG_DIR="$VERIFY_LOG_DIR" ai_stop_verify_status "$VERIFY_REPO" >/dev/null; then
  fail "passing parallel-precommit-fast should not emit status"
fi
[ ! -f "$VERIFY_COUNTER" ] || fail "passing parallel-precommit-fast should clear counter"

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

# --- ai_stop_lint_warnings_reminder internal timeout -------------------------
# The live eslint scan is the only Stop subcheck that spawns real work, sharing
# a single 30s Stop budget with the other checks. A slow/hung eslint must be
# bounded so it cannot time out the whole Stop policy: on overrun it emits
# nothing, returns quickly, and leaves no dedup marker (so the check retries on
# the next stop instead of recording a false clean state).
STOP_LINT_TIMEOUT_REPO="$TMP_ROOT/stop-lint-timeout-repo"
git init -b feature/lint-timeout "$STOP_LINT_TIMEOUT_REPO" >/dev/null 2>&1 \
  || fail "failed to init stop lint timeout fixture"
git -C "$STOP_LINT_TIMEOUT_REPO" config user.email hooks@example.test
git -C "$STOP_LINT_TIMEOUT_REPO" config user.name "Hook Test"
mkdir -p "$STOP_LINT_TIMEOUT_REPO/src" "$STOP_LINT_TIMEOUT_REPO/node_modules/.bin"
printf 'const a = 1;\n' > "$STOP_LINT_TIMEOUT_REPO/src/slow.ts"
git -C "$STOP_LINT_TIMEOUT_REPO" add src/slow.ts
git -C "$STOP_LINT_TIMEOUT_REPO" commit -m base >/dev/null 2>&1 \
  || fail "failed to commit stop lint timeout fixture"
cat > "$STOP_LINT_TIMEOUT_REPO/node_modules/.bin/eslint" <<'EOF'
#!/bin/bash
sleep 5
printf '%s\n' '[{"filePath":"stub","errorCount":0,"warningCount":3,"messages":[{"ruleId":"no-console","severity":1}]}]'
EOF
chmod +x "$STOP_LINT_TIMEOUT_REPO/node_modules/.bin/eslint"
printf 'console.log("slow");\n' > "$STOP_LINT_TIMEOUT_REPO/src/slow.ts"
STOP_LINT_TIMEOUT_START=$(date +%s)
if AI_STOP_LINT_WARNINGS_TIMEOUT_SECONDS=1 \
    ai_stop_lint_warnings_reminder "$STOP_LINT_TIMEOUT_REPO" >/dev/null; then
  fail "eslint overrun should not emit a lint warning reminder"
fi
STOP_LINT_TIMEOUT_ELAPSED=$(( $(date +%s) - STOP_LINT_TIMEOUT_START ))
[ "$STOP_LINT_TIMEOUT_ELAPSED" -lt 5 ] \
  || fail "eslint overrun should be bounded under the stub's 5s sleep (took ${STOP_LINT_TIMEOUT_ELAPSED}s)"
STOP_LINT_TIMEOUT_MARKER=$(ai_stop_marker_path "$STOP_LINT_TIMEOUT_REPO" "lint-warnings")
[ ! -f "$STOP_LINT_TIMEOUT_MARKER" ] \
  || fail "eslint overrun must not write a dedup marker so the check retries next stop"

# --- ai_stop_policy_messages_subagent ----------------------------------------
# The SubagentStop composer keeps only the two cheap, per-delegation metadata
# reads (uncommitted changes + failing cached verify) and drops the e2e,
# async-verify, and live-eslint lint checks. Per-agent scope keying keeps a
# subagent nudge from consuming the main loop's one-shot Stop markers.
SUBAGENT_REPO="$TMP_ROOT/subagent-repo"
git init -b feature/subagent "$SUBAGENT_REPO" >/dev/null 2>&1 \
  || fail "failed to init subagent fixture"
git -C "$SUBAGENT_REPO" config user.email hooks@example.test
git -C "$SUBAGENT_REPO" config user.name "Hook Test"
mkdir -p "$SUBAGENT_REPO/src" "$SUBAGENT_REPO/node_modules/.bin"
printf 'const clean = 1;\n' > "$SUBAGENT_REPO/src/warn.ts"
git -C "$SUBAGENT_REPO" add src/warn.ts
git -C "$SUBAGENT_REPO" commit -m base >/dev/null 2>&1 \
  || fail "failed to commit subagent fixture"
SUBAGENT_HEAD=$(git -C "$SUBAGENT_REPO" rev-parse HEAD)

# eslint stub so the (skipped) lint-warnings reminder would otherwise fire.
cat > "$SUBAGENT_REPO/node_modules/.bin/eslint" <<'EOF'
#!/bin/bash
printf '%s\n' '[{"filePath":"stub","errorCount":0,"warningCount":2,"messages":[{"ruleId":"no-console","severity":1},{"ruleId":"no-console","severity":1}]}]'
EOF
chmod +x "$SUBAGENT_REPO/node_modules/.bin/eslint"

# Dirty the tree (commit-reminder + lint inputs) and freeze the fingerprint the
# cached-state fixtures below key against.
printf 'console.log("warn");\n' > "$SUBAGENT_REPO/src/warn.ts"
SUBAGENT_FP=$(ai_worktree_fingerprint "$SUBAGENT_REPO")

# Failing cached serial verify keyed to the current head + dirty worktree fp.
SUBAGENT_LOG_DIR="$TMP_ROOT/subagent-verify-logs"
mkdir -p "$SUBAGENT_LOG_DIR/meta"
printf '{"name":"wrapper","mode":"serial-verify","start_time":"2026-05-05T00:00:00+00:00","end_time":"2026-05-05T00:00:30+00:00","elapsed_seconds":30,"exit_code":1,"head":"%s","fingerprint":"%s","command":"bash scripts/verify.sh"}\n' \
  "$SUBAGENT_HEAD" "$SUBAGENT_FP" > "$SUBAGENT_LOG_DIR/meta/wrapper.json"

# Failing cached e2e + async keyed to the same worktree fingerprint, so both
# long-horizon reporters are live and the exclusion assertions below are real.
ai_write_bun_marker "$AI_BUN_LOG_DIR/last.e2e" "$SUBAGENT_FP" 1
SUBAGENT_ASYNC_DIR="$MUSI_VERIFY_ASYNC_STATE_ROOT/$(ai_stop_repo_key "$SUBAGENT_REPO")"
mkdir -p "$SUBAGENT_ASYNC_DIR/runs/run-1/logs"
SUBAGENT_ASYNC_STATE="$SUBAGENT_ASYNC_DIR/runs/run-1/state"
SUBAGENT_ASYNC_STARTED=$(( $(date +%s) - 3 ))
cat > "$SUBAGENT_ASYNC_STATE" <<EOF
pid=$$
started_epoch=$SUBAGENT_ASYNC_STARTED
command=bun run verify:changed
log_dir=$SUBAGENT_ASYNC_DIR/runs/run-1/logs
exit_code=1
finished_epoch=$(( SUBAGENT_ASYNC_STARTED + 1 ))
EOF
printf '%s\n' "$SUBAGENT_ASYNC_STATE" > "$SUBAGENT_ASYNC_DIR/latest"

# Content: subagent composer keeps commit + verify, drops e2e/async/lint.
SUBAGENT_MSG=$(MUSI_VERIFY_LOG_DIR="$SUBAGENT_LOG_DIR" \
  ai_stop_policy_messages_subagent "$SUBAGENT_REPO" "agent-alpha") \
  || fail "subagent composer should emit for a dirty tree + failing cached verify"
assert_contains "$SUBAGENT_MSG" "uncommitted changes on branch 'feature/subagent'"
assert_contains "$SUBAGENT_MSG" "cached verify"
assert_not_contains "$SUBAGENT_MSG" "e2e tests are failing"
assert_not_contains "$SUBAGENT_MSG" "async verify"
assert_not_contains "$SUBAGENT_MSG" "eslint warning(s)"

# Scope isolation: the agent-alpha one-shot commit marker must not suppress the
# main loop's unscoped Stop reminder for the same dirty tree.
SUBAGENT_MAIN_MSG=$(ai_stop_commit_reminder "$SUBAGENT_REPO") \
  || fail "subagent-scoped commit marker must not consume the main-loop reminder"
assert_contains "$SUBAGENT_MAIN_MSG" "uncommitted changes on branch 'feature/subagent'"

# A second subagent stop on the same agent scope dedupes the commit reminder
# (its scoped one-shot marker is now set), proving the scope threads through.
SUBAGENT_MSG_2=$(MUSI_VERIFY_LOG_DIR="$SUBAGENT_LOG_DIR" \
  ai_stop_policy_messages_subagent "$SUBAGENT_REPO" "agent-alpha") \
  || fail "second subagent stop should still emit the surviving verify status"
assert_not_contains "$SUBAGENT_MSG_2" "uncommitted changes"

# Sanity: the full Stop composer DOES surface the three skipped sources for this
# same fixture, so the exclusions above are meaningful (commit reminder is now
# deduped by the unscoped marker written just above).
SUBAGENT_FULL_MSG=$(MUSI_VERIFY_LOG_DIR="$SUBAGENT_LOG_DIR" \
  ai_stop_policy_messages "$SUBAGENT_REPO") \
  || fail "full stop composer should emit for the subagent fixture"
assert_contains "$SUBAGENT_FULL_MSG" "e2e tests are failing"
assert_contains "$SUBAGENT_FULL_MSG" "async verify"
assert_contains "$SUBAGENT_FULL_MSG" "eslint warning(s)"

# A malformed SubagentStop payload carrying neither a session id nor an agent id
# yields an empty scope. It must NOT fall back to the main loop's unscoped repo
# key: clear both marker paths, run the empty-scope composer, and prove it wrote
# a distinct sentinel marker while leaving the main-loop unscoped reminder live.
SUBAGENT_UNSCOPED_MARKER=$(ai_stop_marker_path "$SUBAGENT_REPO" "")
SUBAGENT_SENTINEL_MARKER=$(ai_stop_marker_path "$SUBAGENT_REPO" "subagent-unscoped")
rm -f "$SUBAGENT_UNSCOPED_MARKER" "$SUBAGENT_SENTINEL_MARKER"
SUBAGENT_EMPTY_MSG=$(MUSI_VERIFY_LOG_DIR="$SUBAGENT_LOG_DIR" \
  ai_stop_policy_messages_subagent "$SUBAGENT_REPO" "") \
  || fail "empty-scope subagent composer should emit for a dirty tree"
assert_contains "$SUBAGENT_EMPTY_MSG" "uncommitted changes on branch 'feature/subagent'"
[ -f "$SUBAGENT_SENTINEL_MARKER" ] \
  || fail "empty-scope subagent must write its distinct sentinel Stop marker"
[ ! -f "$SUBAGENT_UNSCOPED_MARKER" ] \
  || fail "empty-scope subagent must not write the main-loop unscoped Stop marker"
SUBAGENT_MAIN_AFTER_EMPTY=$(ai_stop_commit_reminder "$SUBAGENT_REPO") \
  || fail "empty-scope subagent must not consume the main-loop reminder"
assert_contains "$SUBAGENT_MAIN_AFTER_EMPTY" "uncommitted changes on branch 'feature/subagent'"

rm -f "$AI_BUN_LOG_DIR/last.e2e"

# --- ai_subagent_stop_scope ---------------------------------------------------
# Per-agent scope material: agent_id and session id fold together (mirroring
# ai_throttle_key) so the SubagentStop marker key differs from the main loop's
# repo-only (empty-scope) key.
[ "$(ai_subagent_stop_scope '{"session_id":"s1","agent_id":"a1"}')" = "session:s1:agent:a1" ] \
  || fail "subagent scope should combine session and agent id"
[ "$(ai_subagent_stop_scope '{"agent_id":"a1"}')" = "agent:a1" ] \
  || fail "subagent scope should use agent id alone when session id is absent"
[ "$(ai_subagent_stop_scope '{"session_id":"s1"}')" = "session:s1" ] \
  || fail "subagent scope should use session id alone when agent id is absent"
[ -z "$(ai_subagent_stop_scope '{}')" ] \
  || fail "subagent scope should be empty when no ids are present"

# --- subagent-stop-reminder.sh wrapper ---------------------------------------
# The SubagentStop adapter emits systemMessage-only JSON, exits 0, and keys its
# one-shot marker to the payload's agent scope — never the unscoped main-loop key.
SUBAGENT_WRAPPER="$REPO_ROOT/scripts/ai-hooks/subagent-stop-reminder.sh"
SUBAGENT_WRAP_REPO="$TMP_ROOT/subagent-wrapper-repo"
git init -b feature/subagent-wrap "$SUBAGENT_WRAP_REPO" >/dev/null 2>&1 \
  || fail "failed to init subagent wrapper fixture"
git -C "$SUBAGENT_WRAP_REPO" config user.email hooks@example.test
git -C "$SUBAGENT_WRAP_REPO" config user.name "Hook Test"
printf 'base\n' > "$SUBAGENT_WRAP_REPO/file.txt"
git -C "$SUBAGENT_WRAP_REPO" add file.txt
git -C "$SUBAGENT_WRAP_REPO" commit -m base >/dev/null 2>&1 \
  || fail "failed to commit subagent wrapper fixture"
SUBAGENT_WRAP_ERR="$TMP_ROOT/subagent-wrapper.err"
SUBAGENT_WRAP_PAYLOAD='{"session_id":"s1","agent_id":"a1","hook_event_name":"SubagentStop"}'

# Clean tree: no stdout, no stderr, exit 0.
SUBAGENT_WRAP_EXIT=0
SUBAGENT_WRAP_OUT=$(
  cd "$SUBAGENT_WRAP_REPO"
  printf '%s' "$SUBAGENT_WRAP_PAYLOAD" | bash "$SUBAGENT_WRAPPER" 2>"$SUBAGENT_WRAP_ERR"
) || SUBAGENT_WRAP_EXIT=$?
[ "$SUBAGENT_WRAP_EXIT" -eq 0 ] \
  || fail "subagent wrapper on clean repo should exit 0 (got $SUBAGENT_WRAP_EXIT)"
[ -z "$SUBAGENT_WRAP_OUT" ] || fail "subagent wrapper on clean repo should produce no stdout"
[ ! -s "$SUBAGENT_WRAP_ERR" ] || fail "subagent wrapper on clean repo should produce no stderr"

# Dirty tree: systemMessage-only JSON with the commit reminder, exit 0.
printf 'subagent-wrapper-dirty\n' >> "$SUBAGENT_WRAP_REPO/file.txt"
SUBAGENT_WRAP_EXIT=0
SUBAGENT_WRAP_OUT=$(
  cd "$SUBAGENT_WRAP_REPO"
  printf '%s' "$SUBAGENT_WRAP_PAYLOAD" | bash "$SUBAGENT_WRAPPER" 2>"$SUBAGENT_WRAP_ERR"
) || SUBAGENT_WRAP_EXIT=$?
[ "$SUBAGENT_WRAP_EXIT" -eq 0 ] \
  || fail "subagent wrapper on dirty repo should exit 0 (got $SUBAGENT_WRAP_EXIT)"
[ ! -s "$SUBAGENT_WRAP_ERR" ] || fail "subagent wrapper on dirty repo should produce no stderr"
assert_system_message_only "$SUBAGENT_WRAP_OUT"
SUBAGENT_WRAP_MSG=$(jq -r '.systemMessage' <<< "$SUBAGENT_WRAP_OUT")
assert_contains "$SUBAGENT_WRAP_MSG" "uncommitted changes on branch 'feature/subagent-wrap'"

# End-to-end keying: the marker lands under the agent scope, not the main key.
SUBAGENT_WRAP_SCOPED_MARKER=$(ai_stop_marker_path "$SUBAGENT_WRAP_REPO" "session:s1:agent:a1")
SUBAGENT_WRAP_MAIN_MARKER=$(ai_stop_marker_path "$SUBAGENT_WRAP_REPO")
[ -f "$SUBAGENT_WRAP_SCOPED_MARKER" ] \
  || fail "subagent wrapper should write a per-agent scoped Stop marker"
[ ! -f "$SUBAGENT_WRAP_MAIN_MARKER" ] \
  || fail "subagent wrapper must not consume the unscoped main-loop Stop marker"

printf 'ai-hooks stop-policy tests passed\n'
