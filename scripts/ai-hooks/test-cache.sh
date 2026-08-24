#!/bin/bash

# Focused ai-hooks shell tests for shared bun/cache hook behavior. Extracted
# from scripts/ai-hooks/test.sh so this behavior family can be run on its own
# (`bash scripts/ai-hooks/test-cache.sh`); the aggregate runner invokes it as
# one step. Shares the generic assertions in test-support.sh.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../tests/lib/test-git-env.sh
. "$SCRIPT_DIR/../tests/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)

# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"
# shellcheck source=claude-adapter.sh
. "$SCRIPT_DIR/claude-adapter.sh"
# shellcheck source=policy.sh
. "$SCRIPT_DIR/policy.sh"

TMP_ROOT=$(mktemp -d /tmp/musi-ai-hooks-cache-test.XXXXXX)
trap 'rm -rf "$TMP_ROOT"' EXIT

AI_STATE_ROOT="$TMP_ROOT/state"
AI_BUN_LOG_DIR="$TMP_ROOT/bun-logs"
AI_PRECOMMIT_LOG_DIR="$TMP_ROOT/pre-commit-logs"

# shellcheck source=cache.sh
. "$SCRIPT_DIR/cache.sh"
# shellcheck source=test-support.sh
. "$SCRIPT_DIR/test-support.sh"

# Keep the ai_cache_sweep_stale that ai_cache_init runs pointed at throwaway
# paths so the test suite never reaps real /tmp state on the host.
AI_RESULT_COMMAND_TMP_PREFIX="$TMP_ROOT/result-cmd"
# Consumed by ai_cache_sweep_stale (sourced from cache.sh); export so ShellCheck
# sees the cross-file use.
export AI_STATE_SWEEP_STOP_GLOB="$TMP_ROOT/sweep-hooks.*/stop"

BUN_HOOK="$REPO_ROOT/.claude/hooks/bun-run-quiet.sh"

assert_cache_bypass_bun() {
  local cmd="$1"

  ai_bun_cmd_bypasses_cache "$cmd" || fail "expected cache-bypass bun command [$cmd]"
}

assert_lock_bypass_bun() {
  local cmd="$1"

  ai_bun_cmd_bypasses_lock "$cmd" || fail "expected lock-bypass bun command [$cmd]"
}

assert_marker_read_fails() {
  local marker="$1"
  local content="$2"

  printf '%s\n' "$content" > "$marker"
  if ai_read_bun_marker "$marker"; then
    fail "corrupt marker unexpectedly parsed: $content"
  fi
}

assert_claude_cache_bypass_rewrites_to_repo_root() {
  local cmd="$1"
  local script_safe="$2"
  local shim_dir="$TMP_ROOT/bun-shim-$script_safe"
  local record="$TMP_ROOT/bun-shim-$script_safe.record"
  local hook_out rewritten expected record_out

  mkdir -p "$shim_dir"
  cat > "$shim_dir/bun" <<'BUN_SHIM'
#!/bin/bash
{
  printf 'PWD=%s\n' "$PWD"
  printf 'ARGS=%s\n' "$*"
} > "$BUN_SHIM_RECORD"
BUN_SHIM
  chmod +x "$shim_dir/bun"

  hook_out=$(
    cd "$REPO_ROOT/packages/server"
    printf '{"tool_input":{"command":"%s","run_in_background":false}}' "$cmd" \
      | PATH="$shim_dir:$PATH" AI_BUN_LOG_DIR="$AI_BUN_LOG_DIR" bash "$BUN_HOOK"
  )
  rewritten=$(printf '%s' "$hook_out" | jq -r '.hookSpecificOutput.updatedInput.command // empty')
  printf -v expected 'cd %q && %s' "$REPO_ROOT" "$cmd"
  [ "$rewritten" = "$expected" ] \
    || fail "Claude bun hook did not rewrite [$cmd] to repo root. Output: $hook_out"

  (
    cd "$REPO_ROOT/packages/server"
    PATH="$shim_dir:$PATH" BUN_SHIM_RECORD="$record" bash -c "$rewritten"
  )
  record_out=$(cat "$record")
  assert_contains "$record_out" "PWD=$REPO_ROOT"
  assert_contains "$record_out" "ARGS=run ${cmd#bun run }"
}

cache_defaults_for_repo() (
  unset AI_STATE_ROOT AI_GIT_STATE_DIR AI_BUN_STATE_DIR AI_STOP_STATE_DIR
  unset AI_THROTTLE_STATE_DIR AI_LINT_COVERAGE_STATE_DIR
  unset AI_BUN_LOG_DIR AI_PRECOMMIT_LOG_DIR
  REPO_ROOT="$1"
  export MUSI_VERIFY_STATE_ROOT="$TMP_ROOT/default-state"
  # shellcheck source=cache.sh
  . "$SCRIPT_DIR/cache.sh"
  printf 'AI_STATE_ROOT=%s\n' "$AI_STATE_ROOT"
  printf 'AI_BUN_LOG_DIR=%s\n' "$AI_BUN_LOG_DIR"
  printf 'AI_PRECOMMIT_LOG_DIR=%s\n' "$AI_PRECOMMIT_LOG_DIR"
)

assert_cache_defaults_are_worktree_scoped() {
  local repo="$TMP_ROOT/cache-default-primary"
  local sibling="$TMP_ROOT/cache-default-sibling"
  local primary_defaults sibling_defaults primary_value sibling_value key

  git init -q -b main "$repo"
  git -C "$repo" config user.email hooks@example.test
  git -C "$repo" config user.name "Hook Test"
  printf 'base\n' > "$repo/file.txt"
  git -C "$repo" add file.txt
  git -C "$repo" commit -qm init
  git -C "$repo" worktree add -q -b cache-default-sibling "$sibling" HEAD

  primary_defaults=$(cache_defaults_for_repo "$repo")
  sibling_defaults=$(cache_defaults_for_repo "$sibling")
  for key in AI_STATE_ROOT AI_BUN_LOG_DIR AI_PRECOMMIT_LOG_DIR; do
    primary_value=$(printf '%s\n' "$primary_defaults" | awk -F= -v key="$key" '$1 == key {print $2}')
    sibling_value=$(printf '%s\n' "$sibling_defaults" | awk -F= -v key="$key" '$1 == key {print $2}')
    [ -n "$primary_value" ] || fail "$key default missing for primary worktree"
    [ -n "$sibling_value" ] || fail "$key default missing for sibling worktree"
    [ "$primary_value" != "$sibling_value" ] \
      || fail "$key default should differ for same-HEAD sibling worktrees: $primary_value"
  done
}

create_bun_cache_fixture_repo() {
  local repo="$1"

  git init -q -b main "$repo"
  git -C "$repo" config user.email hooks@example.test
  git -C "$repo" config user.name "Hook Test"
  printf '{"scripts":{"test":"echo fixture"}}\n' > "$repo/package.json"
  git -C "$repo" add package.json
  git -C "$repo" commit -qm init
}

assert_bun_cache_bypass_preserves_cached_marker() {
  local cmd="$1"
  local script_safe="$2"
  local marker="$AI_BUN_LOG_DIR/last.$script_safe"
  local log="$AI_BUN_LOG_DIR/$script_safe.log"
  local fp marker_before claude_out rewritten expected codex_out codex_post_out attempt

  fp=$(ai_worktree_fingerprint "$REPO_ROOT")
  printf 'stale success marker fixture\n' > "$log"
  ai_write_bun_marker "$marker" "$fp" 0
  marker_before=$(cat "$marker")

  for attempt in 1 2; do
    claude_out=$(
      printf '{"tool_input":{"command":"%s","run_in_background":false}}' "$cmd" \
        | AI_BUN_LOG_DIR="$AI_BUN_LOG_DIR" bash "$BUN_HOOK"
    )
    rewritten=$(printf '%s' "$claude_out" | jq -r '.hookSpecificOutput.updatedInput.command // empty')
    printf -v expected 'cd %q && %s' "$REPO_ROOT" "$cmd"
    [ "$rewritten" = "$expected" ] \
      || fail "Claude bun hook replayed cache or failed repo-root rewrite for cache-bypass command [$cmd] on attempt $attempt: $claude_out"

    codex_out=$(
      printf '{"tool_use_id":"cache-bypass-%s-%s","tool_input":{"command":"%s"}}' "$script_safe" "$attempt" "$cmd" \
        | AI_STATE_ROOT="$AI_STATE_ROOT" AI_BUN_LOG_DIR="$AI_BUN_LOG_DIR" bash "$REPO_ROOT/.codex/hooks/pre-tool-use.sh"
    )
    [ "$codex_out" = '{"continue":true}' ] \
      || fail "Codex pre hook replayed or blocked cached cache-bypass command [$cmd] on attempt $attempt: $codex_out"

    codex_post_out=$(
      printf '{"tool_use_id":"cache-bypass-%s-%s","tool_input":{"command":"%s"},"tool_response":{"exit_code":0,"stdout":"fresh cache-bypass output"}}' "$script_safe" "$attempt" "$cmd" \
        | AI_STATE_ROOT="$AI_STATE_ROOT" AI_BUN_LOG_DIR="$AI_BUN_LOG_DIR" bash "$REPO_ROOT/.codex/hooks/post-tool-use.sh"
    )
    [ "$codex_post_out" = '{"continue":true}' ] \
      || fail "Codex post hook summarized or cached cache-bypass command [$cmd] on attempt $attempt: $codex_post_out"
    [ "$(cat "$marker")" = "$marker_before" ] \
      || fail "Codex post hook rewrote cache marker for cache-bypass command [$cmd]"
    [ "$(cat "$log")" = "stale success marker fixture" ] \
      || fail "Codex post hook rewrote log for cache-bypass command [$cmd]"
  done
}

make_git_fingerprint_optional_locks_guard_shim() {
  local shim_dir="$1"

  mkdir -p "$shim_dir"
  cat > "$shim_dir/git" <<'GIT_FINGERPRINT_LOCKS_SHIM'
#!/bin/bash
set -euo pipefail

guarded=0
case "$*" in
  -C\ *\ rev-parse\ HEAD|-C\ *\ diff\ --no-ext-diff\ --binary\ HEAD|-C\ *\ ls-files\ --others\ --exclude-standard\ -z)
    guarded=1
    ;;
esac

if [ "$guarded" -eq 1 ]; then
  state=OK
  if [ "${GIT_OPTIONAL_LOCKS-}" != "0" ]; then
    state=MISSING
  fi
  printf '%s\t%s\n' "$state" "$*" >> "$AI_TEST_GIT_OPTIONAL_LOCKS_LOG"
  [ "$state" = "OK" ] || exit 42
fi

exec "$AI_TEST_REAL_GIT" "$@"
GIT_FINGERPRINT_LOCKS_SHIM
  chmod +x "$shim_dir/git"
}

assert_bun_fingerprint_entrypoints_use_optional_locks() {
  local shim_dir="$TMP_ROOT/fingerprint-entrypoints-shim"
  local log="$TMP_ROOT/fingerprint-entrypoints-git.log"
  local entry_state="$TMP_ROOT/fingerprint-entrypoints-state"
  local entry_logs="$TMP_ROOT/fingerprint-entrypoints-logs"
  local real_git codex_out claude_out guard_log diff_hits ls_files_hits

  real_git=$(command -v git)
  make_git_fingerprint_optional_locks_guard_shim "$shim_dir"
  cat > "$shim_dir/bun" <<'BUN_SHIM'
#!/bin/bash
exit 0
BUN_SHIM
  chmod +x "$shim_dir/bun"
  : > "$log"

  codex_out=$(
    unset GIT_OPTIONAL_LOCKS
    export PATH="$shim_dir:$PATH"
    export AI_TEST_REAL_GIT="$real_git"
    export AI_TEST_GIT_OPTIONAL_LOCKS_LOG="$log"
    printf '%s' '{"tool_use_id":"fingerprint-entrypoint-codex","tool_input":{"command":"bun run lint"}}' \
      | AI_STATE_ROOT="$entry_state/codex" AI_BUN_LOG_DIR="$entry_logs/codex" bash "$REPO_ROOT/scripts/ai-hooks/bash-pre-tool-use.sh"
  )
  assert_hook_continue_json "$codex_out"

  claude_out=$(
    unset GIT_OPTIONAL_LOCKS
    export PATH="$shim_dir:$PATH"
    export AI_TEST_REAL_GIT="$real_git"
    export AI_TEST_GIT_OPTIONAL_LOCKS_LOG="$log"
    printf '%s' '{"tool_input":{"command":"bun run lint","run_in_background":false}}' \
      | AI_STATE_ROOT="$entry_state/claude" \
        AI_BUN_LOG_DIR="$entry_logs/claude" \
        AI_BUN_LOCK="$entry_state/claude/bun.lock" \
        AI_BUN_ACTIVE_PROCESS_STATE="$entry_state/claude/active-process" \
        bash "$REPO_ROOT/scripts/ai-hooks/bun-run-quiet.sh"
  )
  assert_hook_json "$claude_out"

  guard_log=$(cat "$log")
  assert_not_contains "$guard_log" "MISSING"
  diff_hits=$(grep -cF $'OK\t-C '"$REPO_ROOT"$' diff --no-ext-diff --binary HEAD' "$log" || true)
  [ "$diff_hits" -ge 2 ] \
    || fail "expected both bun fingerprint entry points to guard git diff --no-ext-diff --binary HEAD: $guard_log"
  ls_files_hits=$(grep -cF $'OK\t-C '"$REPO_ROOT"$' ls-files --others --exclude-standard -z' "$log" || true)
  [ "$ls_files_hits" -ge 2 ] \
    || fail "expected both bun fingerprint entry points to guard git ls-files: $guard_log"
}

# The worktree fingerprint must track tracked-binary content: without
# `git diff --no-ext-diff --binary HEAD` every binary change collapses to the constant
# "Binary files ... differ" line and two different contents fingerprint alike.
assert_worktree_fingerprint_tracks_binary_content() {
  local repo="$TMP_ROOT/binary-fp-repo"
  local fp_v2 fp_v3

  git init -q -b main "$repo"
  git -C "$repo" config user.email hooks@example.test
  git -C "$repo" config user.name "Hook Test"
  printf 'v1\0binary\n' > "$repo/asset.bin"
  git -C "$repo" add asset.bin
  git -C "$repo" commit -qm init

  printf 'v2\0binary\n' > "$repo/asset.bin"
  fp_v2=$(ai_worktree_fingerprint "$repo")
  printf 'v3\0binary\n' > "$repo/asset.bin"
  fp_v3=$(ai_worktree_fingerprint "$repo")
  [ "$fp_v2" != "$fp_v3" ] \
    || fail "worktree fingerprint is blind to tracked binary content changes: $fp_v2"
}

# A future-dated marker (clock skew) must never be served as fresh: the age
# floor mirrors musi_success_marker_matches, and all three marker readers
# (bash-pre-tool-use, bun-run-quiet, stop-policy) share the helper.
assert_marker_age_floor() {
  local reader

  ai_marker_age_within_ttl 0 3600 || fail "age 0 should be within TTL"
  ai_marker_age_within_ttl 3599 3600 || fail "age just under TTL should be fresh"
  if ai_marker_age_within_ttl 3600 3600; then
    fail "age at TTL should be stale"
  fi
  if ai_marker_age_within_ttl -1 3600; then
    fail "negative (future-dated) age should be stale"
  fi

  for reader in bash-pre-tool-use.sh bun-run-quiet.sh stop-policy.sh; do
    grep -q 'ai_marker_age_within_ttl' "$REPO_ROOT/scripts/ai-hooks/$reader" \
      || fail "marker reader $reader does not use the shared age floor"
  done
}

# End-to-end through the Claude bun hook: prime a cached OK, then future-date
# the marker's timestamp; the re-run must execute fresh, not replay the cache.
assert_bun_future_dated_marker_not_replayed() {
  local shim_dir="$TMP_ROOT/bun-future-shim"
  local fixture_repo="$TMP_ROOT/bun-future-fixture-repo"
  local run_log="$TMP_ROOT/bun-future-runs.log"
  local cmd="bun run test -- packages/future.test.ts"
  local marker out replay runs future_ts

  create_bun_cache_fixture_repo "$fixture_repo"
  mkdir -p "$shim_dir"
  cat > "$shim_dir/bun" <<BUN_SHIM
#!/bin/bash
printf '%s\n' "\$*" >> "$run_log"
exit 0
BUN_SHIM
  chmod +x "$shim_dir/bun"
  : > "$run_log"

  out=$(
    printf '{"tool_input":{"command":"%s","run_in_background":false}}' "$cmd" \
      | PATH="$shim_dir:$PATH" AI_BUN_REPO_ROOT="$fixture_repo" AI_BUN_LOG_DIR="$AI_BUN_LOG_DIR" bash "$BUN_HOOK"
  )
  runs=$(wc -l < "$run_log")
  [ "$runs" -eq 1 ] || fail "future-marker priming run should execute once, recorded $runs: $out"

  marker="$AI_BUN_LOG_DIR/$(ai_bun_marker_name "$cmd")"
  ai_read_bun_marker "$marker" || fail "priming run left no readable marker: $marker"
  future_ts=$(($(date +%s) + 3600))
  printf 'LAST_TS=%s\nLAST_FP=%s\nLAST_EXIT=%s\n' \
    "$future_ts" "$AI_MARKER_LAST_FP" "$AI_MARKER_LAST_EXIT" > "$marker"

  out=$(
    printf '{"tool_input":{"command":"%s","run_in_background":false}}' "$cmd" \
      | PATH="$shim_dir:$PATH" AI_BUN_REPO_ROOT="$fixture_repo" AI_BUN_LOG_DIR="$AI_BUN_LOG_DIR" bash "$BUN_HOOK"
  )
  replay=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.updatedInput.command // empty')
  if [ -n "$replay" ] && grep -qF "cached OK" <<< "$(bash -c "$replay")"; then
    fail "future-dated marker was replayed as fresh: $out"
  fi
  runs=$(wc -l < "$run_log")
  [ "$runs" -eq 2 ] || fail "future-dated marker should force a fresh run, recorded $runs: $out"

  rm -f "$AI_BUN_LOG_DIR"/last.test.* "$AI_BUN_LOG_DIR/test.log"
}

# H1 end-to-end: a narrow `bun run test -- fileA` cached OK on an unchanged
# worktree must NOT cause a broader `bun run test -- fileA fileB` to replay the
# narrow run's "cached OK". The broader command has to actually run. Drives the
# real Claude bun-run-quiet.sh hook with a recording `bun` shim so we can prove
# the wider command executed rather than short-circuiting on the marker.
assert_bun_widened_command_busts_cache() {
  local shim_dir="$TMP_ROOT/bun-widen-shim"
  local fixture_repo="$TMP_ROOT/bun-widen-fixture-repo"
  local run_log="$TMP_ROOT/bun-widen-runs.log"
  local narrow="bun run test -- packages/a.test.ts"
  local wide="bun run test -- packages/a.test.ts packages/b.test.ts"
  local out runs

  create_bun_cache_fixture_repo "$fixture_repo"
  mkdir -p "$shim_dir"
  # Record each real `bun run ...` invocation, then succeed silently so the hook
  # writes a success marker and replays "cached OK" on a true cache hit.
  cat > "$shim_dir/bun" <<BUN_SHIM
#!/bin/bash
printf '%s\n' "\$*" >> "$run_log"
exit 0
BUN_SHIM
  chmod +x "$shim_dir/bun"
  : > "$run_log"

  # 1) Narrow run: executes (1 recorded invocation).
  out=$(
    printf '{"tool_input":{"command":"%s","run_in_background":false}}' "$narrow" \
      | PATH="$shim_dir:$PATH" AI_BUN_REPO_ROOT="$fixture_repo" AI_BUN_LOG_DIR="$AI_BUN_LOG_DIR" bash "$BUN_HOOK"
  )
  runs=$(wc -l < "$run_log")
  [ "$runs" -eq 1 ] || fail "narrow command should run once, recorded $runs: $out"

  # 2) Re-run the SAME narrow command: true cache hit, replays cached OK, no new
  #    invocation (same argv + unchanged worktree). On a hit the hook returns an
  #    updatedInput command that `cat`s the cached message; run it to read it.
  out=$(
    printf '{"tool_input":{"command":"%s","run_in_background":false}}' "$narrow" \
      | PATH="$shim_dir:$PATH" AI_BUN_REPO_ROOT="$fixture_repo" AI_BUN_LOG_DIR="$AI_BUN_LOG_DIR" bash "$BUN_HOOK"
  )
  local replay
  replay=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.updatedInput.command // empty')
  [ -n "$replay" ] || fail "identical narrow re-run did not return a cached replay command: $out"
  assert_contains "$(bash -c "$replay")" "cached OK"
  runs=$(wc -l < "$run_log")
  [ "$runs" -eq 1 ] || fail "identical narrow re-run should hit cache, recorded $runs runs: $out"

  # 3) Widened command on the SAME unchanged worktree: must NOT replay the narrow
  #    cache — it has to run (2nd recorded invocation), covering the broader set.
  out=$(
    printf '{"tool_input":{"command":"%s","run_in_background":false}}' "$wide" \
      | PATH="$shim_dir:$PATH" AI_BUN_REPO_ROOT="$fixture_repo" AI_BUN_LOG_DIR="$AI_BUN_LOG_DIR" bash "$BUN_HOOK"
  )
  replay=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.updatedInput.command // empty')
  if [ -n "$replay" ] && grep -qF "cached OK" <<< "$(bash -c "$replay")"; then
    fail "widened command wrongly replayed the narrow run's cached OK: $out"
  fi
  runs=$(wc -l < "$run_log")
  [ "$runs" -eq 2 ] || fail "widened command should execute fresh, recorded $runs runs: $out"

  rm -f "$AI_BUN_LOG_DIR"/last.test.* "$AI_BUN_LOG_DIR/test.log"
}

assert_codex_bun_post_success_is_non_blocking() {
  local tool_id="codex-success-test-shared"
  local cmd="bun run test:shared -- packages/shared/src/test-tier-sentinel.test.ts"
  local script="test:shared"
  local script_safe="test_shared"
  local log="$AI_BUN_LOG_DIR/$script_safe.log"
  # Marker is argv-scoped (H1/H2): derive it the same way the hook does.
  local marker
  marker="$AI_BUN_LOG_DIR/$(ai_bun_marker_name "$cmd")"
  local state_file="$AI_BUN_STATE_DIR/$tool_id"
  local fp payload codex_out context

  fp=$(ai_worktree_fingerprint "$REPO_ROOT")
  rm -f "$log" "$marker" "$state_file"
  {
    printf 'SCRIPT=%s\n' "$script"
    printf 'LOG=%s\n' "$log"
    printf 'CUR_FP=%s\n' "$fp"
    printf 'START_TS=%s\n' "$(date +%s)"
  } > "$state_file"

  payload=$(
    jq -n --arg id "$tool_id" --arg cmd "$cmd" --arg raw "Vitest OK: 1 test passed in 1 file." \
      '{tool_use_id:$id, tool_input:{command:$cmd}, tool_response:{raw:$raw}}'
  )
  codex_out=$(printf '%s' "$payload" \
    | AI_STATE_ROOT="$AI_STATE_ROOT" AI_BUN_LOG_DIR="$AI_BUN_LOG_DIR" bash "$REPO_ROOT/.codex/hooks/post-tool-use.sh")
  context=$(printf '%s' "$codex_out" | jq -r '.hookSpecificOutput.additionalContext // empty')

  [ -n "$context" ] || fail "Codex post hook did not emit additionalContext on success: $codex_out"
  assert_contains "$context" "test:shared OK"
  if printf '%s' "$codex_out" | jq -e '.decision == "block"' >/dev/null; then
    fail "Codex post hook used decision:block for success: $codex_out"
  fi
  [ "$(cat "$log")" = "Vitest OK: 1 test passed in 1 file." ] \
    || fail "Codex post hook success log was not plain raw output: $(cat "$log")"
  ai_read_bun_marker "$marker" || fail "Codex post hook did not write success marker"
  [ "$AI_MARKER_LAST_EXIT" = "0" ] || fail "success marker should record exit 0"
}

assert_codex_bun_post_failure_keeps_bounded_block() {
  local tool_id="codex-failure-test-shared"
  local cmd="bun run test:shared -- --definitely-not-a-vitest-flag"
  local script="test:shared"
  local script_safe="test_shared"
  local log="$AI_BUN_LOG_DIR/$script_safe.log"
  # Marker is argv-scoped (H1/H2): derive it the same way the hook does.
  local marker
  marker="$AI_BUN_LOG_DIR/$(ai_bun_marker_name "$cmd")"
  local state_file="$AI_BUN_STATE_DIR/$tool_id"
  local fp raw payload codex_out reason

  fp=$(ai_worktree_fingerprint "$REPO_ROOT")
  rm -f "$log" "$marker" "$state_file"
  {
    printf 'SCRIPT=%s\n' "$script"
    printf 'LOG=%s\n' "$log"
    printf 'CUR_FP=%s\n' "$fp"
    printf 'START_TS=%s\n' "$(date +%s)"
  } > "$state_file"

  raw=$'CACError: Unknown option `--definitelyNotA-vitestFlag`\nerror: script "test:shared" exited with code 1'
  payload=$(jq -n --arg id "$tool_id" --arg cmd "$cmd" --arg raw "$raw" \
    '{tool_use_id:$id, tool_input:{command:$cmd}, tool_response:{raw:$raw}}')
  codex_out=$(printf '%s' "$payload" \
    | AI_STATE_ROOT="$AI_STATE_ROOT" AI_BUN_LOG_DIR="$AI_BUN_LOG_DIR" bash "$REPO_ROOT/.codex/hooks/post-tool-use.sh")
  reason=$(printf '%s' "$codex_out" | jq -r '.reason // empty')

  [ "$(printf '%s' "$codex_out" | jq -r '.decision // empty')" = "block" ] \
    || fail "Codex post hook should block failure output with a bounded summary: $codex_out"
  assert_contains "$reason" "test:shared failed (exit 1"
  assert_contains "$reason" "CACError: Unknown option"
  if grep -qF '{"raw"' <<< "$reason"; then
    fail "Codex failure summary should not stringify raw response JSON: $reason"
  fi
  assert_contains "$(cat "$log")" "CACError: Unknown option"
  if grep -qF '{"raw"' "$log"; then
    fail "Codex failure log should not stringify raw response JSON: $(cat "$log")"
  fi
  ai_read_bun_marker "$marker" || fail "Codex post hook did not write failure marker"
  [ "$AI_MARKER_LAST_EXIT" = "1" ] || fail "failure marker should record exit 1"
}

assert_cache_bypass_bun "bun run verify:logs budget"
assert_cache_bypass_bun "bun run code:intel -- exports packages/shared/src/constants.ts"
assert_cache_bypass_bun "bun run verify:async:status"
assert_cache_bypass_bun "bun run verify:async:tail"
assert_cache_bypass_bun "bun run verify:async:stop"

assert_lock_bypass_bun "bun run verify:logs budget"
assert_lock_bypass_bun "bun run code:intel -- exports packages/shared/src/constants.ts"
assert_lock_bypass_bun "bun run verify:async:status"
assert_lock_bypass_bun "bun run verify:async:tail"
assert_lock_bypass_bun "bun run verify:async:stop"

ai_cache_init
[ -d "$AI_GIT_STATE_DIR" ] || fail "missing git state dir"
[ -d "$AI_BUN_STATE_DIR" ] || fail "missing bun state dir"
[ -d "$AI_STOP_STATE_DIR" ] || fail "missing stop state dir"
[ -d "$AI_BUN_LOG_DIR" ] || fail "missing bun log dir"
[ -d "$AI_PRECOMMIT_LOG_DIR" ] || fail "missing pre-commit log dir"

assert_cache_defaults_are_worktree_scoped
assert_claude_cache_bypass_rewrites_to_repo_root "bun run verify:logs budget" "verify_logs"
assert_claude_cache_bypass_rewrites_to_repo_root "bun run verify:async:status" "verify_async_status"
assert_claude_cache_bypass_rewrites_to_repo_root "bun run code:intel -- exports packages/shared/src/constants.ts" "code_intel"
assert_bun_cache_bypass_preserves_cached_marker "bun run verify:async:status" "verify_async_status"
assert_bun_cache_bypass_preserves_cached_marker "bun run verify:async:stop" "verify_async_stop"
assert_bun_cache_bypass_preserves_cached_marker "bun run code:intel -- exports packages/shared/src/constants.ts" "code_intel"
assert_bun_fingerprint_entrypoints_use_optional_locks
assert_codex_bun_post_success_is_non_blocking
assert_codex_bun_post_failure_keeps_bounded_block
assert_bun_widened_command_busts_cache
assert_worktree_fingerprint_tracks_binary_content
assert_marker_age_floor
assert_bun_future_dated_marker_not_replayed

MARKER="$AI_BUN_LOG_DIR/last.test_changed"
VALID_FP="$(printf 'a%.0s' {1..64})"
NEXT_FP="$(printf 'b%.0s' {1..64})"
ai_write_bun_marker "$MARKER" "$VALID_FP" 7
ai_read_bun_marker "$MARKER" || fail "failed to read marker"
[ "$AI_MARKER_LAST_FP" = "$VALID_FP" ] || fail "marker fingerprint mismatch"
[ "$AI_MARKER_LAST_EXIT" = "7" ] || fail "marker exit mismatch"
[ "$AI_MARKER_LAST_TS" -gt 0 ] || fail "marker timestamp missing"
if find "$AI_BUN_LOG_DIR" -maxdepth 1 -name '.last.test_changed.tmp.*' | grep -q .; then
  fail "marker write left temp files behind"
fi

SAVED_MARKER=$(cat "$MARKER")
(
  mv() { return 1; }
  if ai_write_bun_marker "$MARKER" "$NEXT_FP" 0; then
    fail "marker write unexpectedly succeeded when mv failed"
  fi
)
[ "$(cat "$MARKER")" = "$SAVED_MARKER" ] || fail "failed atomic marker write changed existing marker"
if find "$AI_BUN_LOG_DIR" -maxdepth 1 -name '.last.test_changed.tmp.*' | grep -q .; then
  fail "failed atomic marker write left temp files behind"
fi

NOW=$(date +%s)
assert_marker_read_fails "$MARKER" "LAST_TS=$NOW
LAST_FP=$VALID_FP"
assert_marker_read_fails "$MARKER" "LAST_FP=$VALID_FP
LAST_EXIT=0"
assert_marker_read_fails "$MARKER" "LAST_TS=$NOW
LAST_EXIT=0"
assert_marker_read_fails "$MARKER" "LAST_TS=not-a-time
LAST_FP=$VALID_FP
LAST_EXIT=0"
assert_marker_read_fails "$MARKER" "LAST_TS=-1
LAST_FP=$VALID_FP
LAST_EXIT=0"
assert_marker_read_fails "$MARKER" "LAST_TS=$NOW
LAST_FP=fingerprint-1
LAST_EXIT=0"
assert_marker_read_fails "$MARKER" "LAST_TS=$NOW
LAST_FP=$VALID_FP
LAST_EXIT=128"
ai_write_bun_marker "$MARKER" "$VALID_FP" 7
ai_read_bun_marker "$MARKER" || fail "failed to read marker after corrupt-marker tests"

FP=$(ai_worktree_fingerprint "$REPO_ROOT")
[[ "$FP" =~ ^[0-9a-f]{64}$ ]] || fail "fingerprint format mismatch"

# --- argv-scoped marker keys (H1/H2) -----------------------------------------
# The cache marker must key on the EXACT argv tail, not just the script name, so
# a broader or corrected command on an unchanged worktree can never replay a
# narrower/older run's cached pass or block. Only post-`--` file operands are
# order-insensitive (reordering the file list is the same run); options and
# option order are load-bearing.
assert_argv_fp_equal() {
  local label="$1" a="$2" b="$3" fa fb
  fa=$(ai_bun_argv_fingerprint "$a")
  fb=$(ai_bun_argv_fingerprint "$b")
  [ -n "$fa" ] || fail "argv fingerprint empty for [$a]"
  [ "$fa" = "$fb" ] || fail "$label: expected same argv fingerprint for [$a] and [$b] ($fa != $fb)"
}

assert_argv_fp_distinct() {
  local label="$1" a="$2" b="$3" fa fb
  fa=$(ai_bun_argv_fingerprint "$a")
  fb=$(ai_bun_argv_fingerprint "$b")
  [ "$fa" != "$fb" ] || fail "$label: expected distinct argv fingerprints for [$a] and [$b] (both $fa)"
}

# Fingerprint shape: a short hex token suitable for a marker filename suffix.
ARGV_FP_BARE=$(ai_bun_argv_fingerprint "bun run test")
[[ "$ARGV_FP_BARE" =~ ^[0-9a-f]+$ ]] || fail "argv fingerprint not hex for bare command: [$ARGV_FP_BARE]"

# (a) Widening scope busts the cache: a superset of files is a DIFFERENT key.
assert_argv_fp_distinct "widen file set" \
  "bun run test -- packages/a.test.ts" \
  "bun run test -- packages/a.test.ts packages/b.test.ts"
assert_argv_fp_distinct "narrow vs bare" \
  "bun run test" \
  "bun run test -- packages/a.test.ts"

# (b) Reordering ONLY the post-`--` file operands is a cache HIT (same key).
assert_argv_fp_equal "reorder post-dashdash files" \
  "bun run test -- packages/a.test.ts packages/b.test.ts" \
  "bun run test -- packages/b.test.ts packages/a.test.ts"
assert_argv_fp_equal "whitespace normalization" \
  "bun run test -- packages/a.test.ts packages/b.test.ts" \
  "bun run test --   packages/b.test.ts    packages/a.test.ts"

# (c) Different options / option ORDER are DISTINCT keys (no aliasing).
assert_argv_fp_distinct "different option" \
  "bun run test:changed --reporter=dot" \
  "bun run test:changed --reporter=verbose"
assert_argv_fp_distinct "option order is load-bearing" \
  "bun run test --reporter=dot --bail" \
  "bun run test --bail --reporter=dot"
# Options before `--` are NOT sorted: only the file operands after `--` are.
assert_argv_fp_distinct "pre-dashdash order load-bearing even with same files" \
  "bun run test --bail --reporter=dot -- a.test.ts b.test.ts" \
  "bun run test --reporter=dot --bail -- a.test.ts b.test.ts"
assert_argv_fp_equal "pre-dashdash fixed, post-dashdash reordered" \
  "bun run test --reporter=dot -- a.test.ts b.test.ts" \
  "bun run test --reporter=dot -- b.test.ts a.test.ts"

# Marker-name helper bakes the argv fingerprint into the filename so the three
# call sites (Claude bun-run-quiet, Codex pre/post) stay in lockstep and never
# collide across argv.
NARROW_MARKER=$(ai_bun_marker_name "bun run test -- a.test.ts")
WIDE_MARKER=$(ai_bun_marker_name "bun run test -- a.test.ts b.test.ts")
BARE_MARKER=$(ai_bun_marker_name "bun run test")
case "$NARROW_MARKER" in
  last.test.*) ;;
  *) fail "marker name should be last.<script_safe>.<argv_fp>: [$NARROW_MARKER]" ;;
esac
[ "$NARROW_MARKER" != "$WIDE_MARKER" ] \
  || fail "narrow and wide commands must not share a marker name: [$NARROW_MARKER]"
[ "$NARROW_MARKER" != "$BARE_MARKER" ] \
  || fail "narrow and bare commands must not share a marker name: [$NARROW_MARKER]"
# Colon-bearing script names stay filesystem-safe in the marker name.
COLON_MARKER=$(ai_bun_marker_name "bun run test:changed")
case "$COLON_MARKER" in
  last.test_changed.*) ;;
  *) fail "colon script names must be sanitized in marker name: [$COLON_MARKER]" ;;
esac

FINISHED_SUMMARY=$(ai_bun_failure_summary "test:changed" "$AI_BUN_LOG_DIR/test_changed.log" "" "3" "passed")
if grep -qF "$AI_FLAKY_NOTE" <<< "$FINISHED_SUMMARY"; then
  fail "finished summary should not include flaky failure note"
fi

FAILED_SUMMARY=$(ai_bun_failure_summary "test:changed" "$AI_BUN_LOG_DIR/test_changed.log" "1" "3" "failed")
grep -qF "$AI_FLAKY_NOTE" <<< "$FAILED_SUMMARY" || fail "test failure summary missing flaky note"

# --- wrapped `bun run` exit code inferred from output text -------------------
# The post-tool-use aggregate reaches for these when the vendor payload carries
# no usable exit code, and they answer two different questions: the inference
# reads a code out of the text, while the footer probe decides whether "no code
# found" means the run succeeded or the outcome is unknown. Both do already run
# end-to-end, through the Codex post hook cases above, whose raw responses carry
# no exit code at all: assert_codex_bun_post_failure_keeps_bounded_block reaches
# the inference, and assert_codex_bun_post_success_is_non_blocking falls past it
# into the probe. Each pins one shape and discriminates against nothing, and the
# Copilot wiring case that looks like a third (test-copilot-wiring.sh:246-249)
# reaches neither reader: its trailing `<shellId: N completed with exit code M>`
# marker becomes tool_response.exit_code, so the caller's guard never falls
# through. Pin both directly, each as a positive plus the negatives it
# discriminates against: the positives are what make the negatives mean
# anything, since a reader that returned nothing at all would satisfy every
# negative here on its own.
BUN_FOOTER_OUTPUT=$(printf '%s\n' \
  'some lint failure output' \
  'error: script "lint:changed" exited with code 3')
[ "$(ai_bun_exit_code_from_output "lint:changed" "$BUN_FOOTER_OUTPUT")" = "3" ] \
  || fail "bun exit inference should read the code out of its own script's footer"
[ -z "$(ai_bun_exit_code_from_output "other:script" "$BUN_FOOTER_OUTPUT")" ] \
  || fail "bun exit inference must not read another script's footer"

# bun's footer only counts at the start of a line: an indented or quoted mention
# is the script's own output, not bun reporting the script's exit.
BUN_INDENTED_FOOTER='  error: script "lint:changed" exited with code 3'
[ -z "$(ai_bun_exit_code_from_output "lint:changed" "$BUN_INDENTED_FOOTER")" ] \
  || fail "an indented footer mention is output text, not bun's own report"

# The wrapper spelling matches anywhere in the line, and the LAST reading in the
# output wins so a re-run's tail is what gets recorded.
BUN_PROCESS_EXIT=$(printf '%s\n' \
  'Process exited with code 1' \
  'Process exited with code 2')
[ "$(ai_bun_exit_code_from_output "lint:changed" "$BUN_PROCESS_EXIT")" = "2" ] \
  || fail "the last exit-code reading in the output must win"

ai_bun_output_has_error_footer "lint:changed" 'error: script "lint:changed" interrupted' \
  || fail "footer probe should match its own script's footer even without a code"
! ai_bun_output_has_error_footer "lint:changed" 'error: script "test:shared" exited with code 1' \
  || fail "footer probe must not match another script's error footer"
! ai_bun_output_has_error_footer "lint:changed" 'all files pass linting' \
  || fail "clean output must not read as a bun error footer"

# --- ai_claude_result_command: shell-safe temp-path quoting ------------------
# The rewritten `cat …; rm -f …` command is re-evaluated by the shell when the
# tool runs, so the temp path must be quoted with real shell escaping (printf
# %q) — not merely wrapped in double quotes, which still expands $(), backticks
# and lets an embedded double quote break out. Exercise a whitespace prefix and
# a metacharacter prefix that would inject if only double-quoted.
RC_PREFIX="$TMP_ROOT/result cmd with spaces"
RC_JSON=$(ai_claude_result_command "commit summary line" "$RC_PREFIX")
RC_CMD=$(printf '%s' "$RC_JSON" | jq -r '.hookSpecificOutput.updatedInput.command // empty')
[ -n "$RC_CMD" ] || fail "result command emitted no rewritten command: $RC_JSON"
RC_FILE=""
for f in "$RC_PREFIX".*; do
  [ -f "$f" ] || continue
  RC_FILE="$f"
  break
done
[ -n "$RC_FILE" ] || fail "result command temp file missing for: $RC_PREFIX"
RC_OUT=$(bash -c "$RC_CMD")
assert_contains "$RC_OUT" "commit summary line"
[ ! -f "$RC_FILE" ] || fail "result command self-clean left temp file: $RC_FILE"

# Metacharacters in the prefix must be escaped, not merely double-quoted: a
# double-quoted path still executes $(…)/`…` and an embedded " breaks out. The
# injected touch targets are slash-free names so the replay (run from TMP_ROOT)
# would drop proof files there if the metacharacters were not escaped.
RC_PREFIX_INJ="$TMP_ROOT/rc-\$(touch injproofsub)-\`touch injproofbt\`-\"q"
RC_JSON_INJ=$(ai_claude_result_command "injection payload body" "$RC_PREFIX_INJ")
RC_CMD_INJ=$(printf '%s' "$RC_JSON_INJ" | jq -r '.hookSpecificOutput.updatedInput.command // empty')
[ -n "$RC_CMD_INJ" ] || fail "result command emitted no rewritten command for metachar prefix"
RC_OUT_INJ=$(cd "$TMP_ROOT" && bash -c "$RC_CMD_INJ")
assert_contains "$RC_OUT_INJ" "injection payload body"
[ ! -e "$TMP_ROOT/injproofsub" ] || fail "\$() in temp path executed on replay"
[ ! -e "$TMP_ROOT/injproofbt" ] || fail "backtick in temp path executed on replay"
RC_INJ_LEFTOVERS=("$TMP_ROOT"/rc-*)
[ ! -e "${RC_INJ_LEFTOVERS[0]}" ] || fail "metachar result temp not self-cleaned"

# Omitting the prefix arg falls back to the shared constant. The default prefix
# is metachar-free, so %q leaves it bare and the command starts with it verbatim.
RC_JSON2=$(ai_claude_result_command "default prefix summary")
RC_CMD2=$(printf '%s' "$RC_JSON2" | jq -r '.hookSpecificOutput.updatedInput.command // empty')
case "$RC_CMD2" in
  "cat $AI_RESULT_COMMAND_TMP_PREFIX."*) ;;
  *) fail "result command ignored default prefix: [$RC_CMD2]" ;;
esac
RC_OUT2=$(bash -c "$RC_CMD2")
assert_contains "$RC_OUT2" "default prefix summary"

# --- ai_cache_sweep_stale: reap abandoned result temps + stale stop markers --
SWEEP_STATE="$TMP_ROOT/sweep-state"
mkdir -p "$SWEEP_STATE"
# Cover every ai_claude_result_command prefix family, not just the commit one:
# bun-run-quiet and no-direct-db create their own /tmp/musi-{bun-result,policy-
# guidance}.* temps, and they leak the same way when the rewritten command is
# denied or never runs.
SWEEP_RESULT_PREFIX="$TMP_ROOT/sweep-result"
SWEEP_BUN_PREFIX="$TMP_ROOT/sweep-bun-result"
SWEEP_POLICY_PREFIX="$TMP_ROOT/sweep-policy-guidance"
SWEEP_STOP_DIR="$TMP_ROOT/sweep-hooks.deadkey/stop"
mkdir -p "$SWEEP_STOP_DIR"

sweep_run() {
  AI_STATE_ROOT="$SWEEP_STATE" \
    AI_RESULT_COMMAND_TMP_PREFIXES="$SWEEP_RESULT_PREFIX $SWEEP_BUN_PREFIX $SWEEP_POLICY_PREFIX" \
    AI_STATE_SWEEP_STOP_GLOB="$TMP_ROOT/sweep-hooks.*/stop" \
    AI_STATE_SWEEP_TTL_DAYS=7 \
    AI_STATE_SWEEP_INTERVAL="${1:-0}" \
    ai_cache_sweep_stale
}

# Old (10-day) files get reaped; fresh files survive.
OLD_RESULT="$SWEEP_RESULT_PREFIX.oldaaaa"
: > "$OLD_RESULT"; touch -d '10 days ago' "$OLD_RESULT"
OLD_BUN="$SWEEP_BUN_PREFIX.oldbunx"
: > "$OLD_BUN"; touch -d '10 days ago' "$OLD_BUN"
OLD_POLICY="$SWEEP_POLICY_PREFIX.oldpolx"
: > "$OLD_POLICY"; touch -d '10 days ago' "$OLD_POLICY"
OLD_STOP="$SWEEP_STOP_DIR/last.deadbeef"
: > "$OLD_STOP"; touch -d '10 days ago' "$OLD_STOP"
NEW_RESULT="$SWEEP_RESULT_PREFIX.freshbbbb"
: > "$NEW_RESULT"
NEW_STOP="$SWEEP_STOP_DIR/last.freshkey"
: > "$NEW_STOP"

rm -f "$SWEEP_STATE/.last-sweep"
sweep_run 0

[ ! -f "$OLD_RESULT" ] || fail "sweep did not reap abandoned result temp: $OLD_RESULT"
[ ! -f "$OLD_BUN" ] || fail "sweep did not reap abandoned bun-result temp: $OLD_BUN"
[ ! -f "$OLD_POLICY" ] || fail "sweep did not reap abandoned policy-guidance temp: $OLD_POLICY"
[ ! -f "$OLD_STOP" ] || fail "sweep did not reap stale stop marker: $OLD_STOP"
[ -f "$NEW_RESULT" ] || fail "sweep wrongly reaped fresh result temp: $NEW_RESULT"
[ -f "$NEW_STOP" ] || fail "sweep wrongly reaped fresh stop marker: $NEW_STOP"

# Throttle: a recent stamp suppresses the next sweep, then a reset re-enables it.
OLD_RESULT2="$SWEEP_RESULT_PREFIX.oldcccc"
: > "$OLD_RESULT2"; touch -d '10 days ago' "$OLD_RESULT2"
sweep_run 3600
[ -f "$OLD_RESULT2" ] || fail "sweep throttle failed: reaped despite recent stamp"
rm -f "$SWEEP_STATE/.last-sweep"
sweep_run 0
[ ! -f "$OLD_RESULT2" ] || fail "sweep did not reap after throttle reset: $OLD_RESULT2"

# Regression: cache.sh must be self-sufficient under `set -u` when no hook
# adapter has pre-sourced common.sh. scripts/verify.sh and scripts/verify-async.sh
# source cache.sh this way; before cache.sh sourced common.sh itself, this
# aborted with "AI_STATE_ROOT_PREFIX: unbound variable" (exit 127). Runs in a
# fresh bash with a clean environment so the in-process common.sh sourcing above
# cannot mask the failure.
if ! env -u AI_STATE_ROOT -u AI_STATE_ROOT_PREFIX -u AI_REPO_ROOT_FALLBACK \
  bash -c '
    set -u
    cd "$1" || exit 3
    . scripts/ai-hooks/cache.sh
  ' _ "$REPO_ROOT" >/dev/null 2>&1; then
  fail "cache.sh must source common.sh so it self-sufficiently sources under set -u"
fi

printf 'ai-hooks cache tests passed\n'
