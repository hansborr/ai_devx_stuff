#!/bin/bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)

# shellcheck source=/dev/null
. "$SCRIPT_DIR/common.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/policy.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/protected-files.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/doc-length.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/output-filter.sh"

TMP_ROOT=$(mktemp -d /tmp/musi-ai-hooks-test.XXXXXX)
trap 'rm -rf "$TMP_ROOT"' EXIT

AI_STATE_ROOT="$TMP_ROOT/state"
AI_BUN_LOG_DIR="$TMP_ROOT/bun-logs"
AI_PRECOMMIT_LOG_DIR="$TMP_ROOT/pre-commit-logs"
MUSI_VERIFY_ASYNC_STATE_ROOT="$TMP_ROOT/verify-async"

# shellcheck source=/dev/null
. "$SCRIPT_DIR/cache.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/stop-policy.sh"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_policy_blocks() {
  local cmd="$1"
  local expected="$2"
  local reason

  reason=$(ai_policy_violation_reason "$cmd" || true)
  [ "$reason" = "$expected" ] || fail "policy reason mismatch for [$cmd]"
}

assert_policy_allows() {
  local cmd="$1"

  if ai_policy_violation_reason "$cmd" >/dev/null; then
    fail "policy unexpectedly blocked [$cmd]"
  fi
}

assert_wrapped_bun() {
  local cmd="$1"

  ai_is_wrapped_bun_cmd "$cmd" || fail "expected wrapped bun command [$cmd]"
}

assert_unwrapped_bun() {
  local cmd="$1"

  if ai_is_wrapped_bun_cmd "$cmd"; then
    fail "expected unwrapped bun command [$cmd]"
  fi
}

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

assert_contains() {
  local haystack="$1"
  local needle="$2"

  grep -qF "$needle" <<< "$haystack" || fail "expected [$haystack] to contain [$needle]"
}

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

assert_policy_blocks "git commit -m test --no-verify" "$AI_POLICY_HOOK_BYPASS"
assert_policy_blocks "HUSKY=0 git commit -m test" "$AI_POLICY_HOOK_BYPASS"
assert_policy_blocks "git commit -nm test" "$AI_POLICY_HOOK_BYPASS"
assert_policy_blocks "psql postgres" "$AI_POLICY_POSTGRES"
assert_policy_blocks "redis-cli ping" "$AI_POLICY_REDIS"
assert_policy_blocks "docker ps" "$AI_POLICY_DOCKER"
assert_policy_blocks "echo ThisIsNotTheRealDatabasePassword" "$AI_POLICY_CHANGEME"

assert_policy_allows "echo ok"
assert_policy_allows "git status --short"
assert_policy_allows "bun run test:changed"

PROTECTED_MSG=$(ai_protected_file_advisory "$REPO_ROOT/packages/server/prisma/schema.prisma")
assert_contains "$PROTECTED_MSG" "Create a migration"
if ai_protected_file_advisory "$REPO_ROOT/packages/server/src/main.ts" >/dev/null; then
  fail "unexpected protected-file advisory for unprotected file"
fi

mkdir -p "$TMP_ROOT/docs/agent_notes"
STATUS_DOC="$TMP_ROOT/docs/agent_notes/STATUS.md"
for _ in $(seq 1 121); do
  printf 'line\n' >> "$STATUS_DOC"
done
DOC_MSG=$(ai_doc_length_advisory "$STATUS_DOC")
assert_contains "$DOC_MSG" "STATUS.md is 121 lines"
COUNT_MSG=$(ai_doc_length_advisory_for_count "$STATUS_DOC" 122)
assert_contains "$COUNT_MSG" "STATUS.md is 122 lines"
SHORT_DOC="$TMP_ROOT/docs/agent_notes/NEXT.md"
printf 'short\n' > "$SHORT_DOC"
if ai_doc_length_advisory "$SHORT_DOC" >/dev/null; then
  fail "unexpected doc-length advisory for short doc"
fi
if ai_doc_length_advisory_for_count "$SHORT_DOC" 1 >/dev/null; then
  fail "unexpected doc-length count advisory for short doc"
fi

OUTSIDE_HOOK_OUTPUT=$(
  cd /tmp
  printf '{"tool_input":{"file_path":"/tmp/not-schema.ts"}}' \
    | CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$REPO_ROOT/.claude/hooks/prisma-generate.sh"
)
[ "$OUTSIDE_HOOK_OUTPUT" = '{"continue":true}' ] || fail "Claude prisma hook failed outside repo cwd"

assert_wrapped_bun "bun run lint"
assert_wrapped_bun "bun run lint:changed"
assert_wrapped_bun "bun run typecheck"
assert_wrapped_bun "bun run test:changed"
assert_wrapped_bun "bun run test:slow"
assert_wrapped_bun "bun run e2e"
assert_wrapped_bun "bun run format:check"
assert_wrapped_bun "bun run build --silent"
assert_wrapped_bun "bun run verify"
assert_wrapped_bun "bun run verify:changed"
assert_wrapped_bun "bun run verify:slow"
assert_wrapped_bun "bun run verify:logs budget"
assert_wrapped_bun "bun run verify:async:status"
assert_wrapped_bun "bun run verify:async:tail"
assert_wrapped_bun "bun run verify:async:stop"

assert_cache_bypass_bun "bun run verify:logs budget"
assert_cache_bypass_bun "bun run verify:async:status"
assert_cache_bypass_bun "bun run verify:async:tail"
assert_cache_bypass_bun "bun run verify:async:stop"
assert_lock_bypass_bun "bun run verify:logs budget"
assert_lock_bypass_bun "bun run verify:async:status"
assert_lock_bypass_bun "bun run verify:async:tail"
assert_lock_bypass_bun "bun run verify:async:stop"

assert_unwrapped_bun "bun run dev"
assert_unwrapped_bun "bun run db:status"
assert_unwrapped_bun "bun run test:watch"
assert_unwrapped_bun "bun run test:changed && echo next"
assert_unwrapped_bun "bun run verify:async"
assert_unwrapped_bun "bun run verify:async:changed"
assert_unwrapped_bun "bun run verify:async:slow"

BUN_HOOK="$REPO_ROOT/.claude/hooks/bun-run-quiet.sh"
BUN_HOOK_LOCK="$TMP_ROOT/bun-hook-lock"
(
  exec 8<>"$BUN_HOOK_LOCK"
  flock -n 8 || exit 1
  printf 'PID=fixture SCRIPT=verify:changed STARTED=now\n' > "$BUN_HOOK_LOCK"
  sleep 3
) &
BUN_HOOK_HOLDER=$!
sleep 0.2
BUN_HOOK_OUT=$(
  printf '{"tool_input":{"command":"bun run verify:changed","run_in_background":false}}' \
    | AI_BUN_LOCK="$BUN_HOOK_LOCK" AI_BUN_LOCK_WAIT=1 bash "$BUN_HOOK"
)
wait "$BUN_HOOK_HOLDER" 2>/dev/null || true
assert_contains "$BUN_HOOK_OUT" '"decision": "deny"'
assert_contains "$BUN_HOOK_OUT" 'Waited 1s'
assert_contains "$BUN_HOOK_OUT" 'flock '"$BUN_HOOK_LOCK"' true && echo FREE'

ai_cache_init
[ -d "$AI_GIT_STATE_DIR" ] || fail "missing git state dir"
[ -d "$AI_BUN_STATE_DIR" ] || fail "missing bun state dir"
[ -d "$AI_STOP_STATE_DIR" ] || fail "missing stop state dir"
[ -d "$AI_BUN_LOG_DIR" ] || fail "missing bun log dir"
[ -d "$AI_PRECOMMIT_LOG_DIR" ] || fail "missing pre-commit log dir"

assert_claude_stateful_verify_rewrites_to_repo_root() {
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

assert_stateful_verify_bypasses_cached_marker() {
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
      || fail "Claude bun hook replayed cache or failed repo-root rewrite for [$cmd] on attempt $attempt: $claude_out"

    codex_out=$(
      printf '{"tool_use_id":"stateful-%s-%s","tool_input":{"command":"%s"}}' "$script_safe" "$attempt" "$cmd" \
        | AI_STATE_ROOT="$AI_STATE_ROOT" AI_BUN_LOG_DIR="$AI_BUN_LOG_DIR" bash "$REPO_ROOT/.codex/hooks/pre-tool-use.sh"
    )
    [ "$codex_out" = '{"continue":true}' ] \
      || fail "Codex pre hook replayed or blocked cached stateful command [$cmd] on attempt $attempt: $codex_out"

    codex_post_out=$(
      printf '{"tool_use_id":"stateful-%s-%s","tool_input":{"command":"%s"},"tool_response":{"exit_code":0,"stdout":"fresh stateful output"}}' "$script_safe" "$attempt" "$cmd" \
        | AI_STATE_ROOT="$AI_STATE_ROOT" AI_BUN_LOG_DIR="$AI_BUN_LOG_DIR" bash "$REPO_ROOT/.codex/hooks/post-tool-use.sh"
    )
    [ "$codex_post_out" = '{"continue":true}' ] \
      || fail "Codex post hook summarized or cached stateful command [$cmd] on attempt $attempt: $codex_post_out"
    [ "$(cat "$marker")" = "$marker_before" ] \
      || fail "Codex post hook rewrote cache marker for stateful command [$cmd]"
    [ "$(cat "$log")" = "stale success marker fixture" ] \
      || fail "Codex post hook rewrote log for stateful command [$cmd]"
  done
}

assert_claude_stateful_verify_rewrites_to_repo_root "bun run verify:logs budget" "verify_logs"
assert_claude_stateful_verify_rewrites_to_repo_root "bun run verify:async:status" "verify_async_status"
assert_stateful_verify_bypasses_cached_marker "bun run verify:async:status" "verify_async_status"
assert_stateful_verify_bypasses_cached_marker "bun run verify:async:stop" "verify_async_stop"

# Enforce that every Stop status reporter has loop protection before it can notify.
assert_stop_status_reporters_have_loop_protection

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

# Cache miss → no stop-hook e2e launch, no message, no marker churn.
rm -f "$E2E_MARKER" "$E2E_COUNTER"
FAKE_BUN_CALL="$TMP_ROOT/stop-hook-bun-called"
PATH="$TMP_ROOT/no-such-bin:$PATH" ai_stop_e2e_status "$E2E_REPO" >/dev/null \
  && fail "e2e cache miss should not emit reminder"
[ ! -f "$FAKE_BUN_CALL" ] || fail "stop hook should not launch bun on e2e cache miss"
[ ! -f "$E2E_MARKER" ] || fail "e2e cache miss should not write marker"

# Cached failure → surfaces failure, increments counter to 1.
ai_write_bun_marker "$E2E_MARKER" "$E2E_FP" 1
STOP_E2E_MSG=$(ai_stop_e2e_status "$E2E_REPO") \
  || fail "cached failing e2e should emit reminder"
assert_contains "$STOP_E2E_MSG" "e2e tests are failing"
assert_contains "$STOP_E2E_MSG" "exit 1"
ai_stop_e2e_read_counter "$E2E_COUNTER" || fail "expected counter file after first failure"
[ "$AI_STOP_E2E_COUNTER_COUNT" = "1" ] || fail "first failure should set count=1 (got $AI_STOP_E2E_COUNTER_COUNT)"

# Cache hit, same fp → counter goes to 2 and still emits.
STOP_E2E_MSG=$(ai_stop_e2e_status "$E2E_REPO") \
  || fail "second failure on same fp should still emit reminder"
ai_stop_e2e_read_counter "$E2E_COUNTER" || fail "counter file missing after second failure"
[ "$AI_STOP_E2E_COUNTER_COUNT" = "2" ] || fail "second failure should set count=2 (got $AI_STOP_E2E_COUNTER_COUNT)"

# Third stop on same fp → suppressed.
if ai_stop_e2e_status "$E2E_REPO" >/dev/null; then
  fail "third failure on same fp should be suppressed"
fi
ai_stop_e2e_read_counter "$E2E_COUNTER" || fail "counter file missing after suppression"
[ "$AI_STOP_E2E_COUNTER_COUNT" = "2" ] || fail "suppressed stop should not increment counter past max"

# Fingerprint change → counter resets to 1, emits again.
printf 'change\n' >> "$E2E_REPO/file.txt"
git -C "$E2E_REPO" add file.txt
git -C "$E2E_REPO" commit -m "change" >/dev/null 2>&1 || fail "failed to commit fp change"
E2E_FP=$(ai_worktree_fingerprint "$E2E_REPO")
ai_write_bun_marker "$E2E_MARKER" "$E2E_FP" 1
STOP_E2E_MSG=$(ai_stop_e2e_status "$E2E_REPO") \
  || fail "failing e2e on new fingerprint should emit reminder"
ai_stop_e2e_read_counter "$E2E_COUNTER" || fail "counter file missing after fp change"
[ "$AI_STOP_E2E_COUNTER_COUNT" = "1" ] || fail "fp change should reset count to 1 (got $AI_STOP_E2E_COUNTER_COUNT)"

# Branch change → counter resets to 1.
git -C "$E2E_REPO" checkout -b feature/other >/dev/null 2>&1 || fail "failed to switch e2e branch"
STOP_E2E_MSG=$(ai_stop_e2e_status "$E2E_REPO") \
  || fail "failing e2e on new branch should emit reminder"
ai_stop_e2e_read_counter "$E2E_COUNTER" || fail "counter file missing after branch change"
[ "$AI_STOP_E2E_COUNTER_COUNT" = "1" ] || fail "branch change should reset count to 1"
[ "$AI_STOP_E2E_COUNTER_BRANCH" = "feature/other" ] || fail "counter branch should track current branch"

# Success → counter cleared, no message.
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

# Exit-code change resets the counter (e.g. exit 1 → exit 2 from a re-run).
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

FINISHED_SUMMARY=$(ai_bun_failure_summary "test:changed" "$AI_BUN_LOG_DIR/test_changed.log" "" "3" "passed")
if grep -qF "$AI_FLAKY_NOTE" <<< "$FINISHED_SUMMARY"; then
  fail "finished summary should not include flaky failure note"
fi

FAILED_SUMMARY=$(ai_bun_failure_summary "test:changed" "$AI_BUN_LOG_DIR/test_changed.log" "1" "3" "failed")
grep -qF "$AI_FLAKY_NOTE" <<< "$FAILED_SUMMARY" || fail "test failure summary missing flaky note"

NOISY_TEST_OUTPUT=$'useful failure line\n(node:123) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.\n(Use `node --trace-deprecation ...` to show where the warning was created)\nreal assertion line'
FILTERED_TEST_OUTPUT=$(printf '%s\n' "$NOISY_TEST_OUTPUT" | ai_filter_known_output_noise)
assert_contains "$FILTERED_TEST_OUTPUT" "useful failure line"
assert_contains "$FILTERED_TEST_OUTPUT" "real assertion line"
if grep -qF "client.query()" <<< "$FILTERED_TEST_OUTPUT"; then
  fail "known pg deprecation warning should be filtered from displayed output"
fi
if grep -qF "trace-deprecation" <<< "$FILTERED_TEST_OUTPUT"; then
  fail "known trace-deprecation hint should be filtered from displayed output"
fi

SCRIPT_FAILURE_LOG="$TMP_ROOT/scripts-failure.log"
cat > "$SCRIPT_FAILURE_LOG" <<'EOF'
test:scripts: running test-verify-logs...
ok 1 - before failure
test:scripts: test-verify-logs FAILED

test:scripts: FAILED — passed: test-verify failed: test-verify-logs
EOF
SCRIPT_FAILURE_EXCERPT=$(ai_filtered_task_log_excerpt scripts "$SCRIPT_FAILURE_LOG" 30)
assert_contains "$SCRIPT_FAILURE_EXCERPT" "scripts failed: test-verify-logs"
assert_contains "$SCRIPT_FAILURE_EXCERPT" "command: bash scripts/test-verify-logs.sh"
assert_contains "$SCRIPT_FAILURE_EXCERPT" "test:scripts: test-verify-logs FAILED"

NON_SCRIPT_EXCERPT=$(ai_filtered_task_log_excerpt test "$SCRIPT_FAILURE_LOG" 30)
if grep -qF "command: bash scripts/test-verify-logs.sh" <<< "$NON_SCRIPT_EXCERPT"; then
  fail "non-scripts task excerpt should not include scripts command hint"
fi

MULTI_SCRIPT_FAILURE_LOG="$TMP_ROOT/scripts-failure-multi.log"
cat > "$MULTI_SCRIPT_FAILURE_LOG" <<'EOF'
test:scripts: running test-verify-logs...
test:scripts: test-verify-logs FAILED
test:scripts: running test-other-thing...
test:scripts: test-other-thing FAILED

test:scripts: FAILED — passed: failed: test-verify-logs test-other-thing
EOF
MULTI_SCRIPT_EXCERPT=$(ai_filtered_task_log_excerpt scripts "$MULTI_SCRIPT_FAILURE_LOG" 30)
assert_contains "$MULTI_SCRIPT_EXCERPT" "scripts failed: test-verify-logs"
assert_contains "$MULTI_SCRIPT_EXCERPT" "scripts failed: test-other-thing"
assert_contains "$MULTI_SCRIPT_EXCERPT" "command: bash scripts/test-verify-logs.sh"
assert_contains "$MULTI_SCRIPT_EXCERPT" "command: bash scripts/test-other-thing.sh"

printf 'ai-hooks tests passed\n'
