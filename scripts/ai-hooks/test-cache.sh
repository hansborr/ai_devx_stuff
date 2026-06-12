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

assert_codex_bun_post_success_is_non_blocking() {
  local tool_id="codex-success-test-shared"
  local cmd="bun run test:shared -- packages/shared/src/test-tier-sentinel.test.ts"
  local script="test:shared"
  local script_safe="test_shared"
  local log="$AI_BUN_LOG_DIR/$script_safe.log"
  local marker="$AI_BUN_LOG_DIR/last.$script_safe"
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
  local marker="$AI_BUN_LOG_DIR/last.$script_safe"
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

assert_claude_cache_bypass_rewrites_to_repo_root "bun run verify:logs budget" "verify_logs"
assert_claude_cache_bypass_rewrites_to_repo_root "bun run verify:async:status" "verify_async_status"
assert_claude_cache_bypass_rewrites_to_repo_root "bun run code:intel -- exports packages/shared/src/constants.ts" "code_intel"
assert_bun_cache_bypass_preserves_cached_marker "bun run verify:async:status" "verify_async_status"
assert_bun_cache_bypass_preserves_cached_marker "bun run verify:async:stop" "verify_async_stop"
assert_bun_cache_bypass_preserves_cached_marker "bun run code:intel -- exports packages/shared/src/constants.ts" "code_intel"
assert_codex_bun_post_success_is_non_blocking
assert_codex_bun_post_failure_keeps_bounded_block

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

FINISHED_SUMMARY=$(ai_bun_failure_summary "test:changed" "$AI_BUN_LOG_DIR/test_changed.log" "" "3" "passed")
if grep -qF "$AI_FLAKY_NOTE" <<< "$FINISHED_SUMMARY"; then
  fail "finished summary should not include flaky failure note"
fi

FAILED_SUMMARY=$(ai_bun_failure_summary "test:changed" "$AI_BUN_LOG_DIR/test_changed.log" "1" "3" "failed")
grep -qF "$AI_FLAKY_NOTE" <<< "$FAILED_SUMMARY" || fail "test failure summary missing flaky note"

printf 'ai-hooks cache tests passed\n'
