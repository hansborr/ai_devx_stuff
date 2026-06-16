#!/bin/bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../tests/lib/test-git-env.sh
. "$SCRIPT_DIR/../tests/lib/test-git-env.sh"
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
trap 'rm -rf "$TMP_ROOT"' EXIT

AI_STATE_ROOT="$TMP_ROOT/state"
AI_PRECOMMIT_LOG_DIR="$TMP_ROOT/pre-commit-logs"
AI_GIT_STATE_DIR="$AI_STATE_ROOT/git"
mkdir -p "$AI_GIT_STATE_DIR" "$AI_PRECOMMIT_LOG_DIR"

NO_DIRECT_DB="$REPO_ROOT/.claude/hooks/no-direct-db.sh"
NO_DIRECT_DB_BODY="$REPO_ROOT/scripts/ai-hooks/no-direct-db.sh"
CODEX_PRE="$REPO_ROOT/.codex/hooks/pre-tool-use.sh"

# shellcheck source=test-support.sh
. "$SCRIPT_DIR/test-support.sh"

bash "$SCRIPT_DIR/check-wiring.sh" >/dev/null

NESTED_REPO="$TMP_ROOT/nested-repo"
mkdir -p "$NESTED_REPO"
git -C "$NESTED_REPO" init -q
if ! NESTED_SHIM_OUTPUT=$(
  cd "$NESTED_REPO"
  printf '{"tool_input":{"file_path":"notes.txt"}}' \
    | CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$REPO_ROOT/.claude/hooks/doc-length.sh"
); then
  fail "Claude shim failed when launched from nested git repo cwd"
fi
assert_hook_continue_json "$NESTED_SHIM_OUTPUT"

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
  "env FOO=bar git commit --amend" \
  "git -c commit.gpgsign=false commit --amend" \
  "git -c user.name=ci -c user.email=ci@x commit --amend -m fix" \
  "echo ok && git -c core.editor=true commit --amend" \
  "bash -lc 'git -c commit.gpgsign=false commit --amend'"
# `git commit -c <commit>` reuses a commit's message for a NEW commit — it is not
# an amend and must stay allowed (the widened amend regex must not false-match it).
assert_policy_allows_each \
  "git commit -c HEAD~1" \
  "git commit -c abc123 -m override" \
  "git -c commit.gpgsign=false commit -m normal" \
  "git -c user.name=ci commit -c HEAD~1"

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
ai_policy_is_soft_guidance "$AI_POLICY_GREP" \
  || fail "grep policy should be soft guidance"
for reason in "$AI_POLICY_DOCKER" "$AI_POLICY_GIT_REBASE" "$AI_POLICY_POSTGRES"; do
  if ai_policy_is_soft_guidance "$reason"; then
    fail "policy must stay a hard block: $reason"
  fi
done
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

claude_policy_out() {
  printf '%s' "$(jq -n --arg c "$1" '{tool_input:{command:$c}}')" | bash "$NO_DIRECT_DB"
}

no_direct_db_body_out() {
  printf '%s' "$(jq -n --arg c "$1" '{tool_input:{command:$c}}')" | bash "$NO_DIRECT_DB_BODY"
}

assert_claude_soft_grep_guidance() {
  local out rewritten stdout

  out=$(claude_policy_out "grep -r TODO .")
  assert_hook_json "$out"
  [ "$(jq -r '.hookSpecificOutput.permissionDecision' <<< "$out")" = "allow" ] \
    || fail "Claude grep should rewrite to a successful command: $out"
  [ "$(jq -r '.hookSpecificOutput.hookEventName' <<< "$out")" = "PreToolUse" ] \
    || fail "Claude grep rewrite missing PreToolUse event: $out"
  [ "$(jq -r '.decision // empty' <<< "$out")" = "" ] \
    || fail "soft guidance must not emit a hard-block decision: $out"
  rewritten=$(jq -r '.hookSpecificOutput.updatedInput.command' <<< "$out")
  stdout=$(bash -c "$rewritten") || fail "rewritten guidance command failed: $rewritten"
  [ "$stdout" = "$AI_POLICY_GREP" ] || fail "rewritten command stdout mismatch: [$stdout]"
}

assert_claude_hard_block() {
  local out reason

  out=$(claude_policy_out "$1")
  assert_hook_json "$out"
  [ "$(jq -r '.decision' <<< "$out")" = "block" ] || fail "expected block for [$1]: $out"
  reason=$(jq -r '.reason' <<< "$out")
  [ "$reason" = "$2" ] || fail "block reason should match policy reason for [$1]: $out"
  [ "$(jq -r '.hookSpecificOutput // empty' <<< "$out")" = "" ] \
    || fail "hard block must not rewrite [$1]: $out"
}

assert_codex_grep_still_blocks() {
  local out

  out=$(printf '%s' "$(jq -n '{tool_input:{command:"grep -r TODO ."}}')" \
    | AI_STATE_ROOT="$AI_STATE_ROOT" \
      AI_BUN_LOG_DIR="$TMP_ROOT/codex-bun-logs" \
      AI_PRECOMMIT_LOG_DIR="$AI_PRECOMMIT_LOG_DIR" \
      bash "$CODEX_PRE")
  assert_hook_json "$out"
  [ "$(jq -r '.decision' <<< "$out")" = "block" ] || fail "Codex grep must stay a hard block: $out"
  [ "$(jq -r '.reason' <<< "$out")" = "$AI_POLICY_GREP" ] || fail "Codex grep reason mismatch: $out"
}

assert_codex_hard_block_unchanged() {
  local cmd="$1"
  local expected="$2"
  local out reason

  out=$(printf '%s' "$(jq -n --arg c "$cmd" '{tool_input:{command:$c}}')" \
    | AI_STATE_ROOT="$AI_STATE_ROOT" \
      AI_BUN_LOG_DIR="$TMP_ROOT/codex-bun-logs" \
      AI_PRECOMMIT_LOG_DIR="$AI_PRECOMMIT_LOG_DIR" \
      bash "$CODEX_PRE")
  assert_hook_json "$out"
  [ "$(jq -r '.decision' <<< "$out")" = "block" ] || fail "Codex must hard-block [$cmd]: $out"
  reason=$(jq -r '.reason' <<< "$out")
  [ "$reason" = "$expected" ] || fail "Codex block reason must be unchanged for [$cmd]: $out"
}

assert_no_direct_db_body_self_contained() {
  local out

  out=$(no_direct_db_body_out "docker ps")
  assert_hook_json "$out"
  [ "$(jq -r '.decision' <<< "$out")" = "block" ] || fail "body should block docker ps: $out"
  [ "$(jq -r '.reason' <<< "$out")" = "$AI_POLICY_DOCKER" ] || fail "body block reason mismatch: $out"

  out=$(no_direct_db_body_out "rg needle")
  assert_hook_continue_json "$out"
}

assert_no_direct_db_body_self_contained
assert_claude_soft_grep_guidance
assert_claude_hard_block "docker ps" "$AI_POLICY_DOCKER"
assert_claude_hard_block "docker ps; grep -r TODO ." "$AI_POLICY_DOCKER"
assert_claude_hard_block "git rebase main" "$AI_POLICY_GIT_REBASE"
assert_hook_continue_json "$(claude_policy_out 'rg needle')"
assert_hook_continue_json "$(claude_policy_out 'bun run test:changed')"
assert_codex_grep_still_blocks
assert_codex_hard_block_unchanged "docker ps" "$AI_POLICY_DOCKER"

PROTECTED_MSG=$(ai_protected_file_advisory "$REPO_ROOT/packages/server/prisma/schema.prisma")
assert_contains "$PROTECTED_MSG" "Create a migration"
if ai_protected_file_advisory "$REPO_ROOT/packages/server/src/main.ts" >/dev/null; then
  fail "unexpected protected-file advisory for unprotected file"
fi

AGENTS_DOC="$TMP_ROOT/AGENTS.md"
for _ in $(seq 1 251); do
  printf 'line\n' >> "$AGENTS_DOC"
done
DOC_MSG=$(ai_doc_length_advisory "$AGENTS_DOC")
assert_contains "$DOC_MSG" "doc-length advisory"
assert_contains "$DOC_MSG" "AGENTS.md is 251 lines"
assert_contains "$DOC_MSG" "budget: 250"
assert_contains "$DOC_MSG" "loaded into every agent session"
assert_not_contains "$DOC_MSG" "Trim it now"
assert_not_contains "$DOC_MSG" "threshold:"
[ "$(ai_doc_length_rule_surface "$AGENTS_DOC")" = "edit" ] \
  || fail "AGENTS.md should be an edit-surface doc-length rule"

HOOK_MSG=$(
  jq -n --arg path "$AGENTS_DOC" '{tool_input:{file_path:$path}}' \
    | CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$SCRIPT_DIR/doc-length.sh"
)
assert_hook_json "$HOOK_MSG"
[ "$(jq -r '.hookSpecificOutput.hookEventName // empty' <<< "$HOOK_MSG")" = "PostToolUse" ] \
  || fail "doc-length edit hook should emit PostToolUse context: $HOOK_MSG"
HOOK_CONTEXT=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$HOOK_MSG")
assert_contains "$HOOK_CONTEXT" "doc-length advisory"
assert_contains "$HOOK_CONTEXT" "AGENTS.md is 251 lines"

mkdir -p "$TMP_ROOT/docs/agent_notes/in_progress" "$TMP_ROOT/docs/agent_notes"
IN_PROGRESS_DOC="$TMP_ROOT/docs/agent_notes/in_progress/long.md"
for _ in $(seq 1 301); do
  printf 'line\n' >> "$IN_PROGRESS_DOC"
done
COUNT_MSG=$(ai_doc_length_advisory_for_count "$IN_PROGRESS_DOC" 301)
assert_contains "$COUNT_MSG" "doc-length advisory"
assert_contains "$COUNT_MSG" "long.md is 301 lines"
assert_contains "$COUNT_MSG" "budget: 300"
assert_contains "$COUNT_MSG" "in_progress notes can be long while work is active"
assert_not_contains "$COUNT_MSG" "Trim it now"
[ "$(ai_doc_length_rule_surface "$IN_PROGRESS_DOC")" = "commit" ] \
  || fail "in_progress docs should be commit-surface doc-length rules"

HOOK_MSG=$(
  jq -n --arg path "$IN_PROGRESS_DOC" '{tool_input:{file_path:$path}}' \
    | CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$SCRIPT_DIR/doc-length.sh"
)
assert_hook_continue_json "$HOOK_MSG"

SHORT_DOC="$TMP_ROOT/docs/agent_notes/README.md"
printf 'short\n' > "$SHORT_DOC"
if ai_doc_length_advisory "$SHORT_DOC" >/dev/null; then
  fail "unexpected doc-length advisory for short doc"
fi
if ai_doc_length_advisory_for_count "$SHORT_DOC" 1 >/dev/null; then
  fail "unexpected doc-length count advisory for short doc"
fi

# --- Codex apply_patch wiring -------------------------------------------------
# Extracted to a focused script so this adapter family can also run on its own
# (`bash scripts/ai-hooks/test-codex-wiring.sh`). Stdout is discarded so the
# aggregate keeps its single "ai-hooks tests passed" success line; any failure
# still exits non-zero and prints its FAIL reason on stderr.
bash "$SCRIPT_DIR/test-codex-wiring.sh" >/dev/null
# --- tidy-edited-file hook ---------------------------------------------------
# Extracted to a focused script so this behavior family can also run on its own
# (`bash scripts/ai-hooks/test-tidy.sh`). Stdout is discarded so the
# aggregate keeps its single "ai-hooks tests passed" success line; any failure
# still exits non-zero and prints its FAIL reason on stderr.
bash "$SCRIPT_DIR/test-tidy.sh" >/dev/null
# --- lint-coverage-check hook ------------------------------------------------
# Extracted to a focused script so this behavior family can also run on its own
# (`bash scripts/ai-hooks/test-lint-coverage.sh`). Stdout is discarded so the
# aggregate keeps its single "ai-hooks tests passed" success line; any failure
# still exits non-zero and prints its FAIL reason on stderr.
bash "$SCRIPT_DIR/test-lint-coverage.sh" >/dev/null
# --- ratchet-regression-check hook -------------------------------------------
# Extracted to a focused script so this behavior family can also run on its own
# (`bash scripts/ai-hooks/test-ratchet-regression.sh`). Stdout is discarded so the
# aggregate keeps its single "ai-hooks tests passed" success line; any failure
# still exits non-zero and prints its FAIL reason on stderr.
bash "$SCRIPT_DIR/test-ratchet-regression.sh" >/dev/null
# --- cache hook behavior ------------------------------------------------------
# Extracted to a focused script so this behavior family can also run on its own
# (`bash scripts/ai-hooks/test-cache.sh`). Stdout is discarded so the aggregate
# keeps its single "ai-hooks tests passed" success line; any failure still exits
# non-zero and prints its FAIL reason on stderr.
bash "$SCRIPT_DIR/test-cache.sh" >/dev/null

OUTSIDE_HOOK_OUTPUT=$(
  cd /tmp
  printf '{"tool_input":{"file_path":"/tmp/not-schema.ts"}}' \
    | CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$REPO_ROOT/.claude/hooks/prisma-generate.sh"
)
[ "$OUTSIDE_HOOK_OUTPUT" = '{"continue":true}' ] || fail "Claude prisma hook failed outside repo cwd"

PRISMA_STATE_ROOT="$TMP_ROOT/prisma-state-root"
PRISMA_STATE_DIR="$TMP_ROOT/prisma-state-dir"
PRISMA_FAKE_BIN="$TMP_ROOT/prisma-fake-bin"
mkdir -p "$PRISMA_STATE_DIR" "$PRISMA_FAKE_BIN"
{
  printf '#!/bin/bash\n'
  printf 'printf "unexpected prisma generate invocation\\n" >&2\n'
  printf 'exit 99\n'
} > "$PRISMA_FAKE_BIN/bun"
chmod +x "$PRISMA_FAKE_BIN/bun"
{
  printf 'LAST_TS=%s\n' "$(date +%s)"
  printf 'LAST_HASH=%s\n' "$(sha256sum "$REPO_ROOT/packages/server/prisma/schema.prisma" | awk '{print $1}')"
} > "$PRISMA_STATE_DIR/last"
PRISMA_DEBOUNCE_OUTPUT=$(
  jq -n --arg path "$REPO_ROOT/packages/server/prisma/schema.prisma" '{tool_input:{file_path:$path}}' \
    | AI_STATE_ROOT="$PRISMA_STATE_ROOT" \
      AI_PRISMA_STATE_DIR="$PRISMA_STATE_DIR" \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" \
      PATH="$PRISMA_FAKE_BIN:$PATH" \
      bash "$REPO_ROOT/.claude/hooks/prisma-generate.sh"
)
assert_hook_continue_json "$PRISMA_DEBOUNCE_OUTPUT"
[ ! -e "$PRISMA_STATE_DIR/generate.log" ] \
  || fail "debounced prisma hook should not write a generate log"

assert_wrapped_bun "bun run lint"
assert_wrapped_bun "bun run lint:changed"
assert_wrapped_bun "bun run typecheck"
assert_wrapped_bun "bun run test:changed"
assert_wrapped_bun "bun run test:client"
assert_wrapped_bun "bun run test:client:split"
assert_wrapped_bun "bun run test:client:isolated"
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

assert_unwrapped_bun "bun run dev"
assert_unwrapped_bun "bun run db:status"
assert_unwrapped_bun "bun run test:watch"
assert_unwrapped_bun "bun run test:changed && echo next"
assert_unwrapped_bun "bun run verify:async"
assert_unwrapped_bun "bun run verify:async:changed"
assert_unwrapped_bun "bun run verify:async:slow"

BUN_HOOK="$REPO_ROOT/.claude/hooks/bun-run-quiet.sh"
BUN_HOOK_BODY="$REPO_ROOT/scripts/ai-hooks/bun-run-quiet.sh"
BUN_BODY_BG_OUT=$(
  cd /tmp
  printf '{"tool_input":{"command":"bun run verify:changed","run_in_background":true}}' \
    | bash "$BUN_HOOK_BODY"
)
assert_contains "$BUN_BODY_BG_OUT" '"decision": "block"'
assert_contains "$BUN_BODY_BG_OUT" 'must run in the foreground'
BUN_BODY_PASS_OUT=$(
  cd /tmp
  printf '{"tool_input":{"command":"bun run dev"}}' \
    | bash "$BUN_HOOK_BODY"
)
[ "$BUN_BODY_PASS_OUT" = '{"continue":true}' ] || fail "bun body passthrough failed: $BUN_BODY_PASS_OUT"

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

assert_git_commit_quiet_body_non_commit_passthrough() {
  local hook_out

  hook_out=$(
    printf '{"tool_input":{"command":"echo hi"}}' \
      | bash "$REPO_ROOT/scripts/ai-hooks/git-commit-quiet.sh"
  )

  assert_hook_continue_json "$hook_out"
}

# G1 regression: the git-commit-quiet hook *executes* the command via `bash -c`,
# so it must self-block a forbidden `git commit --amend` BEFORE running it.
# Otherwise the amend rewrites HEAD even though the agent is told it was blocked.
assert_git_commit_quiet_amend_blocked_pre_execution() {
  local ws_head_before hook_out reason ws_head_after lock

  # This hook hardcodes its own REPO_ROOT to the workspace (it `cd`s there before
  # `bash -c "$CMD"`), so an UN-guarded `git commit --amend` would rewrite the
  # WORKSPACE HEAD. The self-block must fire before that cd/exec. Asserting the
  # workspace HEAD is unchanged is the decisive proof: it is exactly the ref the
  # original bug rewrote. (Safe to assert now that the guard is in place.)
  ws_head_before=$(git -C "$REPO_ROOT" rev-parse HEAD)
  lock="$TMP_ROOT/git-commit-quiet-amend-lock"

  hook_out=$(
    printf '{"tool_input":{"command":"git commit --amend --no-edit"}}' \
      | AI_GIT_COMMIT_LOCK="$lock" \
        bash "$REPO_ROOT/scripts/ai-hooks/git-commit-quiet.sh"
  )
  ws_head_after=$(git -C "$REPO_ROOT" rev-parse HEAD)
  reason=$(printf '%s' "$hook_out" | jq -r '.reason // empty')

  [ "$(printf '%s' "$hook_out" | jq -r '.decision // empty')" = "block" ] \
    || fail "git-commit-quiet should block --amend before executing it: $hook_out"
  [ "$ws_head_after" = "$ws_head_before" ] \
    || fail "git-commit-quiet executed the --amend (workspace HEAD moved $ws_head_before -> $ws_head_after) despite blocking"
  # The block must NOT have taken the lock (it returns before the lock/exec).
  [ ! -s "$lock" ] \
    || fail "git-commit-quiet acquired the commit lock before self-blocking --amend"
  assert_contains "$reason" "amend"
  assert_contains "$reason" "did NOT run"
}

# The amend self-guard must NOT block legitimate `git commit` forms — overshoot
# here breaks every normal commit (this very workflow commits with `git commit
# -F` afterward). ai_preflight_or_block exits via ai_emit_block only on a hard
# policy violation, so a clean run prints nothing and returns 0. Each call runs
# in a subshell because ai_emit_block calls `exit`.
assert_preflight_allows() {
  local cmd="$1"
  local out

  out=$(ai_preflight_or_block "$cmd") \
    || fail "ai_preflight_or_block exited non-zero for allowed command [$cmd]"
  [ -z "$out" ] \
    || fail "ai_preflight_or_block unexpectedly blocked allowed command [$cmd]: $out"
}

assert_preflight_blocks() {
  local cmd="$1"
  local expected="$2"
  local out reason

  out=$(ai_preflight_or_block "$cmd")
  reason=$(printf '%s' "$out" | jq -r '.reason // empty' 2>/dev/null || true)
  [ "$(printf '%s' "$out" | jq -r '.decision // empty' 2>/dev/null)" = "block" ] \
    || fail "ai_preflight_or_block should block [$cmd], got: $out"
  [ "$reason" = "$expected" ] \
    || fail "ai_preflight_or_block reason mismatch for [$cmd]: $reason"
}

assert_git_commit_quiet_normal_commit_allowed_by_guard() {
  # Normal commits (and config-prefixed normal commits, and message-reuse `-c`)
  # must sail past the self-guard. The wrapper itself then runs them; the guard's
  # only job is not to false-block.
  assert_preflight_allows "git commit -m 'normal commit message'"
  assert_preflight_allows "git commit -F /tmp/commit-msg.txt"
  assert_preflight_allows "git commit -c HEAD~1"
  assert_preflight_allows "git -c commit.gpgsign=false commit -m normal"
  # Hard policy violations the executing hook could otherwise run are blocked
  # before exec — the adjacent-`git commit` amend form this hook actually runs.
  assert_preflight_blocks "git commit --amend --no-edit" "$AI_POLICY_GIT_AMEND"
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

assert_commit_timeout_status_no_running_commit
assert_commit_timeout_status_waits_for_landing_commit
assert_commit_timeout_status_retries_when_still_running
assert_codex_git_commit_unknown_guidance
assert_codex_git_commit_signal_guidance
assert_git_commit_quiet_body_non_commit_passthrough
assert_git_commit_quiet_amend_blocked_pre_execution
assert_git_commit_quiet_normal_commit_allowed_by_guard
assert_claude_git_commit_timeout_guidance

# --- stop-policy hook ---------------------------------------------------------
# Extracted to a focused script so this behavior family can also run on its own
# (`bash scripts/ai-hooks/test-stop-policy.sh`). Stdout is discarded so the
# aggregate keeps its single "ai-hooks tests passed" success line; any failure
# still exits non-zero and prints its FAIL reason on stderr.
bash "$SCRIPT_DIR/test-stop-policy.sh" >/dev/null

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
assert_contains "$SCRIPT_FAILURE_EXCERPT" "command: bash scripts/tests/test-verify-logs.sh"
assert_contains "$SCRIPT_FAILURE_EXCERPT" "test:scripts: test-verify-logs FAILED"

NON_SCRIPT_EXCERPT=$(ai_filtered_task_log_excerpt test "$SCRIPT_FAILURE_LOG" 30)
if grep -qF "command: bash scripts/tests/test-verify-logs.sh" <<< "$NON_SCRIPT_EXCERPT"; then
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
assert_contains "$MULTI_SCRIPT_EXCERPT" "command: bash scripts/tests/test-verify-logs.sh"
assert_contains "$MULTI_SCRIPT_EXCERPT" "command: bash scripts/tests/test-other-thing.sh"

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
assert_contains "$RATCHET_VALID_EXCERPT" 'bun run lint:ratchet:update -- --allow-worse --reason "<why accepting this baseline increase is better than forcing a low-quality fix now>"'

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
