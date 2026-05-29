#!/bin/bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../test-git-env.sh
. "$SCRIPT_DIR/../test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
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
# shellcheck source=/dev/null
. "$SCRIPT_DIR/commit-output.sh"

TMP_ROOT=$(mktemp -d /tmp/musi-ai-hooks-test.XXXXXX)
TIDY_REPO_TMP="$TMP_ROOT/tidy-repo"
LINT_COVERAGE_REPO_TMP="$TMP_ROOT/lint-coverage-repo"
trap 'rm -rf "$TMP_ROOT" "$TIDY_REPO_TMP" "$LINT_COVERAGE_REPO_TMP"' EXIT

AI_STATE_ROOT="$TMP_ROOT/state"
AI_BUN_LOG_DIR="$TMP_ROOT/bun-logs"
AI_PRECOMMIT_LOG_DIR="$TMP_ROOT/pre-commit-logs"
MUSI_VERIFY_ASYNC_STATE_ROOT="$TMP_ROOT/verify-async"

# shellcheck source=/dev/null
. "$SCRIPT_DIR/cache.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/lint-coverage-state.sh"
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

assert_policy_blocks_in_dir() {
  local dir="$1"
  local cmd="$2"
  local expected="$3"
  local reason

  reason=$(cd "$dir" && ai_policy_violation_reason "$cmd" || true)
  [ "$reason" = "$expected" ] || fail "policy reason mismatch for [$cmd] in [$dir]"
}

assert_policy_allows_in_dir() {
  local dir="$1"
  local cmd="$2"

  if (cd "$dir" && ai_policy_violation_reason "$cmd" >/dev/null); then
    fail "policy unexpectedly blocked [$cmd] in [$dir]"
  fi
}

assert_policy_blocks_each() {
  local expected="$1"
  local cmd
  shift

  for cmd in "$@"; do
    assert_policy_blocks "$cmd" "$expected"
  done
}

assert_policy_allows_each() {
  local cmd

  for cmd in "$@"; do
    assert_policy_allows "$cmd"
  done
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

assert_lc_state_read_fails() {
  local file="$1"
  local content="$2"

  printf '%s\n' "$content" > "$file"
  if ai_lint_coverage_read_state "$file"; then
    fail "corrupt lint-coverage state unexpectedly parsed: $content"
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"

  grep -qF "$needle" <<< "$haystack" || fail "expected [$haystack] to contain [$needle]"
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"

  if grep -qF "$needle" <<< "$haystack"; then
    fail "expected [$haystack] not to contain [$needle]"
  fi
}

assert_response_combined_exit() {
  local payload="$1"
  local expected_combined="$2"
  local expected_exit="$3"
  local response combined exit_code

  response=$(ai_response_json_from_payload "$payload")
  combined=$(ai_combined_response_text "$response")
  exit_code=$(printf '%s' "$response" | jq -r '.exit_code // empty')

  [ "$combined" = "$expected_combined" ] \
    || fail "response combined text mismatch. Expected [$expected_combined], got [$combined] from [$response]"
  [ "$exit_code" = "$expected_exit" ] \
    || fail "response exit code mismatch. Expected [$expected_exit], got [$exit_code] from [$response]"
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
assert_policy_blocks " docker ps" "$AI_POLICY_DOCKER"
assert_policy_blocks "echo ThisIsNotTheRealDatabasePassword" "$AI_POLICY_CHANGEME"

assert_policy_blocks_each "$AI_POLICY_GIT_AMEND" \
  " git commit --amend -m fix" \
  "git commit --amend -m fix" \
  "echo ok && git commit --amend" \
  "bash -lc 'git commit --amend'" \
  "env FOO=bar git commit --amend"

assert_policy_blocks_each "$AI_POLICY_GIT_REBASE" \
  "git rebase main" \
  "git rebase -i main" \
  "git rebase --onto main feature" \
  "echo ok && git rebase --autosquash main" \
  "bash -lc 'git rebase main'" \
  "env FOO=bar git rebase main" \
  "git rebase --continue ; git rebase main" \
  "git rebase --abort && git rebase -i HEAD~3"
assert_policy_allows_each \
  "git rebase --continue" \
  "git rebase --abort" \
  "git rebase --skip" \
  "git rebase --quit" \
  "git rebase --continue && git rebase --abort"

assert_policy_blocks_each "$AI_POLICY_GIT_RESET" \
  "git reset --hard HEAD" \
  "git reset --soft HEAD~1" \
  "git reset --merge ORIG_HEAD" \
  "git reset --keep HEAD" \
  "git reset --mixed HEAD~1" \
  "git reset -q HEAD~1" \
  "git reset HEAD~1" \
  " git reset --hard HEAD" \
  "echo ok && git reset --hard" \
  "bash -lc 'git reset --hard HEAD'" \
  "env FOO=bar git reset --soft HEAD" \
  "git reset --mixed HEAD~1 -- packages/client/src/foo.ts"
assert_policy_allows_each \
  "git reset" \
  "git reset HEAD -- packages/client/src/foo.ts" \
  "git reset --quiet HEAD -- packages/client/src/foo.ts" \
  "git reset --mixed HEAD -- packages/client/src/foo.ts" \
  "git reset -- packages/client/src/foo.ts" \
  "git restore --staged packages/client/src/foo.ts"

assert_policy_blocks_each "$AI_POLICY_GIT_HISTORY_REWRITE" \
  "git filter-branch --tree-filter true" \
  "git filter-repo --path foo" \
  "git replace abc def" \
  "git update-ref refs/heads/main abc" \
  "git reflog expire --expire=now --all" \
  "echo ok && git filter-repo --path foo" \
  "bash -lc 'git update-ref refs/heads/main abc'" \
  "env FOO=bar git replace abc def"

assert_policy_blocks_each "$AI_POLICY_GIT_FORCE_PUSH" \
  " git push --force" \
  "git push --force" \
  "git push -f origin feat/foo" \
  "git push --force-with-lease origin feat/foo" \
  "git push --force-with-lease=refs/heads/feat/foo origin feat/foo" \
  "git push --mirror origin" \
  "git push origin +main" \
  "git push origin :feat/foo" \
  "git push --delete origin feat/foo" \
  "git push -d origin feat/foo" \
  "echo ok && git push --force" \
  "bash -lc 'git push --force'" \
  "env FOO=bar git push --force"
assert_policy_blocks_each "$AI_POLICY_GIT_PUSH_MAIN" \
  " git push origin main" \
  "git push origin main" \
  "git push origin master" \
  "git push origin HEAD:main" \
  "git push origin HEAD:refs/heads/master" \
  "git push origin refs/heads/main" \
  "git push origin --all" \
  "git push --all origin" \
  "echo ok && git push origin main" \
  "bash -lc 'git push origin main'" \
  "env FOO=bar git push origin main"
MAIN_BRANCH_REPO="$TMP_ROOT/main-branch-repo"
FEATURE_BRANCH_REPO="$TMP_ROOT/feature-branch-repo"
git init -q "$MAIN_BRANCH_REPO"
git -C "$MAIN_BRANCH_REPO" symbolic-ref HEAD refs/heads/main
git init -q "$FEATURE_BRANCH_REPO"
git -C "$FEATURE_BRANCH_REPO" symbolic-ref HEAD refs/heads/feat/policy
assert_policy_blocks_in_dir "$MAIN_BRANCH_REPO" "git push" "$AI_POLICY_GIT_PUSH_MAIN"
assert_policy_blocks_in_dir "$MAIN_BRANCH_REPO" "git push origin" "$AI_POLICY_GIT_PUSH_MAIN"
assert_policy_blocks_in_dir "$MAIN_BRANCH_REPO" "git push origin HEAD" "$AI_POLICY_GIT_PUSH_MAIN"
assert_policy_blocks_in_dir "$MAIN_BRANCH_REPO" "git push -u origin HEAD" "$AI_POLICY_GIT_PUSH_MAIN"
assert_policy_blocks_in_dir "$MAIN_BRANCH_REPO" "git push 2>&1" "$AI_POLICY_GIT_PUSH_MAIN"
assert_policy_blocks_in_dir "$MAIN_BRANCH_REPO" "git push origin HEAD>/tmp/push.out" "$AI_POLICY_GIT_PUSH_MAIN"
assert_policy_allows_in_dir "$MAIN_BRANCH_REPO" "git push origin feat/foo"
assert_policy_allows_in_dir "$MAIN_BRANCH_REPO" "git push --set-upstream origin feat/foo"
assert_policy_allows_in_dir "$MAIN_BRANCH_REPO" "git push origin feat/foo 2>&1"
assert_policy_allows_in_dir "$MAIN_BRANCH_REPO" "git push origin feat/foo>/tmp/push.out"
assert_policy_allows_in_dir "$FEATURE_BRANCH_REPO" "git push"
assert_policy_allows_in_dir "$FEATURE_BRANCH_REPO" "git push origin HEAD"
assert_policy_allows_in_dir "$FEATURE_BRANCH_REPO" "git push --set-upstream origin feat/foo"
assert_policy_allows_in_dir "$FEATURE_BRANCH_REPO" "git push origin feat/foo"

assert_policy_blocks_each "$AI_POLICY_GIT_BRANCH_FORCE_DELETE" \
  "git branch -D feat/foo" \
  "git branch -df feat/foo" \
  "git branch -fd feat/foo" \
  "git branch -d -f feat/foo" \
  "git branch -f -d feat/foo" \
  "git branch --delete --force feat/foo" \
  "git branch --delete -f feat/foo" \
  "git branch --force --delete feat/foo" \
  "git tag -d v1.0.0" \
  "git tag --delete v1.0.0" \
  "git worktree remove --force ../feature" \
  "git worktree remove -f ../feature" \
  "echo ok && git branch -D feat/foo" \
  "bash -lc 'git tag -d v1.0.0'" \
  "env FOO=bar git worktree remove --force ../feature"
assert_policy_blocks_each "$AI_POLICY_GIT_CLEAN_FORCE" \
  "git clean -f" \
  "git clean -fd" \
  "git clean -fdx ." \
  "git clean --force" \
  "echo ok && git clean -fdx" \
  "bash -lc 'git clean -f'" \
  "env FOO=bar git clean -fd"
assert_policy_allows_each \
  "git branch -d feat/foo" \
  "git clean -n"

assert_policy_blocks_each "$AI_POLICY_GH_AUTH" \
  " gh auth token" \
  "gh auth token" \
  "gh auth login" \
  "gh auth logout" \
  "gh auth refresh" \
  "gh auth setup-git" \
  "bash -lc 'gh auth token'" \
  "env FOO=bar gh auth login"

assert_policy_blocks_each "$AI_POLICY_GH_REMOTE_MUTATION" \
  " gh pr create --title test" \
  "gh pr create --title test" \
  "gh pr comment 1 --body test" \
  "gh pr merge 1 --admin" \
  "gh pr close 1" \
  "gh pr reopen 1" \
  "gh pr ready 1" \
  "gh pr edit 1 --title test" \
  "gh pr lock 1" \
  "gh pr unlock 1" \
  "gh pr review 1 --approve" \
  "gh issue create --title test" \
  "gh issue comment 1 --body test" \
  "gh issue close 1" \
  "gh issue reopen 1" \
  "gh issue edit 1 --title test" \
  "gh issue delete 1" \
  "gh issue develop 1" \
  "gh issue lock 1" \
  "gh issue unlock 1" \
  "gh issue transfer 1 owner/repo" \
  "gh issue pin 1" \
  "gh issue unpin 1" \
  "gh repo create owner/repo" \
  "gh repo fork owner/repo" \
  "gh repo delete owner/repo" \
  "gh repo archive owner/repo" \
  "gh repo rename new-name" \
  "gh repo transfer owner/repo other" \
  "gh repo edit --description test" \
  "gh repo sync owner/repo" \
  "gh repo deploy-key add key.pub" \
  "gh repo deploy-key delete 123" \
  "gh release create v1.0.0" \
  "gh release edit v1.0.0" \
  "gh release delete v1.0.0" \
  "gh release delete-asset asset-id" \
  "gh release upload v1.0.0 file.tgz" \
  "gh workflow disable ci.yml" \
  "gh workflow enable ci.yml" \
  "gh workflow run ci.yml" \
  "gh run cancel 123" \
  "gh run rerun 123" \
  "gh run delete 123" \
  "gh cache delete key" \
  "gh secret set TOKEN" \
  "gh secret delete TOKEN" \
  "gh variable set NAME --body value" \
  "gh variable delete NAME" \
  "gh api --method POST repos/owner/repo/issues" \
  "gh api --method=PUT repos/owner/repo" \
  "gh api -X PATCH repos/owner/repo/issues/1" \
  "gh api -XDELETE repos/owner/repo/issues/1" \
  "gh api repos/owner/repo/issues -f title=test" \
  "gh api repos/owner/repo/issues --raw-field title=test" \
  "gh api repos/owner/repo/issues --input body.json" \
  "gh api graphql -f query='mutation { closeIssue(input: {}) { clientMutationId } }'" \
  "gh api graphql --input query.graphql" \
  "gh codespace create" \
  "gh codespace delete -c test" \
  "gh codespace edit -c test" \
  "gh codespace rebuild -c test" \
  "gh codespace stop -c test" \
  "gh gist create file.txt" \
  "gh gist edit gist-id file.txt" \
  "gh gist delete gist-id" \
  "gh gpg-key add key.asc" \
  "gh gpg-key delete key-id" \
  "gh ssh-key add key.pub" \
  "gh ssh-key delete key-id" \
  "gh label create kind/bug" \
  "gh label edit kind/bug" \
  "gh label delete kind/bug" \
  "gh label clone owner/repo" \
  "gh repo set-default owner/repo" \
  "gh alias set co pr checkout" \
  "gh alias delete co" \
  "gh config set prompt disabled" \
  "gh extension install owner/ext" \
  "gh extension remove owner/ext" \
  "gh extension upgrade owner/ext" \
  "echo ok && gh pr merge 1" \
  "bash -lc 'gh repo delete owner/repo'" \
  "env FOO=bar gh pr create --title test"

assert_policy_allows_each \
  "gh pr view 1 --json number" \
  "gh pr list --state open" \
  "gh issue view 1" \
  "gh issue list" \
  "gh run view 123" \
  "gh run list" \
  "gh repo view owner/repo" \
  "gh release view v1.0.0" \
  "gh release list" \
  "gh workflow view ci.yml" \
  "gh auth status" \
  "gh api --method GET repos/owner/repo" \
  "gh api -X GET search/issues -f q=repo:owner/repo" \
  "gh api graphql -f query='query { viewer { login } }'"

assert_policy_blocks_each "$AI_POLICY_GREP" \
  "grep -r TODO ." \
  "grep -R TODO src/" \
  "grep -rn TODO packages/" \
  "grep -nrl TODO ." \
  "grep --recursive TODO dir" \
  "egrep -r TODO ." \
  "fgrep -R TODO src/" \
  "grep -n -r TODO ." \
  "echo ok && grep -r TODO ." \
  "true; grep -rn TODO src/" \
  "bash -lc 'grep -r TODO .'" \
  "sh -c \"grep -R TODO .\""
assert_policy_allows_each \
  "echo ok" \
  "git status --short" \
  "git grep needle" \
  "git -C /tmp/some/path grep needle" \
  "rg needle" \
  "rg --files" \
  "ripgrep needle" \
  "which grep" \
  "grep TODO packages/client/src/main.ts" \
  "egrep TODO packages/client/src/main.ts" \
  "grep -n TODO file.txt" \
  "grep -l TODO *.txt" \
  "find . -exec grep TODO {} +" \
  "printf '%s\n' TODO | xargs grep TODO" \
  "echo ok && grep TODO package.json" \
  "true; grep TODO package.json" \
  "echo TODO | grep TODO" \
  "cat package.json | grep -v node_modules" \
  "rg pattern packages | grep -v test" \
  "find . -name '*.ts' | grep components" \
  "rg -n 'FOO|grep' packages/client/src" \
  "bun run test:changed"

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

# --- tidy-edited-file hook ----------------------------------------------------
rm -rf "$TIDY_REPO_TMP"
mkdir -p "$TIDY_REPO_TMP/scripts/ai-hooks" "$TIDY_REPO_TMP/src" "$TIDY_REPO_TMP/node_modules/.bin"
cp "$REPO_ROOT/scripts/ai-hooks/common.sh" "$REPO_ROOT/scripts/ai-hooks/tidy-edited-file.sh" "$TIDY_REPO_TMP/scripts/ai-hooks/"
git -C "$TIDY_REPO_TMP" init -q
HOOK_FIXTURE_REPO_ROOT="$TIDY_REPO_TMP"
TIDY_PINNED_LOG="$TMP_ROOT/tidy-pinned.log"
cat > "$TIDY_REPO_TMP/node_modules/.bin/prettier" <<'EOF'
#!/bin/bash
set -u

printf 'prettier' >> "$TIDY_PINNED_LOG"
for arg in "$@"; do
  printf '\t%s' "$arg" >> "$TIDY_PINNED_LOG"
done
printf '\n' >> "$TIDY_PINNED_LOG"

if [ "${TIDY_PINNED_PRETTIER_FAIL:-0}" = "1" ]; then
  printf 'prettier failed line\n'
  exit 7
fi
if [ "${TIDY_PINNED_PRETTIER_FORMAT_FIXTURE:-0}" = "1" ]; then
  target=""
  for arg in "$@"; do
    target="$arg"
  done
  [ -n "$target" ] && printf 'const value = { answer: 1 };\n' > "$target"
fi
EOF
cat > "$TIDY_REPO_TMP/node_modules/.bin/eslint" <<'EOF'
#!/bin/bash
set -u

printf 'eslint' >> "$TIDY_PINNED_LOG"
for arg in "$@"; do
  printf '\t%s' "$arg" >> "$TIDY_PINNED_LOG"
done
printf '\n' >> "$TIDY_PINNED_LOG"

if [ "${TIDY_PINNED_ESLINT_FAIL:-0}" = "1" ]; then
  i=1
  while [ "$i" -le 60 ]; do
    printf 'eslint line %02d\n' "$i"
    i=$((i + 1))
  done
  exit 8
fi

# The tidy hook runs a second, non-mutating `eslint -f json` pass after a clean
# `--fix` run to surface residual warn-level violations. Detect that pass by the
# `-f` flag and emit a json report: one severity-1 message when
# TIDY_PINNED_ESLINT_WARNINGS=1, otherwise a clean (zero-warning) report.
eslint_json_mode=0
for arg in "$@"; do
  case "$arg" in
    -f | --format) eslint_json_mode=1 ;;
  esac
done
if [ "$eslint_json_mode" = "1" ]; then
  if [ "${TIDY_PINNED_ESLINT_WARNINGS:-0}" = "1" ]; then
    printf '%s\n' '[{"filePath":"stub","errorCount":0,"warningCount":1,"messages":[{"ruleId":"no-console","severity":1,"line":3,"column":5,"message":"Unexpected console statement."}]}]'
  else
    printf '%s\n' '[{"filePath":"stub","errorCount":0,"warningCount":0,"messages":[]}]'
  fi
  exit 0
fi
EOF
chmod +x "$TIDY_REPO_TMP/node_modules/.bin/prettier" "$TIDY_REPO_TMP/node_modules/.bin/eslint"

run_tidy_hook() {
  local payload="$1"

  TIDY_PINNED_LOG="$TIDY_PINNED_LOG" \
    TIDY_PINNED_PRETTIER_FAIL="${TIDY_PINNED_PRETTIER_FAIL:-0}" \
    TIDY_PINNED_PRETTIER_FORMAT_FIXTURE="${TIDY_PINNED_PRETTIER_FORMAT_FIXTURE:-0}" \
    TIDY_PINNED_ESLINT_FAIL="${TIDY_PINNED_ESLINT_FAIL:-0}" \
    TIDY_PINNED_ESLINT_WARNINGS="${TIDY_PINNED_ESLINT_WARNINGS:-0}" \
    bash "$TIDY_REPO_TMP/scripts/ai-hooks/tidy-edited-file.sh" <<< "$payload"
}

tidy_context() {
  jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$1"
}

assert_hook_json() {
  local output="$1"

  jq -e . >/dev/null <<< "$output" || fail "invalid hook JSON: $output"
}

assert_hook_continue_json() {
  local output="$1"

  assert_hook_json "$output"
  jq -e '.continue == true and length == 1' >/dev/null <<< "$output" \
    || fail "expected continue hook JSON, got: $output"
}

tidy_payload_for_file() {
  local file="$1"

  jq -n --arg file "$file" '{tool_name:"Edit",tool_input:{file_path:$file}}'
}

tidy_relative_path() {
  realpath --relative-to="${HOOK_FIXTURE_REPO_ROOT:-$REPO_ROOT}" "$1"
}

TIDY_TS="$TIDY_REPO_TMP/src/needs-formatting.ts"
TIDY_TS_REL=$(tidy_relative_path "$TIDY_TS")
printf 'const value={answer:1}\n' > "$TIDY_TS"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(TIDY_PINNED_PRETTIER_FORMAT_FIXTURE=1 run_tidy_hook "$(tidy_payload_for_file "$TIDY_TS_REL")") \
  || fail "tidy hook should not fail for Claude .ts payload"
assert_hook_json "$TIDY_OUTPUT"
TIDY_CONTEXT=$(tidy_context "$TIDY_OUTPUT")
[ "$TIDY_CONTEXT" = "tidy-edited-file: $TIDY_TS_REL tidied" ] \
  || fail "Claude .ts tidy should report changed file, got: $TIDY_CONTEXT"
assert_not_contains "$TIDY_CONTEXT" "OK"
TIDY_EXPECTED_LOG=$(printf 'prettier\t--write\t--ignore-unknown\t%s\neslint\t--fix\t--no-warn-ignored\t%s\neslint\t-f\tjson\t--no-warn-ignored\t%s' "$TIDY_TS" "$TIDY_TS" "$TIDY_TS")
[ "$(cat "$TIDY_PINNED_LOG")" = "$TIDY_EXPECTED_LOG" ] \
  || fail "Claude .ts tidy command log mismatch: $(cat "$TIDY_PINNED_LOG")"
[ "$(cat "$TIDY_TS")" = 'const value = { answer: 1 };' ] \
  || fail "Claude .ts tidy should format the fixture: $(cat "$TIDY_TS")"

TIDY_CLEAN_TS="$TIDY_REPO_TMP/src/already-tidy.ts"
TIDY_CLEAN_TS_REL=$(tidy_relative_path "$TIDY_CLEAN_TS")
printf 'const clean = { answer: 1 };\n' > "$TIDY_CLEAN_TS"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file "$TIDY_CLEAN_TS_REL")") \
  || fail "tidy hook should not fail for already-tidy .ts payload"
assert_hook_continue_json "$TIDY_OUTPUT"
TIDY_EXPECTED_LOG=$(printf 'prettier\t--write\t--ignore-unknown\t%s\neslint\t--fix\t--no-warn-ignored\t%s\neslint\t-f\tjson\t--no-warn-ignored\t%s' "$TIDY_CLEAN_TS" "$TIDY_CLEAN_TS" "$TIDY_CLEAN_TS")
[ "$(cat "$TIDY_PINNED_LOG")" = "$TIDY_EXPECTED_LOG" ] \
  || fail "already-tidy .ts command log mismatch: $(cat "$TIDY_PINNED_LOG")"

TIDY_MD="$TIDY_REPO_TMP/src/note.md"
TIDY_MD_REL=$(tidy_relative_path "$TIDY_MD")
printf '# title\n' > "$TIDY_MD"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file "$TIDY_MD_REL")") \
  || fail "tidy hook should not fail for Markdown payload"
assert_hook_continue_json "$TIDY_OUTPUT"
TIDY_EXPECTED_LOG=$'prettier\t--write\t--ignore-unknown\t'"$TIDY_MD"
[ "$(cat "$TIDY_PINNED_LOG")" = "$TIDY_EXPECTED_LOG" ] \
  || fail "Markdown tidy should only run prettier: $(cat "$TIDY_PINNED_LOG")"

TIDY_MISSING_REL=$(tidy_relative_path "$TIDY_REPO_TMP/src/missing.ts")
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file "$TIDY_MISSING_REL")") \
  || fail "tidy hook should not fail for missing file"
assert_hook_continue_json "$TIDY_OUTPUT"
[ ! -s "$TIDY_PINNED_LOG" ] || fail "missing file should not invoke pinned tools"

: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file ".git/config")") \
  || fail "tidy hook should not fail for unsupported .git path"
assert_hook_json "$TIDY_OUTPUT"
assert_contains "$(tidy_context "$TIDY_OUTPUT")" ".git/config skipped (unsupported path)"
[ ! -s "$TIDY_PINNED_LOG" ] || fail ".git path should not invoke pinned tools"

: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file "node_modules/foo.ts")") \
  || fail "tidy hook should not fail for unsupported node_modules path"
assert_hook_json "$TIDY_OUTPUT"
assert_contains "$(tidy_context "$TIDY_OUTPUT")" "node_modules/foo.ts skipped (unsupported path)"
[ ! -s "$TIDY_PINNED_LOG" ] || fail "node_modules path should not invoke pinned tools"

TIDY_BINARY="$TIDY_REPO_TMP/src/blob.bin"
TIDY_BINARY_REL=$(tidy_relative_path "$TIDY_BINARY")
printf 'a\0b' > "$TIDY_BINARY"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file "$TIDY_BINARY_REL")") \
  || fail "tidy hook should not fail for binary file"
assert_hook_json "$TIDY_OUTPUT"
assert_contains "$(tidy_context "$TIDY_OUTPUT")" "$TIDY_BINARY_REL skipped (binary file)"
[ ! -s "$TIDY_PINNED_LOG" ] || fail "binary file should not invoke pinned tools"

TIDY_CODEX_TS="$TIDY_REPO_TMP/src/codex one.ts"
TIDY_CODEX_MD="$TIDY_REPO_TMP/src/codex-note.md"
TIDY_CODEX_MOVED="$TIDY_REPO_TMP/src/moved file.ts"
TIDY_CODEX_OLD="$TIDY_REPO_TMP/src/old file.ts"
TIDY_CODEX_DELETED="$TIDY_REPO_TMP/src/deleted.ts"
printf 'const codex = 1\n' > "$TIDY_CODEX_TS"
printf '# codex\n' > "$TIDY_CODEX_MD"
printf 'const moved = 1\n' > "$TIDY_CODEX_MOVED"
TIDY_CODEX_TS_REL=$(tidy_relative_path "$TIDY_CODEX_TS")
TIDY_CODEX_MD_REL=$(tidy_relative_path "$TIDY_CODEX_MD")
TIDY_CODEX_MOVED_REL=$(tidy_relative_path "$TIDY_CODEX_MOVED")
TIDY_CODEX_OLD_REL=$(tidy_relative_path "$TIDY_CODEX_OLD")
TIDY_CODEX_DELETED_REL=$(tidy_relative_path "$TIDY_CODEX_DELETED")
TIDY_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  "*** Add File: $TIDY_CODEX_TS_REL" \
  '+const codex = 1' \
  "*** Update File: $TIDY_CODEX_MD_REL" \
  '@@' \
  '-# old' \
  '+# codex' \
  "*** Update File: $TIDY_CODEX_TS_REL" \
  '@@' \
  '-const codex = 0' \
  '+const codex = 1' \
  "*** Delete File: $TIDY_CODEX_DELETED_REL" \
  "*** Update File: $TIDY_CODEX_OLD_REL" \
  "*** Move to: $TIDY_CODEX_MOVED_REL" \
  '@@' \
  '-const moved = 0' \
  '+const moved = 1' \
  '*** End Patch')
TIDY_CODEX_PAYLOAD=$(jq -n --arg command "$TIDY_PATCH" --arg ignored "node_modules/ignored.ts" \
  '{tool_name:"apply_patch",tool_input:{file_path:$ignored,command:$command}}')
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$TIDY_CODEX_PAYLOAD") \
  || fail "tidy hook should not fail for Codex apply_patch payload"
assert_hook_json "$TIDY_OUTPUT"
TIDY_CONTEXT=$(tidy_context "$TIDY_OUTPUT")
assert_not_contains "$TIDY_CONTEXT" "OK"
assert_not_contains "$TIDY_CONTEXT" "$TIDY_CODEX_DELETED_REL skipped (missing/deleted file)"
assert_not_contains "$TIDY_CONTEXT" "$TIDY_CODEX_OLD_REL skipped (missing/deleted file)"
assert_not_contains "$TIDY_CONTEXT" "node_modules/ignored.ts"
TIDY_EXPECTED_LOG=$(printf 'prettier\t--write\t--ignore-unknown\t%s\neslint\t--fix\t--no-warn-ignored\t%s\neslint\t-f\tjson\t--no-warn-ignored\t%s\nprettier\t--write\t--ignore-unknown\t%s\nprettier\t--write\t--ignore-unknown\t%s\neslint\t--fix\t--no-warn-ignored\t%s\neslint\t-f\tjson\t--no-warn-ignored\t%s' "$TIDY_CODEX_TS" "$TIDY_CODEX_TS" "$TIDY_CODEX_TS" "$TIDY_CODEX_MD" "$TIDY_CODEX_MOVED" "$TIDY_CODEX_MOVED" "$TIDY_CODEX_MOVED")
[ "$(cat "$TIDY_PINNED_LOG")" = "$TIDY_EXPECTED_LOG" ] \
  || fail "Codex apply_patch tidy command log mismatch: $(cat "$TIDY_PINNED_LOG")"

TIDY_CODEX_FORMAT="$TIDY_REPO_TMP/src/codex-needs-formatting.ts"
TIDY_CODEX_FORMAT_REL=$(tidy_relative_path "$TIDY_CODEX_FORMAT")
printf 'const codexFormat={answer:1}\n' > "$TIDY_CODEX_FORMAT"
TIDY_FORMAT_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  "*** Update File: $TIDY_CODEX_FORMAT_REL" \
  '@@' \
  '-const codexFormat={answer:0}' \
  '+const codexFormat={answer:1}' \
  '*** End Patch')
TIDY_CODEX_FORMAT_PAYLOAD=$(jq -n --arg command "$TIDY_FORMAT_PATCH" \
  '{tool_name:"apply_patch",tool_input:{command:$command}}')
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(TIDY_PINNED_PRETTIER_FORMAT_FIXTURE=1 run_tidy_hook "$TIDY_CODEX_FORMAT_PAYLOAD") \
  || fail "tidy hook should not fail for Codex formatted apply_patch payload"
assert_hook_json "$TIDY_OUTPUT"
TIDY_CONTEXT=$(tidy_context "$TIDY_OUTPUT")
[ "$TIDY_CONTEXT" = "tidy-edited-file: $TIDY_CODEX_FORMAT_REL tidied" ] \
  || fail "Codex apply_patch tidy should report changed file, got: $TIDY_CONTEXT"
assert_not_contains "$TIDY_CONTEXT" "OK"

: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(TIDY_PINNED_PRETTIER_FAIL=1 run_tidy_hook "$(tidy_payload_for_file "$TIDY_MD_REL")") \
  || fail "tidy hook should not fail when prettier fails"
assert_hook_json "$TIDY_OUTPUT"
TIDY_CONTEXT=$(tidy_context "$TIDY_OUTPUT")
assert_contains "$TIDY_CONTEXT" "$TIDY_MD_REL ERROR (non-blocking)"
assert_contains "$TIDY_CONTEXT" "prettier exited 7"
assert_contains "$TIDY_CONTEXT" "prettier failed line"

: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(TIDY_PINNED_ESLINT_FAIL=1 run_tidy_hook "$(tidy_payload_for_file "$TIDY_TS_REL")") \
  || fail "tidy hook should not fail when eslint fails"
assert_hook_json "$TIDY_OUTPUT"
TIDY_CONTEXT=$(tidy_context "$TIDY_OUTPUT")
assert_contains "$TIDY_CONTEXT" "$TIDY_TS_REL ERROR (non-blocking)"
assert_contains "$TIDY_CONTEXT" "eslint exited 8"
assert_contains "$TIDY_CONTEXT" "truncated (60 lines total; last 30 lines)"
assert_contains "$TIDY_CONTEXT" "eslint line 31"
assert_contains "$TIDY_CONTEXT" "eslint line 60"
TIDY_ESLINT_LINE_COUNT=$(grep -c '^eslint line ' <<< "$TIDY_CONTEXT" || true)
[ "$TIDY_ESLINT_LINE_COUNT" = "30" ] \
  || fail "eslint output should be bounded to 30 lines: $TIDY_CONTEXT"
assert_not_contains "$TIDY_CONTEXT" "eslint line 01"
assert_not_contains "$TIDY_CONTEXT" "eslint line 30"

: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook '{"tool_name":"Edit","tool_input":{}}') \
  || fail "tidy hook should not fail when payload has no file path"
assert_hook_continue_json "$TIDY_OUTPUT"
[ ! -s "$TIDY_PINNED_LOG" ] || fail "no-path payload should not invoke pinned tools"

: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook 'not json') \
  || fail "tidy hook should not fail for malformed JSON payload"
assert_hook_continue_json "$TIDY_OUTPUT"
[ ! -s "$TIDY_PINNED_LOG" ] || fail "malformed payload should not invoke pinned tools"

: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(SKIP_TIDY_HOOK=1 run_tidy_hook "$(tidy_payload_for_file "$TIDY_TS_REL")") \
  || fail "tidy hook should not fail when skipped"
assert_hook_json "$TIDY_OUTPUT"
assert_contains "$(tidy_context "$TIDY_OUTPUT")" "SKIP_TIDY_HOOK=1"
[ ! -s "$TIDY_PINNED_LOG" ] || fail "SKIP_TIDY_HOOK=1 should not invoke pinned tools"

# Residual warn-level eslint violations are surfaced (non-blocking) after a
# clean --fix pass, naming the rule and location so the agent does not discover
# them only at a gate.
TIDY_WARN_TS="$TIDY_REPO_TMP/src/has-warning.ts"
TIDY_WARN_TS_REL=$(tidy_relative_path "$TIDY_WARN_TS")
printf 'console.log("hi");\n' > "$TIDY_WARN_TS"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(TIDY_PINNED_ESLINT_WARNINGS=1 run_tidy_hook "$(tidy_payload_for_file "$TIDY_WARN_TS_REL")") \
  || fail "tidy hook should not fail when surfacing eslint warnings"
assert_hook_json "$TIDY_OUTPUT"
TIDY_CONTEXT=$(tidy_context "$TIDY_OUTPUT")
assert_contains "$TIDY_CONTEXT" "$TIDY_WARN_TS_REL has 1 eslint warning(s)"
assert_contains "$TIDY_CONTEXT" 'these block `bun run lint`'
assert_contains "$TIDY_CONTEXT" "no-console at 3:5"
assert_contains "$(cat "$TIDY_PINNED_LOG")" $'eslint\t-f\tjson\t--no-warn-ignored'

# No residual warnings -> no advisory line (the json pass still runs).
TIDY_NOWARN_TS="$TIDY_REPO_TMP/src/no-warning.ts"
TIDY_NOWARN_TS_REL=$(tidy_relative_path "$TIDY_NOWARN_TS")
printf 'const ok = 1;\n' > "$TIDY_NOWARN_TS"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file "$TIDY_NOWARN_TS_REL")") \
  || fail "tidy hook should not fail for a warning-free file"
assert_hook_continue_json "$TIDY_OUTPUT"
assert_not_contains "$(tidy_context "$TIDY_OUTPUT")" "eslint warning(s)"
assert_contains "$(cat "$TIDY_PINNED_LOG")" $'eslint\t-f\tjson\t--no-warn-ignored'

# --- lint-coverage-check hook ------------------------------------------------
rm -rf "$LINT_COVERAGE_REPO_TMP"
mkdir -p "$LINT_COVERAGE_REPO_TMP/scripts/ai-hooks" "$LINT_COVERAGE_REPO_TMP/src/ratcheted" "$LINT_COVERAGE_REPO_TMP/node_modules/.bin"
# Copy the production dependency set the hook now sources (cache.sh ->
# output-filter.sh + verify-metadata.sh, plus the new throttle helper) so the
# fixture matches production wiring rather than stubbing the chain out.
cp "$REPO_ROOT/scripts/ai-hooks/common.sh" \
  "$REPO_ROOT/scripts/ai-hooks/cache.sh" \
  "$REPO_ROOT/scripts/ai-hooks/output-filter.sh" \
  "$REPO_ROOT/scripts/ai-hooks/edited-paths.sh" \
  "$REPO_ROOT/scripts/ai-hooks/lint-coverage-state.sh" \
  "$REPO_ROOT/scripts/ai-hooks/lint-coverage-check.sh" \
  "$LINT_COVERAGE_REPO_TMP/scripts/ai-hooks/"
cp "$REPO_ROOT/scripts/verify-metadata.sh" "$LINT_COVERAGE_REPO_TMP/scripts/"
git -C "$LINT_COVERAGE_REPO_TMP" init -q
HOOK_FIXTURE_REPO_ROOT="$LINT_COVERAGE_REPO_TMP"
LINT_COVERAGE_PINNED_LOG="$TMP_ROOT/lint-coverage-pinned.log"
# Dedicated, fresh throttle/cache state so lint-coverage runs never touch the
# shared /tmp root and each throttle sub-test starts from a known state.
LINT_COVERAGE_STATE_DIR="$TMP_ROOT/lint-coverage-state"
LINT_COVERAGE_CACHE_STATE="$TMP_ROOT/lint-coverage-cache"
cat > "$LINT_COVERAGE_REPO_TMP/lint-ratchet.baseline.json" <<'JSON'
{
  "version": 1,
  "tests": {
    "ratchet/fixture": {
      "ruleId": "fixture/rule",
      "mode": "no-new",
      "target": 0,
      "metric": "message-count",
      "files": [
        "src/ratcheted/**/*.ts"
      ],
      "ignores": [
        "src/ratcheted/**/*.test.ts"
      ],
      "ruleOptions": [],
      "configHash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "ruleSourceHash": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "items": {}
    }
  }
}
JSON
cat > "$LINT_COVERAGE_REPO_TMP/node_modules/.bin/eslint" <<'EOF'
#!/bin/bash
set -u

printf 'eslint' >> "$LINT_COVERAGE_PINNED_LOG"
for arg in "$@"; do
  printf '\t%s' "$arg" >> "$LINT_COVERAGE_PINNED_LOG"
done
printf '\n' >> "$LINT_COVERAGE_PINNED_LOG"

target=""
for arg in "$@"; do
  target="$arg"
done

case "$target" in
  *uncovered*)
    printf 'undefined\n'
    ;;
  *)
    printf '{"rules":{}}\n'
    ;;
esac
EOF
chmod +x "$LINT_COVERAGE_REPO_TMP/node_modules/.bin/eslint"

run_lint_coverage_hook() {
  local payload="$1"

  # Detection tests run with TTL=0 (always emit) so the throttle state machine
  # never changes their expectations; throttle tests set AI_LINT_COVERAGE_TTL,
  # AI_LINT_COVERAGE_MAX_DETECTIONS, and AI_FAKE_NOW explicitly before calling.
  LINT_COVERAGE_PINNED_LOG="$LINT_COVERAGE_PINNED_LOG" \
    AI_STATE_ROOT="$LINT_COVERAGE_CACHE_STATE" \
    AI_LINT_COVERAGE_STATE_DIR="$LINT_COVERAGE_STATE_DIR" \
    AI_BUN_LOG_DIR="$AI_BUN_LOG_DIR" \
    AI_PRECOMMIT_LOG_DIR="$AI_PRECOMMIT_LOG_DIR" \
    AI_LINT_COVERAGE_TTL="${AI_LINT_COVERAGE_TTL:-0}" \
    AI_LINT_COVERAGE_MAX_DETECTIONS="${AI_LINT_COVERAGE_MAX_DETECTIONS:-10}" \
    AI_FAKE_NOW="${AI_FAKE_NOW:-}" \
    bash "$LINT_COVERAGE_REPO_TMP/scripts/ai-hooks/lint-coverage-check.sh" <<< "$payload"
}

lint_coverage_payload_for_session() {
  local file="$1"
  local session="$2"

  jq -n --arg file "$file" --arg sid "$session" \
    '{session_id:$sid,tool_name:"Edit",tool_input:{file_path:$file}}'
}

lint_coverage_context() {
  jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$1"
}

LINT_COVERAGE_COVERED_TS="$LINT_COVERAGE_REPO_TMP/src/covered.ts"
LINT_COVERAGE_COVERED_TS_REL=$(tidy_relative_path "$LINT_COVERAGE_COVERED_TS")
printf 'const covered = 1;\n' > "$LINT_COVERAGE_COVERED_TS"
: > "$LINT_COVERAGE_PINNED_LOG"
LINT_COVERAGE_OUTPUT=$(run_lint_coverage_hook "$(tidy_payload_for_file "$LINT_COVERAGE_COVERED_TS_REL")") \
  || fail "lint coverage hook should not fail for covered Claude .ts payload"
assert_hook_continue_json "$LINT_COVERAGE_OUTPUT"
LINT_COVERAGE_EXPECTED_LOG=$(printf 'eslint\t--print-config\t%s' "$LINT_COVERAGE_COVERED_TS")
[ "$(cat "$LINT_COVERAGE_PINNED_LOG")" = "$LINT_COVERAGE_EXPECTED_LOG" ] \
  || fail "Claude lint coverage command log mismatch: $(cat "$LINT_COVERAGE_PINNED_LOG")"

LINT_COVERAGE_UNCOVERED_JSONC="$LINT_COVERAGE_REPO_TMP/src/uncovered.jsonc"
LINT_COVERAGE_UNCOVERED_JSONC_REL=$(tidy_relative_path "$LINT_COVERAGE_UNCOVERED_JSONC")
printf '{ "uncovered": true }\n' > "$LINT_COVERAGE_UNCOVERED_JSONC"
: > "$LINT_COVERAGE_PINNED_LOG"
LINT_COVERAGE_OUTPUT=$(run_lint_coverage_hook "$(tidy_payload_for_file "$LINT_COVERAGE_UNCOVERED_JSONC_REL")") \
  || fail "lint coverage hook should not fail for uncovered Claude .jsonc payload"
assert_hook_json "$LINT_COVERAGE_OUTPUT"
LINT_COVERAGE_CONTEXT=$(lint_coverage_context "$LINT_COVERAGE_OUTPUT")
assert_contains "$LINT_COVERAGE_CONTEXT" "NOT covered by ESLint at all"
assert_contains "$LINT_COVERAGE_CONTEXT" "  - $LINT_COVERAGE_UNCOVERED_JSONC_REL"
assert_contains "$LINT_COVERAGE_CONTEXT" "lint-coverage-map.md"
LINT_COVERAGE_EXPECTED_LOG=$(printf 'eslint\t--print-config\t%s' "$LINT_COVERAGE_UNCOVERED_JSONC")
[ "$(cat "$LINT_COVERAGE_PINNED_LOG")" = "$LINT_COVERAGE_EXPECTED_LOG" ] \
  || fail "Claude lint coverage JSONC command log mismatch: $(cat "$LINT_COVERAGE_PINNED_LOG")"

LINT_COVERAGE_RATCHETED_TS="$LINT_COVERAGE_REPO_TMP/src/ratcheted/uncovered-ratchet.ts"
LINT_COVERAGE_RATCHETED_TS_REL=$(tidy_relative_path "$LINT_COVERAGE_RATCHETED_TS")
printf 'const ratcheted = 1;\n' > "$LINT_COVERAGE_RATCHETED_TS"
: > "$LINT_COVERAGE_PINNED_LOG"
LINT_COVERAGE_OUTPUT=$(run_lint_coverage_hook "$(tidy_payload_for_file "$LINT_COVERAGE_RATCHETED_TS_REL")") \
  || fail "lint coverage hook should not fail for ratchet-covered payload"
assert_hook_json "$LINT_COVERAGE_OUTPUT"
LINT_COVERAGE_CONTEXT=$(lint_coverage_context "$LINT_COVERAGE_OUTPUT")
assert_contains "$LINT_COVERAGE_CONTEXT" "covered only by lint:ratchet"
assert_contains "$LINT_COVERAGE_CONTEXT" "  - $LINT_COVERAGE_RATCHETED_TS_REL (fixture/rule)"
assert_contains "$LINT_COVERAGE_CONTEXT" "accepted floor, not an error"
assert_not_contains "$LINT_COVERAGE_CONTEXT" "NOT covered by ESLint at all"
LINT_COVERAGE_EXPECTED_LOG=$(printf 'eslint\t--print-config\t%s' "$LINT_COVERAGE_RATCHETED_TS")
[ "$(cat "$LINT_COVERAGE_PINNED_LOG")" = "$LINT_COVERAGE_EXPECTED_LOG" ] \
  || fail "Claude lint coverage ratcheted command log mismatch: $(cat "$LINT_COVERAGE_PINNED_LOG")"

LINT_COVERAGE_RATCHET_IGNORED_TS="$LINT_COVERAGE_REPO_TMP/src/ratcheted/uncovered-ratchet.test.ts"
LINT_COVERAGE_RATCHET_IGNORED_TS_REL=$(tidy_relative_path "$LINT_COVERAGE_RATCHET_IGNORED_TS")
printf 'const ratchetIgnored = 1;\n' > "$LINT_COVERAGE_RATCHET_IGNORED_TS"
: > "$LINT_COVERAGE_PINNED_LOG"
LINT_COVERAGE_OUTPUT=$(run_lint_coverage_hook "$(tidy_payload_for_file "$LINT_COVERAGE_RATCHET_IGNORED_TS_REL")") \
  || fail "lint coverage hook should not fail for ratchet-ignored uncovered payload"
assert_hook_json "$LINT_COVERAGE_OUTPUT"
LINT_COVERAGE_CONTEXT=$(lint_coverage_context "$LINT_COVERAGE_OUTPUT")
assert_contains "$LINT_COVERAGE_CONTEXT" "NOT covered by ESLint at all"
assert_contains "$LINT_COVERAGE_CONTEXT" "  - $LINT_COVERAGE_RATCHET_IGNORED_TS_REL"
LINT_COVERAGE_EXPECTED_LOG=$(printf 'eslint\t--print-config\t%s' "$LINT_COVERAGE_RATCHET_IGNORED_TS")
[ "$(cat "$LINT_COVERAGE_PINNED_LOG")" = "$LINT_COVERAGE_EXPECTED_LOG" ] \
  || fail "Claude lint coverage ratchet-ignored command log mismatch: $(cat "$LINT_COVERAGE_PINNED_LOG")"

LINT_COVERAGE_MD="$LINT_COVERAGE_REPO_TMP/src/note.md"
LINT_COVERAGE_MD_REL=$(tidy_relative_path "$LINT_COVERAGE_MD")
printf '# note\n' > "$LINT_COVERAGE_MD"
: > "$LINT_COVERAGE_PINNED_LOG"
LINT_COVERAGE_OUTPUT=$(run_lint_coverage_hook "$(tidy_payload_for_file "$LINT_COVERAGE_MD_REL")") \
  || fail "lint coverage hook should not fail for non-lintable payload"
assert_hook_continue_json "$LINT_COVERAGE_OUTPUT"
[ ! -s "$LINT_COVERAGE_PINNED_LOG" ] || fail "non-lintable file should not invoke pinned tools"

LINT_COVERAGE_CODEX_UNCOVERED_TS="$LINT_COVERAGE_REPO_TMP/src/codex-uncovered.ts"
LINT_COVERAGE_CODEX_COVERED_JSON="$LINT_COVERAGE_REPO_TMP/src/codex-covered.json"
LINT_COVERAGE_CODEX_RATCHETED_TS="$LINT_COVERAGE_REPO_TMP/src/ratcheted/codex-uncovered-ratchet.ts"
LINT_COVERAGE_CODEX_MISSING="$LINT_COVERAGE_REPO_TMP/src/codex-missing.ts"
printf 'const uncovered = 1;\n' > "$LINT_COVERAGE_CODEX_UNCOVERED_TS"
printf '{ "covered": true }\n' > "$LINT_COVERAGE_CODEX_COVERED_JSON"
printf 'const ratcheted = 1;\n' > "$LINT_COVERAGE_CODEX_RATCHETED_TS"
LINT_COVERAGE_CODEX_UNCOVERED_TS_REL=$(tidy_relative_path "$LINT_COVERAGE_CODEX_UNCOVERED_TS")
LINT_COVERAGE_CODEX_COVERED_JSON_REL=$(tidy_relative_path "$LINT_COVERAGE_CODEX_COVERED_JSON")
LINT_COVERAGE_CODEX_RATCHETED_TS_REL=$(tidy_relative_path "$LINT_COVERAGE_CODEX_RATCHETED_TS")
LINT_COVERAGE_CODEX_MISSING_REL=$(tidy_relative_path "$LINT_COVERAGE_CODEX_MISSING")
LINT_COVERAGE_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  "*** Add File: $LINT_COVERAGE_CODEX_UNCOVERED_TS_REL" \
  '+const uncovered = 1;' \
  "*** Update File: $LINT_COVERAGE_CODEX_COVERED_JSON_REL" \
  '@@' \
  '-{ "covered": false }' \
  '+{ "covered": true }' \
  "*** Update File: $LINT_COVERAGE_CODEX_RATCHETED_TS_REL" \
  '@@' \
  '-const ratcheted = 0;' \
  '+const ratcheted = 1;' \
  "*** Update File: $LINT_COVERAGE_CODEX_UNCOVERED_TS_REL" \
  '@@' \
  '-const uncovered = 0;' \
  '+const uncovered = 1;' \
  "*** Delete File: $LINT_COVERAGE_CODEX_MISSING_REL" \
  '*** End Patch')
LINT_COVERAGE_CODEX_PAYLOAD=$(jq -n --arg command "$LINT_COVERAGE_PATCH" --arg ignored "node_modules/ignored.ts" \
  '{tool_name:"apply_patch",tool_input:{file_path:$ignored,command:$command}}')
: > "$LINT_COVERAGE_PINNED_LOG"
LINT_COVERAGE_OUTPUT=$(run_lint_coverage_hook "$LINT_COVERAGE_CODEX_PAYLOAD") \
  || fail "lint coverage hook should not fail for Codex apply_patch payload"
assert_hook_json "$LINT_COVERAGE_OUTPUT"
LINT_COVERAGE_CONTEXT=$(lint_coverage_context "$LINT_COVERAGE_OUTPUT")
assert_contains "$LINT_COVERAGE_CONTEXT" "NOT covered by ESLint at all"
assert_contains "$LINT_COVERAGE_CONTEXT" "  - $LINT_COVERAGE_CODEX_UNCOVERED_TS_REL"
assert_not_contains "$LINT_COVERAGE_CONTEXT" "$LINT_COVERAGE_CODEX_COVERED_JSON_REL"
assert_contains "$LINT_COVERAGE_CONTEXT" "covered only by lint:ratchet"
assert_contains "$LINT_COVERAGE_CONTEXT" "  - $LINT_COVERAGE_CODEX_RATCHETED_TS_REL (fixture/rule)"
assert_not_contains "$LINT_COVERAGE_CONTEXT" "$LINT_COVERAGE_CODEX_MISSING_REL"
assert_not_contains "$LINT_COVERAGE_CONTEXT" "node_modules/ignored.ts"
LINT_COVERAGE_EXPECTED_LOG=$(printf 'eslint\t--print-config\t%s\neslint\t--print-config\t%s\neslint\t--print-config\t%s' "$LINT_COVERAGE_CODEX_UNCOVERED_TS" "$LINT_COVERAGE_CODEX_COVERED_JSON" "$LINT_COVERAGE_CODEX_RATCHETED_TS")
[ "$(cat "$LINT_COVERAGE_PINNED_LOG")" = "$LINT_COVERAGE_EXPECTED_LOG" ] \
  || fail "Codex lint coverage command log mismatch: $(cat "$LINT_COVERAGE_PINNED_LOG")"

# --- lint-coverage throttle state helpers ------------------------------------
LC_STATE_FILE="$TMP_ROOT/lint-coverage-state-unit"
LC_NOW=$(date +%s)
printf 'LAST_TS=%s\nLAST_COUNT=4\n' "$LC_NOW" > "$LC_STATE_FILE"
ai_lint_coverage_read_state "$LC_STATE_FILE" || fail "valid lint-coverage state should parse"
[ "$AI_LC_STATE_TS" = "$LC_NOW" ] || fail "lint-coverage state ts mismatch (got $AI_LC_STATE_TS)"
[ "$AI_LC_STATE_COUNT" = "4" ] || fail "lint-coverage state count mismatch (got $AI_LC_STATE_COUNT)"

assert_lc_state_read_fails "$LC_STATE_FILE" "LAST_TS=$LC_NOW"
assert_lc_state_read_fails "$LC_STATE_FILE" "LAST_COUNT=1"
assert_lc_state_read_fails "$LC_STATE_FILE" "LAST_TS=$LC_NOW
LAST_COUNT=1
LAST_BOGUS=2"
assert_lc_state_read_fails "$LC_STATE_FILE" "LAST_TS=not-a-time
LAST_COUNT=1"
assert_lc_state_read_fails "$LC_STATE_FILE" "LAST_TS=0
LAST_COUNT=1"
assert_lc_state_read_fails "$LC_STATE_FILE" "LAST_TS=-5
LAST_COUNT=1"
assert_lc_state_read_fails "$LC_STATE_FILE" "LAST_TS=$LC_NOW
LAST_COUNT=x"
assert_lc_state_read_fails "$LC_STATE_FILE" "LAST_TS=$LC_NOW
LAST_COUNT=-1"

# Invalid TTL / max-detection env values fall back to the documented defaults;
# valid values (including TTL=0, the always-emit escape hatch) pass through.
[ "$(AI_LINT_COVERAGE_TTL=abc; ai_lint_coverage_ttl)" = "1800" ] || fail "non-integer TTL should default"
[ "$(AI_LINT_COVERAGE_TTL=-5; ai_lint_coverage_ttl)" = "1800" ] || fail "negative TTL should default"
[ "$(AI_LINT_COVERAGE_TTL=0; ai_lint_coverage_ttl)" = "0" ] || fail "zero TTL should be allowed"
[ "$(AI_LINT_COVERAGE_TTL=60; ai_lint_coverage_ttl)" = "60" ] || fail "valid TTL should pass through"
[ "$(AI_LINT_COVERAGE_MAX_DETECTIONS=abc; ai_lint_coverage_max_detections)" = "10" ] || fail "non-integer max should default"
[ "$(AI_LINT_COVERAGE_MAX_DETECTIONS=0; ai_lint_coverage_max_detections)" = "10" ] || fail "zero max should default"
[ "$(AI_LINT_COVERAGE_MAX_DETECTIONS=-3; ai_lint_coverage_max_detections)" = "10" ] || fail "negative max should default"
[ "$(AI_LINT_COVERAGE_MAX_DETECTIONS=5; ai_lint_coverage_max_detections)" = "5" ] || fail "valid max should pass through"

# Suppress-branch write failure must fail toward emitting: a readable in-window
# state with counter room normally suppresses, but if persisting the bumped
# counter fails, the warning still emits rather than relying on a counter that
# can no longer advance. Mirrors the ai_write_bun_marker mv-failure pattern.
LC_WF_DIR="$TMP_ROOT/lint-coverage-writefail-state"
mkdir -p "$LC_WF_DIR"
LC_WF_FILE="$LC_WF_DIR/uncovered.writefail"
printf 'LAST_TS=900000\nLAST_COUNT=0\n' > "$LC_WF_FILE"
if (
  AI_LINT_COVERAGE_STATE_DIR="$LC_WF_DIR" AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 \
    ai_lint_coverage_should_emit uncovered writefail 900000
); then
  fail "readable in-window state with counter room should suppress when writes succeed"
fi
printf 'LAST_TS=900000\nLAST_COUNT=0\n' > "$LC_WF_FILE"
if (
  ai_lint_coverage_write_state() { return 1; }
  AI_LINT_COVERAGE_STATE_DIR="$LC_WF_DIR" AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 \
    ai_lint_coverage_should_emit uncovered writefail 900000
); then
  : # emitted: failed increment write correctly fell back to emitting
else
  fail "suppress-branch write failure should fail toward emitting"
fi

# --- lint-coverage throttle end-to-end ---------------------------------------
COMBINED_LC_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  "*** Update File: $LINT_COVERAGE_CODEX_UNCOVERED_TS_REL" \
  '@@' \
  '-const uncovered = 0;' \
  '+const uncovered = 1;' \
  "*** Update File: $LINT_COVERAGE_CODEX_RATCHETED_TS_REL" \
  '@@' \
  '-const ratcheted = 0;' \
  '+const ratcheted = 1;' \
  '*** End Patch')
combined_lc_payload_for_session() {
  jq -n --arg command "$COMBINED_LC_PATCH" --arg sid "$1" \
    '{session_id:$sid,tool_name:"apply_patch",tool_input:{command:$command}}'
}

# Same session: emit, suppress, suppress, re-emit on the MAX_DETECTIONS-th
# subsequent detection. now is pinned so age stays under TTL throughout.
rm -rf "$LINT_COVERAGE_STATE_DIR"
LC_PAYLOAD_A=$(lint_coverage_payload_for_session "$LINT_COVERAGE_UNCOVERED_JSONC_REL" "session-a")
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=3 AI_FAKE_NOW=100000 run_lint_coverage_hook "$LC_PAYLOAD_A")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=3 AI_FAKE_NOW=100000 run_lint_coverage_hook "$LC_PAYLOAD_A")
assert_hook_continue_json "$LC_OUT"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=3 AI_FAKE_NOW=100000 run_lint_coverage_hook "$LC_PAYLOAD_A")
assert_hook_continue_json "$LC_OUT"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=3 AI_FAKE_NOW=100000 run_lint_coverage_hook "$LC_PAYLOAD_A")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"

# TTL elapsed: a suppressed session re-emits once the clock advances past TTL.
rm -rf "$LINT_COVERAGE_STATE_DIR"
LC_PAYLOAD_TIME=$(lint_coverage_payload_for_session "$LINT_COVERAGE_UNCOVERED_JSONC_REL" "session-time")
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=200000 run_lint_coverage_hook "$LC_PAYLOAD_TIME")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=200000 run_lint_coverage_hook "$LC_PAYLOAD_TIME")
assert_hook_continue_json "$LC_OUT"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=201801 run_lint_coverage_hook "$LC_PAYLOAD_TIME")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"

# Backward clock jump re-emits and resets even with counter room under MAX: a
# negative age cannot be trusted, so the suppress path is skipped.
rm -rf "$LINT_COVERAGE_STATE_DIR"
LC_PAYLOAD_CLOCK=$(lint_coverage_payload_for_session "$LINT_COVERAGE_UNCOVERED_JSONC_REL" "session-clock")
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=900000 run_lint_coverage_hook "$LC_PAYLOAD_CLOCK")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=899900 run_lint_coverage_hook "$LC_PAYLOAD_CLOCK")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"

# Different session id: fresh state, re-emits even at the same instant.
LC_PAYLOAD_B=$(lint_coverage_payload_for_session "$LINT_COVERAGE_UNCOVERED_JSONC_REL" "session-b")
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=200000 run_lint_coverage_hook "$LC_PAYLOAD_B")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"

# No session id: first emits, second suppresses through the repo fallback key.
rm -rf "$LINT_COVERAGE_STATE_DIR"
LC_PAYLOAD_NOSESS=$(tidy_payload_for_file "$LINT_COVERAGE_UNCOVERED_JSONC_REL")
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=300000 run_lint_coverage_hook "$LC_PAYLOAD_NOSESS")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=300000 run_lint_coverage_hook "$LC_PAYLOAD_NOSESS")
assert_hook_continue_json "$LC_OUT"

# Tier independence: a tier (b) emit is not blocked by a prior tier (a) emit on
# the same session/instant — the two tiers keep separate counters.
rm -rf "$LINT_COVERAGE_STATE_DIR"
LC_PAYLOAD_RATCHET=$(lint_coverage_payload_for_session "$LINT_COVERAGE_RATCHETED_TS_REL" "session-tier")
LC_PAYLOAD_UNCOV=$(lint_coverage_payload_for_session "$LINT_COVERAGE_UNCOVERED_JSONC_REL" "session-tier")
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=2 AI_FAKE_NOW=400000 run_lint_coverage_hook "$LC_PAYLOAD_RATCHET")
assert_contains "$(lint_coverage_context "$LC_OUT")" "covered only by lint:ratchet"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=2 AI_FAKE_NOW=400000 run_lint_coverage_hook "$LC_PAYLOAD_UNCOV")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"

# Both tiers in one payload emit together in a single additional-context block.
rm -rf "$LINT_COVERAGE_STATE_DIR"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=2 AI_FAKE_NOW=500000 run_lint_coverage_hook "$(combined_lc_payload_for_session "session-both")")
LC_CONTEXT=$(lint_coverage_context "$LC_OUT")
assert_contains "$LC_CONTEXT" "covered only by lint:ratchet"
assert_contains "$LC_CONTEXT" "NOT covered by ESLint at all"

# When one tier is suppressed, a combined payload still emits the other tier.
# Drive the ratchet tier to a near-suppress state on its own, then a combined
# payload suppresses ratchet but emits the still-fresh uncovered tier.
rm -rf "$LINT_COVERAGE_STATE_DIR"
LC_PAYLOAD_RATCHET_MIX=$(lint_coverage_payload_for_session "$LINT_COVERAGE_CODEX_RATCHETED_TS_REL" "session-mix")
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=2 AI_FAKE_NOW=600000 run_lint_coverage_hook "$LC_PAYLOAD_RATCHET_MIX")
assert_contains "$(lint_coverage_context "$LC_OUT")" "covered only by lint:ratchet"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=2 AI_FAKE_NOW=600000 run_lint_coverage_hook "$(combined_lc_payload_for_session "session-mix")")
LC_CONTEXT=$(lint_coverage_context "$LC_OUT")
assert_contains "$LC_CONTEXT" "NOT covered by ESLint at all"
assert_not_contains "$LC_CONTEXT" "covered only by lint:ratchet"

# Garbage state file is treated as fresh and re-emits. With MAX=10 and a pinned
# clock a valid {count:0} state would suppress the second call, so the re-emit
# can only be the corrupt file failing the read.
rm -rf "$LINT_COVERAGE_STATE_DIR"
LC_PAYLOAD_GARBAGE=$(lint_coverage_payload_for_session "$LINT_COVERAGE_UNCOVERED_JSONC_REL" "session-garbage")
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=700000 run_lint_coverage_hook "$LC_PAYLOAD_GARBAGE")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"
LC_GARBAGE_STATE=$(find "$LINT_COVERAGE_STATE_DIR" -type f -name 'uncovered.*' | head -n 1)
[ -n "$LC_GARBAGE_STATE" ] || fail "expected an uncovered throttle state file after first emit"
printf 'not a valid state file\n' > "$LC_GARBAGE_STATE"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=700000 run_lint_coverage_hook "$LC_PAYLOAD_GARBAGE")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"

# Covered edits emit nothing and never create throttle state.
rm -rf "$LINT_COVERAGE_STATE_DIR"
LC_PAYLOAD_COVERED=$(lint_coverage_payload_for_session "$LINT_COVERAGE_COVERED_TS_REL" "session-covered")
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=800000 run_lint_coverage_hook "$LC_PAYLOAD_COVERED")
assert_hook_continue_json "$LC_OUT"
LC_STATE_FILE_COUNT=$(find "$LINT_COVERAGE_STATE_DIR" -type f | wc -l)
[ "$LC_STATE_FILE_COUNT" -eq 0 ] || fail "covered edit should not create throttle state"

# --- ai_lint_coverage_would_emit (read-only throttle probe) ------------------
# The ratchet-regression hook throttles BEFORE spending a lint, so the probe
# must answer "would this tier emit?" without writing state.
RR_WE_DIR="$TMP_ROOT/would-emit-state"
rm -rf "$RR_WE_DIR"
mkdir -p "$RR_WE_DIR"
( AI_LINT_COVERAGE_STATE_DIR="$RR_WE_DIR" AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 \
  ai_lint_coverage_would_emit ratchetreg:probe key-we 1000 ) \
  || fail "would_emit should emit for a fresh tier"
[ "$(find "$RR_WE_DIR" -type f | wc -l)" -eq 0 ] || fail "would_emit must not write state for a fresh tier"
printf 'LAST_TS=1000\nLAST_COUNT=0\n' > "$RR_WE_DIR/ratchetreg:probe.key-we"
if ( AI_LINT_COVERAGE_STATE_DIR="$RR_WE_DIR" AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 \
     ai_lint_coverage_would_emit ratchetreg:probe key-we 1000 ); then
  fail "would_emit should suppress an in-window tier with counter room"
fi
( AI_LINT_COVERAGE_STATE_DIR="$RR_WE_DIR" AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 \
  ai_lint_coverage_would_emit ratchetreg:probe key-we 999999 ) \
  || fail "would_emit should emit once age passes TTL"
grep -qF "LAST_COUNT=0" "$RR_WE_DIR/ratchetreg:probe.key-we" \
  || fail "would_emit must not mutate throttle state"

# --- ratchet-regression-check hook -------------------------------------------
# The hook is exercised with a fake `bun` on PATH that emits canned discovery /
# edit-check rows and logs every invocation. This isolates the hook's bash logic
# (path extraction, caps, content cache, throttle-before-lint, advisory output)
# from the real ratchet engine, which is covered by scripts/test-lint-ratchet.sh.
RR_REPO="$TMP_ROOT/ratchet-regression-repo"
RR_FAKE_BIN="$TMP_ROOT/ratchet-regression-bin"
RR_BUN_LOG="$TMP_ROOT/ratchet-regression-bun.log"
RR_STATE_ROOT="$TMP_ROOT/ratchet-regression-state"
rm -rf "$RR_REPO" "$RR_FAKE_BIN" "$RR_STATE_ROOT"
mkdir -p "$RR_REPO/scripts/ai-hooks" "$RR_REPO/src" "$RR_FAKE_BIN"
cp "$REPO_ROOT/scripts/ai-hooks/common.sh" \
  "$REPO_ROOT/scripts/ai-hooks/edited-paths.sh" \
  "$REPO_ROOT/scripts/ai-hooks/cache.sh" \
  "$REPO_ROOT/scripts/ai-hooks/output-filter.sh" \
  "$REPO_ROOT/scripts/ai-hooks/lint-coverage-state.sh" \
  "$REPO_ROOT/scripts/ai-hooks/ratchet-regression-check.sh" \
  "$RR_REPO/scripts/ai-hooks/"
cp "$REPO_ROOT/scripts/verify-metadata.sh" "$RR_REPO/scripts/"
git -C "$RR_REPO" init -q

cat > "$RR_FAKE_BIN/bun" <<'EOF'
#!/bin/bash
set -u
{
  printf 'bun'
  for arg in "$@"; do printf '\t%s' "$arg"; done
  printf '\n'
} >> "$RR_BUN_LOG"

mode=""
for arg in "$@"; do
  case "$arg" in
    --edit-check-targets) mode="targets" ;;
    --edit-check) mode="check" ;;
  esac
done

if [ "$mode" = "targets" ]; then
  [ "${RR_BUN_FAIL:-0}" = "1" ] && exit 3
  emit=0
  for arg in "$@"; do
    if [ "$arg" = "--edit-check-targets" ]; then emit=1; continue; fi
    [ "$emit" = "1" ] || continue
    printf 'target\t%s\tratchet/local-type-assertion-boundary\tlocal/type-assertion-boundary\n' "$arg"
  done
  exit 0
fi

if [ "$mode" = "check" ]; then
  { [ "${RR_BUN_FAIL:-0}" = "1" ] || [ "${RR_BUN_FAIL_CHECK:-0}" = "1" ]; } && exit 3
  tf=""
  prev=""
  for arg in "$@"; do
    [ "$prev" = "--targets-file" ] && tf="$arg"
    prev="$arg"
  done
  [ -n "$tf" ] && [ -f "$tf" ] || exit 0
  while IFS=$'\t' read -r kind rel test rule; do
    [ "$kind" = "target" ] || continue
    printf 'checked\t%s\n' "$rel"
    [ "${RR_BUN_NO_REGRESSION:-0}" = "1" ] && continue
    if [ "${RR_BUN_EMPTY_LINE:-0}" = "1" ]; then
      printf 'regression\t%s\t%s\t%s\tnew-path\t\t0\t1\n' "$rel" "$test" "$rule"
    else
      printf 'regression\t%s\t%s\t%s\tnew-path\t1\t0\t1\n' "$rel" "$test" "$rule"
    fi
  done < "$tf"
  exit 0
fi
exit 0
EOF
chmod +x "$RR_FAKE_BIN/bun"

run_ratchet_regression_hook() {
  local payload="$1"
  RR_BUN_LOG="$RR_BUN_LOG" \
    RR_BUN_FAIL="${RR_BUN_FAIL:-0}" \
    RR_BUN_FAIL_CHECK="${RR_BUN_FAIL_CHECK:-0}" \
    RR_BUN_NO_REGRESSION="${RR_BUN_NO_REGRESSION:-0}" \
    RR_BUN_EMPTY_LINE="${RR_BUN_EMPTY_LINE:-0}" \
    AI_STATE_ROOT="$RR_STATE_ROOT" \
    AI_LINT_COVERAGE_STATE_DIR="$RR_STATE_ROOT/lint-coverage" \
    AI_RATCHET_REGRESSION_CONTENT_DIR="$RR_STATE_ROOT/content" \
    AI_BUN_LOG_DIR="$AI_BUN_LOG_DIR" \
    AI_PRECOMMIT_LOG_DIR="$AI_PRECOMMIT_LOG_DIR" \
    AI_RATCHET_REGRESSION_TTL="${AI_RATCHET_REGRESSION_TTL:-0}" \
    AI_RATCHET_REGRESSION_MAX="${AI_RATCHET_REGRESSION_MAX:-10}" \
    AI_RATCHET_REGRESSION_MAX_TARGETS="${AI_RATCHET_REGRESSION_MAX_TARGETS:-3}" \
    AI_FAKE_NOW="${AI_FAKE_NOW:-}" \
    PATH="$RR_FAKE_BIN:$PATH" \
    bash "$RR_REPO/scripts/ai-hooks/ratchet-regression-check.sh" <<< "$payload"
}

rr_context() {
  jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$1"
}

rr_edit_payload() {
  jq -n --arg file "$1" --arg sid "$2" \
    '{session_id:$sid,tool_name:"Edit",tool_input:{file_path:$file}}'
}

# (1) Claude Edit path extraction + advisory warning naming file:line, rule, reason.
printf 'const raw: unknown = {};\nexport const value = raw as { value: number };\n' > "$RR_REPO/src/foo.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(AI_FAKE_NOW=100000 run_ratchet_regression_hook "$(rr_edit_payload "src/foo.ts" "rr-1")") \
  || fail "ratchet-regression hook should not fail for a Claude Edit payload"
assert_hook_json "$RR_OUT"
RR_CTX=$(rr_context "$RR_OUT")
assert_contains "$RR_CTX" "lint-ratchet (WARNING)"
assert_contains "$RR_CTX" "src/foo.ts:1 (local/type-assertion-boundary — new-path)"
assert_contains "$RR_CTX" "Type-aware ratchets are not checked"
RR_DISCOVERY=$(grep -F -- '--edit-check-targets' "$RR_BUN_LOG" || true)
assert_contains "$RR_DISCOVERY" $'\tsrc/foo.ts'
grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG" \
  || fail "first run should invoke the lint step: $(cat "$RR_BUN_LOG")"

# (1b) A regression row with an empty `line` field must parse without shifting
# baselineCount into the location (the [P2] tab-IFS-collapse bug). The bullet
# shows the bare path, never path:<count>.
printf 'const el: unknown = {};\nexport const e = el as { value: number };\n' > "$RR_REPO/src/el.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(RR_BUN_EMPTY_LINE=1 AI_FAKE_NOW=110000 run_ratchet_regression_hook "$(rr_edit_payload "src/el.ts" "rr-el")") \
  || fail "ratchet-regression hook should not fail on an empty-line regression row"
RR_CTX=$(rr_context "$RR_OUT")
assert_contains "$RR_CTX" "src/el.ts (local/type-assertion-boundary — new-path)"
assert_not_contains "$RR_CTX" "src/el.ts:"

# (2) Codex apply_patch path extraction: Add/Update linted, Delete + node_modules skipped.
printf 'const added: unknown = {};\nexport const a = added as { value: number };\n' > "$RR_REPO/src/added.ts"
printf 'const updated: unknown = {};\nexport const u = updated as { value: number };\n' > "$RR_REPO/src/updated.ts"
RR_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  "*** Add File: src/added.ts" \
  '+const added: unknown = {};' \
  "*** Update File: src/updated.ts" \
  '@@' \
  '-old' \
  '+new' \
  "*** Delete File: src/gone.ts" \
  "*** Update File: node_modules/pkg/index.ts" \
  '@@' \
  '-x' \
  '+y' \
  '*** End Patch')
RR_CODEX_PAYLOAD=$(jq -n --arg command "$RR_PATCH" --arg sid "rr-codex" \
  '{session_id:$sid,tool_name:"apply_patch",tool_input:{command:$command}}')
: > "$RR_BUN_LOG"
RR_OUT=$(AI_FAKE_NOW=100000 run_ratchet_regression_hook "$RR_CODEX_PAYLOAD") \
  || fail "ratchet-regression hook should not fail for a Codex apply_patch payload"
RR_DISCOVERY=$(grep -F -- '--edit-check-targets' "$RR_BUN_LOG" || true)
assert_contains "$RR_DISCOVERY" $'\tsrc/added.ts'
assert_contains "$RR_DISCOVERY" $'\tsrc/updated.ts'
assert_not_contains "$RR_DISCOVERY" "src/gone.ts"
assert_not_contains "$RR_DISCOVERY" "node_modules/pkg/index.ts"

# (3) A deleted/missing edited file is skipped before any engine call.
: > "$RR_BUN_LOG"
RR_OUT=$(AI_FAKE_NOW=100000 run_ratchet_regression_hook "$(rr_edit_payload "src/never-existed.ts" "rr-del")") \
  || fail "ratchet-regression hook should not fail for a missing file"
assert_hook_continue_json "$RR_OUT"
[ ! -s "$RR_BUN_LOG" ] || fail "missing file should not invoke the ratchet engine: $(cat "$RR_BUN_LOG")"

# (4) Content-identical re-saves skip ESLint entirely. TTL=0 disables throttle
# suppression, so a skipped second lint can only be the content-hash cache.
printf 'const cc: unknown = {};\nexport const c = cc as { value: number };\n' > "$RR_REPO/src/cc.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(AI_RATCHET_REGRESSION_TTL=0 AI_FAKE_NOW=200000 run_ratchet_regression_hook "$(rr_edit_payload "src/cc.ts" "rr-cc")") \
  || fail "ratchet-regression content-cache first run failed"
assert_contains "$(rr_context "$RR_OUT")" "src/cc.ts:1"
grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG" \
  || fail "first content-cache run should lint (invoke --edit-check): $(cat "$RR_BUN_LOG")"
: > "$RR_BUN_LOG"
RR_OUT=$(AI_RATCHET_REGRESSION_TTL=0 AI_FAKE_NOW=200000 run_ratchet_regression_hook "$(rr_edit_payload "src/cc.ts" "rr-cc")") \
  || fail "ratchet-regression content-cache second run failed"
assert_hook_continue_json "$RR_OUT"
grep -qF -- "--edit-check-targets" "$RR_BUN_LOG" || fail "second run should still run discovery"
if grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG"; then
  fail "content-identical re-save must skip the lint step: $(cat "$RR_BUN_LOG")"
fi

# (5) Throttle-before-lint: after warning once, a CHANGED re-save of the same
# (file,rule) within TTL is dropped before the lint step (content cache misses,
# so the suppression is the per-(file,rule) throttle).
printf 'const th: unknown = {};\nexport const t = th as { value: number };\n' > "$RR_REPO/src/th.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(AI_RATCHET_REGRESSION_TTL=1800 AI_FAKE_NOW=300000 run_ratchet_regression_hook "$(rr_edit_payload "src/th.ts" "rr-th")") \
  || fail "ratchet-regression throttle first run failed"
assert_contains "$(rr_context "$RR_OUT")" "src/th.ts:1"
printf 'const th2: unknown = {};\nexport const t2 = th2 as { value: number };\n// changed\n' > "$RR_REPO/src/th.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(AI_RATCHET_REGRESSION_TTL=1800 AI_FAKE_NOW=300000 run_ratchet_regression_hook "$(rr_edit_payload "src/th.ts" "rr-th")") \
  || fail "ratchet-regression throttle second run failed"
assert_hook_continue_json "$RR_OUT"
if grep -qE -- '--edit-check($|[^-])' "$RR_BUN_LOG"; then
  fail "a throttle-suppressed target must be dropped before the lint step: $(cat "$RR_BUN_LOG")"
fi

# (6) Per-file/per-rule tiering: a different file still warns while src/th.ts is
# suppressed in the same session/instant.
printf 'const ot: unknown = {};\nexport const o = ot as { value: number };\n' > "$RR_REPO/src/other.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(AI_RATCHET_REGRESSION_TTL=1800 AI_FAKE_NOW=300000 run_ratchet_regression_hook "$(rr_edit_payload "src/other.ts" "rr-th")") \
  || fail "ratchet-regression per-file run failed"
assert_contains "$(rr_context "$RR_OUT")" "src/other.ts:1 (local/type-assertion-boundary — new-path)"

# (7) Advisory and exit-0 on engine failure (both discovery and lint failures).
printf 'const cf: unknown = {};\nexport const f = cf as { value: number };\n' > "$RR_REPO/src/cf.ts"
: > "$RR_BUN_LOG"
RR_OUT=$(RR_BUN_FAIL=1 AI_FAKE_NOW=400000 run_ratchet_regression_hook "$(rr_edit_payload "src/cf.ts" "rr-cf")") \
  || fail "ratchet-regression hook must exit 0 when discovery fails"
assert_hook_continue_json "$RR_OUT"
: > "$RR_BUN_LOG"
RR_OUT=$(RR_BUN_FAIL_CHECK=1 AI_FAKE_NOW=400001 run_ratchet_regression_hook "$(rr_edit_payload "src/cf.ts" "rr-cf2")") \
  || fail "ratchet-regression hook must exit 0 when the lint step fails"
assert_hook_continue_json "$RR_OUT"

# (8) The .no-edit-lint kill switch disables the hook before any engine call.
touch "$RR_REPO/.no-edit-lint"
: > "$RR_BUN_LOG"
RR_OUT=$(AI_FAKE_NOW=500000 run_ratchet_regression_hook "$(rr_edit_payload "src/foo.ts" "rr-kill")") \
  || fail "ratchet-regression hook should not fail with the kill switch present"
assert_hook_continue_json "$RR_OUT"
[ ! -s "$RR_BUN_LOG" ] || fail "kill switch should skip the engine entirely: $(cat "$RR_BUN_LOG")"
rm -f "$RR_REPO/.no-edit-lint"

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
assert_wrapped_bun "bun run format:changed:check"
assert_wrapped_bun "bun run build --silent"
assert_wrapped_bun "bun run code:intel -- exports packages/shared/src/constants.ts"
assert_wrapped_bun "bun run verify"
assert_wrapped_bun "bun run verify:changed"
assert_wrapped_bun "bun run verify:slow"
assert_wrapped_bun "bun run verify:logs budget"
assert_wrapped_bun "bun run verify:async:status"
assert_wrapped_bun "bun run verify:async:tail"
assert_wrapped_bun "bun run verify:async:stop"

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
assert_contains "$BUN_HOOK_OUT" '"decision": "block"'
assert_contains "$BUN_HOOK_OUT" 'Waited 1s'
assert_contains "$BUN_HOOK_OUT" 'flock '"$BUN_HOOK_LOCK"' true && echo FREE'

ai_cache_init
[ -d "$AI_GIT_STATE_DIR" ] || fail "missing git state dir"
[ -d "$AI_BUN_STATE_DIR" ] || fail "missing bun state dir"
[ -d "$AI_STOP_STATE_DIR" ] || fail "missing stop state dir"
[ -d "$AI_BUN_LOG_DIR" ] || fail "missing bun log dir"
[ -d "$AI_PRECOMMIT_LOG_DIR" ] || fail "missing pre-commit log dir"

assert_response_combined_exit \
  '{"tool_response":{"raw":"plain command output","exit_code":0}}' \
  "plain command output" \
  "0"
assert_response_combined_exit \
  '{"tool_response":{"raw":"plain command output"}}' \
  "plain command output" \
  ""
assert_response_combined_exit \
  '{"tool_response":{"output":"stdout text","metadata":{"exit_code":7}}}' \
  "stdout text" \
  "7"
assert_response_combined_exit \
  '{"tool_response":{"raw":"completed text","status":"completed"}}' \
  "completed text" \
  ""

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

init_commit_timeout_status_repo() {
  local name="$1"
  local repo="$TMP_ROOT/commit-timeout-status-$name"

  mkdir -p "$repo"
  git init -b main "$repo" >/dev/null 2>&1 || fail "failed to init commit status repo"
  git -C "$repo" config user.email hooks@example.test
  git -C "$repo" config user.name "Hook Test"
  printf 'base\n' > "$repo/file.txt"
  git -C "$repo" add file.txt
  git -C "$repo" commit -qm "initial commit" || fail "failed to create initial commit status fixture"
  printf '%s' "$repo"
}

assert_commit_timeout_status_no_running_commit() {
  local repo lock head output rc

  repo=$(init_commit_timeout_status_repo "not-running")
  lock="$repo/precommit.lock"
  head=$(git -C "$repo" rev-parse HEAD)
  printf 'change\n' >> "$repo/file.txt"
  git -C "$repo" add file.txt

  if output=$(cd "$repo" && MUSI_COMMIT_STATUS_LOCK="$lock" bash "$REPO_ROOT/scripts/ai-hooks/commit-timeout-status.sh" "$head" 1); then
    rc=0
  else
    rc=$?
  fi

  [ "$rc" -eq 1 ] || fail "commit status helper should exit 1 when no commit is running or landed: $output"
  assert_contains "$output" "No commit has landed, and the pre-commit lock is not held."
  assert_contains "$output" "Retry the original git commit command"
}

assert_commit_timeout_status_waits_for_landing_commit() {
  local repo lock head output holder commit_pid

  repo=$(init_commit_timeout_status_repo "landing")
  lock="$repo/precommit.lock"
  head=$(git -C "$repo" rev-parse HEAD)
  printf 'change\n' >> "$repo/file.txt"
  git -C "$repo" add file.txt

  (
    exec 8<>"$lock"
    flock -n 8 || exit 1
    printf 'PID=fixture STARTED=now\n' > "$lock"
    sleep 1
  ) &
  holder=$!
  sleep 0.1
  (
    sleep 0.2
    git -C "$repo" commit -qm "delayed commit"
  ) &
  commit_pid=$!

  output=$(cd "$repo" && MUSI_COMMIT_STATUS_LOCK="$lock" bash "$REPO_ROOT/scripts/ai-hooks/commit-timeout-status.sh" "$head" 5) \
    || fail "commit status helper should report delayed commit success: $output"
  wait "$holder" 2>/dev/null || true
  wait "$commit_pid" 2>/dev/null || fail "delayed commit fixture failed"

  assert_contains "$output" "A commit/pre-commit process still appears to be running"
  assert_contains "$output" "Commit finished: HEAD moved"
  assert_contains "$output" "delayed commit"
}

assert_commit_timeout_status_retries_when_still_running() {
  local repo lock head output rc holder

  repo=$(init_commit_timeout_status_repo "still-running")
  lock="$repo/precommit.lock"
  head=$(git -C "$repo" rev-parse HEAD)

  (
    exec 8<>"$lock"
    flock -n 8 || exit 1
    printf 'PID=fixture STARTED=now\n' > "$lock"
    sleep 3
  ) &
  holder=$!
  sleep 0.1

  if output=$(cd "$repo" && MUSI_COMMIT_STATUS_LOCK="$lock" bash "$REPO_ROOT/scripts/ai-hooks/commit-timeout-status.sh" "$head" 1); then
    rc=0
  else
    rc=$?
  fi
  kill "$holder" 2>/dev/null || true
  wait "$holder" 2>/dev/null || true

  [ "$rc" -eq 2 ] || fail "commit status helper should exit 2 when lock remains held: $output"
  assert_contains "$output" "Commit still is not finished after waiting 1s"
  assert_contains "$output" "Try this status command again"
  assert_contains "$output" "commit-timeout-status.sh"
  assert_contains "$output" "$head"
}

assert_codex_git_commit_unknown_guidance() {
  local tool_id="codex-git-unknown"
  local cmd="git commit -m test"
  local state_file="$AI_GIT_STATE_DIR/$tool_id"
  local head payload codex_out reason

  head=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo none)
  {
    printf 'HEAD_BEFORE=%s\n' "$head"
    printf 'START_TS=%s\n' "$(date +%s)"
  } > "$state_file"

  payload=$(jq -n --arg id "$tool_id" --arg cmd "$cmd" \
    '{tool_use_id:$id, tool_input:{command:$cmd}, tool_response:{raw:""}}')
  codex_out=$(printf '%s' "$payload" \
    | AI_STATE_ROOT="$AI_STATE_ROOT" AI_PRECOMMIT_LOG_DIR="$AI_PRECOMMIT_LOG_DIR" bash "$REPO_ROOT/.codex/hooks/post-tool-use.sh")
  reason=$(printf '%s' "$codex_out" | jq -r '.reason // empty')

  [ "$(printf '%s' "$codex_out" | jq -r '.decision // empty')" = "block" ] \
    || fail "Codex post hook should block unknown commit output with guidance: $codex_out"
  assert_contains "$reason" "Commit status unknown."
  assert_contains "$reason" "may still be running and may still land the commit"
  assert_contains "$reason" "Do not retry git commit immediately"
  assert_contains "$reason" "Run this status command"
  assert_contains "$reason" "commit-timeout-status.sh"
  assert_contains "$reason" "240 seconds"
  assert_contains "$reason" "$head"
  assert_not_contains "$reason" "Monitor"
  [ ! -f "$state_file" ] || fail "Codex git state file should be removed after post hook"
}

assert_codex_git_commit_signal_guidance() {
  local tool_id="codex-git-signal"
  local cmd="git commit -m test"
  local state_file="$AI_GIT_STATE_DIR/$tool_id"
  local head payload codex_out reason

  head=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo none)
  {
    printf 'HEAD_BEFORE=%s\n' "$head"
    printf 'START_TS=%s\n' "$(date +%s)"
  } > "$state_file"

  payload=$(jq -n --arg id "$tool_id" --arg cmd "$cmd" \
    '{tool_use_id:$id, tool_input:{command:$cmd}, tool_response:{raw:"partial output", exit_code:124}}')
  codex_out=$(printf '%s' "$payload" \
    | AI_STATE_ROOT="$AI_STATE_ROOT" AI_PRECOMMIT_LOG_DIR="$AI_PRECOMMIT_LOG_DIR" bash "$REPO_ROOT/.codex/hooks/post-tool-use.sh")
  reason=$(printf '%s' "$codex_out" | jq -r '.reason // empty')

  [ "$(printf '%s' "$codex_out" | jq -r '.decision // empty')" = "block" ] \
    || fail "Codex post hook should block signal commit output with guidance: $codex_out"
  assert_contains "$reason" "Commit status unknown (exit 124)."
  assert_contains "$reason" "partial output"
  assert_contains "$reason" "may still be running and may still land the commit"
  assert_contains "$reason" "Do not retry git commit immediately"
  assert_contains "$reason" "Run this status command"
  assert_contains "$reason" "commit-timeout-status.sh"
  assert_not_contains "$reason" "Monitor"
}

assert_claude_git_commit_timeout_guidance() {
  local marker="54321"
  local hook_out reason pid args

  hook_out=$(
    printf '{"tool_input":{"command":"git commit --dry-run >/dev/null 2>&1; sleep %s; echo done >/dev/null"}}' "$marker" \
      | AI_GIT_COMMIT_LOCK="$TMP_ROOT/git-commit-lock" AI_GIT_COMMIT_TIMEOUT=1 bash "$REPO_ROOT/.claude/hooks/git-commit-quiet.sh"
  )
  while IFS= read -r pid; do
    args=$(ps -o args= -p "$pid" 2>/dev/null || true)
    [ "$args" = "sleep $marker" ] && kill "$pid" 2>/dev/null || true
  done < <(pgrep -x sleep 2>/dev/null || true)
  reason=$(printf '%s' "$hook_out" | jq -r '.reason // empty')

  [ "$(printf '%s' "$hook_out" | jq -r '.decision // empty')" = "block" ] \
    || fail "Claude git commit hook should block timeout with valid JSON: $hook_out"
  assert_contains "$reason" "git commit wrapper timed out"
  assert_contains "$reason" "may still be running and may still land the commit"
  assert_contains "$reason" "Do not retry git commit immediately"
  assert_contains "$reason" "Run this status command"
  assert_contains "$reason" "commit-timeout-status.sh"
  assert_contains "$reason" "240 seconds"
  assert_not_contains "$reason" "Monitor"
}

assert_claude_cache_bypass_rewrites_to_repo_root "bun run verify:logs budget" "verify_logs"
assert_claude_cache_bypass_rewrites_to_repo_root "bun run verify:async:status" "verify_async_status"
assert_claude_cache_bypass_rewrites_to_repo_root "bun run code:intel -- exports packages/shared/src/constants.ts" "code_intel"
assert_bun_cache_bypass_preserves_cached_marker "bun run verify:async:status" "verify_async_status"
assert_bun_cache_bypass_preserves_cached_marker "bun run verify:async:stop" "verify_async_stop"
assert_bun_cache_bypass_preserves_cached_marker "bun run code:intel -- exports packages/shared/src/constants.ts" "code_intel"
assert_codex_bun_post_success_is_non_blocking
assert_codex_bun_post_failure_keeps_bounded_block
assert_commit_timeout_status_no_running_commit
assert_commit_timeout_status_waits_for_landing_commit
assert_commit_timeout_status_retries_when_still_running
assert_codex_git_commit_unknown_guidance
assert_codex_git_commit_signal_guidance
assert_claude_git_commit_timeout_guidance

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

# Stale fingerprint: silent, no counter write — the cached failure no longer
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

# R5/F7: name the failing gate(s) from per-step meta so the agent can tell a
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

# ai_ratchet_failure_excerpt: render the state-aware report on a valid envelope,
# and degrade to the raw log tail with a note when the envelope is absent (ran
# crashed before emitting) or malformed (formatter exits non-zero) — so a config
# or runtime error cannot masquerade as a clean "0 findings" render.
RATCHET_FAILURE_LOG="$TMP_ROOT/ratchet-failure.log"
printf 'lint:ratchet crashed: boom\n' > "$RATCHET_FAILURE_LOG"

RATCHET_DIAG_VALID="$TMP_ROOT/ratchet-diagnostics-valid.json"
cat > "$RATCHET_DIAG_VALID" <<'JSON'
{
  "version": "1",
  "tool": "lint:ratchet",
  "findings": [
    {
      "control": "lint/local/no-debugger",
      "severity": "block",
      "path": "packages/server/src/regressed.ts",
      "line": 12,
      "ruleId": "no-debugger",
      "reason": "increased-count",
      "baselineCount": 0,
      "currentCount": 1,
      "why": "Ratchet regression for no-debugger.",
      "howToFix": "Reduce this file's no-debugger finding count.",
      "repairKind": "manual"
    }
  ],
  "summary": { "blocking": 1, "warning": 0, "info": 0, "byControl": { "lint/local/no-debugger": 1 } }
}
JSON
RATCHET_VALID_EXCERPT=$(ai_ratchet_failure_excerpt "$RATCHET_DIAG_VALID" "$RATCHET_FAILURE_LOG" 30)
assert_contains "$RATCHET_VALID_EXCERPT" "### Lint ratchet"
assert_contains "$RATCHET_VALID_EXCERPT" '#### `lint/local/no-debugger`'
assert_contains "$RATCHET_VALID_EXCERPT" 'bun run lint:ratchet:update -- --allow-worse --reason "<why>"'

RATCHET_PRECOMMIT_LOG_DIR="$TMP_ROOT/precommit-ratchet-summary"
mkdir -p "$RATCHET_PRECOMMIT_LOG_DIR"
cp "$RATCHET_DIAG_VALID" "$RATCHET_PRECOMMIT_LOG_DIR/ratchet-diagnostics.json"
cat > "$RATCHET_PRECOMMIT_LOG_DIR/ratchet.log" <<'EOF'
{
  "raw": "json tail should not be the preferred commit summary"
}
lint:ratchet FAIL — 1 current finding(s); 1 regression(s); 0 improvement(s); blocking=1 warning=0 info=0
EOF
RATCHET_PRECOMMIT_SUMMARY=$(
  ai_precommit_failure_summary \
    $'=== PRE-COMMIT FAILED (12s) ===\nPassed: lint typecheck\nFailed: ratchet' \
    "$RATCHET_PRECOMMIT_LOG_DIR"
)
assert_contains "$RATCHET_PRECOMMIT_SUMMARY" "### Lint ratchet"
assert_contains "$RATCHET_PRECOMMIT_SUMMARY" '#### `lint/local/no-debugger`'
assert_not_contains "$RATCHET_PRECOMMIT_SUMMARY" "json tail should not be the preferred commit summary"

RATCHET_MISSING_DIAG="$TMP_ROOT/ratchet-diagnostics-missing.json"
rm -f "$RATCHET_MISSING_DIAG"
RATCHET_MISSING_EXCERPT=$(ai_ratchet_failure_excerpt "$RATCHET_MISSING_DIAG" "$RATCHET_FAILURE_LOG" 30)
assert_contains "$RATCHET_MISSING_EXCERPT" "before producing a diagnostics envelope"
assert_contains "$RATCHET_MISSING_EXCERPT" "lint:ratchet crashed: boom"

RATCHET_DIAG_MALFORMED="$TMP_ROOT/ratchet-diagnostics-malformed.json"
printf 'this is not a valid diagnostics envelope\n' > "$RATCHET_DIAG_MALFORMED"
RATCHET_MALFORMED_EXCERPT=$(ai_ratchet_failure_excerpt "$RATCHET_DIAG_MALFORMED" "$RATCHET_FAILURE_LOG" 30)
assert_contains "$RATCHET_MALFORMED_EXCERPT" "report formatter failed"
assert_contains "$RATCHET_MALFORMED_EXCERPT" "lint:ratchet crashed: boom"

printf 'ai-hooks tests passed\n'
