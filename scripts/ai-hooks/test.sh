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

# shellcheck source=/dev/null
. "$SCRIPT_DIR/cache.sh"

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
assert_wrapped_bun "bun run e2e"
assert_wrapped_bun "bun run format:check"
assert_wrapped_bun "bun run build --silent"

assert_unwrapped_bun "bun run dev"
assert_unwrapped_bun "bun run db:status"
assert_unwrapped_bun "bun run test:watch"
assert_unwrapped_bun "bun run test:changed && echo next"

ai_cache_init
[ -d "$AI_GIT_STATE_DIR" ] || fail "missing git state dir"
[ -d "$AI_BUN_STATE_DIR" ] || fail "missing bun state dir"
[ -d "$AI_BUN_LOG_DIR" ] || fail "missing bun log dir"
[ -d "$AI_PRECOMMIT_LOG_DIR" ] || fail "missing pre-commit log dir"

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

printf 'ai-hooks tests passed\n'
