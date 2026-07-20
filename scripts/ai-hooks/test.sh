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
. "$SCRIPT_DIR/failure-guidance.sh"
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

assert_policy_blocks_contains() {
  local cmd="$1"
  local expected="$2"
  local reason

  reason=$(ai_policy_violation_reason "$cmd" || true)
  [ -n "$reason" ] || fail "policy should block [$cmd]"
  assert_contains "$reason" "$expected"
}

assert_policy_allows() {
  local cmd="$1"

  if ai_policy_violation_reason "$cmd" >/dev/null; then
    fail "policy unexpectedly blocked [$cmd]"
  fi
}

assert_policy_advisory_contains() {
  local cmd="$1"
  local expected="$2"
  local advisory

  assert_policy_allows "$cmd"
  advisory=$(ai_policy_advisory_context "$cmd" || true)
  [ -n "$advisory" ] || fail "policy should advise for [$cmd]"
  assert_contains "$advisory" "$expected"
}

policy_only_probe() {
  local cmd="$1"
  local marker_state="$2"
  local out_file="$3"
  local err_file="$4"
  local marker="$REPO_ROOT/.allow-protected-edits"

  rm -f "$marker"
  if [ "$marker_state" = "marker-active" ]; then
    touch "$marker"
  fi

  bash -c '
    set -u
    script_dir=$1
    cmd=$2
    . "$script_dir/common.sh"
    . "$script_dir/policy.sh"
    reason=$(ai_policy_violation_reason "$cmd" || true)
    advisory=$(ai_policy_advisory_context "$cmd" || true)
    printf "reason=%s\n" "$reason"
    printf "advisory=%s\n" "$advisory"
  ' bash "$SCRIPT_DIR" "$cmd" >"$out_file" 2>"$err_file"
  rm -f "$marker"
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

claude_destructive_git_family() {
  local entry="$1"

  if [[ "$entry" == *" commit "* || "$entry" == *" commit"* ]]; then
    if [[ "$entry" == *"--amend"* ]]; then
      printf '%s\n' commit-amend
      return 0
    fi
    if [[ "$entry" == *"--no-verify"* ]]; then
      printf '%s\n' commit-hook-bypass
      return 0
    fi
  elif [[ "$entry" == *" push "* ]]; then
    if [[ "$entry" == *"--prune"* ]]; then
      printf '%s\n' push-prune
    elif [[ "$entry" == *"--delete"* || "$entry" == *" -d"* || "$entry" == *" :"* ]]; then
      printf '%s\n' push-delete
    else
      printf '%s\n' push-force
    fi
    return 0
  elif [[ "$entry" == *" reset "* ]]; then
    printf '%s\n' reset-ref-or-index
    return 0
  elif [[ "$entry" == *" clean "* ]]; then
    printf '%s\n' clean-force
    return 0
  elif [[ "$entry" == *" branch "* ]]; then
    if [[ "$entry" == *"--delete"* || "$entry" == *"-D"* || "$entry" == *"-df"* || "$entry" == *"-fd"* ]]; then
      printf '%s\n' branch-force-delete
    elif [ "$entry" = 'Bash(git branch *--force*)' ]; then
      printf '%s\n' branch-force-long
    elif [ "$entry" = 'Bash(git branch -f*)' ]; then
      printf '%s\n' branch-force-f-leading
    elif [ "$entry" = 'Bash(git branch * -f*)' ]; then
      printf '%s\n' branch-force-f-after
    elif [ "$entry" = 'Bash(git branch -M*)' ]; then
      printf '%s\n' branch-force-move-leading
    elif [ "$entry" = 'Bash(git branch * -M*)' ]; then
      printf '%s\n' branch-force-move-after
    elif [ "$entry" = 'Bash(git branch -C*)' ]; then
      printf '%s\n' branch-force-copy-leading
    elif [ "$entry" = 'Bash(git branch * -C*)' ]; then
      printf '%s\n' branch-force-copy-after
    else
      return 1
    fi
    return 0
  elif [[ "$entry" == *" tag "* ]]; then
    if [[ "$entry" == *"--delete"* || "$entry" == *" -d"* ]]; then
      printf '%s\n' tag-delete
    else
      printf '%s\n' tag-force-update
    fi
    return 0
  elif [[ "$entry" == *" worktree remove "* ]]; then
    printf '%s\n' worktree-force-remove
    return 0
  elif [[ "$entry" == *" checkout "* ]]; then
    if [[ "$entry" == *"--force"* || "$entry" == *" -f"* ]]; then
      printf '%s\n' checkout-force
    else
      printf '%s\n' checkout-path-discard
    fi
    return 0
  elif [[ "$entry" == *" switch "* ]]; then
    printf '%s\n' switch-force
    return 0
  elif [[ "$entry" == *" restore "* ]]; then
    printf '%s\n' restore-worktree
    return 0
  elif [[ "$entry" == *" stash "* ]]; then
    printf '%s\n' stash-discard
    return 0
  elif [[ "$entry" == *" filter-branch"* || "$entry" == *" filter-repo"* || "$entry" == *" replace"* || "$entry" == *" update-ref"* || "$entry" == *" reflog expire"* ]]; then
    printf '%s\n' history-rewrite
    return 0
  fi

  return 1
}

assert_claude_destructive_git_parity() {
  local corpus_file="$TMP_ROOT/claude-destructive-git-corpus.tsv"
  local native_families_file="$TMP_ROOT/claude-destructive-git-families.txt"
  local entry family command expected

  cat > "$corpus_file" <<EOF
commit-amend|git commit --amend|$AI_POLICY_GIT_AMEND
commit-hook-bypass|git commit --no-verify|$AI_POLICY_HOOK_BYPASS
push-force|git push --force|$AI_POLICY_GIT_FORCE_PUSH
push-delete|git push --delete origin feat/foo|$AI_POLICY_GIT_FORCE_PUSH
push-prune|git push --prune origin|$AI_POLICY_GIT_FORCE_PUSH
reset-ref-or-index|git reset --hard HEAD|$AI_POLICY_GIT_RESET
clean-force|git clean --force|$AI_POLICY_GIT_CLEAN_FORCE
branch-force-delete|git branch -D feat/foo|$AI_POLICY_GIT_BRANCH_FORCE_DELETE
branch-force-long|git branch --force feat/foo HEAD~1|$AI_POLICY_GIT_BRANCH_FORCE_DELETE
branch-force-f-leading|git branch -f feat/foo HEAD~1|$AI_POLICY_GIT_BRANCH_FORCE_DELETE
branch-force-f-after|git branch feat/foo -f HEAD~1|$AI_POLICY_GIT_BRANCH_FORCE_DELETE
branch-force-move-leading|git branch -M feat/old feat/new|$AI_POLICY_GIT_BRANCH_FORCE_DELETE
branch-force-move-after|git branch feat/old -M feat/new|$AI_POLICY_GIT_BRANCH_FORCE_DELETE
branch-force-copy-leading|git branch -C feat/source feat/copy|$AI_POLICY_GIT_BRANCH_FORCE_DELETE
branch-force-copy-after|git branch feat/source -C feat/copy|$AI_POLICY_GIT_BRANCH_FORCE_DELETE
tag-delete|git tag --delete v1.0.0|$AI_POLICY_GIT_BRANCH_FORCE_DELETE
tag-force-update|git tag --force v1.0.0 HEAD~1|$AI_POLICY_GIT_BRANCH_FORCE_DELETE
worktree-force-remove|git worktree remove --force ../feature|$AI_POLICY_GIT_BRANCH_FORCE_DELETE
checkout-force|git checkout --force main|$AI_POLICY_GIT_WORKTREE_LOSS
checkout-path-discard|git checkout -- packages/client/src/foo.ts|$AI_POLICY_GIT_WORKTREE_LOSS
switch-force|git switch --force main|$AI_POLICY_GIT_WORKTREE_LOSS
restore-worktree|git restore --worktree packages/client/src/foo.ts|$AI_POLICY_GIT_WORKTREE_LOSS
stash-discard|git stash clear|$AI_POLICY_GIT_WORKTREE_LOSS
history-rewrite|git update-ref refs/heads/main abc|$AI_POLICY_GIT_HISTORY_REWRITE
EOF

  : > "$native_families_file"
  while IFS= read -r entry; do
    family=$(claude_destructive_git_family "$entry") \
      || fail "unclassified Claude destructive-git deny entry: $entry"
    printf '%s\n' "$family" >> "$native_families_file"
  done < <(jq -r '.permissions.deny[] | select(startswith("Bash(git "))' "$REPO_ROOT/.claude/settings.json")
  sort -u -o "$native_families_file" "$native_families_file"

  while IFS='|' read -r family command expected; do
    grep -Fxq "$family" "$native_families_file" \
      || fail "shared destructive-git parity corpus has no Claude family: $family"
    assert_policy_blocks "$command" "$expected"
  done < "$corpus_file"

  while IFS= read -r family; do
    awk -F '|' -v family="$family" '$1 == family { found = 1 } END { exit !found }' "$corpus_file" \
      || fail "Claude destructive-git family lacks a shared-policy fixture: $family"
  done < "$native_families_file"
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

# Hand-maintained slice only: generator-contributed bypass scripts render into
# AI_GENERATED_BYPASS_BUN_SCRIPTS (classified-bun-scripts.generated.sh, sourced
# via policy.sh) and are appended below; do not re-add them here.
AI_BUN_CLASSIFIED_BYPASS_SCRIPTS='
baseline:restore-stage
clean
code:intel:perf
code:intel:server
codemod:concurrency-guard
codemod:expand-barrel
codemod:structured-logging-fix
codemod:trpc-shared-input
codemod:trpc-shared-output
db:status
dev
doctor
e2e:debug
e2e:ui
lint:max-lines-exceptions:update
lint:ratchet:update
lint:ratchet:zero-baseline
module:index
postinstall
prepare
test:mutation
test:scripts:mutation
test:server:mutation
test:lint-ratchet:mutation
test:watch
typecheck:watch
verify:async
verify:async:changed
verify:async:slow
worktree:drop
worktree:gc
worktree:init
worktree:new
worktree:refresh-data
worktree:status
worktree:template-refresh
'

AI_BUN_CLASSIFIED_BYPASS_SCRIPTS="${AI_BUN_CLASSIFIED_BYPASS_SCRIPTS}
${AI_GENERATED_BYPASS_BUN_SCRIPTS}"

script_list_contains() {
  local needle="$1" list="$2" script

  while IFS= read -r script; do
    [ -n "$script" ] || continue
    [ "$script" = "$needle" ] && return 0
  done <<< "$list"

  return 1
}

script_list_duplicates() {
  local list="$1"

  grep -v '^$' <<< "$list" | LC_ALL=C sort | uniq -d | paste -sd ',' -
}

# Completeness tripwire over the COMBINED (hand + generated) classifier lists:
# every package.json script must be classified exactly once. Duplicates within
# or across the lists usually mean a generator-contributed script was re-added
# to a hand-maintained heredoc; fix the heredoc, not the generated fragment.
assert_bun_package_scripts_are_classified() {
  local package_scripts missing="" stale_wrapped="" stale_bypass="" script
  local duplicate_wrapped duplicate_bypass overlap

  duplicate_wrapped=$(script_list_duplicates "$AI_WRAPPED_BUN_SCRIPTS")
  [ -z "$duplicate_wrapped" ] \
    || fail "wrapped bun script list has duplicate entries: $duplicate_wrapped"
  duplicate_bypass=$(script_list_duplicates "$AI_BUN_CLASSIFIED_BYPASS_SCRIPTS")
  [ -z "$duplicate_bypass" ] \
    || fail "bun-run-quiet bypass list has duplicate entries: $duplicate_bypass"
  overlap=$(script_list_duplicates "$AI_WRAPPED_BUN_SCRIPTS
$AI_BUN_CLASSIFIED_BYPASS_SCRIPTS")
  [ -z "$overlap" ] \
    || fail "scripts classified both wrapped and bypass: $overlap"

  package_scripts=$(bun -e 'const pkg = require("./package.json"); console.log(Object.keys(pkg.scripts).join("\n"));')

  while IFS= read -r script; do
    [ -n "$script" ] || continue
    if ! script_list_contains "$script" "$AI_WRAPPED_BUN_SCRIPTS" \
      && ! script_list_contains "$script" "$AI_BUN_CLASSIFIED_BYPASS_SCRIPTS"; then
      missing="${missing}${missing:+, }$script"
    fi
  done <<< "$package_scripts"

  while IFS= read -r script; do
    [ -n "$script" ] || continue
    if ! script_list_contains "$script" "$package_scripts"; then
      stale_wrapped="${stale_wrapped}${stale_wrapped:+, }$script"
    fi
  done <<< "$AI_WRAPPED_BUN_SCRIPTS"

  while IFS= read -r script; do
    [ -n "$script" ] || continue
    if ! script_list_contains "$script" "$package_scripts"; then
      stale_bypass="${stale_bypass}${stale_bypass:+, }$script"
    fi
  done <<< "$AI_BUN_CLASSIFIED_BYPASS_SCRIPTS"

  [ -z "$missing" ] || fail "package.json scripts missing bun-run-quiet classification: $missing"
  [ -z "$stale_wrapped" ] || fail "wrapped bun script list has stale entries: $stale_wrapped"
  [ -z "$stale_bypass" ] || fail "bun-run-quiet bypass list has stale entries: $stale_bypass"
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
assert_policy_blocks "export HUSKY=0 && git commit -m test" "$AI_POLICY_HOOK_BYPASS"
assert_policy_blocks "export HUSKY=0; git commit -m test" "$AI_POLICY_HOOK_BYPASS"
assert_policy_blocks "git commit -nm test" "$AI_POLICY_HOOK_BYPASS"
assert_policy_blocks "echo ok && git commit --no-verify" "$AI_POLICY_HOOK_BYPASS"
assert_policy_blocks "git -c core.editor=true commit -n" "$AI_POLICY_HOOK_BYPASS"
assert_policy_blocks "git push --no-verify" "$AI_POLICY_HOOK_BYPASS"
assert_policy_blocks "git push origin HEAD --no-verify" "$AI_POLICY_HOOK_BYPASS"
assert_policy_blocks "echo ok && git push --no-verify" "$AI_POLICY_HOOK_BYPASS"
assert_policy_blocks "env HUSKY=0 git commit -m test" "$AI_POLICY_HOOK_BYPASS"
assert_policy_blocks "env -i HUSKY=0 PATH=/usr/bin git commit -m test" "$AI_POLICY_HOOK_BYPASS"
assert_policy_blocks "env -u GIT_DIR HUSKY=0 git commit -m test" "$AI_POLICY_HOOK_BYPASS"
assert_policy_blocks "env --split-string=FOO=bar HUSKY=0 git commit -m test" "$AI_POLICY_HOOK_BYPASS"
assert_policy_blocks "env -S 'HUSKY=0 git commit -m test'" "$AI_POLICY_HOOK_BYPASS"
assert_policy_blocks "bash -lc 'git commit --no-verify'" "$AI_POLICY_HOOK_BYPASS"
assert_policy_blocks "bash -lc 'git push --no-verify'" "$AI_POLICY_HOOK_BYPASS"
assert_policy_blocks "bash -lc 'env HUSKY=0 git commit -m test'" "$AI_POLICY_HOOK_BYPASS"
assert_policy_allows_each \
  "rg HUSKY=0 scripts/" \
  "rg \"export HUSKY=0\" scripts/" \
  "rg -- --no-verify" \
  "rg \"--no-verify\" .husky/" \
  "rg \"git commit\" -n scripts/" \
  "git log --grep=--no-verify"
assert_policy_advisory_contains "touch .allow-protected-edits" "repo-wide"
assert_policy_advisory_contains "bash -lc 'touch .allow-protected-edits'" "remove it immediately"
assert_policy_advisory_contains ": > .allow-protected-edits" "protected-file maintenance"
ALLOW_MARKER_POLICY_OUT=$(
  jq -n --arg cmd "touch .allow-protected-edits" '{tool_input:{command:$cmd}}' \
    | CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$REPO_ROOT/scripts/ai-hooks/bash-pre-tool-use.sh"
)
assert_hook_json "$ALLOW_MARKER_POLICY_OUT"
[ "$(jq -r '.hookSpecificOutput.hookEventName // empty' <<< "$ALLOW_MARKER_POLICY_OUT")" = "PreToolUse" ] \
  || fail "marker creation should emit PreToolUse advisory context: $ALLOW_MARKER_POLICY_OUT"
ALLOW_MARKER_POLICY_CONTEXT=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$ALLOW_MARKER_POLICY_OUT")
assert_contains "$ALLOW_MARKER_POLICY_CONTEXT" ".allow-protected-edits"
assert_contains "$ALLOW_MARKER_POLICY_CONTEXT" "repo-wide"
assert_policy_blocks_each "$AI_POLICY_POSTGRES" \
  "psql postgres" \
  "psql -c 'select 1'" \
  "env PGX=1 psql postgres" \
  "bash -lc 'psql postgres'" \
  "timeout 30 psql postgres" \
  "timeout -s KILL 30 psql postgres" \
  "command psql -c 'select 1'" \
  "nice psql postgres"
assert_policy_blocks_each "$AI_POLICY_REDIS" \
  "redis-cli ping" \
  "env REDIS_URL=redis://localhost redis-cli ping" \
  "bash -lc 'redis-cli ping'" \
  "timeout 30 redis-cli ping" \
  "command redis-cli ping"
assert_policy_blocks_each "$AI_POLICY_DOCKER" \
  "docker ps" \
  " docker ps" \
  "docker-compose ps" \
  "env FOO=bar docker ps" \
  "bash -c \"docker compose down\"" \
  "timeout 30 docker ps" \
  "command docker ps"
assert_policy_allows_each \
  "grep -n \"psql\" scripts/" \
  "echo \"don't use psql\"" \
  "echo redis-cli" \
  "rg \"docker compose\" docs/" \
  "git grep pg_dump" \
  "printf '%s\n' docker" \
  "command git status"
assert_policy_blocks "echo ThisIsNotTheRealDatabasePassword" "$AI_POLICY_CHANGEME"

# Every destructive Git family denied natively by Claude must have a
# representative command blocked by the shared Codex/Copilot policy. New
# native families therefore require an explicit cross-harness fixture.
assert_claude_destructive_git_parity

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
assert_policy_blocks_each "$AI_POLICY_GIT_AMEND" \
  'X=$(git commit --amend)' \
  'X=`git commit --amend`'
# The complementary "the widened amend regex must not false-match
# `git commit -c <commit>` (reuse-message, not amend)" allow-cases are
# branch-sensitive: a plain commit is blocked on a protected branch, so a bare
# `assert_policy_allows` here fails whenever the harness itself runs on
# main/master (e.g. `bun run verify` on the integration branch). They run in
# FEATURE_BRANCH_REPO alongside the other feature-branch commit allows below.

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
  "git -C . reset --hard HEAD" \
  "git -c color.ui=false reset --hard HEAD" \
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
assert_policy_blocks_each "$AI_POLICY_GIT_RESET" \
  "if true; then git reset --hard; fi" \
  "if false; then :; else git reset --hard; fi" \
  "if false; then :; elif git reset --hard; then :; fi" \
  "{ git reset --hard; }"
assert_policy_allows_each \
  "git reset" \
  "git reset HEAD -- packages/client/src/foo.ts" \
  "git reset --quiet HEAD -- packages/client/src/foo.ts" \
  "git reset --mixed HEAD -- packages/client/src/foo.ts" \
  "git reset -- packages/client/src/foo.ts" \
  "git restore --staged packages/client/src/foo.ts"

assert_policy_blocks_each "$AI_POLICY_GIT_WORKTREE_LOSS" \
  "git checkout -f main" \
  "git checkout --force main" \
  "git checkout main -f" \
  "git switch -f main" \
  "git switch --force main" \
  "git checkout -- packages/client/src/foo.ts" \
  "git checkout HEAD -- packages/client/src/foo.ts" \
  "git checkout ." \
  "git checkout -- ." \
  "git restore --worktree packages/client/src/foo.ts" \
  "git restore -W packages/client/src/foo.ts" \
  "git restore ." \
  "git restore -- ." \
  "git restore ./packages/client/src/foo.ts" \
  "git stash drop" \
  "git stash drop stash@{0}" \
  "git stash clear" \
  "git -C . restore --worktree package.json" \
  "bash -lc 'git stash clear'" \
  "env FOO=bar git checkout -- package.json"
assert_policy_allows_each \
  "git checkout main" \
  "git checkout -b feat/foo" \
  "git switch main" \
  "git switch -c feat/foo" \
  "git restore --staged packages/client/src/foo.ts" \
  "git restore --source=HEAD --staged packages/client/src/foo.ts" \
  "git stash list" \
  "git stash show stash@{0}" \
  "rg \"git checkout --\" docs/" \
  "echo \"git restore .\""

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
  "git -C . push --force" \
  "git -c protocol.version=2 push --force" \
  "git push -f origin feat/foo" \
  "git push --force-with-lease origin feat/foo" \
  "git push --force-with-lease=refs/heads/feat/foo origin feat/foo" \
  "git push --mirror origin" \
  "git push --prune origin" \
  "git push origin +main" \
  "git push origin :feat/foo" \
  "git push --delete origin feat/foo" \
  "git push -d origin feat/foo" \
  "echo ok && git push --force" \
  "bash -lc 'git push --force'" \
  "env FOO=bar git push --force"
assert_policy_blocks_each "$AI_POLICY_GIT_FORCE_PUSH" \
  "for x in 1; do git push --force; done" \
  "! git push --force"
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
assert_policy_allows_in_dir "$FEATURE_BRANCH_REPO" "git push -n origin HEAD"
assert_policy_allows_in_dir "$FEATURE_BRANCH_REPO" "git push --dry-run origin HEAD"
assert_policy_allows_in_dir "$FEATURE_BRANCH_REPO" "git push --set-upstream origin feat/foo"
assert_policy_allows_in_dir "$FEATURE_BRANCH_REPO" "git push origin feat/foo"

# Committing on the protected branch is blocked; feature branches are untouched.
assert_policy_blocks_in_dir "$MAIN_BRANCH_REPO" "git commit" "$AI_POLICY_GIT_COMMIT_ON_MAIN"
assert_policy_blocks_in_dir "$MAIN_BRANCH_REPO" "git commit -m 'add feature'" "$AI_POLICY_GIT_COMMIT_ON_MAIN"
assert_policy_blocks_in_dir "$MAIN_BRANCH_REPO" "git commit -F /tmp/commit-msg.txt" "$AI_POLICY_GIT_COMMIT_ON_MAIN"
assert_policy_blocks_in_dir "$MAIN_BRANCH_REPO" "git -c commit.gpgsign=false commit -m normal" "$AI_POLICY_GIT_COMMIT_ON_MAIN"
assert_policy_blocks_in_dir "$MAIN_BRANCH_REPO" "echo ok && git commit -m wip" "$AI_POLICY_GIT_COMMIT_ON_MAIN"
# The `-c <commit>` reuse-message form is a real commit too, so on the protected
# branch it is blocked by commit-on-main (never mis-attributed to the amend rule).
assert_policy_blocks_in_dir "$MAIN_BRANCH_REPO" "git commit -c HEAD~1" "$AI_POLICY_GIT_COMMIT_ON_MAIN"
# A dry-run creates nothing, so it stays allowed even on the protected branch.
assert_policy_allows_in_dir "$MAIN_BRANCH_REPO" "git commit --dry-run"
assert_policy_allows_in_dir "$MAIN_BRANCH_REPO" "git commit --dry-run -m x"
# The dry-run carve-out is scoped to the commit's own segment: a real commit
# must not be exempted by a `--dry-run` belonging to a later command, and a
# dry-run preceding a real commit must not exempt the real one.
assert_policy_blocks_in_dir "$MAIN_BRANCH_REPO" "git commit -m real && echo --dry-run" "$AI_POLICY_GIT_COMMIT_ON_MAIN"
assert_policy_blocks_in_dir "$MAIN_BRANCH_REPO" "git commit -m real; echo --dry-run" "$AI_POLICY_GIT_COMMIT_ON_MAIN"
assert_policy_blocks_in_dir "$MAIN_BRANCH_REPO" "git commit --dry-run && git commit -m real" "$AI_POLICY_GIT_COMMIT_ON_MAIN"
# A more specific violation still wins: amend reports the history-rewrite block.
assert_policy_blocks_in_dir "$MAIN_BRANCH_REPO" "git commit --amend --no-edit" "$AI_POLICY_GIT_AMEND"
# No overshoot onto read-only verbs or commit-* plumbing that merely name
# "commit": only genuine global options may precede the commit verb, and
# subcommands (grep/show/log/diff/help/branch) are bare words, never dash-led.
assert_policy_allows_in_dir "$MAIN_BRANCH_REPO" "git log --oneline"
assert_policy_allows_in_dir "$MAIN_BRANCH_REPO" "git show commit-tree"
assert_policy_allows_in_dir "$MAIN_BRANCH_REPO" "git commit-tree"
assert_policy_allows_in_dir "$MAIN_BRANCH_REPO" "git grep commit"
assert_policy_allows_in_dir "$MAIN_BRANCH_REPO" "git show commit"
assert_policy_allows_in_dir "$MAIN_BRANCH_REPO" "git log --grep commit"
assert_policy_allows_in_dir "$MAIN_BRANCH_REPO" "git diff --name-only commit"
assert_policy_allows_in_dir "$MAIN_BRANCH_REPO" "git help commit"
# A global option before the verb (e.g. --no-pager) is still a real commit.
assert_policy_blocks_in_dir "$MAIN_BRANCH_REPO" "git --no-pager commit -m x" "$AI_POLICY_GIT_COMMIT_ON_MAIN"
assert_policy_allows_in_dir "$FEATURE_BRANCH_REPO" "git commit"
assert_policy_allows_in_dir "$FEATURE_BRANCH_REPO" "git commit -m 'add feature'"
assert_policy_allows_in_dir "$FEATURE_BRANCH_REPO" "git -c commit.gpgsign=false commit -m normal"
# `git commit -c <commit>` reuses a commit's message for a NEW commit — it is
# not an amend — so the widened amend regex must not false-match it. These run
# on a feature branch because a plain commit is otherwise blocked on main.
assert_policy_allows_in_dir "$FEATURE_BRANCH_REPO" "git commit -c HEAD~1"
assert_policy_allows_in_dir "$FEATURE_BRANCH_REPO" "git commit -c abc123 -m override"
assert_policy_allows_in_dir "$FEATURE_BRANCH_REPO" "git -c user.name=ci commit -c HEAD~1"
assert_policy_allows_each \
  "printf '%s\n' 'X=\$(git commit --amend)'" \
  "printf '%s\n' 'X=\`git commit --amend\`'" \
  'echo "then git reset --hard"' \
  'echo "do git push --force"' \
  'echo "else git reset --hard"' \
  'echo "elif git reset --hard"' \
  'echo "{ git reset --hard"' \
  'echo "! git push --force"'

# Protected-branch predicate (shared by the commit/push matchers and the
# git-level pre-commit guard).
ai_branch_is_protected main || fail "main must be protected"
ai_branch_is_protected master || fail "master must be protected"
ai_branch_is_protected feat/policy && fail "feature branch must not be protected"
ai_branch_is_protected "" && fail "detached/empty HEAD must not be treated as protected"

# ai_guard_commit_branch_or_die resolves the branch from the cwd repo, so the
# .husky/pre-commit hook catches commits the PreToolUse string matcher cannot
# (the `git -C <path>` / `cd <path> && git commit` forms): git runs the hook in
# the target repo regardless of how the command navigated there.
( cd "$MAIN_BRANCH_REPO" && ai_guard_commit_branch_or_die ) 2>/dev/null \
  && fail "pre-commit guard must block a commit on the protected branch"
( cd "$FEATURE_BRANCH_REPO" && ai_guard_commit_branch_or_die ) 2>/dev/null \
  || fail "pre-commit guard must allow a commit on a feature branch"

assert_policy_blocks_each "$AI_POLICY_GIT_BRANCH_FORCE_DELETE" \
  "git branch -D feat/foo" \
  "git -C . branch -D feat/foo" \
  "git -c color.ui=false branch -D feat/foo" \
  "git branch -df feat/foo" \
  "git branch -fd feat/foo" \
  "git branch -d -f feat/foo" \
  "git branch -f -d feat/foo" \
  "git branch --delete --force feat/foo" \
  "git branch --delete -f feat/foo" \
  "git branch --force --delete feat/foo" \
  "git branch --force feat/foo HEAD~1" \
  "git branch -f feat/foo HEAD~1" \
  "git branch -M feat/old feat/new" \
  "git branch -C feat/source feat/copy" \
  "git tag -d v1.0.0" \
  "git tag --delete v1.0.0" \
  "git tag --force v1.0.0 HEAD~1" \
  "git tag -f v1.0.0 HEAD~1" \
  "git worktree remove --force ../feature" \
  "git worktree remove -f ../feature" \
  "echo ok && git branch -D feat/foo" \
  "bash -lc 'git tag -d v1.0.0'" \
  "env FOO=bar git worktree remove --force ../feature"
assert_policy_blocks_each "$AI_POLICY_GIT_CLEAN_FORCE" \
  "git clean -f" \
  "git -C . clean -fd" \
  "git -c clean.requireForce=false clean -fd" \
  "git clean -fd" \
  "git clean -fdx ." \
  "git clean --force" \
  "echo ok && git clean -fdx" \
  "bash -lc 'git clean -f'" \
  "env FOO=bar git clean -fd"
assert_policy_allows_each \
  "git branch -d feat/foo" \
  "git branch -m feat/old feat/new" \
  "git branch -c feat/source feat/copy" \
  "git tag v1.0.0" \
  "git clean -n"

assert_policy_blocks_contains "printf '%s\n' x > bun.lock" "Protected lockfile"
assert_policy_blocks_contains "printf '%s\n' x >> scripts/verify/steps.generated.sh" "Protected generated file"
assert_policy_blocks_contains "printf '%s\n' x >> scripts/ai-hooks/hook-timeouts.generated.sh" "Protected generated file"
assert_policy_blocks_contains "printf '%s\n' x >> scripts/ai-hooks/classified-bun-scripts.generated.sh" "Protected generated file"
assert_policy_blocks_contains "echo x>bun.lock" "Protected lockfile"
assert_policy_blocks_contains "echo x>>bun.lock" "Protected lockfile"
assert_policy_blocks_contains "cat evil>bun.lock" "Protected lockfile"
assert_policy_blocks_contains "echo x >|bun.lock" "Protected lockfile"
assert_policy_blocks_contains "echo hi && echo x>bun.lock" "Protected lockfile"
assert_policy_blocks_contains "echo x&>bun.lock" "Protected lockfile"
assert_policy_blocks_contains "sed -i 's/a/b/' lint-ratchet.baseline.json" "lint-ratchet.baseline.json"
assert_policy_blocks_contains "printf '%s\n' x | tee docs/generated/harness-controls.md" "Protected generated file"
assert_policy_blocks_contains "cp package.json docs/generated/local-lint-rules.md" "Protected generated file"
assert_policy_allows "printf '%s\n' x > docs/generated/README.md"
assert_policy_allows "printf '%s\n' x >> docs/generated/lint-coverage-map.md"
assert_policy_allows "printf '%s\n' x | tee docs/generated/observed_flaky_tests.md"
assert_policy_blocks_contains "install package.json .husky/_/pre-commit" "Protected Husky internals"
assert_policy_blocks_contains "mv package.json scripts/suppression-register.sh" "suppression registers"
assert_policy_blocks_contains "mv bun.lock /tmp/bun.lock.moved" "Protected lockfile"
assert_policy_allows_each \
  "cat bun.lock" \
  "cp bun.lock /tmp/bun.lock.copy" \
  "sed -n '1p' scripts/verify/steps.generated.sh" \
  "sed -n '1p' scripts/ai-hooks/hook-timeouts.generated.sh" \
  "sed -n '1p' scripts/ai-hooks/classified-bun-scripts.generated.sh" \
  "rg 'harness' docs/generated/harness-controls.md" \
  "printf '%s\n' x > packages/server/src/main.ts" \
  "sed -i 's/a/b/' packages/server/src/main.ts" \
  "printf '%s\n' x | tee notes.txt" \
  "cp package.json /tmp/package.copy" \
  "install package.json /tmp/package.copy" \
  "mv package.json /tmp/package.copy" \
  "mv /tmp/scratch.txt /tmp/other" \
  "echo 'x>bun.lock'" \
  "printf '%s\n' 'x>>bun.lock'" \
  "grep 'x>|bun.lock' notes.txt"

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

for reason in "$AI_POLICY_DOCKER" "$AI_POLICY_GIT_REBASE" "$AI_POLICY_POSTGRES"; do
  if ai_policy_is_soft_guidance "$reason"; then
    fail "policy must stay a hard block: $reason"
  fi
done
assert_policy_allows_each \
  "echo ok" \
  "git status --short" \
  "git -C /tmp/some/path status --short" \
  "git -c color.ui=false status --short" \
  "git grep needle" \
  "git -C /tmp/some/path grep needle" \
  "rg needle" \
  "rg --files" \
  "ripgrep needle" \
  "which grep" \
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
  "sh -c \"grep -R TODO .\"" \
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

assert_codex_allows() {
  local cmd="$1"
  local out

  out=$(printf '%s' "$(jq -n --arg c "$cmd" '{tool_input:{command:$c}}')" \
    | AI_STATE_ROOT="$AI_STATE_ROOT" \
      AI_BUN_LOG_DIR="$TMP_ROOT/codex-bun-logs" \
      AI_PRECOMMIT_LOG_DIR="$AI_PRECOMMIT_LOG_DIR" \
      bash "$CODEX_PRE")
  assert_hook_json "$out"
  assert_hook_continue_json "$out"
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
assert_claude_hard_block "docker ps" "$AI_POLICY_DOCKER"
assert_claude_hard_block "docker ps; grep -r TODO ." "$AI_POLICY_DOCKER"
assert_claude_hard_block "git rebase main" "$AI_POLICY_GIT_REBASE"
assert_hook_continue_json "$(claude_policy_out 'rg needle')"
assert_hook_continue_json "$(claude_policy_out 'grep -r TODO .')"
assert_hook_continue_json "$(claude_policy_out 'bun run test:changed')"
assert_codex_allows "grep -r TODO ."
assert_codex_hard_block_unchanged "docker ps" "$AI_POLICY_DOCKER"

# --- L8: heredoc bodies are data, not executable command shapes -------------
# Keep this group at the end of the shared-policy/direct-caller section so
# parallel hook lanes can append their own groups without interleaving cases.
HEREDOC_ONLY_CMD=$'cat > /tmp/musi-l8-notes.txt <<\'NOTES\'\nThe wrapper is scripts/ai-hooks/git-commit-quiet.sh.\nExample only: git commit --amend --no-edit\nNOTES'
HEREDOC_ADVISORY_ONLY_CMD=$'cat <<"POLICY_NOTES"\ntouch .allow-protected-edits\nprintf x > bun.lock\nPOLICY_NOTES'
HEREDOC_THEN_COMMIT_CMD=$'cat <<\'FIRST\' <<-"SECOND"\nfirst body: git commit --amend\nFIRST\n\tsecond body: scripts/ai-hooks/git-commit-quiet.sh\n\tSECOND\ngit commit -m real'
HEREDOC_THEN_AMEND_CMD=$'cat <<ONE <<-TWO\nfirst body\nONE\n\tsecond body\n\tTWO\ngit commit --amend --no-edit'
UNTERMINATED_HEREDOC_CMD=$'cat <<BROKEN\ngit commit --amend'
UNTERMINATED_ADVISORY_CMD=$'cat <<BROKEN\ntouch .allow-protected-edits'
COMMENT_PHANTOM_HEREDOC_CMD=$': # <<HIDE\ngit reset --hard\nHIDE'
REAL_HEREDOC_BEFORE_COMMENT_CMD=$'cat <<DATA # <<PHANTOM\ngit reset --hard\nDATA\ngit reset --hard'
HASH_IN_WORD_HEREDOC_CMD=$'cat foo#bar <<DATA\ngit reset --hard\nDATA'
UNQUOTED_HEREDOC_SUBSTITUTION_CMD=$'cat <<EOF\n$(git reset --hard HEAD~5)\nEOF'
QUOTED_HEREDOC_SUBSTITUTION_CMD=$'cat <<\'EOF\'\n$(git reset --hard HEAD~5)\nEOF'
UNQUOTED_HEREDOC_BACKTICK_CMD=$'cat <<EOF\n`git reset --hard HEAD~5`\nEOF'
HERESTRING_FAKE_HEREDOC_CMD=$'grep -q x <<< "DELIM"\ngit commit --no-verify -m foo\nDELIM'
HERESTRING_THEN_COMMIT_CMD='grep -q x <<< "DELIM"; git commit -m foo'

assert_policy_allows "$HEREDOC_ONLY_CMD"
if ai_is_git_commit_cmd "$HEREDOC_ONLY_CMD"; then
  fail "heredoc-only command must not be routed to the commit wrapper"
fi
HEREDOC_WRAPPER_OUT=$(jq -n --arg cmd "$HEREDOC_ONLY_CMD" '{tool_input:{command:$cmd}}' \
  | bash "$REPO_ROOT/scripts/ai-hooks/git-commit-quiet.sh")
assert_hook_continue_json "$HEREDOC_WRAPPER_OUT"

# Both raw direct callers must inherit stripping from policy.sh itself.
assert_hook_continue_json "$(no_direct_db_body_out "$HEREDOC_ONLY_CMD")"
assert_hook_continue_json "$(claude_policy_out "$HEREDOC_ONLY_CMD")"
assert_codex_allows "$HEREDOC_ONLY_CMD"

# Advisory/protected-file scanners ignore heredoc data too.
assert_policy_allows "$HEREDOC_ADVISORY_ONLY_CMD"
if ai_policy_advisory_context "$HEREDOC_ADVISORY_ONLY_CMD" >/dev/null; then
  fail "heredoc-only marker/protected-file text must not emit an advisory"
fi

# Executable commands after one or more heredocs remain visible. The second
# heredoc uses <<- and a tab-indented terminator.
ai_is_git_commit_cmd "$HEREDOC_THEN_COMMIT_CMD" \
  || fail "real commit after two heredocs must be routed to the wrapper"
assert_policy_blocks "$HEREDOC_THEN_AMEND_CMD" "$AI_POLICY_GIT_AMEND"
HEREDOC_AMEND_WRAPPER_OUT=$(jq -n --arg cmd "$HEREDOC_THEN_AMEND_CMD" '{tool_input:{command:$cmd}}' \
  | bash "$REPO_ROOT/scripts/ai-hooks/git-commit-quiet.sh")
[ "$(jq -r '.decision // empty' <<< "$HEREDOC_AMEND_WRAPPER_OUT")" = "block" ] \
  || fail "real amend after heredocs must reach the wrapper preflight: $HEREDOC_AMEND_WRAPPER_OUT"
assert_contains "$(jq -r '.reason // empty' <<< "$HEREDOC_AMEND_WRAPPER_OUT")" "amend"

# The protected-branch scanner is independently callable and must use the same
# stripped view. An unterminated heredoc exercises the raw-text fallback for
# policy scanners AND commit routing: a commit behind a malformed heredoc must
# still route through the wrapper rather than run unguarded.
if (cd "$MAIN_BRANCH_REPO" && ai_policy_has_git_commit_on_main "$HEREDOC_ONLY_CMD"); then
  fail "commit-on-main scanner must ignore commit text in a heredoc body"
fi
(cd "$MAIN_BRANCH_REPO" && ai_policy_has_git_commit_on_main "$UNTERMINATED_HEREDOC_CMD") \
  || fail "commit-on-main scanner must fail closed for an unterminated heredoc"
assert_policy_blocks "$UNTERMINATED_HEREDOC_CMD" "$AI_POLICY_GIT_AMEND"
ai_is_git_commit_cmd "$UNTERMINATED_HEREDOC_CMD" \
  || fail "commit routing must fall back to raw text for an unterminated heredoc"
assert_contains "$(ai_policy_advisory_context "$UNTERMINATED_ADVISORY_CMD")" ".allow-protected-edits"

# An unquoted # starts a shell comment only at a word boundary. A declaration
# inside that comment is inert and must not hide the executable reset below it.
assert_policy_blocks "$COMMENT_PHANTOM_HEREDOC_CMD" "$AI_POLICY_GIT_RESET"
# A real declaration before the comment still owns its body, while the phantom
# declaration after # does not. A # embedded in a word does not start a comment.
assert_policy_blocks "$REAL_HEREDOC_BEFORE_COMMENT_CMD" "$AI_POLICY_GIT_RESET"
assert_policy_allows "$HASH_IN_WORD_HEREDOC_CMD"

# Unquoted heredoc bodies undergo shell expansion, so executable command
# substitutions in them remain policy-visible. A quoted delimiter makes the
# same body pure data; HEREDOC_ONLY_CMD above covers that stripping behavior.
assert_policy_blocks "$UNQUOTED_HEREDOC_SUBSTITUTION_CMD" "$AI_POLICY_GIT_RESET"
assert_policy_blocks "$UNQUOTED_HEREDOC_BACKTICK_CMD" "$AI_POLICY_GIT_RESET"
assert_policy_allows "$QUOTED_HEREDOC_SUBSTITUTION_CMD"

# A herestring is not a heredoc declaration: it must neither swallow later
# commands through a fake delimiter nor make same-line commit routing fail open.
assert_policy_blocks "$HERESTRING_FAKE_HEREDOC_CMD" "$AI_POLICY_HOOK_BYPASS"
HERESTRING_STRIPPED=$(ai_strip_noncommand_text "$HERESTRING_THEN_COMMIT_CMD") \
  || fail "herestring-bearing command must not fail heredoc stripping"
[ "$HERESTRING_STRIPPED" = "$HERESTRING_THEN_COMMIT_CMD" ] \
  || fail "herestring-bearing command must remain intact after stripping"
ai_is_git_commit_cmd "$HERESTRING_THEN_COMMIT_CMD" \
  || fail "commit after a same-line herestring must be routed to the wrapper"

# --- heredoc stripper hardening: interpreter-fed bodies, arithmetic <<,
# $() desync, partially quoted delimiters, quoted global-option args ---------

# A heredoc body fed to an obvious stdin-reading shell invocation (directly
# or through a pipeline) IS the script that shell executes: it must stay
# visible to the hard policy scanners instead of being stripped as data.
# Detection is deliberately conservative (command-position shell name,
# optional path/env prefix) — bumpers, not a wall: exotic spellings such as
# quoted-concatenated shell names ("ba"sh) are accepted residuals.
INTERP_HEREDOC_PUSH_CMD=$'bash <<\'EOF\'\ngit push origin main\nEOF'
INTERP_HEREDOC_AMEND_CMD=$'sh <<EOF\ngit commit --amend --no-edit\nEOF'
INTERP_PATH_HEREDOC_CMD=$'/bin/bash <<\'EOF\'\ngit reset --hard\nEOF'
INTERP_PIPE_HEREDOC_CMD=$'cat <<\'EOF\' | bash\ngit reset --hard\nEOF'
INTERP_ENV_HEREDOC_CMD=$'env bash <<\'EOF\'\ngit rebase main\nEOF'
assert_policy_blocks "$INTERP_HEREDOC_PUSH_CMD" "$AI_POLICY_GIT_PUSH_MAIN"
assert_policy_blocks "$INTERP_HEREDOC_AMEND_CMD" "$AI_POLICY_GIT_AMEND"
assert_policy_blocks "$INTERP_PATH_HEREDOC_CMD" "$AI_POLICY_GIT_RESET"
assert_policy_blocks "$INTERP_PIPE_HEREDOC_CMD" "$AI_POLICY_GIT_RESET"
assert_policy_blocks "$INTERP_ENV_HEREDOC_CMD" "$AI_POLICY_GIT_REBASE"
# The pre-hook (the only gate for push) must inherit the same visibility.
assert_claude_hard_block "$INTERP_HEREDOC_PUSH_CMD" "$AI_POLICY_GIT_PUSH_MAIN"
# Non-executing shell shapes stay data: a syntax-check (-n), a shell name in
# argument position, and a shell running an explicit script operand none of
# which execute the body.
NONEXEC_SYNTAX_CHECK_CMD=$'bash -n <<\'EOF\'\ngit reset --hard\nEOF'
NONEXEC_ARG_POSITION_CMD=$'cat - bash <<\'EOF\'\ngit reset --hard\nEOF'
NONEXEC_SCRIPT_OPERAND_CMD=$'bash upgrade.sh <<\'EOF\'\ngit reset --hard\nEOF'
assert_policy_allows "$NONEXEC_SYNTAX_CHECK_CMD"
assert_policy_allows "$NONEXEC_ARG_POSITION_CMD"
assert_policy_allows "$NONEXEC_SCRIPT_OPERAND_CMD"
# Operands are scanned uniformly across the <<WORD token: a script operand
# after the declaration still disarms the shell, and a filename operand after
# it is not a pipeline consumer. A trailing comment does not read as an
# operand. (Accepted residual: a value-taking shell option such as
# `bash -O extglob <<'EOF'` reads its value as a script operand and strips
# the body even though stdin executes — no option-table modeling.)
NONEXEC_OPERAND_AFTER_CMD=$'bash <<\'EOF\' upgrade.sh\ngit reset --hard\nEOF'
NONINTERP_FILE_OPERAND_CMD=$'cat <<\'EOF\' bash\ngit commit --amend\nEOF'
INTERP_TRAILING_COMMENT_CMD=$'bash <<\'EOF\' # cleanup\ngit reset --hard\nEOF'
assert_policy_allows "$NONEXEC_OPERAND_AFTER_CMD"
assert_policy_allows "$NONINTERP_FILE_OPERAND_CMD"
assert_policy_blocks "$INTERP_TRAILING_COMMENT_CMD" "$AI_POLICY_GIT_RESET"
# Non-interpreter consumers keep the data-stripping behavior, even when a
# shell name appears only inside the body text.
NONINTERP_BASH_MENTION_CMD=$'cat <<\'EOF\'\nrun bash later; example: git commit --amend\nEOF'
assert_policy_allows "$NONINTERP_BASH_MENTION_CMD"

# $((...)) / ((...)) arithmetic uses << as a shift operator: it must neither
# invent a heredoc that swallows following commands nor unmoor commit routing.
ARITH_SHIFT_EATEN_AMEND_CMD=$'echo $((1<<1))\ngit commit --amend --no-edit\n1'
assert_policy_blocks "$ARITH_SHIFT_EATEN_AMEND_CMD" "$AI_POLICY_GIT_AMEND"
ARITH_CMD_EATEN_RESET_CMD=$'((x = 1<<1))\ngit reset --hard\n1'
assert_policy_blocks "$ARITH_CMD_EATEN_RESET_CMD" "$AI_POLICY_GIT_RESET"
ARITH_THEN_COMMIT_CMD=$'echo $((1<<1))\ngit commit -m "real commit"'
ai_is_git_commit_cmd "$ARITH_THEN_COMMIT_CMD" \
  || fail "commit after an arithmetic shift line must be routed to the wrapper"
ARITH_BENIGN_CMD=$'echo $((1<<1))\necho after'
ARITH_STRIPPED=$(ai_strip_noncommand_text "$ARITH_BENIGN_CMD") \
  || fail "arithmetic shift must not register an unterminated heredoc"
[ "$ARITH_STRIPPED" = "$ARITH_BENIGN_CMD" ] \
  || fail "arithmetic shift lines must pass through the stripper unchanged"
ARITH_THEN_HEREDOC_CMD=$'echo $((1<<1)) && cat <<\'EOF\'\ngit commit --amend\nEOF'
assert_policy_allows "$ARITH_THEN_HEREDOC_CMD"

# Unquoted bodies: from the first substitution opener ($( or backtick) the
# rest of the body is retained wholesale — no depth/quote/comment modeling —
# so a ")" hidden in a comment or quoted string cannot drop later executable
# lines from the policy view. Over-retaining trailing data is the intended
# trade-off (fail closed).
SUBST_COMMENT_PAREN_CMD=$'cat <<EOF\n$(\n# )\ngit reset --hard\n)\nEOF'
assert_policy_blocks "$SUBST_COMMENT_PAREN_CMD" "$AI_POLICY_GIT_RESET"
SUBST_QUOTED_PAREN_CMD=$'cat <<EOF\n$(echo \')\'\ngit reset --hard\n)\nEOF'
assert_policy_blocks "$SUBST_QUOTED_PAREN_CMD" "$AI_POLICY_GIT_RESET"
# Body lines before the first opener are pure data and stay stripped; lines
# from the opener on are retained.
SUBST_STICKY_BODY_CMD=$'cat <<EOF\nplain prose before\n$(echo hi)\ntrailing prose after\nEOF'
SUBST_STICKY_STRIPPED=$(ai_strip_noncommand_text "$SUBST_STICKY_BODY_CMD") \
  || fail "substitution-bearing body must still strip cleanly"
case "$SUBST_STICKY_STRIPPED" in
  *"plain prose before"*) fail "body lines before a substitution opener must be stripped" ;;
esac
assert_contains "$SUBST_STICKY_STRIPPED" "trailing prose after"

# POSIX delimiter quoting: ANY quoted part (\MSG, M"SG") suppresses body
# expansion, and the terminator matches the delimiter with quotes removed. A
# valid partially quoted delimiter must not fail the strip (which would fail
# commit routing open past the wrapper, lock, and queue).
BACKSLASH_DELIM_COMMIT_CMD=$'git commit -F - <<\\MSG\nfeat(x): subject line\n\nbody long enough for the hook\nMSG'
ai_is_git_commit_cmd "$BACKSLASH_DELIM_COMMIT_CMD" \
  || fail "commit with a backslash-quoted heredoc delimiter must be routed to the wrapper"
BACKSLASH_DELIM_STRIPPED=$(ai_strip_noncommand_text "$BACKSLASH_DELIM_COMMIT_CMD") \
  || fail "backslash-quoted delimiter must terminate its heredoc cleanly"
case "$BACKSLASH_DELIM_STRIPPED" in
  *"subject line"*) fail "backslash-quoted delimiter body must be stripped as data" ;;
esac
BACKSLASH_DELIM_DATA_CMD=$'cat <<\\EOF\n$(git reset --hard HEAD~5)\nEOF'
assert_policy_allows "$BACKSLASH_DELIM_DATA_CMD"
PARTIAL_QUOTE_DELIM_DATA_CMD=$'cat <<M"SG"\ngit commit --amend\nMSG'
assert_policy_allows "$PARTIAL_QUOTE_DELIM_DATA_CMD"
PARTIAL_QUOTE_DELIM_COMMIT_CMD=$'git commit -F - <<M"SG"\ncommit message text\nMSG'
ai_is_git_commit_cmd "$PARTIAL_QUOTE_DELIM_COMMIT_CMD" \
  || fail "commit with a partially quoted heredoc delimiter must be routed to the wrapper"
# Inside a double-quoted delimiter, backslash is special only before $ ` " \
# (POSIX): elsewhere it stays a literal delimiter character, so the
# terminator carries the backslash and a benign body must strip cleanly
# instead of tripping the raw fallback.
DQ_PLAIN_DELIM_CMD=$'cat <<"MSG"\ngit commit --amend\nMSG'
DQ_LITERAL_BACKSLASH_DELIM_CMD=$'cat <<"M\\SG"\ngit commit --amend\nM\\SG'
DQ_ESCAPED_DOLLAR_DELIM_CMD=$'cat <<"M\\$G"\ngit commit --amend\nM$G'
assert_policy_allows "$DQ_PLAIN_DELIM_CMD"
assert_policy_allows "$DQ_LITERAL_BACKSLASH_DELIM_CMD"
assert_policy_allows "$DQ_ESCAPED_DOLLAR_DELIM_CMD"

# Global git option arguments may carry whitespace behind any quoting style
# (quoted spans, escapes, concatenations); the pre-verb matcher must still
# see the verb behind them.
assert_policy_blocks "git -C '/tmp/feature lane' commit --amend" "$AI_POLICY_GIT_AMEND"
assert_policy_blocks 'git -C "/tmp/feature lane" commit --amend' "$AI_POLICY_GIT_AMEND"
assert_policy_blocks 'git -C /tmp/feature\ lane commit --amend' "$AI_POLICY_GIT_AMEND"
assert_policy_blocks "git -C /tmp/'feature lane' commit --amend" "$AI_POLICY_GIT_AMEND"
assert_policy_blocks "git --git-dir='/tmp/feature lane/.git' commit --amend" "$AI_POLICY_GIT_AMEND"
ai_is_git_commit_cmd "git -C '/tmp/feature lane' commit -m x" \
  || fail "quoted -C argument must not unroute the commit wrapper"
assert_policy_allows "git -C '/tmp/feature lane' log --oneline"

# --- pre-hook work-root wiring: branch policy follows the command's target
# checkout, not the hook process cwd ----------------------------------------
# `git push` has no executing wrapper, so the pre hooks (no-direct-db.sh and the
# bash-pre-tool-use aggregate) are the only gate. A push/commit aimed at another
# checkout via a leading `cd <dir>`/`git -C <dir>` must be judged against THAT
# checkout's branch. Before the callers forwarded a resolved work root they
# evaluated the hook process cwd instead: a `cd <main> && git push` fired from a
# feature worktree slipped past the push-to-main guard, while the mirror
# `cd <feature> && git push` fired from main was blocked as a false positive.
# These run the real hook bodies with the payload cwd AND the process cwd parked
# on the OPPOSITE branch, so they fail on the cwd-only behavior and pass only
# once the caller resolves the command's target dir.
run_pre_hook_with_cwd() {
  local hook="$1" cmd="$2" payload_cwd="$3" proc_cwd="$4"
  (
    cd "$proc_cwd" || exit 1
    jq -n --arg c "$cmd" --arg cwd "$payload_cwd" \
      '{cwd:$cwd,tool_input:{command:$c}}' \
      | AI_STATE_ROOT="$AI_STATE_ROOT" \
        AI_BUN_LOG_DIR="$TMP_ROOT/workroot-bun-logs" \
        AI_PRECOMMIT_LOG_DIR="$AI_PRECOMMIT_LOG_DIR" \
        CLAUDE_PROJECT_DIR="$REPO_ROOT" \
        bash "$hook"
  )
}

assert_pre_hook_blocks_cross_checkout() {
  local hook="$1" cmd="$2" payload_cwd="$3" proc_cwd="$4" expected="$5" out
  out=$(run_pre_hook_with_cwd "$hook" "$cmd" "$payload_cwd" "$proc_cwd")
  assert_hook_json "$out"
  [ "$(jq -r '.decision' <<< "$out")" = "block" ] \
    || fail "[$hook] must block cross-checkout [$cmd] (proc cwd $proc_cwd): $out"
  [ "$(jq -r '.reason' <<< "$out")" = "$expected" ] \
    || fail "[$hook] block reason mismatch for cross-checkout [$cmd]: $out"
}

assert_pre_hook_allows_cross_checkout() {
  local hook="$1" cmd="$2" payload_cwd="$3" proc_cwd="$4" out
  out=$(run_pre_hook_with_cwd "$hook" "$cmd" "$payload_cwd" "$proc_cwd")
  assert_hook_continue_json "$out"
}

BASH_PRE_TOOL_USE="$REPO_ROOT/scripts/ai-hooks/bash-pre-tool-use.sh"
for pre_hook in "$NO_DIRECT_DB_BODY" "$BASH_PRE_TOOL_USE"; do
  # `cd <dir> && git push`: the target checkout's branch decides, not the cwd.
  assert_pre_hook_blocks_cross_checkout "$pre_hook" \
    "cd $MAIN_BRANCH_REPO && git push" \
    "$FEATURE_BRANCH_REPO" "$FEATURE_BRANCH_REPO" "$AI_POLICY_GIT_PUSH_MAIN"
  assert_pre_hook_allows_cross_checkout "$pre_hook" \
    "cd $FEATURE_BRANCH_REPO && git push" \
    "$MAIN_BRANCH_REPO" "$MAIN_BRANCH_REPO"
  # `git -C <dir> commit`: same work-root resolution reaches the commit-on-main
  # guard for the global-option form.
  assert_pre_hook_blocks_cross_checkout "$pre_hook" \
    "git -C $MAIN_BRANCH_REPO commit -m 'wire work root through'" \
    "$FEATURE_BRANCH_REPO" "$FEATURE_BRANCH_REPO" "$AI_POLICY_GIT_COMMIT_ON_MAIN"
  assert_pre_hook_allows_cross_checkout "$pre_hook" \
    "git -C $FEATURE_BRANCH_REPO commit -m 'wire work root through'" \
    "$MAIN_BRANCH_REPO" "$MAIN_BRANCH_REPO"
  # `git -C <dir> push`: the original review bypass. Needs the non-commit
  # resolver generalization, so it lands with the merged branches.
  assert_pre_hook_blocks_cross_checkout "$pre_hook" \
    "git -C $MAIN_BRANCH_REPO push" \
    "$FEATURE_BRANCH_REPO" "$FEATURE_BRANCH_REPO" "$AI_POLICY_GIT_PUSH_MAIN"
  assert_pre_hook_allows_cross_checkout "$pre_hook" \
    "git -C $FEATURE_BRANCH_REPO push" \
    "$MAIN_BRANCH_REPO" "$MAIN_BRANCH_REPO"
done

assert_protected_file_entry() {
  local path="$1"
  local expected_key="$2"
  local expected_text="$3"
  local advisory key

  key=$(ai_protected_file_advisory_key "$path") \
    || fail "expected protected-file advisory key for $path"
  [ "$key" = "$expected_key" ] \
    || fail "protected-file advisory key mismatch for $path: expected $expected_key, got $key"
  advisory=$(ai_protected_file_advisory "$path") \
    || fail "expected protected-file advisory text for $path"
  assert_contains "$advisory" "$expected_text"
}

assert_protected_file_deny_entry() {
  local path="$1"
  local expected_key="$2"
  local expected_text="$3"
  local deny key

  key=$(ai_protected_file_deny_key "$path") \
    || fail "expected protected-file deny key for $path"
  [ "$key" = "$expected_key" ] \
    || fail "protected-file deny key mismatch for $path: expected $expected_key, got $key"
  deny=$(ai_protected_file_deny "$path") \
    || fail "expected protected-file deny text for $path"
  assert_contains "$deny" "$expected_text"
}

assert_protected_file_not_denied() {
  local path="$1"

  if ai_protected_file_deny "$path" >/dev/null; then
    fail "hand-maintained generated-directory document should not be denied: $path"
  fi
}

assert_protected_file_entry \
  "$REPO_ROOT/packages/server/prisma/schema.prisma" \
  "prisma-schema" \
  "Create a migration"
assert_protected_file_entry \
  "$REPO_ROOT/packages/server/src/routers/campaign.ts" \
  "guide-trpc-router" \
  "docs/guides/add-trpc-procedure.md"
assert_protected_file_entry \
  "$REPO_ROOT/packages/server/src/socket/map-broadcast.ts" \
  "guide-socket" \
  "docs/guides/add-socket-broadcast.md"
assert_protected_file_entry \
  "$REPO_ROOT/packages/shared/src/rules/character-rules.ts" \
  "guide-rules" \
  "docs/guides/change-rules-logic.md"
assert_protected_file_entry \
  "$REPO_ROOT/e2e/character-sheet.spec.ts" \
  "guide-e2e" \
  "docs/guides/add-e2e-test.md"
assert_protected_file_deny_entry \
  "$REPO_ROOT/lint-ratchet.baseline.json" \
  "tamper-lint-ratchet-baseline" \
  "bun run lint:ratchet:update"
assert_protected_file_entry \
  "$REPO_ROOT/eslint.config.js" \
  "tamper-eslint-config" \
  "Tamper advisory"
assert_protected_file_deny_entry \
  "$REPO_ROOT/scripts/eslint-disable-register.sh" \
  "tamper-suppression-register" \
  "register smoke tests"
assert_protected_file_deny_entry \
  "$REPO_ROOT/scripts/suppression-register.sh" \
  "tamper-suppression-register" \
  "register smoke tests"
assert_protected_file_deny_entry \
  "$REPO_ROOT/docs/generated/harness-controls.md" \
  "generated-harness-controls" \
  "bun run docs:harness-controls"
assert_protected_file_not_denied "$REPO_ROOT/docs/generated/README.md"
assert_protected_file_not_denied "$REPO_ROOT/docs/generated/lint-coverage-map.md"
assert_protected_file_not_denied "$REPO_ROOT/docs/generated/observed_flaky_tests.md"
assert_protected_file_deny_entry \
  "$REPO_ROOT/scripts/verify/steps.generated.sh" \
  "generated-verify-steps" \
  "bun run verify:steps"
assert_protected_file_deny_entry \
  "$REPO_ROOT/scripts/ai-hooks/hook-timeouts.generated.sh" \
  "generated-hook-timeouts" \
  "bun run harness:hook-timeouts"
assert_protected_file_deny_entry \
  "$REPO_ROOT/scripts/ai-hooks/classified-bun-scripts.generated.sh" \
  "generated-classified-bun-scripts" \
  "bun run verify:steps"
assert_protected_file_deny_entry \
  "$REPO_ROOT/scripts/tests/harness-check-fixture-manifest.generated.txt" \
  "generated-harness-check-fixture-manifest" \
  "bun run verify:steps"
assert_protected_file_deny_entry \
  "$REPO_ROOT/bun.lock" \
  "lockfile" \
  "bun install"
assert_protected_file_deny_entry \
  "$REPO_ROOT/.husky/_/husky.sh" \
  "husky-internals" \
  "bun install"
assert_protected_file_entry \
  "$REPO_ROOT/.husky/pre-commit" \
  "git-hook" \
  "Editing a git hook"
assert_protected_file_entry \
  "$REPO_ROOT/packages/server/src/utils/campaign-mutations.ts" \
  "concurrency-mutation-boundary" \
  "docs/CONCURRENCY.md"
assert_protected_file_entry \
  "$REPO_ROOT/packages/shared/src/schemas/auth.ts" \
  "shared-schema" \
  "Shared schemas"
if ai_protected_file_advisory "$REPO_ROOT/packages/server/src/main.ts" >/dev/null; then
  fail "unexpected protected-file advisory for unprotected file"
fi
if ai_protected_file_deny "$REPO_ROOT/packages/server/src/main.ts" >/dev/null; then
  fail "unexpected protected-file deny for unprotected file"
fi

protected_files_out_for_path() {
  local path="$1"
  local session="$2"
  local state_root="$3"
  local ttl="${4:-0}"
  local now="${5:-100000}"

  jq -n --arg path "$path" --arg session "$session" '{session_id:$session,tool_input:{file_path:$path}}' \
    | AI_STATE_ROOT="$state_root" \
      AI_PROTECTED_FILES_THROTTLE_TTL="$ttl" \
      AI_FAKE_NOW="$now" \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" \
      bash "$REPO_ROOT/.claude/hooks/protected-files.sh"
}

protected_files_out_for_apply_patch_in_dir() {
  local cwd="$1"
  local patch="$2"
  local session="$3"
  local state_root="$4"
  local ttl="${5:-0}"
  local now="${6:-100000}"

  (
    cd "$cwd"
    jq -n --arg command "$patch" --arg session "$session" \
      '{session_id:$session,tool_name:"apply_patch",tool_input:{command:$command}}' \
      | AI_STATE_ROOT="$state_root" \
        AI_PROTECTED_FILES_THROTTLE_TTL="$ttl" \
        AI_FAKE_NOW="$now" \
        CLAUDE_PROJECT_DIR="$REPO_ROOT" \
        bash "$REPO_ROOT/.codex/hooks/protected-files.sh"
  )
}

assert_protected_files_advisory() {
  local path="$1"
  local expected="$2"
  local output context

  output=$(protected_files_out_for_path "$path" "protected-files-$path" "$TMP_ROOT/protected-files-advisory-state")
  assert_hook_json "$output"
  [ "$(jq -r '.hookSpecificOutput.hookEventName // empty' <<< "$output")" = "PreToolUse" ] \
    || fail "protected-files hook should emit PreToolUse context for $path: $output"
  [ "$(jq -r '.decision // empty' <<< "$output")" = "" ] \
    || fail "protected-files advisory must not hard-block $path: $output"
  context=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$output")
  assert_contains "$context" "$expected"
}

assert_protected_files_advisory \
  "$REPO_ROOT/packages/server/src/routers/campaign.ts" \
  "docs/guides/add-trpc-procedure.md"
assert_protected_files_advisory \
  "$REPO_ROOT/packages/server/src/socket/map-broadcast.ts" \
  "docs/guides/add-socket-broadcast.md"
assert_protected_files_advisory \
  "$REPO_ROOT/packages/shared/src/rules/character-rules.ts" \
  "docs/guides/change-rules-logic.md"
assert_protected_files_advisory \
  "$REPO_ROOT/e2e/character-sheet.spec.ts" \
  "docs/guides/add-e2e-test.md"
assert_protected_files_advisory \
  "$REPO_ROOT/eslint.config.js" \
  "Tamper advisory"

assert_protected_files_deny() {
  local path="$1"
  local expected="$2"
  local output reason

  output=$(protected_files_out_for_path "$path" "protected-files-deny-$path" "$TMP_ROOT/protected-files-deny-state")
  assert_hook_json "$output"
  [ "$(jq -r '.decision // empty' <<< "$output")" = "deny" ] \
    || fail "protected-files hook should deny $path: $output"
  reason=$(jq -r '.reason // empty' <<< "$output")
  assert_contains "$reason" "$expected"
}

assert_protected_files_allow() {
  local path="$1"
  local output

  output=$(protected_files_out_for_path "$path" "protected-files-allow-$path" "$TMP_ROOT/protected-files-allow-state")
  assert_hook_continue_json "$output"
}

assert_protected_files_deny \
  "$REPO_ROOT/lint-ratchet.baseline.json" \
  "bun run lint:ratchet:update"
assert_protected_files_deny \
  "$REPO_ROOT/scripts/eslint-disable-register.sh" \
  "register smoke tests"
assert_protected_files_deny \
  "$REPO_ROOT/docs/generated/local-lint-rules.md" \
  "bun run docs:lint-guidance"
assert_protected_files_allow "$REPO_ROOT/docs/generated/README.md"
assert_protected_files_allow "$REPO_ROOT/docs/generated/lint-coverage-map.md"
assert_protected_files_allow "$REPO_ROOT/docs/generated/observed_flaky_tests.md"
assert_protected_files_deny \
  "$REPO_ROOT/scripts/verify/steps.generated.sh" \
  "bun run verify:steps"
assert_protected_files_deny \
  "$REPO_ROOT/scripts/ai-hooks/hook-timeouts.generated.sh" \
  "bun run harness:hook-timeouts"
assert_protected_files_deny \
  "$REPO_ROOT/scripts/ai-hooks/classified-bun-scripts.generated.sh" \
  "bun run verify:steps"
assert_protected_files_deny \
  "$REPO_ROOT/bun.lock" \
  "bun install"
assert_protected_files_deny \
  "$REPO_ROOT/.husky/_/pre-commit" \
  "bun install"

PROTECTED_ADD_FILE_PATCH=$'*** Begin Patch\n*** Add File: new-protected-hook-test.md\n+generated by test\n*** End Patch'
PROTECTED_NEW_FILE_OUT=$(
  protected_files_out_for_apply_patch_in_dir \
    "$REPO_ROOT/docs/generated" \
    "$PROTECTED_ADD_FILE_PATCH" \
    "protected-files-new-generated-file" \
    "$TMP_ROOT/protected-files-new-generated-state"
)
assert_hook_json "$PROTECTED_NEW_FILE_OUT"
[ "$(jq -r '.decision // empty' <<< "$PROTECTED_NEW_FILE_OUT")" = "deny" ] \
  || fail "protected-files hook should deny new apply_patch files under protected cwd: $PROTECTED_NEW_FILE_OUT"
assert_contains "$(jq -r '.reason // empty' <<< "$PROTECTED_NEW_FILE_OUT")" \
  "Protected generated file"

PROTECTED_THROTTLE_STATE="$TMP_ROOT/protected-files-throttle-state"
PROTECTED_THROTTLE_PATH="$REPO_ROOT/packages/server/src/routers/character.ts"
PROTECTED_THROTTLE_OUT=$(
  protected_files_out_for_path "$PROTECTED_THROTTLE_PATH" "protected-files-throttle" "$PROTECTED_THROTTLE_STATE" 1800 200000
)
assert_hook_json "$PROTECTED_THROTTLE_OUT"
assert_contains "$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$PROTECTED_THROTTLE_OUT")" \
  "docs/guides/add-trpc-procedure.md"
PROTECTED_THROTTLE_OUT=$(
  protected_files_out_for_path "$PROTECTED_THROTTLE_PATH" "protected-files-throttle" "$PROTECTED_THROTTLE_STATE" 1800 200000
)
assert_hook_continue_json "$PROTECTED_THROTTLE_OUT"

PROTECTED_DENY_THROTTLE_OUT=$(
  protected_files_out_for_path "$REPO_ROOT/bun.lock" "protected-files-deny-throttle" "$PROTECTED_THROTTLE_STATE" 1800 200000
)
assert_hook_json "$PROTECTED_DENY_THROTTLE_OUT"
[ "$(jq -r '.decision // empty' <<< "$PROTECTED_DENY_THROTTLE_OUT")" = "deny" ] \
  || fail "protected-files deny tier should not be throttled: $PROTECTED_DENY_THROTTLE_OUT"

POLICY_ONLY_OUT="$TMP_ROOT/policy-only-protected-files.out"
POLICY_ONLY_ERR="$TMP_ROOT/policy-only-protected-files.err"
policy_only_probe "printf '%s\n' x > lint-ratchet.baseline.json" "marker-absent" "$POLICY_ONLY_OUT" "$POLICY_ONLY_ERR"
POLICY_ONLY_TEXT=$(<"$POLICY_ONLY_OUT")
POLICY_ONLY_STDERR=$(<"$POLICY_ONLY_ERR")
assert_not_contains "$POLICY_ONLY_STDERR" "command not found"
assert_contains "$POLICY_ONLY_TEXT" "reason=protected-files: Protected file"
assert_contains "$POLICY_ONLY_TEXT" "advisory="

policy_only_probe "printf '%s\n' x > lint-ratchet.baseline.json" "marker-active" "$POLICY_ONLY_OUT" "$POLICY_ONLY_ERR"
POLICY_ONLY_TEXT=$(<"$POLICY_ONLY_OUT")
POLICY_ONLY_STDERR=$(<"$POLICY_ONLY_ERR")
assert_not_contains "$POLICY_ONLY_STDERR" "command not found"
assert_contains "$POLICY_ONLY_TEXT" "reason="
assert_contains "$POLICY_ONLY_TEXT" "advisory=protected-files: Repo-wide"
assert_contains "$POLICY_ONLY_TEXT" "would have been denied for $REPO_ROOT/lint-ratchet.baseline.json"

PROTECTED_ALLOW_MARKER="$REPO_ROOT/.allow-protected-edits"
touch "$PROTECTED_ALLOW_MARKER"
PROTECTED_BASH_MARKER_REASON=$(ai_policy_violation_reason "printf '%s\n' x > bun.lock" || true)
PROTECTED_BASH_MARKER_CONTEXT=$(ai_policy_advisory_context "printf '%s\n' x > bun.lock" || true)
PROTECTED_MARKER_OUT=$(
  protected_files_out_for_path "$REPO_ROOT/bun.lock" "protected-files-marker" "$TMP_ROOT/protected-files-marker-state"
)
rm -f "$PROTECTED_ALLOW_MARKER"
[ -z "$PROTECTED_BASH_MARKER_REASON" ] \
  || fail "protected-files Bash marker should downgrade deny to advisory: $PROTECTED_BASH_MARKER_REASON"
assert_contains "$PROTECTED_BASH_MARKER_CONTEXT" ".allow-protected-edits"
assert_contains "$PROTECTED_BASH_MARKER_CONTEXT" "would have been denied for $REPO_ROOT/bun.lock"
assert_hook_json "$PROTECTED_MARKER_OUT"
[ "$(jq -r '.decision // empty' <<< "$PROTECTED_MARKER_OUT")" = "" ] \
  || fail "protected-files marker should downgrade deny to advisory: $PROTECTED_MARKER_OUT"
PROTECTED_MARKER_CONTEXT=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$PROTECTED_MARKER_OUT")
assert_contains "$PROTECTED_MARKER_CONTEXT" ".allow-protected-edits"
assert_contains "$PROTECTED_MARKER_CONTEXT" "Repo-wide"
assert_contains "$PROTECTED_MARKER_CONTEXT" "would have been denied for $REPO_ROOT/bun.lock"
assert_contains "$PROTECTED_MARKER_CONTEXT" "Remove the marker"

AGENTS_DOC="$TMP_ROOT/AGENTS.md"
for _ in $(seq 1 251); do
  printf 'line\n' >> "$AGENTS_DOC"
done
DOC_MSG=$(musi_doc_length_advisory "$AGENTS_DOC")
assert_contains "$DOC_MSG" "doc-length advisory"
assert_contains "$DOC_MSG" "AGENTS.md is 251 lines"
assert_contains "$DOC_MSG" "budget: 250"
assert_contains "$DOC_MSG" "loaded into every agent session"
assert_not_contains "$DOC_MSG" "Trim it now"
assert_not_contains "$DOC_MSG" "threshold:"
[ "$(musi_doc_length_rule_surface "$AGENTS_DOC")" = "edit" ] \
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
COUNT_MSG=$(musi_doc_length_advisory_for_count "$IN_PROGRESS_DOC" 301)
assert_contains "$COUNT_MSG" "doc-length advisory"
assert_contains "$COUNT_MSG" "long.md is 301 lines"
assert_contains "$COUNT_MSG" "budget: 300"
assert_contains "$COUNT_MSG" "in_progress notes can be long while work is active"
assert_not_contains "$COUNT_MSG" "Trim it now"
[ "$(musi_doc_length_rule_surface "$IN_PROGRESS_DOC")" = "commit" ] \
  || fail "in_progress docs should be commit-surface doc-length rules"

HOOK_MSG=$(
  jq -n --arg path "$IN_PROGRESS_DOC" '{tool_input:{file_path:$path}}' \
    | CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$SCRIPT_DIR/doc-length.sh"
)
assert_hook_continue_json "$HOOK_MSG"

SHORT_DOC="$TMP_ROOT/docs/agent_notes/README.md"
printf 'short\n' > "$SHORT_DOC"
if musi_doc_length_advisory "$SHORT_DOC" >/dev/null; then
  fail "unexpected doc-length advisory for short doc"
fi
if musi_doc_length_advisory_for_count "$SHORT_DOC" 1 >/dev/null; then
  fail "unexpected doc-length count advisory for short doc"
fi

# --- backlog-note-lint hook (Claude Edit|Write) ------------------------------
# Fixture backlog tree pointed at via AI_BACKLOG_NOTES_DIR so the scope filter
# runs against isolated notes instead of the live docs/agent_notes/backlog tree.
BACKLOG_NOTES_DIR="$TMP_ROOT/backlog"
mkdir -p "$BACKLOG_NOTES_DIR/pack"

BACKLOG_DIRTY_NOTE="$BACKLOG_NOTES_DIR/pack/dirty.md"
printf '# Dirty note\n\nNo front matter here.\n' > "$BACKLOG_DIRTY_NOTE"
BACKLOG_DIRTY_OUT=$(
  jq -n --arg path "$BACKLOG_DIRTY_NOTE" '{tool_input:{file_path:$path}}' \
    | AI_BACKLOG_NOTES_DIR="$BACKLOG_NOTES_DIR" \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$SCRIPT_DIR/backlog-note-lint.sh"
)
assert_hook_json "$BACKLOG_DIRTY_OUT"
[ "$(jq -r '.hookSpecificOutput.hookEventName // empty' <<< "$BACKLOG_DIRTY_OUT")" = "PostToolUse" ] \
  || fail "backlog-note-lint should emit PostToolUse context for a dirty note: $BACKLOG_DIRTY_OUT"
BACKLOG_DIRTY_CONTEXT=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$BACKLOG_DIRTY_OUT")
assert_contains "$BACKLOG_DIRTY_CONTEXT" "backlog:lint advisory findings"
assert_contains "$BACKLOG_DIRTY_CONTEXT" "Missing Status:"
assert_contains "$BACKLOG_DIRTY_CONTEXT" "Missing Date:"

# A clean note carries the required front matter and must stay silent.
BACKLOG_CLEAN_NOTE="$BACKLOG_NOTES_DIR/pack/clean.md"
printf -- '---\nStatus: Ready\nDate: 2026-07-08\n---\n\n# Clean note\n\nBody.\n' > "$BACKLOG_CLEAN_NOTE"
BACKLOG_CLEAN_OUT=$(
  jq -n --arg path "$BACKLOG_CLEAN_NOTE" '{tool_input:{file_path:$path}}' \
    | AI_BACKLOG_NOTES_DIR="$BACKLOG_NOTES_DIR" \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$SCRIPT_DIR/backlog-note-lint.sh"
)
assert_hook_continue_json "$BACKLOG_CLEAN_OUT"

# Pack-level findings must also run against the overridden backlog root. This
# fixture is clean as a single note but its pack lacks a required index.
BACKLOG_MISSING_INDEX_DIR="$BACKLOG_NOTES_DIR/missing-index"
mkdir -p "$BACKLOG_MISSING_INDEX_DIR"
BACKLOG_MISSING_INDEX_NOTE="$BACKLOG_MISSING_INDEX_DIR/10-a.md"
printf '# A\n\nStatus: Ready\nDate: 2026-07-08\n' > "$BACKLOG_MISSING_INDEX_NOTE"
printf '# B\n\nStatus: Ready\nDate: 2026-07-08\n' > "$BACKLOG_MISSING_INDEX_DIR/11-b.md"
BACKLOG_MISSING_INDEX_OUT=$(
  jq -n --arg path "$BACKLOG_MISSING_INDEX_NOTE" '{tool_input:{file_path:$path}}' \
    | AI_BACKLOG_NOTES_DIR="$BACKLOG_NOTES_DIR" \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$SCRIPT_DIR/backlog-note-lint.sh"
)
assert_hook_json "$BACKLOG_MISSING_INDEX_OUT"
[ "$(jq -r '.hookSpecificOutput.hookEventName // empty' <<< "$BACKLOG_MISSING_INDEX_OUT")" = "PostToolUse" ] \
  || fail "backlog-note-lint should emit PostToolUse context for overridden-root pack findings: $BACKLOG_MISSING_INDEX_OUT"
BACKLOG_MISSING_INDEX_CONTEXT=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$BACKLOG_MISSING_INDEX_OUT")
assert_contains "$BACKLOG_MISSING_INDEX_CONTEXT" "Missing Pack Index:"
assert_contains "$BACKLOG_MISSING_INDEX_CONTEXT" "$BACKLOG_MISSING_INDEX_DIR"

# A markdown edit outside the backlog tree must stay silent (hot path).
BACKLOG_OUTSIDE_NOTE="$TMP_ROOT/not-backlog/note.md"
mkdir -p "$(dirname "$BACKLOG_OUTSIDE_NOTE")"
printf '# Outside\n\nno front matter\n' > "$BACKLOG_OUTSIDE_NOTE"
BACKLOG_OUTSIDE_OUT=$(
  jq -n --arg path "$BACKLOG_OUTSIDE_NOTE" '{tool_input:{file_path:$path}}' \
    | AI_BACKLOG_NOTES_DIR="$BACKLOG_NOTES_DIR" \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$SCRIPT_DIR/backlog-note-lint.sh"
)
assert_hook_continue_json "$BACKLOG_OUTSIDE_OUT"

# A deleted/renamed-away note is in scope by path but absent on disk; file mode
# skips it silently rather than reporting a phantom finding.
BACKLOG_DELETED_OUT=$(
  jq -n --arg path "$BACKLOG_NOTES_DIR/pack/gone.md" '{tool_input:{file_path:$path}}' \
    | AI_BACKLOG_NOTES_DIR="$BACKLOG_NOTES_DIR" \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$SCRIPT_DIR/backlog-note-lint.sh"
)
assert_hook_continue_json "$BACKLOG_DELETED_OUT"

# --- Codex apply_patch wiring -------------------------------------------------
# Extracted to a focused script so this adapter family can also run on its own
# (`bash scripts/ai-hooks/test-codex-wiring.sh`). Stdout is discarded so the
# aggregate keeps its single "ai-hooks tests passed" success line; any failure
# still exits non-zero and prints its FAIL reason on stderr.
bash "$SCRIPT_DIR/test-codex-wiring.sh" >/dev/null
# --- Copilot payload wiring ---------------------------------------------------
# Extracted to a focused script so this adapter family can also run on its own
# (`bash scripts/ai-hooks/test-copilot-wiring.sh`). Stdout is discarded so the
# aggregate keeps its single "ai-hooks tests passed" success line; any failure
# still exits non-zero and prints its FAIL reason on stderr.
bash "$SCRIPT_DIR/test-copilot-wiring.sh" >/dev/null
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
# --- session-state hook -------------------------------------------------------
# Extracted to a focused script so this behavior family can also run on its own
# (`bash scripts/ai-hooks/test-session-state.sh`). Stdout is discarded so the
# aggregate keeps its single "ai-hooks tests passed" success line; any failure
# still exits non-zero and prints its FAIL reason on stderr.
bash "$SCRIPT_DIR/test-session-state.sh" >/dev/null

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

PRISMA_LOCK_FAIL_BIN="$TMP_ROOT/prisma-lock-fail-bin"
PRISMA_LOCK_FAIL_SENTINEL="$TMP_ROOT/prisma-lock-fail-invoked"
mkdir -p "$PRISMA_LOCK_FAIL_BIN"
{
  printf '#!/bin/bash\n'
  printf 'touch "$PRISMA_LOCK_FAIL_SENTINEL"\n'
  printf 'printf "unexpected prisma generate invocation\\n" >&2\n'
  printf 'exit 99\n'
} > "$PRISMA_LOCK_FAIL_BIN/bun"
chmod +x "$PRISMA_LOCK_FAIL_BIN/bun"

PRISMA_LOCK_MKDIR_PARENT="$TMP_ROOT/prisma-lock-mkdir-parent"
printf 'not a directory\n' > "$PRISMA_LOCK_MKDIR_PARENT"
PRISMA_LOCK_MKDIR_OUTPUT=$(
  jq -n --arg path "$REPO_ROOT/packages/server/prisma/schema.prisma" '{tool_input:{file_path:$path}}' \
    | AI_PRISMA_STATE_DIR="$PRISMA_LOCK_MKDIR_PARENT/state" \
      PRISMA_LOCK_FAIL_SENTINEL="$PRISMA_LOCK_FAIL_SENTINEL" \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" \
      PATH="$PRISMA_LOCK_FAIL_BIN:$PATH" \
      bash "$REPO_ROOT/.claude/hooks/prisma-generate.sh"
)
assert_hook_json "$PRISMA_LOCK_MKDIR_OUTPUT"
[ "$(jq -r '.decision // empty' <<< "$PRISMA_LOCK_MKDIR_OUTPUT")" = "block" ] \
  || fail "prisma hook should block when state directory mkdir fails: $PRISMA_LOCK_MKDIR_OUTPUT"
assert_contains "$(jq -r '.reason // empty' <<< "$PRISMA_LOCK_MKDIR_OUTPUT")" \
  "could not prepare state directory for lock"
assert_contains "$(jq -r '.reason // empty' <<< "$PRISMA_LOCK_MKDIR_OUTPUT")" \
  "State directory: $PRISMA_LOCK_MKDIR_PARENT/state"
[ ! -e "$PRISMA_LOCK_FAIL_SENTINEL" ] \
  || fail "prisma hook should not run generate when state directory mkdir fails"

PRISMA_LOCK_OPEN_OUTPUT=$(
  jq -n --arg path "$REPO_ROOT/packages/server/prisma/schema.prisma" '{tool_input:{file_path:$path}}' \
    | AI_PRISMA_STATE_DIR="$TMP_ROOT/prisma-lock-open-state" \
      AI_PRISMA_LOCK="$TMP_ROOT/prisma-lock-missing-parent/lock" \
      PRISMA_LOCK_FAIL_SENTINEL="$PRISMA_LOCK_FAIL_SENTINEL" \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" \
      PATH="$PRISMA_LOCK_FAIL_BIN:$PATH" \
      bash "$REPO_ROOT/.claude/hooks/prisma-generate.sh"
)
assert_hook_json "$PRISMA_LOCK_OPEN_OUTPUT"
[ "$(jq -r '.decision // empty' <<< "$PRISMA_LOCK_OPEN_OUTPUT")" = "block" ] \
  || fail "prisma hook should block when lock open fails: $PRISMA_LOCK_OPEN_OUTPUT"
assert_contains "$(jq -r '.reason // empty' <<< "$PRISMA_LOCK_OPEN_OUTPUT")" "could not open lock"
[ ! -e "$PRISMA_LOCK_FAIL_SENTINEL" ] \
  || fail "prisma hook should not run generate when lock open fails"

rm -f "$PRISMA_LOCK_FAIL_SENTINEL"
{
  printf '#!/bin/bash\n'
  printf 'exit 73\n'
} > "$PRISMA_LOCK_FAIL_BIN/flock"
chmod +x "$PRISMA_LOCK_FAIL_BIN/flock"
PRISMA_LOCK_FLOCK_OUTPUT=$(
  jq -n --arg path "$REPO_ROOT/packages/server/prisma/schema.prisma" '{tool_input:{file_path:$path}}' \
    | AI_PRISMA_STATE_DIR="$TMP_ROOT/prisma-lock-flock-state" \
      AI_PRISMA_LOCK="$TMP_ROOT/prisma-lock-flock-state/lock" \
      PRISMA_LOCK_FAIL_SENTINEL="$PRISMA_LOCK_FAIL_SENTINEL" \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" \
      PATH="$PRISMA_LOCK_FAIL_BIN:$PATH" \
      bash "$REPO_ROOT/.claude/hooks/prisma-generate.sh"
)
assert_hook_json "$PRISMA_LOCK_FLOCK_OUTPUT"
[ "$(jq -r '.decision // empty' <<< "$PRISMA_LOCK_FLOCK_OUTPUT")" = "block" ] \
  || fail "prisma hook should block when flock fails: $PRISMA_LOCK_FLOCK_OUTPUT"
assert_contains "$(jq -r '.reason // empty' <<< "$PRISMA_LOCK_FLOCK_OUTPUT")" "could not acquire lock"
[ ! -e "$PRISMA_LOCK_FAIL_SENTINEL" ] \
  || fail "prisma hook should not run generate when flock fails"

assert_bun_package_scripts_are_classified

assert_wrapped_bun "bun run adr:check"
assert_wrapped_bun "bun run lint"
assert_wrapped_bun "bun run lint:changed"
assert_wrapped_bun "bun run lint:shell"
assert_wrapped_bun "bun run lint:ratchet:check-baseline"
assert_wrapped_bun "bun run typecheck"
assert_wrapped_bun "bun run test:changed"
assert_wrapped_bun "bun run test:client"
assert_wrapped_bun "bun run test:client:split"
assert_wrapped_bun "bun run test:client:isolated"
assert_wrapped_bun "bun run test:eslint-rules -- eslint-rules/no-barrel.test.js"
assert_wrapped_bun "bun run test:scripts:file -- scripts/logs-audit/logs-audit.test.ts"
assert_wrapped_bun "bun run test:slow"
assert_wrapped_bun "bun run e2e"
assert_wrapped_bun "bun run eval:lint-messages"
assert_wrapped_bun "bun run format:check"
assert_wrapped_bun "bun run format:changed:check"
assert_wrapped_bun "bun run build --silent"
assert_wrapped_bun "bun run code:intel -- exports packages/shared/src/constants.ts"
assert_wrapped_bun "bun run drift:ai --scope current --check all"
assert_wrapped_bun "bun run drift:triage --format json report.json"
assert_wrapped_bun "bun run logs:audit --file reports/server.jsonl"
assert_wrapped_bun "bun run harness:audit --format json reports/envelope.json"
assert_wrapped_bun "bun run verify"
assert_wrapped_bun "bun run verify:changed"
assert_wrapped_bun "bun run verify:slow"
assert_wrapped_bun "bun run verify:parallel"
assert_wrapped_bun "bun run verify:logs budget"
assert_wrapped_bun "bun run verify:steps:check"
assert_wrapped_bun "bun run harness:hook-timeouts:check"
assert_wrapped_bun "bun run verify:async:status"
assert_wrapped_bun "bun run verify:async:tail"
assert_wrapped_bun "bun run verify:async:stop"

assert_unwrapped_bun "bun run dev"
assert_unwrapped_bun "bun run db:status"
assert_unwrapped_bun "bun run test:watch"
assert_unwrapped_bun "bun run test:mutation"
assert_unwrapped_bun "bun run docs:harness-controls"
assert_unwrapped_bun "bun run harness:hook-timeouts"
assert_unwrapped_bun "bun run verify:steps"
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
assert_contains "$BUN_HOOK_OUT" 'Wait for the in-flight run to finish before retrying this command'
assert_not_contains "$BUN_HOOK_OUT" 'flock '"$BUN_HOOK_LOCK"' true && echo FREE'
assert_not_contains "$BUN_HOOK_OUT" 'Monitor'

BUN_DEFAULT_WAIT_OUT=$(
  (
    exec 8<>"$TMP_ROOT/bun-default-wait-lock"
    flock -n 8 || exit 1
    printf 'PID=fixture SCRIPT=lint STARTED=now\n' > "$TMP_ROOT/bun-default-wait-lock"
    sleep 2
  ) &
  holder=$!
  sleep 0.2
  printf '{"tool_input":{"command":"bun run lint","run_in_background":false}}' \
    | AI_BUN_LOCK="$TMP_ROOT/bun-default-wait-lock" \
      MUSI_INTERACTIVE_TIMEOUT=1 \
      bash "$BUN_HOOK"
  wait "$holder" 2>/dev/null || true
)
assert_contains "$BUN_DEFAULT_WAIT_OUT" '"decision": "block"'
assert_contains "$BUN_DEFAULT_WAIT_OUT" 'Waited 1s'

assert_claude_bun_lock_wait_subtracts_watchdog_budget() {
  local fake_bin="$TMP_ROOT/fake-bun-budget-bin"
  local lock="$TMP_ROOT/bun-budget-lock"
  local hook_out reason second

  mkdir -p "$fake_bin"
  cat > "$fake_bin/bun" <<'SH'
#!/bin/bash
if [ "$1" = "run" ] && [ "$2" = "lint" ]; then
  sleep 5
  exit 0
fi
printf 'unexpected fake bun argv: %s\n' "$*" >&2
exit 64
SH
  chmod +x "$fake_bin/bun"

  second=$(date +%s)
  while [ "$(date +%s)" = "$second" ]; do
    sleep 0.05
  done
  (
    exec 8<>"$lock"
    flock -n 8 || exit 1
    printf 'PID=fixture SCRIPT=lint STARTED=now\n' > "$lock"
    sleep 1.2
  ) &
  holder=$!
  sleep 0.2

  hook_out=$(
    printf '{"tool_input":{"command":"bun run lint","run_in_background":false}}' \
      | AI_BUN_LOCK="$lock" \
        AI_BUN_LOCK_WAIT=3 \
        AI_BUN_TIMEOUT=3 \
        AI_BUN_LOG_DIR="$TMP_ROOT/bun-budget-logs" \
        AI_BUN_TTL=0 \
        PATH="$fake_bin:$PATH" \
        bash "$BUN_HOOK"
  )
  wait "$holder" 2>/dev/null || true
  reason=$(printf '%s' "$hook_out" | jq -r '.reason // empty')

  [ "$(printf '%s' "$hook_out" | jq -r '.decision // empty')" = "block" ] \
    || fail "Claude bun hook should block after lock wait consumes budget: $hook_out"
  assert_contains "$reason" "lint killed by watchdog"
  assert_not_contains "$reason" "at 3s"
}

assert_claude_bun_timeout_clamps_to_hook_margin() {
  local lock="$TMP_ROOT/bun-timeout-clamp-lock"
  local hook_out="$TMP_ROOT/bun-timeout-clamp.out"
  local hook_err="$TMP_ROOT/bun-timeout-clamp.err"
  local reason

  (
    exec 8<>"$lock"
    flock -n 8 || exit 1
    printf 'PID=fixture SCRIPT=lint STARTED=now\n' > "$lock"
    sleep 2
  ) &
  holder=$!
  sleep 0.2

  printf '{"tool_input":{"command":"bun run lint","run_in_background":false}}' \
    | AI_BUN_LOCK="$lock" \
      AI_BUN_LOCK_WAIT=1 \
      AI_BUN_TIMEOUT=2500 \
      bash "$BUN_HOOK" > "$hook_out" 2> "$hook_err" \
    || fail "Claude bun hook timeout clamp fixture failed"
  wait "$holder" 2>/dev/null || true
  reason=$(jq -r '.reason // empty' "$hook_out")

  [ "$(jq -r '.decision // empty' "$hook_out")" = "block" ] \
    || fail "Claude bun hook should block on held lock with clamp active: $(cat "$hook_out")"
  assert_contains "$reason" "Waited 1s"
  assert_contains "$(cat "$hook_err")" "bun-run-quiet: clamped timeout from 2500s to 2400s"
  assert_contains "$(cat "$hook_err")" "generated hook timeout 2460s"
}

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

# The suffix keys on the fast-commit provenance log (actual skip outcome),
# not on marker presence: a marker-set commit whose HEAD was never logged
# (docs-only, bridged, fully verified) must not claim skipped slots.
assert_commit_success_summary_fast_commit_notice() {
  local repo="$TMP_ROOT/fast-commit-summary-repo"
  local before after summary common_dir

  git init -q "$repo"
  git -C "$repo" config user.email test@example.invalid
  git -C "$repo" config user.name Test
  printf 'one\n' > "$repo/file.txt"
  git -C "$repo" add file.txt
  git -C "$repo" commit -qm "test: initial fixture"
  before=$(git -C "$repo" rev-parse HEAD)
  printf 'two\n' >> "$repo/file.txt"
  git -C "$repo" add file.txt
  git -C "$repo" commit -qm "test: update fixture"
  after=$(git -C "$repo" rev-parse HEAD)

  summary=$(ai_commit_success_summary "$repo" "$before" "$after")
  assert_not_contains "$summary" "fast-commit: test+scripts slots skipped"

  # Marker present but HEAD not in the provenance log (nothing was actually
  # skipped): no skip claim.
  common_dir=$(musi_git_common_identity_path "$repo")
  : > "$common_dir/musi-fast-commit"
  summary=$(ai_commit_success_summary "$repo" "$before" "$after")
  assert_not_contains "$summary" "fast-commit: test+scripts slots skipped"

  # HEAD recorded in the provenance log: the suffix appears.
  musi_fast_commit_log_append "$repo" "$after"
  summary=$(ai_commit_success_summary "$repo" "$before" "$after")
  assert_contains "$summary" "fast-commit: test+scripts slots skipped"
  assert_contains "$summary" "bash scripts/land.sh"

  # A logged non-HEAD commit must not stamp the suffix onto a later commit.
  musi_fast_commit_log_clear "$repo" "$after"
  musi_fast_commit_log_append "$repo" "$before"
  summary=$(ai_commit_success_summary "$repo" "$before" "$after")
  assert_not_contains "$summary" "fast-commit: test+scripts slots skipped"

  rm -f "$common_dir/musi-fast-commit"
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
  assert_contains "$reason" "Check git status --short and git log -1 --oneline before retrying"
  assert_contains "$reason" "$head"
  assert_not_contains "$reason" "commit-timeout-status.sh"
  assert_not_contains "$reason" "Monitor"
  assert_not_contains "$reason" "backgrounded"
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
  assert_contains "$reason" "Check git status --short and git log -1 --oneline before retrying"
  assert_not_contains "$reason" "commit-timeout-status.sh"
  assert_not_contains "$reason" "Monitor"
  assert_not_contains "$reason" "backgrounded"
}

assert_git_commit_quiet_body_non_commit_passthrough() {
  local hook_out

  hook_out=$(
    printf '{"tool_input":{"command":"echo hi"}}' \
      | bash "$REPO_ROOT/scripts/ai-hooks/git-commit-quiet.sh"
  )

  assert_hook_continue_json "$hook_out"
}

assert_git_commit_quiet_lock_contention_fail_fast() {
  local lock="$TMP_ROOT/git-commit-quiet-held-lock"
  local hook_out reason

  (
    exec 8<>"$lock"
    flock -n 8 || exit 1
    printf 'PID=fixture STARTED=now\n' > "$lock"
    sleep 2
  ) &
  holder=$!
  sleep 0.2

  hook_out=$(
    # git-commit-quiet.sh runs the commit-policy preflight against the resolved
    # WORK_ROOT, so a plain `git commit` is (correctly) blocked on main/master
    # before the lock check under test. Point the payload cwd at a feature-branch
    # repo to reach the lock path regardless of the branch the harness runs on.
    jq -n --arg cwd "$FEATURE_BRANCH_REPO" \
      '{cwd:$cwd, tool_input:{command:"git commit -m test"}}' \
      | AI_GIT_COMMIT_LOCK="$lock" \
        bash "$REPO_ROOT/scripts/ai-hooks/git-commit-quiet.sh"
  )
  wait "$holder" 2>/dev/null || true
  reason=$(printf '%s' "$hook_out" | jq -r '.reason // empty')

  [ "$(printf '%s' "$hook_out" | jq -r '.decision // empty')" = "block" ] \
    || fail "git-commit-quiet should block when its worktree lock is held: $hook_out"
  assert_contains "$reason" "Another git commit is in progress"
  assert_contains "$reason" "PID=fixture"
}

assert_git_commit_quiet_shared_queue_blocks_other_worktrees() {
  local queue_lock="$TMP_ROOT/git-commit-shared-queue-lock"
  local first_lock="$TMP_ROOT/git-commit-worktree-a.lock"
  local second_lock="$TMP_ROOT/git-commit-worktree-b.lock"
  local first_out="$TMP_ROOT/git-commit-shared-first.out"
  local ready="$TMP_ROOT/git-commit-shared-queue.ready"
  local release="$TMP_ROOT/git-commit-shared-queue.release"
  local second_out reason decision waited=0

  # Two-marker handshake instead of a wall-clock `sleep 2` hold: the holder's
  # command touches `ready` only once the wrapper has acquired the shared queue
  # flock (bash -c runs post-acquisition), then blocks until `release` exists.
  # Grepping the lock file's CONTENT is not a liveness signal — the wrapper
  # truncate-writes holder info after acquiring and nothing clears it on
  # release, so under parallel-lane load the old content poll matched residue
  # from an already-exited holder and the waiter saw an uncontended acquire.
  # The `ready` marker exists only while the holder is alive inside its
  # critical section, so the waiter below always meets a genuinely held flock.
  # Backstop bound: AI_GIT_COMMIT_TIMEOUT=30 arms the wrapper's watchdog, which
  # reaps the holder tree even if `release` were never touched.
  (
    jq -n --arg cmd "git commit --dry-run >/dev/null 2>&1; touch '$ready'; until [ -e '$release' ]; do sleep 0.05; done" \
      '{tool_input:{command:$cmd}}' \
      | AI_GIT_COMMIT_LOCK="$first_lock" \
        MUSI_COMMIT_QUEUE_LOCK="$queue_lock" \
        AI_GIT_COMMIT_TIMEOUT=30 \
        bash "$REPO_ROOT/scripts/ai-hooks/git-commit-quiet.sh" > "$first_out"
  ) &
  first_pid=$!

  # Bounded wait (10s) for proof-of-acquisition.
  while [ "$waited" -lt 100 ]; do
    [ -e "$ready" ] && break
    sleep 0.1
    waited=$((waited + 1))
  done
  if [ ! -e "$ready" ]; then
    touch "$release"
    wait "$first_pid" 2>/dev/null || true
    fail "first git-commit-quiet invocation did not signal shared-queue acquisition within 10s"
  fi

  # Guard every fallible step between here and the release/reap below: the
  # suite runs under set -e, so an unguarded nonzero substitution (waiter
  # pipeline, jq parse of its output) would exit the suite before the release
  # — and the suite EXIT trap deletes TMP_ROOT, leaving the holder blocked on
  # a marker path that can never appear until its 30s watchdog fires.
  second_out=$(
    jq -n --arg cmd "git commit --dry-run" '{tool_input:{command:$cmd}}' \
      | AI_GIT_COMMIT_LOCK="$second_lock" \
        MUSI_COMMIT_QUEUE_LOCK="$queue_lock" \
        MUSI_COMMIT_QUEUE_TIMEOUT=1 \
        AI_GIT_COMMIT_TIMEOUT=5 \
        bash "$REPO_ROOT/scripts/ai-hooks/git-commit-quiet.sh"
  ) || second_out="<waiter invocation failed: exit $?>"

  # Release and reap BEFORE parsing or asserting: fail (and any implicit
  # errexit) ends the suite, so cleanup placed after this point would leak a
  # holder still blocked on the release marker.
  touch "$release"
  wait "$first_pid" 2>/dev/null || true

  decision=$(printf '%s' "$second_out" | jq -r '.decision // empty' 2>/dev/null || true)
  reason=$(printf '%s' "$second_out" | jq -r '.reason // empty' 2>/dev/null || true)

  [ "$decision" = "block" ] \
    || fail "git-commit-quiet should block on shared queue held by another worktree: $second_out"
  assert_contains "$reason" "shared commit queue lock"
  assert_contains "$reason" "CMD=git commit --dry-run"
}

assert_git_commit_quiet_timeout_clamps_to_hook_margin() {
  local queue_lock="$TMP_ROOT/git-commit-timeout-clamp-queue.lock"
  local worktree_lock="$TMP_ROOT/git-commit-timeout-clamp-worktree.lock"
  local hook_out="$TMP_ROOT/git-commit-timeout-clamp.out"
  local hook_err="$TMP_ROOT/git-commit-timeout-clamp.err"
  local ready="$TMP_ROOT/git-commit-timeout-clamp.ready"
  local release="$TMP_ROOT/git-commit-timeout-clamp.release"
  local reason fixture_status waited=0

  # Two-marker handshake instead of a wall-clock hold (same cure as the
  # shared-queue sibling above): the holder touches `ready` only after
  # `flock -n` has actually succeeded, so the waiter below always meets a
  # genuinely held queue instead of racing a fixed startup grace. Unlike the
  # sibling, this holder is a raw subshell with no wrapper watchdog behind
  # it, so the release wait is bounded INSIDE the holder (~30s of short
  # sleeps) — an unbounded loop could leak past the suite forever.
  (
    exec 8<>"$queue_lock"
    flock -n 8 || exit 1
    printf 'PID=fixture WORKTREE=%s CMD=git commit --dry-run STARTED=now\n' "$FEATURE_BRANCH_REPO" > "$queue_lock"
    touch "$ready"
    held=0
    while [ "$held" -lt 600 ] && [ ! -e "$release" ]; do
      sleep 0.05
      held=$((held + 1))
    done
  ) &
  holder=$!

  # Bounded wait (10s) for proof-of-acquisition.
  while [ "$waited" -lt 100 ]; do
    [ -e "$ready" ] && break
    sleep 0.1
    waited=$((waited + 1))
  done
  if [ ! -e "$ready" ]; then
    touch "$release"
    wait "$holder" 2>/dev/null || true
    fail "timeout-clamp holder did not signal shared-queue acquisition within 10s"
  fi

  # Guard every fallible step between here and the release/reap below: the
  # suite runs under set -e, so an unguarded failure (fixture subshell, jq
  # parse) would exit the suite before the release — and the EXIT trap
  # deletes TMP_ROOT, leaving the holder blocked on a marker path that can
  # never appear until its own ~30s bound expires.
  fixture_status=0
  (
    cd "$FEATURE_BRANCH_REPO" || exit 1
    printf '{"tool_input":{"command":"git commit --dry-run"}}' \
      | AI_GIT_COMMIT_LOCK="$worktree_lock" \
        MUSI_COMMIT_QUEUE_LOCK="$queue_lock" \
        MUSI_COMMIT_QUEUE_TIMEOUT=1 \
        AI_GIT_COMMIT_TIMEOUT=2500 \
        bash "$REPO_ROOT/scripts/ai-hooks/git-commit-quiet.sh" > "$hook_out" 2> "$hook_err"
  ) || fixture_status=$?

  # Release and reap BEFORE any assertion or parse step: fail (and any
  # implicit errexit) ends the suite, so cleanup placed after this point
  # would leak a holder still blocked on the release marker.
  touch "$release"
  wait "$holder" 2>/dev/null || true

  [ "$fixture_status" -eq 0 ] \
    || fail "git-commit-quiet timeout clamp fixture failed (exit $fixture_status): $(cat "$hook_err" 2>/dev/null || true)"
  reason=$(jq -r '.reason // empty' "$hook_out" 2>/dev/null || true)

  [ "$(jq -r '.decision // empty' "$hook_out" 2>/dev/null || true)" = "block" ] \
    || fail "git-commit-quiet should block on held queue with clamp active: $(cat "$hook_out")"
  assert_contains "$reason" "shared commit queue lock"
  assert_contains "$(cat "$hook_err")" "git-commit-quiet: clamped timeout from 2500s to 2400s"
  assert_contains "$(cat "$hook_err")" "generated hook timeout 2460s"
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
  #
  # ai_preflight_or_block consults the ambient branch, and a plain commit is
  # (correctly) blocked on main/master — so isolate the branch-independent guard
  # under test in a feature-branch repo. Otherwise this fails whenever the
  # harness itself runs on the protected branch (e.g. `bun run verify` on main).
  cd "$FEATURE_BRANCH_REPO" || fail "could not cd to feature-branch repo"
  assert_preflight_allows "git commit -m 'normal commit message'"
  assert_preflight_allows "git commit -F /tmp/commit-msg.txt"
  assert_preflight_allows "git commit -c HEAD~1"
  assert_preflight_allows "git -c commit.gpgsign=false commit -m normal"
  cd "$REPO_ROOT" || fail "could not cd back to repo root"
  # Hard policy violations the executing hook could otherwise run are blocked
  # before exec — the adjacent-`git commit` amend form this hook actually runs.
  assert_preflight_blocks "git commit --amend --no-edit" "$AI_POLICY_GIT_AMEND"
}

assert_claude_git_commit_timeout_guidance() {
  local marker="54321"
  local hook_out reason pid args

  hook_out=$(
    printf '{"tool_input":{"command":"git commit --dry-run >/dev/null 2>&1; sleep %s; echo done >/dev/null"}}' "$marker" \
      | AI_GIT_COMMIT_LOCK="$TMP_ROOT/git-commit-lock" \
        MUSI_COMMIT_QUEUE_LOCK="$TMP_ROOT/git-commit-timeout-queue-lock" \
        AI_GIT_COMMIT_TIMEOUT=1 \
        bash "$REPO_ROOT/.claude/hooks/git-commit-quiet.sh"
  )
  while IFS= read -r pid; do
    args=$(ps -o args= -p "$pid" 2>/dev/null || true)
    [ "$args" = "sleep $marker" ] && kill "$pid" 2>/dev/null || true
  done < <(pgrep -x sleep 2>/dev/null || true)
  reason=$(printf '%s' "$hook_out" | jq -r '.reason // empty')

  [ "$(printf '%s' "$hook_out" | jq -r '.decision // empty')" = "block" ] \
    || fail "Claude git commit hook should block timeout with valid JSON: $hook_out"
  assert_contains "$reason" "git commit wrapper timed out"
  assert_contains "$reason" "Check git status --short and git log -1 --oneline before retrying"
  assert_not_contains "$reason" "commit-timeout-status.sh"
  assert_not_contains "$reason" "Monitor"
  assert_not_contains "$reason" "backgrounded"
}

# --- L1: commit wrapper resolves the target worktree, not the hook's checkout --
# The wrapper derives REPO_ROOT from its own file location (the main checkout).
# A session parked there but committing in a linked worktree must key HEAD
# tracking, locks, branch policy, and the success summary on the worktree the
# commit lands in — resolved from the command's leading `cd`/`git -C` forms or
# the payload cwd (ai_resolve_target_dir).

assert_resolve_target_dir_order() {
  local quoted_dashc="git -C '/wt' commit -m x"
  resolve() { ai_resolve_target_dir "$1" "$2" "$3"; }

  [ "$(resolve 'cd /wt && git commit -m x' /workspace /repo)" = /wt ] \
    || fail "resolve: leading cd should win over payload cwd"
  [ "$(resolve 'git -C /wt commit -m x' /workspace /repo)" = /wt ] \
    || fail "resolve: leading git -C should win over payload cwd"
  [ "$(resolve 'git -C /tmp/commit-lane commit -m x' /workspace /repo)" = /tmp/commit-lane ] \
    || fail "resolve: commit substring in git -C path must not truncate the target"
  [ "$(resolve 'cd /main-checkout && git push' /feature-worktree /repo)" = /main-checkout ] \
    || fail "resolve: leading cd should target a non-commit git command"
  [ "$(resolve 'git -C /main-checkout push' /feature-worktree /repo)" = /main-checkout ] \
    || fail "resolve: git -C should target a non-commit git command"
  [ "$(resolve 'git -C /tmp/commit-lane push' /feature-worktree /repo)" = /tmp/commit-lane ] \
    || fail "resolve: commit substring in non-commit git -C path must not truncate the target"
  [ "$(resolve 'cd /a && git -C rel push' /payload/cwd /repo)" = /a/rel ] \
    || fail "resolve: relative git -C after cd should resolve from the effective cd directory"
  [ "$(resolve 'cd /a && command git push' /feature-worktree /repo)" = /a ] \
    || fail "resolve: command-prefixed git should use the leading cd target"
  [ "$(resolve 'cd /a && env X=1 git push' /feature-worktree /repo)" = /a ] \
    || fail "resolve: env-prefixed git should use the leading cd target"
  [ "$(resolve 'cd lanes/wt && git commit -m x' /workspace /repo)" = /workspace/lanes/wt ] \
    || fail "resolve: relative leading cd should resolve from payload cwd"
  [ "$(resolve "$quoted_dashc" /workspace /repo)" = /wt ] \
    || fail "resolve: git -C should unquote its directory token"
  [ "$(resolve 'git commit -m x' /wt /repo)" = /wt ] \
    || fail "resolve: bare commit should fall back to payload cwd"
  [ "$(resolve 'git push' /feature-worktree /repo)" = /feature-worktree ] \
    || fail "resolve: git without cd or -C should fall back to payload cwd"
  [ "$(resolve 'git commit -m x' '' /repo)" = /repo ] \
    || fail "resolve: no cd/-C and no cwd should fall back to the repo root"
  # `-C` AFTER `commit` is --reuse-message (a commit-ish), never a directory.
  [ "$(resolve 'git commit -C HEAD~1' /wt /repo)" = /wt ] \
    || fail "resolve: git commit -C <commit-ish> must not be read as a directory"
  # A -C owned by an earlier git command must not retarget the later commit.
  [ "$(resolve 'git -C /repo-a status && git commit -m x' /repo-b /repo)" = /repo-b ] \
    || fail "resolve: an earlier git invocation's -C must not retarget the commit"
  # In a simple compound, the last cd before commit is the effective cwd.
  [ "$(resolve 'cd /feature && cd /main-checkout && git commit -m x' /cwd /repo)" = /main-checkout ] \
    || fail "resolve: multiple cds should use the last cd before commit"
  [ "$(resolve 'cd /feature; cd /main-checkout; git commit -m x' /cwd /repo)" = /main-checkout ] \
    || fail "resolve: semicolon-separated cds should use the last cd before commit"
  [ "$(resolve 'echo $(pwd) && git commit -m x' /cwd /repo)" = /cwd ] \
    || fail "resolve: command substitution should fall back to payload cwd"
}

# Build a linked worktree of WT_MAIN_REPO on its own feature branch, with one
# file staged and ready to commit. Echoes the worktree path.
wt_new_lane() {
  local branch="$1"
  local name="$2"
  local wt="$TMP_ROOT/$name"

  git -C "$WT_MAIN_REPO" worktree add -q -b "$branch" "$wt" >/dev/null
  printf '%s\n' "$name" > "$wt/$name.txt"
  git -C "$wt" add "$name.txt"
  printf '%s' "$wt"
}

# On success the wrapper rewrites the command to a `cat <tmp>; rm <tmp>` that
# prints the commit summary. Extract and run it to read that summary.
git_commit_quiet_success_summary() {
  local hook_out="$1"
  local rewritten
  rewritten=$(printf '%s' "$hook_out" | jq -r '.hookSpecificOutput.updatedInput.command // empty')
  [ -n "$rewritten" ] || return 1
  eval "$rewritten"
}

# Shared assertion for the two leading-form shapes (cd prefix and git -C) plus
# the bare-commit-with-worktree-cwd shape: the commit lands in the worktree, the
# wrapper reports success, and its locks key on the worktree.
assert_git_commit_quiet_lands_in_worktree() {
  local wt="$1"
  local payload="$2"
  local before after hook_out decision summary writer_lock queue_lock
  queue_lock="$TMP_ROOT/$(basename "$wt")-queue.lock"

  before=$(git -C "$wt" rev-parse HEAD)
  hook_out=$(
    printf '%s' "$payload" \
      | MUSI_VERIFY_STATE_ROOT="$TMP_ROOT" \
        MUSI_COMMIT_QUEUE_LOCK="$queue_lock" \
        bash "$REPO_ROOT/scripts/ai-hooks/git-commit-quiet.sh"
  )
  after=$(git -C "$wt" rev-parse HEAD)
  decision=$(printf '%s' "$hook_out" | jq -r '.hookSpecificOutput.permissionDecision // empty')
  summary=$(git_commit_quiet_success_summary "$hook_out")

  [ "$decision" = "allow" ] \
    || fail "worktree commit should succeed (updatedInput), got: $hook_out"
  assert_contains "$summary" "Commit succeeded"
  [ "$after" != "$before" ] \
    || fail "worktree commit did not move the worktree HEAD ($wt)"
  # Single-writer lock keyed on the worktree, and the queue holder names it.
  writer_lock=$(MUSI_VERIFY_STATE_ROOT="$TMP_ROOT" musi_standard_git_commit_lock "$wt")
  [ -s "$writer_lock" ] \
    || fail "single-writer lock not keyed on the worktree ($writer_lock)"
  assert_contains "$(cat "$queue_lock")" "WORKTREE="
  assert_contains "$(cat "$queue_lock")" "$(basename "$wt")"
}

assert_git_commit_quiet_worktree_cd_form_lands() {
  local wt
  wt=$(wt_new_lane feat/lane-cd wt-cd)
  assert_git_commit_quiet_lands_in_worktree "$wt" \
    "$(jq -n --arg cwd "$WT_MAIN_REPO" --arg cmd "cd $wt && git commit -m 'test: land via cd prefix in the linked worktree'" \
      '{cwd:$cwd, tool_input:{command:$cmd}}')"
}

assert_git_commit_quiet_relative_cd_replays_from_payload_cwd() {
  local wt
  wt=$(wt_new_lane feat/lane-relative-cd wt-relative-cd)
  assert_git_commit_quiet_lands_in_worktree "$wt" \
    "$(jq -n --arg cwd "$TMP_ROOT" \
      --arg cmd "cd wt-relative-cd && git commit -m 'test: replay relative cd from payload cwd'" \
      '{cwd:$cwd, tool_input:{command:$cmd}}')"
}

assert_git_commit_quiet_quoted_space_cd_lands() {
  local wt
  wt=$(wt_new_lane feat/lane-quoted-space "wt quoted space")
  assert_git_commit_quiet_lands_in_worktree "$wt" \
    "$(jq -n --arg cwd "$TMP_ROOT" \
      --arg cmd "cd 'wt quoted space' && git commit -m 'test: land through quoted space path'" \
      '{cwd:$cwd, tool_input:{command:$cmd}}')"
}

assert_git_commit_quiet_worktree_dashC_form_lands() {
  local wt
  wt=$(wt_new_lane feat/lane-dashc wt-dashc)
  assert_git_commit_quiet_lands_in_worktree "$wt" \
    "$(jq -n --arg cwd "$WT_MAIN_REPO" --arg cmd "git -C $wt commit -m 'test: land via git -C in the linked worktree'" \
      '{cwd:$cwd, tool_input:{command:$cmd}}')"
}

assert_git_commit_quiet_worktree_payload_cwd_lands() {
  local wt
  wt=$(wt_new_lane feat/lane-cwd wt-cwd)
  # Bare `git commit` — only the payload cwd (the worktree) points at the target.
  assert_git_commit_quiet_lands_in_worktree "$wt" \
    "$(jq -n --arg cwd "$wt" \
      '{cwd:$cwd, tool_input:{command:"git commit -m \"test: land via payload cwd in the worktree\""}}')"
}

# ai_commit_truth_up_lines is the filter that isolates the `.husky/post-commit`
# baseline advisories from the rest of the captured child output. It must keep
# exactly the `post-commit: `-prefixed lines, drop everything else, and exit 0
# (grep no-match) when there are none.
assert_commit_truth_up_lines_filter() {
  local output extracted
  output="On branch main
post-commit: merge produced a stale ratchet baseline - run: bun run lint:ratchet:update
[main abc1234] test: hand-completed merge
post-commit: merged lint-ratchet baseline verified truthful.
 1 file changed, 1 insertion(+)"

  extracted=$(ai_commit_truth_up_lines "$output")
  assert_contains "$extracted" "post-commit: merge produced a stale ratchet baseline"
  assert_contains "$extracted" "post-commit: merged lint-ratchet baseline verified truthful."
  assert_not_contains "$extracted" "On branch main"
  assert_not_contains "$extracted" "1 file changed"

  # No advisories -> empty output, and grep's no-match exit 1 must not surface
  # (the caller runs it on the wrapper success path, which must stay exit 0).
  extracted=$(ai_commit_truth_up_lines "just a normal commit line
 2 files changed, 3 insertions(+)")
  [ -z "$extracted" ] || fail "expected no truth-up lines, got: $extracted"
}

# End-to-end: when a hand-completed merge commits through the wrapper, the
# `.husky/post-commit` truth-up advisories printed during the commit must reach
# the agent. Before the fix the wrapper captured them into its OUTFILE and then
# discarded them, replacing the tool output with the quiet success summary alone.
# Simulate the post-commit hook by having the committed command emit the same
# `post-commit: ` lines to stderr (captured into the wrapper's OUTFILE just like
# the real hook's output).
assert_git_commit_quiet_forwards_truth_up_advisories() {
  local wt payload before after hook_out decision summary queue_lock
  wt=$(wt_new_lane feat/lane-truth-up wt-truth-up)
  queue_lock="$TMP_ROOT/$(basename "$wt")-queue.lock"
  payload=$(jq -n --arg cwd "$wt" \
    --arg cmd "git commit -m 'test: land a hand-completed merge tripping the ratchet truth-up' && { printf '%s\n' 'post-commit: merge produced a stale ratchet baseline - run: bun run lint:ratchet:update' >&2; printf '%s\n' 'post-commit: max-lines exception merge needs truth-up - run bun run lint' >&2; }" \
    '{cwd:$cwd, tool_input:{command:$cmd}}')

  before=$(git -C "$wt" rev-parse HEAD)
  hook_out=$(
    printf '%s' "$payload" \
      | MUSI_VERIFY_STATE_ROOT="$TMP_ROOT" \
        MUSI_COMMIT_QUEUE_LOCK="$queue_lock" \
        bash "$REPO_ROOT/scripts/ai-hooks/git-commit-quiet.sh"
  )
  after=$(git -C "$wt" rev-parse HEAD)
  decision=$(printf '%s' "$hook_out" | jq -r '.hookSpecificOutput.permissionDecision // empty')
  summary=$(git_commit_quiet_success_summary "$hook_out")

  [ "$decision" = "allow" ] \
    || fail "truth-up commit should succeed (updatedInput), got: $hook_out"
  [ "$after" != "$before" ] \
    || fail "truth-up commit did not move HEAD ($wt)"
  assert_contains "$summary" "Commit succeeded"
  assert_contains "$summary" "post-commit: merge produced a stale ratchet baseline"
  assert_contains "$summary" "post-commit: max-lines exception merge needs truth-up"
}

# An ordinary success (no post-commit advisories in the child output) must be
# left exactly as before — just the "Commit succeeded" summary, no stray lines.
assert_git_commit_quiet_plain_success_has_no_truth_up_noise() {
  local wt payload hook_out summary queue_lock
  wt=$(wt_new_lane feat/lane-no-truth-up wt-no-truth-up)
  queue_lock="$TMP_ROOT/$(basename "$wt")-queue.lock"
  payload=$(jq -n --arg cwd "$wt" \
    '{cwd:$cwd, tool_input:{command:"git commit -m \"test: an ordinary commit with no truth-up advisories\""}}')

  hook_out=$(
    printf '%s' "$payload" \
      | MUSI_VERIFY_STATE_ROOT="$TMP_ROOT" \
        MUSI_COMMIT_QUEUE_LOCK="$queue_lock" \
        bash "$REPO_ROOT/scripts/ai-hooks/git-commit-quiet.sh"
  )
  summary=$(git_commit_quiet_success_summary "$hook_out")
  assert_contains "$summary" "Commit succeeded"
  assert_not_contains "$summary" "post-commit:"
}

assert_git_commit_quiet_prior_dashC_does_not_retarget() {
  local wt
  wt=$(wt_new_lane feat/lane-prior-dashc wt-prior-dashc)
  assert_git_commit_quiet_lands_in_worktree "$wt" \
    "$(jq -n --arg cwd "$wt" \
      --arg cmd "git -C $WT_MAIN_REPO status --short && git commit -m 'test: ignore prior git dash C target'" \
      '{cwd:$cwd, tool_input:{command:$cmd}}')"
}

# Branch policy must evaluate the resolved WORK_ROOT, not the hook process cwd.
assert_git_commit_quiet_branch_policy_uses_work_root() {
  local out reason
  # Feature-branch work_root is allowed even from a protected-branch cwd.
  out=$(cd "$MAIN_BRANCH_REPO" && ai_preflight_or_block "git commit -m 'subject long enough here'" "$FEATURE_BRANCH_REPO") \
    || fail "preflight exited non-zero for a feature-branch work_root"
  [ -z "$out" ] \
    || fail "preflight blocked a commit into a feature-branch work_root: $out"
  # Protected-branch work_root is blocked even from a feature-branch cwd.
  out=$(cd "$FEATURE_BRANCH_REPO" && ai_preflight_or_block "git commit -m 'subject long enough here'" "$MAIN_BRANCH_REPO")
  reason=$(printf '%s' "$out" | jq -r '.reason // empty')
  [ "$(printf '%s' "$out" | jq -r '.decision // empty')" = "block" ] \
    || fail "preflight should block a commit into a protected-branch work_root: $out"
  [ "$reason" = "$AI_POLICY_GIT_COMMIT_ON_MAIN" ] \
    || fail "preflight block reason mismatch for a protected-branch work_root: $reason"
}

# Two linked worktrees committing concurrently must not collide on the
# single-writer lock (keyed per worktree); they serialize on the shared queue.
assert_git_commit_quiet_concurrent_worktrees_no_writer_collision() {
  local wt_a wt_b out_a out_b lock_a lock_b
  wt_a=$(wt_new_lane feat/lane-cc-a wt-cc-a)
  wt_b=$(wt_new_lane feat/lane-cc-b wt-cc-b)
  out_a="$TMP_ROOT/wt-cc-a.out"
  out_b="$TMP_ROOT/wt-cc-b.out"

  # Shared common dir -> one shared queue lock; distinct worktrees -> distinct
  # single-writer locks. Derive both under TMP_ROOT (no AI_GIT_COMMIT_LOCK).
  (
    jq -n --arg cwd "$wt_a" '{cwd:$cwd, tool_input:{command:"git commit -m \"test: concurrent lane a commit\""}}' \
      | MUSI_VERIFY_STATE_ROOT="$TMP_ROOT" bash "$REPO_ROOT/scripts/ai-hooks/git-commit-quiet.sh" > "$out_a"
  ) &
  local pid_a=$!
  (
    jq -n --arg cwd "$wt_b" '{cwd:$cwd, tool_input:{command:"git commit -m \"test: concurrent lane b commit\""}}' \
      | MUSI_VERIFY_STATE_ROOT="$TMP_ROOT" bash "$REPO_ROOT/scripts/ai-hooks/git-commit-quiet.sh" > "$out_b"
  ) &
  local pid_b=$!
  wait "$pid_a" 2>/dev/null || true
  wait "$pid_b" 2>/dev/null || true

  assert_not_contains "$(cat "$out_a")" "Another git commit is in progress"
  assert_not_contains "$(cat "$out_b")" "Another git commit is in progress"
  [ "$(git -C "$wt_a" rev-parse HEAD)" != "$(git -C "$WT_MAIN_REPO" rev-parse HEAD)" ] \
    || fail "concurrent lane a did not land its commit"
  [ "$(git -C "$wt_b" rev-parse HEAD)" != "$(git -C "$WT_MAIN_REPO" rev-parse HEAD)" ] \
    || fail "concurrent lane b did not land its commit"
  lock_a=$(MUSI_VERIFY_STATE_ROOT="$TMP_ROOT" musi_standard_git_commit_lock "$wt_a")
  lock_b=$(MUSI_VERIFY_STATE_ROOT="$TMP_ROOT" musi_standard_git_commit_lock "$wt_b")
  [ "$lock_a" != "$lock_b" ] \
    || fail "the two worktrees shared one single-writer lock ($lock_a)"
}

# The independent landing-detection path (bash-pre/bash-post, via the Codex
# adapters) must observe the worktree HEAD too — no false no-landing summary.
assert_bash_pre_post_worktree_landing_detection() {
  local wt tool_id payload state_dir post_out reason
  wt=$(wt_new_lane feat/lane-prepost wt-prepost)
  tool_id="prepost-worktree-landing"
  state_dir="$AI_STATE_ROOT/git"
  payload=$(jq -n --arg id "$tool_id" --arg cwd "$WT_MAIN_REPO" \
    --arg cmd "cd $wt && git commit -m 'test: land in worktree observed by the shared path'" \
    '{tool_use_id:$id, cwd:$cwd, tool_input:{command:$cmd}}')

  # 1. Pre hook snapshots HEAD_BEFORE + WORK_ROOT for this tool_use_id.
  printf '%s' "$payload" \
    | AI_STATE_ROOT="$AI_STATE_ROOT" AI_PRECOMMIT_LOG_DIR="$AI_PRECOMMIT_LOG_DIR" \
      bash "$REPO_ROOT/.codex/hooks/pre-tool-use.sh" >/dev/null
  [ "$(ai_read_state_value "$state_dir/$tool_id" WORK_ROOT)" = "$(cd "$wt" && pwd -P)" ] \
    || fail "pre hook did not record the worktree as WORK_ROOT"

  # 2. The commit actually lands in the worktree.
  git -C "$wt" commit -qm "test: land in worktree observed by the shared path"

  # 3. Post hook must report success against the worktree HEAD, not no-landing.
  post_out=$(printf '%s' "$payload" \
    | jq '. + {tool_response:{exit_code:0, stdout:""}}' \
    | AI_STATE_ROOT="$AI_STATE_ROOT" AI_PRECOMMIT_LOG_DIR="$AI_PRECOMMIT_LOG_DIR" \
      bash "$REPO_ROOT/.codex/hooks/post-tool-use.sh")
  reason=$(printf '%s' "$post_out" | jq -r '.reason // empty')
  assert_contains "$reason" "Commit succeeded"
  assert_not_contains "$reason" "No commit landed"
}

# --- worktree fixture for the L1 wrapper tests -------------------------------
WT_MAIN_REPO="$TMP_ROOT/wt-main"
git init -q "$WT_MAIN_REPO"
git -C "$WT_MAIN_REPO" config user.email test@example.invalid
git -C "$WT_MAIN_REPO" config user.name Test
git -C "$WT_MAIN_REPO" symbolic-ref HEAD refs/heads/main
printf 'base\n' > "$WT_MAIN_REPO/base.txt"
git -C "$WT_MAIN_REPO" add base.txt
git -C "$WT_MAIN_REPO" commit -qm "test: base commit for the worktree fixture"

# --- Item 1: PreToolUse commit guard is worktree-aware -----------------------
# A session parked in one checkout committing into a linked worktree via
# `cd <lane> && git commit` or `git -C <lane> commit` must judge the branch of
# the LANE the commit lands in, not the session's own checkout. The real hooks
# (no-direct-db.sh / bash-pre-tool-use.sh) resolve the target with
# ai_resolve_target_dir and pass that work root to ai_policy_violation_reason;
# this mirrors that path so the guard behavior is pinned end to end.
SD15_REPO="$TMP_ROOT/sd15-primary"
git init -q -b feat/primary "$SD15_REPO"
git -C "$SD15_REPO" config user.email test@example.invalid
git -C "$SD15_REPO" config user.name Test
git -C "$SD15_REPO" commit -q --allow-empty -m "test: base commit for worktree-aware guard"
git -C "$SD15_REPO" branch main
SD15_LANE_FEAT="$TMP_ROOT/sd15-lane-feat"
SD15_LANE_MAIN="$TMP_ROOT/sd15-lane-main"
git -C "$SD15_REPO" worktree add -q -b feat/lane "$SD15_LANE_FEAT" >/dev/null
git -C "$SD15_REPO" worktree add -q "$SD15_LANE_MAIN" main >/dev/null

# Resolve the commit's target checkout exactly as the PreToolUse hooks do, then
# return the policy reason (empty when allowed).
sd15_guard_reason() {
  local payload_cwd="$1"
  local cmd="$2"
  local target work_root
  target=$(ai_resolve_target_dir "$cmd" "$payload_cwd" "$payload_cwd")
  work_root=$(git -C "$target" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$payload_cwd")
  ai_policy_violation_reason "$cmd" "$work_root" || true
}
assert_sd15_allows() {
  local reason
  reason=$(sd15_guard_reason "$1" "$2")
  [ -z "$reason" ] || fail "worktree-aware guard should allow [$2] from [$1], got: $reason"
}
assert_sd15_blocks_commit_on_main() {
  local reason
  reason=$(sd15_guard_reason "$1" "$2")
  [ "$reason" = "$AI_POLICY_GIT_COMMIT_ON_MAIN" ] \
    || fail "worktree-aware guard should block [$2] from [$1], got: $reason"
}

# (a) Session parked on the protected branch commits into a feature-branch lane.
assert_sd15_allows "$SD15_REPO" "cd $SD15_LANE_FEAT && git commit -m 'lane feature work'"
assert_sd15_allows "$SD15_REPO" "git -C $SD15_LANE_FEAT commit -m 'lane feature work'"
# (d) A lane that is itself parked on a protected branch is still blocked, via
# the cd form, the git -C form, and when the session cwd IS that lane.
assert_sd15_blocks_commit_on_main "$SD15_REPO" "cd $SD15_LANE_MAIN && git commit -m wip"
assert_sd15_blocks_commit_on_main "$SD15_REPO" "git -C $SD15_LANE_MAIN commit -m wip"
assert_sd15_blocks_commit_on_main "$SD15_LANE_MAIN" "git commit -m wip"
# A bare commit whose session cwd is the feature lane stays allowed.
assert_sd15_allows "$SD15_LANE_FEAT" "git commit -m 'lane feature work'"

# --- L7: shared commit-queue visibility (heartbeat + waiter tickets) ---------
# The cross-worktree queue wait is a bounded FOREGROUND poll loop that heartbeats
# the holder + queue depth, backed by per-lane waiter tickets under
# <lock>.waiters/. These assert the heartbeat content under real 3-lane
# contention, ticket cleanup on normal exit, self-clean on catchable signals,
# peer-expiry of a SIGKILLed lane's ticket, and that no wait machinery outlives a
# killed lane.

# Grab the shared queue lock and hold it for $2 seconds with a recognizable
# holder line, so waiter lanes park behind it. Sets QUEUE_HOLDER_PID.
start_queue_holder() {
  local queue_lock="$1"
  local hold="$2"
  (
    exec 8<>"$queue_lock"
    flock -n 8 || exit 1
    printf 'PID=holderfix WORKTREE=%s CMD=git commit -m holder STARTED=now\n' \
      "$FEATURE_BRANCH_REPO" > "$queue_lock"
    sleep "$hold"
  ) &
  QUEUE_HOLDER_PID=$!
}

# Block until the holder fixture owns the lock (its line is visible in it).
wait_for_queue_holder() {
  local queue_lock="$1"
  local n=0
  while [ "$n" -lt 50 ]; do
    grep -qF 'CMD=git commit -m holder' "$queue_lock" 2>/dev/null && return 0
    sleep 0.1
    n=$((n + 1))
  done
  return 1
}

# Launch a waiter lane parked on $queue_lock (stderr -> $err_file). A distinct
# writer lock per lane lets lanes reach the shared queue instead of colliding on
# the per-worktree single-writer lock. Fast heartbeat/poll intervals keep the
# test bounded. Sets QUEUE_WAITER_PID.
start_queue_waiter() {
  local queue_lock="$1"
  local writer_lock="$2"
  local err_file="$3"
  local queue_timeout="$4"
  jq -n --arg cwd "$FEATURE_BRANCH_REPO" \
    '{cwd:$cwd, tool_input:{command:"git commit --dry-run"}}' \
    | AI_GIT_COMMIT_LOCK="$writer_lock" \
      MUSI_COMMIT_QUEUE_LOCK="$queue_lock" \
      MUSI_COMMIT_QUEUE_TIMEOUT="$queue_timeout" \
      MUSI_COMMIT_QUEUE_HEARTBEAT_INTERVAL=1 \
      MUSI_COMMIT_QUEUE_POLL_INTERVAL=0.2 \
      AI_GIT_COMMIT_TIMEOUT=30 \
      bash "$REPO_ROOT/scripts/ai-hooks/git-commit-quiet.sh" >/dev/null 2>"$err_file" &
  QUEUE_WAITER_PID=$!
}

# Waiter-dir bookkeeping: naming, dead-PID/age pruning, self-exclusion. This is
# the "expired on abandonment (next lane ignores its ticket)" acceptance bullet
# at the helper level; the SIGKILL integration below exercises the same path
# end-to-end.
assert_commit_queue_waiter_ticket_expiry() {
  local wd="$TMP_ROOT/expiry-queue.lock.waiters"
  local live dead old now count

  [ "$(musi_commit_queue_waiter_dir "$TMP_ROOT/x/q.lock")" = "$TMP_ROOT/x/q.lock.waiters" ] \
    || fail "waiter dir naming"

  mkdir -p "$wd"
  sleep 30 & live=$!
  sleep 30 & dead=$!
  kill -9 "$dead"; wait "$dead" 2>/dev/null || true
  now=$(date +%s)
  printf 'PID=%s WORKTREE=/a STARTED=%s\n' "$live" "$now" > "$wd/$live"
  printf 'PID=%s WORKTREE=/b STARTED=%s\n' "$dead" "$now" > "$wd/$dead"

  count=$(musi_count_commit_queue_waiters "$wd" 999999)
  [ "$count" = 1 ] || fail "waiter expiry: expected 1 live waiter, got [$count]"
  [ ! -e "$wd/$dead" ] || fail "waiter expiry: dead (SIGKILLed) ticket not pruned"
  [ -e "$wd/$live" ] || fail "waiter expiry: live ticket wrongly pruned"
  [ "$(musi_count_commit_queue_waiters "$wd" "$live")" = 0 ] \
    || fail "waiter expiry: self must be excluded from the count"

  sleep 30 & old=$!
  printf 'PID=%s WORKTREE=/c STARTED=%s\n' "$old" "$((now - 10000))" > "$wd/$old"
  count=$(musi_count_commit_queue_waiters "$wd" 999999 5)
  [ "$count" = 1 ] || fail "waiter expiry: aged ticket should not count, got [$count]"
  [ ! -e "$wd/$old" ] || fail "waiter expiry: aged ticket not pruned"

  kill "$live" "$old" 2>/dev/null || true
  wait "$live" "$old" 2>/dev/null || true
}

# Under 3-lane contention, every parked lane heartbeats the holder line and a
# waiter count; at least one lane observes both peers (2 other waiters).
assert_git_commit_quiet_queue_heartbeat_three_lanes() {
  local queue_lock="$TMP_ROOT/hb-queue.lock"
  local e1="$TMP_ROOT/hb-lane1.err"
  local e2="$TMP_ROOT/hb-lane2.err"
  local e3="$TMP_ROOT/hb-lane3.err"
  local p1 p2 p3 f combined

  start_queue_holder "$queue_lock" 4
  wait_for_queue_holder "$queue_lock" || fail "heartbeat: holder never took the queue lock"

  start_queue_waiter "$queue_lock" "$TMP_ROOT/hb-l1.wl" "$e1" 8; p1=$QUEUE_WAITER_PID
  start_queue_waiter "$queue_lock" "$TMP_ROOT/hb-l2.wl" "$e2" 8; p2=$QUEUE_WAITER_PID
  start_queue_waiter "$queue_lock" "$TMP_ROOT/hb-l3.wl" "$e3" 8; p3=$QUEUE_WAITER_PID
  wait "$p1" "$p2" "$p3" 2>/dev/null || true
  wait "$QUEUE_HOLDER_PID" 2>/dev/null || true

  for f in "$e1" "$e2" "$e3"; do
    assert_contains "$(cat "$f")" "still waiting for shared commit queue"
    assert_contains "$(cat "$f")" "holder: PID=holderfix"
    assert_contains "$(cat "$f")" "CMD=git commit -m holder"
    assert_contains "$(cat "$f")" "other waiter(s)"
  done
  combined=$(cat "$e1" "$e2" "$e3")
  assert_contains "$combined" "2 other waiter(s)"
}

# A lane that acquires without contention still registers then drops its ticket:
# after a normal (successful) commit no waiter ticket is left behind.
assert_git_commit_quiet_queue_ticket_cleaned_on_normal_exit() {
  local wt queue_lock waiter_dir

  wt=$(wt_new_lane feat/lane-ticket wt-ticket)
  queue_lock="$TMP_ROOT/wt-ticket-queue.lock"
  waiter_dir=$(musi_commit_queue_waiter_dir "$queue_lock")

  jq -n --arg cwd "$wt" \
    '{cwd:$cwd, tool_input:{command:"git commit -m \"test: normal-exit waiter ticket cleanup\""}}' \
    | MUSI_VERIFY_STATE_ROOT="$TMP_ROOT" MUSI_COMMIT_QUEUE_LOCK="$queue_lock" \
      bash "$REPO_ROOT/scripts/ai-hooks/git-commit-quiet.sh" >/dev/null

  [ "$(git -C "$wt" rev-parse HEAD)" != "$(git -C "$WT_MAIN_REPO" rev-parse HEAD)" ] \
    || fail "normal-exit lane did not land its commit"
  local ticket
  for ticket in "$waiter_dir"/*; do
    [ -e "$ticket" ] || continue
    case "$(basename "$ticket")" in
      ''|*[!0-9]*) ;;
      *) fail "normal-exit lane left a waiter ticket: $ticket" ;;
    esac
  done
}

# TERM/INT/KILL a lane mid-wait. Catchable signals self-clean the ticket via the
# interim trap; SIGKILL leaves it for a peer to expire. In every case no queue
# machinery outlives the lane: no further heartbeat output, no orphaned child.
_queue_signal_scenarios() {
  local queue_lock="$TMP_ROOT/sig-queue.lock"
  local waiter_dir sig err wp n sz1 sz2 c
  waiter_dir=$(musi_commit_queue_waiter_dir "$queue_lock")

  for sig in TERM INT KILL; do
    err="$TMP_ROOT/sig-$sig.err"
    : > "$err"
    start_queue_holder "$queue_lock" 30
    wait_for_queue_holder "$queue_lock" || fail "$sig: holder never took the queue lock"
    start_queue_waiter "$queue_lock" "$TMP_ROOT/sig-$sig.wl" "$err" 60
    wp=$QUEUE_WAITER_PID

    n=0
    while [ "$n" -lt 80 ]; do
      [ -e "$waiter_dir/$wp" ] && grep -qF 'still waiting' "$err" 2>/dev/null && break
      sleep 0.1
      n=$((n + 1))
    done
    [ -e "$waiter_dir/$wp" ] || fail "$sig: waiter ticket never registered"
    grep -qF 'still waiting' "$err" || fail "$sig: waiter never heartbeat before the signal"

    kill -"$sig" "$wp" 2>/dev/null || true
    wait "$wp" 2>/dev/null || true   # reap; a trap-driven exit is prompt

    sz1=$(wc -c < "$err")
    sleep 1.3
    sz2=$(wc -c < "$err")
    [ "$sz1" = "$sz2" ] \
      || fail "$sig: queue-status output continued after the lane died ($sz1 -> $sz2)"
    [ -z "$(pgrep -P "$wp" 2>/dev/null)" ] \
      || fail "$sig: a child of the killed lane is still running"

    if [ "$sig" = KILL ]; then
      [ -e "$waiter_dir/$wp" ] || fail "KILL: ticket vanished before peer expiry"
      c=$(musi_count_commit_queue_waiters "$waiter_dir" 999999)
      [ "$c" = 0 ] || fail "KILL: peer did not expire the abandoned ticket (count $c)"
      [ ! -e "$waiter_dir/$wp" ] || fail "KILL: abandoned ticket not pruned by peer"
    else
      [ ! -e "$waiter_dir/$wp" ] || fail "$sig: interim trap did not remove the waiter ticket"
    fi

    kill -9 "$QUEUE_HOLDER_PID" 2>/dev/null || true
    wait "$QUEUE_HOLDER_PID" 2>/dev/null || true
  done
}

# Job control (set -m) so a backgrounded lane gets a trappable INT — a plain-&
# child has SIGINT set to SIG_IGN, which the real foreground hook never does. Run
# in a subshell so monitor-mode job notices and a `fail` exit stay contained; the
# captured log is surfaced only on failure.
assert_git_commit_quiet_queue_no_orphan_on_signals() {
  local log="$TMP_ROOT/queue-signal-scenarios.log"
  if ! ( set -m; _queue_signal_scenarios ) 2>"$log"; then
    fail "queue signal scenarios failed:
$(cat "$log")"
  fi
}

assert_no_sleep_marker() {
  local marker="$1"
  local pid args found=0

  while IFS= read -r pid; do
    args=$(ps -o args= -p "$pid" 2>/dev/null || true)
    if [ "$args" = "sleep $marker" ]; then
      kill "$pid" 2>/dev/null || true
      found=1
    fi
  done < <(pgrep -x sleep 2>/dev/null || true)

  [ "$found" -eq 0 ] || fail "process tree cleanup left nested sleep $marker running"
}

assert_claude_bun_timeout_kills_process_tree() {
  local fake_bin="$TMP_ROOT/fake-bun-bin"
  local marker="65432"
  local hook_out reason

  mkdir -p "$fake_bin"
  cat > "$fake_bin/bun" <<'SH'
#!/bin/bash
if [ "$1" = "run" ] && [ "$2" = "lint" ]; then
  sleep "$AI_BUN_SLEEP_MARKER" &
  wait "$!"
  exit $?
fi
printf 'unexpected fake bun argv: %s\n' "$*" >&2
exit 64
SH
  chmod +x "$fake_bin/bun"

  hook_out=$(
    printf '{"tool_input":{"command":"bun run lint","run_in_background":false}}' \
      | AI_BUN_LOCK="$TMP_ROOT/bun-timeout-lock" \
        AI_BUN_LOG_DIR="$TMP_ROOT/bun-timeout-logs" \
        AI_BUN_TIMEOUT=1 \
        AI_BUN_SLEEP_MARKER="$marker" \
        PATH="$fake_bin:$PATH" \
        bash "$REPO_ROOT/.claude/hooks/bun-run-quiet.sh"
  )
  reason=$(printf '%s' "$hook_out" | jq -r '.reason // empty')

  [ "$(printf '%s' "$hook_out" | jq -r '.decision // empty')" = "block" ] \
    || fail "Claude bun hook should block timeout with valid JSON: $hook_out"
  assert_contains "$reason" "lint killed by watchdog"
  assert_no_sleep_marker "$marker"
}

assert_claude_bun_clean_run_clears_orphan_state() {
  local fake_bin="$TMP_ROOT/fake-bun-clean-state-bin"
  local state_dir="$TMP_ROOT/bun-clean-state"
  local log_dir="$TMP_ROOT/bun-clean-logs"
  local lock="$TMP_ROOT/bun-clean-lock"
  local state_file="$state_dir/active-process"
  local first_out second_out reason

  mkdir -p "$fake_bin" "$state_dir" "$log_dir"
  cat > "$fake_bin/bun" <<'SH'
#!/bin/bash
if [ "$1" = "run" ] && [ "$2" = "lint" ]; then
  exit 0
fi
printf 'unexpected fake bun argv: %s\n' "$*" >&2
exit 64
SH
  chmod +x "$fake_bin/bun"

  first_out=$(
    printf '{"tool_input":{"command":"bun run lint","run_in_background":false}}' \
      | AI_BUN_LOCK="$lock" \
        AI_BUN_LOG_DIR="$log_dir" \
        AI_BUN_STATE_DIR="$state_dir" \
        AI_BUN_TIMEOUT=4 \
        AI_BUN_TTL=0 \
        PATH="$fake_bin:$PATH" \
        bash "$BUN_HOOK"
  )
  assert_hook_json "$first_out"
  [ "$(printf '%s' "$first_out" | jq -r '.decision // empty')" != "block" ] \
    || fail "clean bun run should not block: $first_out"
  [ ! -e "$state_file" ] || fail "clean bun run left active process state: $(cat "$state_file")"

  second_out=$(
    printf '{"tool_input":{"command":"bun run lint","run_in_background":false}}' \
      | AI_BUN_LOCK="$lock" \
        AI_BUN_LOG_DIR="$log_dir" \
        AI_BUN_STATE_DIR="$state_dir" \
        AI_BUN_TIMEOUT=4 \
        AI_BUN_TTL=0 \
        PATH="$fake_bin:$PATH" \
        bash "$BUN_HOOK"
  )
  assert_hook_json "$second_out"
  reason=$(printf '%s' "$second_out" | jq -r '.reason // empty')
  assert_not_contains "$reason" "Previous bun-run-quiet.sh wrapper died"
  [ ! -e "$state_file" ] || fail "second clean bun run left active process state: $(cat "$state_file")"
}

assert_claude_bun_sigkilled_wrapper_blocks_orphan_rerun() {
  local fake_bin="$TMP_ROOT/fake-bun-orphan-bin"
  local state_dir="$TMP_ROOT/bun-orphan-state"
  local log_dir="$TMP_ROOT/bun-orphan-logs"
  local lock="$TMP_ROOT/bun-orphan-lock"
  local started="$TMP_ROOT/bun-orphan-started"
  local first_out="$TMP_ROOT/bun-orphan-first.out"
  local first_err="$TMP_ROOT/bun-orphan-first.err"
  local state_file="$state_dir/active-process"
  local child_pid pgid reason second_out watchdog_pid="" pid

  mkdir -p "$fake_bin" "$state_dir" "$log_dir"
  cat > "$fake_bin/bun" <<'SH'
#!/bin/bash
if [ "$1" = "run" ] && [ "$2" = "lint" ]; then
  printf 'started\n' > "$AI_BUN_FAKE_STARTED"
  sleep "$AI_BUN_ORPHAN_SLEEP"
  exit 0
fi
printf 'unexpected fake bun argv: %s\n' "$*" >&2
exit 64
SH
  chmod +x "$fake_bin/bun"

  printf '{"tool_input":{"command":"bun run lint","run_in_background":false}}' \
    | AI_BUN_LOCK="$lock" \
      AI_BUN_LOG_DIR="$log_dir" \
      AI_BUN_STATE_DIR="$state_dir" \
      AI_BUN_TIMEOUT=4 \
      AI_BUN_TTL=0 \
      AI_BUN_FAKE_STARTED="$started" \
      AI_BUN_ORPHAN_SLEEP=30 \
      PATH="$fake_bin:$PATH" \
      bash "$BUN_HOOK" > "$first_out" 2> "$first_err" &
  wrapper_pid=$!

  for _ in $(seq 1 50); do
    [ -s "$state_file" ] && [ -f "$started" ] && break
    sleep 0.1
  done
  [ -s "$state_file" ] || {
    kill "$wrapper_pid" 2>/dev/null || true
    fail "bun wrapper did not record active child state before SIGKILL"
  }
  child_pid=$(ai_read_state_value "$state_file" CHILD_PID || true)
  pgid=$(ai_read_state_value "$state_file" CHILD_PGID || true)
  [ -n "$child_pid" ] || fail "active child state missing CHILD_PID: $(cat "$state_file")"
  [ -n "$pgid" ] || fail "active child state missing CHILD_PGID: $(cat "$state_file")"

  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    [ "$pid" = "$child_pid" ] || watchdog_pid="$pid"
  done < <(pgrep -P "$wrapper_pid" 2>/dev/null || true)
  [ -n "$watchdog_pid" ] && kill -TERM "$watchdog_pid" 2>/dev/null || true
  kill -KILL "$wrapper_pid" 2>/dev/null || true
  wait "$wrapper_pid" 2>/dev/null || true

  second_out=$(
    printf '{"tool_input":{"command":"bun run lint","run_in_background":false}}' \
      | AI_BUN_LOCK="$lock" \
        AI_BUN_LOG_DIR="$log_dir" \
        AI_BUN_STATE_DIR="$state_dir" \
        AI_BUN_TIMEOUT=4 \
        AI_BUN_TTL=0 \
        PATH="$fake_bin:$PATH" \
        bash "$BUN_HOOK"
  )
  reason=$(printf '%s' "$second_out" | jq -r '.reason // empty')

  kill -TERM -- "-$pgid" 2>/dev/null || true
  sleep 0.2
  kill -KILL -- "-$pgid" 2>/dev/null || true
  rm -f "$state_file"

  [ "$(printf '%s' "$second_out" | jq -r '.decision // empty')" = "block" ] \
    || fail "bun wrapper should block while a SIGKILL-orphaned child group is active: $second_out"
  assert_contains "$reason" "Previous bun-run-quiet.sh wrapper died"
  assert_contains "$reason" "PGID=$pgid"
  assert_contains "$reason" "starting another verification run in this worktree could race the orphan"
}

assert_commit_success_summary_fast_commit_notice
assert_codex_git_commit_unknown_guidance
assert_codex_git_commit_signal_guidance
assert_git_commit_quiet_body_non_commit_passthrough
assert_git_commit_quiet_lock_contention_fail_fast
assert_git_commit_quiet_shared_queue_blocks_other_worktrees
assert_git_commit_quiet_timeout_clamps_to_hook_margin
assert_git_commit_quiet_amend_blocked_pre_execution
assert_git_commit_quiet_normal_commit_allowed_by_guard
assert_resolve_target_dir_order
assert_git_commit_quiet_worktree_cd_form_lands
assert_git_commit_quiet_relative_cd_replays_from_payload_cwd
assert_git_commit_quiet_quoted_space_cd_lands
assert_git_commit_quiet_worktree_dashC_form_lands
assert_git_commit_quiet_worktree_payload_cwd_lands
assert_commit_truth_up_lines_filter
assert_git_commit_quiet_forwards_truth_up_advisories
assert_git_commit_quiet_plain_success_has_no_truth_up_noise
assert_git_commit_quiet_prior_dashC_does_not_retarget
assert_git_commit_quiet_branch_policy_uses_work_root
assert_git_commit_quiet_concurrent_worktrees_no_writer_collision
assert_bash_pre_post_worktree_landing_detection
assert_commit_queue_waiter_ticket_expiry
assert_git_commit_quiet_queue_heartbeat_three_lanes
assert_git_commit_quiet_queue_ticket_cleaned_on_normal_exit
assert_git_commit_quiet_queue_no_orphan_on_signals
assert_claude_git_commit_timeout_guidance
assert_claude_bun_lock_wait_subtracts_watchdog_budget
assert_claude_bun_timeout_clamps_to_hook_margin
assert_claude_bun_timeout_kills_process_tree
assert_claude_bun_clean_run_clears_orphan_state
assert_claude_bun_sigkilled_wrapper_blocks_orphan_rerun

# --- stop-policy hook ---------------------------------------------------------
# Extracted to a focused script so this behavior family can also run on its own
# (`bash scripts/ai-hooks/test-stop-policy.sh`). Stdout is discarded so the
# aggregate keeps its single "ai-hooks tests passed" success line; any failure
# still exits non-zero and prints its FAIL reason on stderr.
bash "$SCRIPT_DIR/test-stop-policy.sh" >/dev/null

# --- failure-guidance hook ----------------------------------------------------
failure_guidance_error_payload() {
  local command="$1"
  local error_text="$2"

  jq -n --arg command "$command" --arg error "$error_text" '{
    hook_event_name: "PostToolUseFailure",
    tool_name: "Bash",
    tool_input: { command: $command },
    tool_use_id: "toolu_failure_fixture",
    error: $error
  }'
}

failure_guidance_stderr_payload() {
  local command="$1"
  local error_text="$2"
  local stderr_text="$3"

  jq -n --arg command "$command" --arg error "$error_text" --arg stderr "$stderr_text" '{
    hook_event_name: "PostToolUseFailure",
    tool_name: "Bash",
    tool_input: { command: $command },
    tool_use_id: "toolu_failure_fixture",
    error: $error,
    tool_response: {
      exit_code: 1,
      stdout: "",
      stderr: $stderr
    }
  }'
}

failure_guidance_response_string_payload() {
  local command="$1"
  local error_text="$2"
  local response_text="$3"

  jq -n --arg command "$command" --arg error "$error_text" --arg response "$response_text" '{
    hook_event_name: "PostToolUseFailure",
    tool_name: "Bash",
    tool_input: { command: $command },
    tool_use_id: "toolu_failure_fixture",
    error: $error,
    tool_response: $response
  }'
}

failure_guidance_context() {
  jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$1"
}

assert_failure_guidance_payload_contains() {
  local payload="$1"
  local expected="$2"
  local output context

  output=$(printf '%s' "$payload" | "$REPO_ROOT/scripts/ai-hooks/failure-guidance.sh")
  assert_hook_json "$output"
  [ "$(jq -r '.hookSpecificOutput.hookEventName // empty' <<< "$output")" = "PostToolUseFailure" ] \
    || fail "failure-guidance should emit PostToolUseFailure context: $output"
  context=$(failure_guidance_context "$output")
  assert_contains "$context" "$expected"
}

assert_failure_guidance_payload_silent() {
  local payload="$1"
  local output

  output=$(printf '%s' "$payload" | "$REPO_ROOT/scripts/ai-hooks/failure-guidance.sh")
  [ -z "$output" ] || fail "failure-guidance should stay silent for unrelated failure: $output"
}

TERSE_FAILURE='Command exited with non-zero status code 1'
OOM_FAILURE=$'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory\nESLint crashed while scanning the project'
assert_failure_guidance_payload_silent \
  "$(failure_guidance_error_payload "bun run lint" "$TERSE_FAILURE")"
assert_failure_guidance_payload_contains \
  "$(failure_guidance_stderr_payload "bun run lint" "$TERSE_FAILURE" "$OOM_FAILURE")" \
  "scripts/lib/gate-env.sh"
# The heap policy now follows the lint tool itself (lint/lint:changed/lint:fix
# all source gate-env.sh), so the guidance points at raising the heap, not at
# rerouting through a gate.
OOM_GUIDANCE_CONTEXT=$(failure_guidance_context "$(printf '%s' \
  "$(failure_guidance_stderr_payload "bun run lint" "$TERSE_FAILURE" "$OOM_FAILURE")" \
  | "$REPO_ROOT/scripts/ai-hooks/failure-guidance.sh")")
assert_contains "$OOM_GUIDANCE_CONTEXT" "MUSI_GATE_NODE_OLD_SPACE_MB"
if grep -qF "retry via bun run verify or git commit" <<< "$OOM_GUIDANCE_CONTEXT"; then
  fail "failure-guidance should retire the route-through-a-gate workaround: $OOM_GUIDANCE_CONTEXT"
fi
assert_failure_guidance_payload_silent \
  "$(failure_guidance_error_payload "node scripts/unrelated.js" "FATAL ERROR: unrelated process failed")"

FLAKY_FAILURE=$'packages/server/src/routers/srd.test.ts:428\nexpected subclasses to have length 12'
assert_failure_guidance_payload_contains \
  "$(failure_guidance_stderr_payload "bun run test:changed --reporter=dot" "$TERSE_FAILURE" "$FLAKY_FAILURE")" \
  "docs/generated/observed_flaky_tests.md"
assert_failure_guidance_payload_silent \
  "$(failure_guidance_stderr_payload "bun run test -- packages/server/src/routers/new-feature.test.ts" "$TERSE_FAILURE" "packages/server/src/routers/new-feature.test.ts failed deterministically")"

LOCK_FAILURE='Waited 1s for another `bun run` invocation to finish but it is still running (PID=123 CMD=bun run verify).'
assert_failure_guidance_payload_contains \
  "$(failure_guidance_response_string_payload "bun run verify" "$TERSE_FAILURE" "$LOCK_FAILURE")" \
  "verify:async:status"
assert_failure_guidance_payload_silent \
  "$(failure_guidance_stderr_payload "bun run verify" "$TERSE_FAILURE" "verify failed because typecheck found a real error")"

CLAUDE_FAILURE_GUIDANCE_OUTPUT=$(printf '%s' "$(failure_guidance_stderr_payload "bun run lint" "$TERSE_FAILURE" "$OOM_FAILURE")" \
  | CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$REPO_ROOT/.claude/hooks/failure-guidance.sh")
assert_hook_json "$CLAUDE_FAILURE_GUIDANCE_OUTPUT"
assert_contains "$(failure_guidance_context "$CLAUDE_FAILURE_GUIDANCE_OUTPUT")" \
  "scripts/lib/gate-env.sh"

MULTI_GUIDANCE_OUTPUT=$(printf '%s' "$(failure_guidance_stderr_payload "bun run lint" "$TERSE_FAILURE" "$OOM_FAILURE"$'\n'"$LOCK_FAILURE")" \
  | "$REPO_ROOT/scripts/ai-hooks/failure-guidance.sh")
assert_hook_json "$MULTI_GUIDANCE_OUTPUT"
MULTI_GUIDANCE_CONTEXT=$(failure_guidance_context "$MULTI_GUIDANCE_OUTPUT")
assert_contains "$MULTI_GUIDANCE_CONTEXT" "scripts/lib/gate-env.sh"
assert_contains "$MULTI_GUIDANCE_CONTEXT" "verify:async:status"
[ "$(printf '%s\n' "$MULTI_GUIDANCE_CONTEXT" | wc -l)" -eq 2 ] \
  || fail "failure-guidance should emit one line per matched pattern: $MULTI_GUIDANCE_CONTEXT"

TRUNCATED_FAILURE_GUIDANCE=$(ai_failure_limit_guidance_lines $'one\ntwo\nthree\nfour\nfive\nsix\nseven' 5)
assert_contains "$TRUNCATED_FAILURE_GUIDANCE" "+2 more"
if grep -qF "six" <<< "$TRUNCATED_FAILURE_GUIDANCE"; then
  fail "failure-guidance truncation should hide clipped lines: $TRUNCATED_FAILURE_GUIDANCE"
fi

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
lint:ratchet FAIL — 1 current finding(s); 1 regression(s); 0 improvement(s); blocking=1 info=0
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
