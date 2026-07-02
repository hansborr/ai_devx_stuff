#!/bin/bash

# Shared policy checks and verification command matching.

AI_POLICY_HOOK_BYPASS="Hook bypass is not allowed. Pre-commit hooks must always run."
AI_POLICY_POSTGRES="Do not use PostgreSQL CLI tools directly. You are in a container - use Prisma for all DB operations: 'bun run --filter @musi/server db:push' for schema, 'bun run --filter @musi/server db:seed' for seeding, or Prisma CLI commands routed through the repo scripts. Credentials are in .devcontainer/.env."
AI_POLICY_REDIS="Do not use redis-cli directly. You are in a container - Redis is managed by the app. If you need to inspect Redis state, read the app code or use 'bun run' scripts."
AI_POLICY_DOCKER="Do not run docker or docker-compose commands. You are in a container - PostgreSQL and Redis are already running and managed by the dev container. Use Prisma CLI for database operations."
AI_POLICY_CHANGEME="Wrong database credentials. 'ThisIsNotTheRealDatabasePassword' is not the password for this environment. Read .devcontainer/.env for the correct credentials."
AI_POLICY_GIT_AMEND="Git commit amend is not allowed from agents because it rewrites local history. The amend did NOT run — HEAD and your staged changes are untouched. Stage your changes and create a NEW follow-up commit instead. If the previous commit genuinely must be amended, ask the user to do it manually."
AI_POLICY_GIT_REBASE="Git rebase is not allowed from agents because it rewrites local history. Use merge or add follow-up commits; if a rebase is required, ask the user to run it."
AI_POLICY_GIT_RESET="Dangerous git reset modes are not allowed from agents. Use path-scoped 'git restore --staged <path>' or ask the user to run the reset."
AI_POLICY_GIT_HISTORY_REWRITE="Git history rewrite and direct ref manipulation are not allowed from agents. Add a follow-up commit or ask the user to run the rewrite."
AI_POLICY_GIT_FORCE_PUSH="Git force-push and remote branch deletion are not allowed from agents. Push normal feature-branch updates only, or ask the user to perform the remote mutation."
AI_POLICY_GIT_PUSH_MAIN="Pushing to main or master is not allowed from agents. Push a feature branch or ask the user to push the protected branch."
AI_POLICY_GIT_COMMIT_ON_MAIN="Committing on main or master is not allowed from agents. Create a feature branch ('git switch -c feat/...') and commit there; reviewers merge to the protected branch."
AI_POLICY_GIT_BRANCH_FORCE_DELETE="Force-deleting branches, deleting tags, or force-removing worktrees is not allowed from agents. Use non-force cleanup such as 'git branch -d' or 'bun run worktree:drop', or ask the user to perform the deletion."
AI_POLICY_GIT_CLEAN_FORCE="Git clean with force is not allowed from agents because it destroys untracked files. Remove specific generated files by name or ask the user to clean the tree."
AI_POLICY_GH_REMOTE_MUTATION="GitHub remote mutations are not allowed from agents. Use read-only 'gh ... view/list/status' commands, or ask the user to perform the mutation."
AI_POLICY_GH_AUTH="GitHub auth token output and auth reconfiguration are not allowed from agents. Use 'gh auth status' for read-only auth checks, or ask the user to manage authentication."
AI_POLICY_ALLOW_PROTECTED_EDITS_ADVISORY="Protected edit override marker .allow-protected-edits is repo-wide. Use it only for deliberate protected-file maintenance, and remove it immediately after that work is done."
AI_FLAKY_NOTE="Note: If this failure looks flaky (passes in isolation, fails under load), ensure you document it under docs/agent_notes/observed_flaky_tests.md if you are unable to resolve it right now."

AI_WRAPPED_BUN_RE='^bun run (lint|lint:changed|lint:fix|typecheck|test|test:changed|test:server|test:client|test:client:isolated|test:client:split|test:shared|test:coverage|test:slow|e2e|format|format:check|format:changed|format:changed:check|build|code:intel|verify|verify:changed|verify:slow|verify:logs|verify:async:status|verify:async:tail|verify:async:stop)( --| [A-Za-z0-9._:/=-]+| --[A-Za-z0-9._=-]+)*$'
AI_POLICY_CMD_START='(^[[:space:]]*|[;&|][[:space:]]*)'
AI_POLICY_CMD_END="($|[[:space:];|&'\"])"
AI_POLICY_ENV_PREFIX='env[[:space:]]+([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)+'
AI_POLICY_SHELL_PREFIX="(bash|sh)[[:space:]]+-[^[:space:]]*c[^[:space:]]*[[:space:]]+['\"]?"
# Global git options that may legitimately sit between `git` and the `commit`
# verb: a value-taking option with its argument (`-c key=val`, `-C path`,
# `--git-dir path`, …) or any other single dash-led flag. Restricting the
# pre-verb tokens to these keeps read-only subcommands that merely *name* commit
# (`git grep commit`, `git log --grep commit`, `git show commit`) from being
# mistaken for a real commit; subcommands are bare words, never dash-led.
AI_POLICY_GIT_PRECOMMIT_OPTS='((-[cC]|--(git-dir|work-tree|namespace|exec-path|config-env|super-prefix))[[:space:]]+[^[:space:];&|]+[[:space:]]+|--[A-Za-z][^[:space:];&|]*[[:space:]]+|-[A-Za-z][^[:space:];&|]*[[:space:]]+)*'

ai_policy_command_re() {
  local command_re="$1"
  local cmd_start="${2:-$AI_POLICY_CMD_START}"

  printf '%s%s|%s%s%s|%s%s(%s)?%s' \
    "$cmd_start" "$command_re" \
    "$cmd_start" "$AI_POLICY_ENV_PREFIX" "$command_re" \
    "$cmd_start" "$AI_POLICY_SHELL_PREFIX" "$AI_POLICY_ENV_PREFIX" "$command_re"
}

ai_policy_has_command() {
  local cmd="$1"
  local command_re="$2"
  local cmd_start="${3:-$AI_POLICY_CMD_START}"

  grep -qE -- "$(ai_policy_command_re "$command_re" "$cmd_start")" <<< "$cmd"
}

ai_current_branch() {
  git symbolic-ref --quiet --short HEAD 2>/dev/null || true
}

# True when direct commits/pushes to BRANCH are disallowed (the protected
# integration branch). Reviewers land work here via merge, not direct commits.
ai_branch_is_protected() {
  case "$1" in
    main|master) return 0 ;;
    *) return 1 ;;
  esac
}

# Hard guard for git-level hooks (.husky/pre-commit): refuse a direct commit on
# the protected branch and point at the merge-based integration path. Because
# git runs the hook inside the target repo, this is cwd-correct and also covers
# the `git -C <path>` / `cd <path> && git commit` forms that the PreToolUse
# string matcher (ai_policy_has_git_commit_on_main) cannot resolve. Prints to
# stderr and returns 1 when blocked, 0 otherwise; the caller decides to exit.
ai_guard_commit_branch_or_die() {
  local branch
  branch=$(ai_current_branch)
  ai_branch_is_protected "$branch" || return 0
  cat >&2 <<EOF
=== COMMIT BLOCKED: protected branch '$branch' ===
Direct commits on '$branch' are not allowed. Land work on a feature branch:
  git switch -c feat/your-change && git commit ...
then integrate with a merge (git merge --no-ff), which skips this hook. A
genuine one-off exception needs --no-verify, which skips ALL pre-commit checks.
EOF
  return 1
}

ai_policy_strip_allowed_rebase_controls() {
  sed -E 's/git[[:space:]]+rebase[[:space:]]+--(continue|abort|skip|quit)//g' <<< "$1"
}

# Remove `git [opts] commit ... --dry-run ...` invocations so the live-commit
# matcher cannot be exempted by a `--dry-run` token that belongs to a *different*
# command later on the same line. The pattern is bounded by [^;&|], so it only
# ever strips within a single command segment (a genuine dry-run commit), never
# across a `;`/`&&`/`||`/pipe. Mirrors ai_policy_strip_allowed_rebase_controls.
ai_policy_strip_dry_run_commits() {
  sed -E "s/git[[:space:]]+${AI_POLICY_GIT_PRECOMMIT_OPTS}commit[^;&|]*--dry-run[^;&|]*//g" <<< "$1"
}

ai_policy_has_dangerous_git_reset() {
  local cmd="$1"

  ai_policy_has_command "$cmd" "git[[:space:]]+reset[^;&|]*[[:space:]]--(hard|soft|merge|keep)$AI_POLICY_CMD_END" && return 0
  if ai_policy_has_command "$cmd" "git[[:space:]]+reset([[:space:]]+(-[A-Za-z]+|--[A-Za-z0-9-]+(=[^[:space:];|&'\"]+)?))*[[:space:]]+[^[:space:]-][^[:space:];|&'\"]*$AI_POLICY_CMD_END"; then
    ai_policy_has_command "$cmd" "git[[:space:]]+reset([[:space:]]+(-[A-Za-z]+|--[A-Za-z0-9-]+(=[^[:space:];|&'\"]+)?))*[[:space:]]+HEAD[[:space:]]+--[[:space:]]+" && return 1
    return 0
  fi

  return 1
}

ai_policy_has_git_push_to_main() {
  local cmd="$1"
  local branch
  local push_command_end
  local push_flags_re
  local push_redirect_tail
  local push_remote_re

  ai_policy_has_command "$cmd" "git[[:space:]]+push[^;&|]*[[:space:]]((refs/heads/)?(main|master)|[^[:space:];|&'\"]+:(refs/heads/)?(main|master))$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "git[[:space:]]+push[^;&|]*[[:space:]]--(all|branches)$AI_POLICY_CMD_END" && return 0

  branch=$(ai_current_branch)
  ai_branch_is_protected "$branch" || return 1

  push_command_end="($|[;|&'\"])"
  push_flags_re="([[:space:]]+(-[A-Za-z][A-Za-z0-9-]*|--[A-Za-z0-9-]+(=[^[:space:]]+)?))*"
  push_redirect_tail="[[:space:]]*[0-9]*(>&|<&|[<>])[^[:space:];|&'\"]*"
  push_remote_re="([[:space:]]+[A-Za-z0-9._/-]+)?"
  ai_policy_has_command "$cmd" "git[[:space:]]+push${push_flags_re}${push_remote_re}[[:space:]]*$push_command_end" && return 0
  ai_policy_has_command "$cmd" "git[[:space:]]+push${push_flags_re}${push_remote_re}${push_redirect_tail}" && return 0
  ai_policy_has_command "$cmd" "git[[:space:]]+push${push_flags_re}${push_remote_re}[[:space:]]+HEAD[[:space:]]*$push_command_end" && return 0
  ai_policy_has_command "$cmd" "git[[:space:]]+push${push_flags_re}${push_remote_re}[[:space:]]+HEAD${push_redirect_tail}" && return 0
  return 1
}

ai_policy_has_git_commit_on_main() {
  local cmd="$1"
  local branch scrubbed

  # Drop dry-run commits first: a `git ... commit ... --dry-run` validates
  # without creating a commit, so it is never blocked. Stripping it (segment-
  # bounded) before the live-commit test closes the bypass where a real commit
  # rides on a later, unrelated `--dry-run`, e.g. `git commit -m x && echo --dry-run`.
  scrubbed=$(ai_policy_strip_dry_run_commits "$cmd")

  # Match a real `git commit`, including the `git -c <cfg> ... commit` form.
  # Only genuine global options may precede the verb (see
  # AI_POLICY_GIT_PRECOMMIT_OPTS), so read-only subcommands that merely name
  # `commit` are not caught, and `commit-tree`/`commit-graph` plumbing and a
  # bare `... commit-ish` arg are excluded because CMD_END requires a separator.
  ai_policy_has_command "$scrubbed" "git[[:space:]]+${AI_POLICY_GIT_PRECOMMIT_OPTS}commit$AI_POLICY_CMD_END" || return 1

  branch=$(ai_current_branch)
  ai_branch_is_protected "$branch"
}

ai_policy_has_husky_zero_prefix() {
  local cmd="$1"
  local env_assignment
  local env_option
  local env_option_value
  local git_commit_re
  local husky_prefix
  local split_string_husky_prefix

  env_assignment='[A-Za-z_][A-Za-z0-9_]*=[^[:space:];&|]+'
  env_option_value='[^[:space:];&|]+'
  env_option="(-i|--ignore-environment|--null|--debug|--list-signal-handling|(-u|--unset|-C|--chdir|--argv0|-S|--split-string)[[:space:]]+${env_option_value}|--(unset|chdir|argv0|split-string)=${env_option_value}|--(block-signal|default-signal|ignore-signal)(=${env_option_value})?)"
  git_commit_re="git[[:space:]]+${AI_POLICY_GIT_PRECOMMIT_OPTS}commit$AI_POLICY_CMD_END"
  husky_prefix="((${env_assignment}[[:space:]]+)*HUSKY=0[[:space:]]+|env[[:space:]]+(${env_option}[[:space:]]+|${env_assignment}[[:space:]]+)*HUSKY=0[[:space:]]+)"
  split_string_husky_prefix="env[[:space:]]+(${env_option}[[:space:]]+)*(-S|--split-string)(=|[[:space:]]+)['\"]?HUSKY=0[[:space:]]+"
  ai_policy_has_command "$cmd" "(${husky_prefix}|${split_string_husky_prefix})[^;&|]*${git_commit_re}" && return 0
  ai_policy_has_command "$cmd" "export([^;&|]*[[:space:]])?HUSKY=0($|[[:space:];&|])" \
    && ai_policy_has_command "$cmd" "$git_commit_re"
}

ai_policy_has_git_commit_hook_bypass_flag() {
  local cmd="$1"
  local git_commit_re

  git_commit_re="git[[:space:]]+${AI_POLICY_GIT_PRECOMMIT_OPTS}commit"
  ai_policy_has_command "$cmd" "${git_commit_re}[^;&|]*[[:space:]]--no-verify$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "${git_commit_re}[^;&|]*[[:space:]]-[A-Za-z]*n[A-Za-z]*$AI_POLICY_CMD_END" && return 0
  return 1
}

ai_policy_has_git_push_hook_bypass_flag() {
  local cmd="$1"
  local git_push_re

  git_push_re="git[[:space:]]+${AI_POLICY_GIT_PRECOMMIT_OPTS}push"
  ai_policy_has_command "$cmd" "${git_push_re}[^;&|]*[[:space:]]--no-verify$AI_POLICY_CMD_END"
}

ai_policy_touches_allow_protected_edits_marker() {
  local cmd="$1"
  local marker_re='[^;&|]*\.allow-protected-edits'

  ai_policy_has_command "$cmd" "touch${marker_re}$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "(:|true|printf|echo|cat)${marker_re}(>|>>)[^;&|]*$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "(:|true|printf|echo|cat)[^;&|]*(>|>>)[^;&|]*\.allow-protected-edits$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "tee([[:space:]]+-[A-Za-z]+)*${marker_re}$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "(install|cp|mv)${marker_re}$AI_POLICY_CMD_END" && return 0
  return 1
}

ai_policy_advisory_context() {
  local cmd="$1"

  if ai_policy_touches_allow_protected_edits_marker "$cmd"; then
    printf '%s' "$AI_POLICY_ALLOW_PROTECTED_EDITS_ADVISORY"
    return 0
  fi

  return 1
}

ai_policy_has_gh_api_explicit_get() {
  ai_policy_has_command "$1" "gh[[:space:]]+api[^;&|]*[[:space:]]((--method(=|[[:space:]]+)|-X[[:space:]]*)[Gg][Ee][Tt])$AI_POLICY_CMD_END"
}

ai_policy_has_gh_api_visible_graphql_query() {
  local cmd="$1"

  ai_policy_has_command "$cmd" "gh[[:space:]]+api[[:space:]]+graphql" || return 1
  grep -qE -- '(^|[[:space:]])(-f|-F|--field|--raw-field)[[:space:]]+query=['"'"'"]?(query|\{)' <<< "$cmd" || return 1
  ! grep -qiE -- 'mutation[[:space:]]*(\{|[[:alpha:]_])' <<< "$cmd"
}

ai_policy_has_gh_api_mutation() {
  local cmd="$1"

  ai_policy_has_command "$cmd" "gh[[:space:]]+api[^;&|]*[[:space:]]((--method(=|[[:space:]]+)|-X[[:space:]]*)[Pp][Oo][Ss][Tt]|(--method(=|[[:space:]]+)|-X[[:space:]]*)[Pp][Uu][Tt]|(--method(=|[[:space:]]+)|-X[[:space:]]*)[Pp][Aa][Tt][Cc][Hh]|(--method(=|[[:space:]]+)|-X[[:space:]]*)[Dd][Ee][Ll][Ee][Tt][Ee])$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "gh[[:space:]]+api[^;&|]*[[:space:]]--input($|[[:space:]=])" && return 0
  if ai_policy_has_command "$cmd" "gh[[:space:]]+api[^;&|]*[[:space:]](-f|-F|--field|--raw-field)([[:space:]=]|$)"; then
    ai_policy_has_gh_api_explicit_get "$cmd" && return 1
    ai_policy_has_gh_api_visible_graphql_query "$cmd" && return 1
    return 0
  fi

  return 1
}

ai_policy_violation_reason() {
  local cmd="$1"
  local rebase_residue

  if ai_policy_has_husky_zero_prefix "$cmd" \
    || ai_policy_has_git_commit_hook_bypass_flag "$cmd" \
    || ai_policy_has_git_push_hook_bypass_flag "$cmd"; then
    printf '%s' "$AI_POLICY_HOOK_BYPASS"
    return 0
  fi

  if grep -qE '\b(psql|pgcli|pg_dump|pg_restore|pg_isready|createdb|dropdb)\b' <<< "$cmd"; then
    printf '%s' "$AI_POLICY_POSTGRES"
    return 0
  fi

  if grep -qE '\bredis-cli\b' <<< "$cmd"; then
    printf '%s' "$AI_POLICY_REDIS"
    return 0
  fi

  if grep -qE '(^[[:space:]]*|[;&|][[:space:]]*)docker([[:space:]]|-)' <<< "$cmd"; then
    printf '%s' "$AI_POLICY_DOCKER"
    return 0
  fi

  if grep -qF 'ThisIsNotTheRealDatabasePassword' <<< "$cmd"; then
    printf '%s' "$AI_POLICY_CHANGEME"
    return 0
  fi

  # Match `git commit … --amend` AND the `git -c <cfg> … commit … --amend` form
  # (config flags between `git` and `commit`). The optional `([^;&|]*[[:space:]])?`
  # segment swallows any `-c key=val` config args before `commit`. `--amend` must
  # still appear, so `git commit -c <commit>` (reuse-message, not an amend) is not
  # matched — it has no `--amend`.
  if ai_policy_has_command "$cmd" "git[[:space:]]+([^;&|]*[[:space:]])?commit[^;&|]*[[:space:]]--amend$AI_POLICY_CMD_END"; then
    printf '%s' "$AI_POLICY_GIT_AMEND"
    return 0
  fi

  rebase_residue=$(ai_policy_strip_allowed_rebase_controls "$cmd")
  if ai_policy_has_command "$rebase_residue" "git[[:space:]]+rebase$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$rebase_residue" "git[[:space:]]+rebase[[:space:]]+"; then
    printf '%s' "$AI_POLICY_GIT_REBASE"
    return 0
  fi

  if ai_policy_has_dangerous_git_reset "$cmd"; then
    printf '%s' "$AI_POLICY_GIT_RESET"
    return 0
  fi

  if ai_policy_has_command "$cmd" "git[[:space:]]+(filter-branch|filter-repo|replace|update-ref)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "git[[:space:]]+reflog[[:space:]]+expire[^;&|]*--expire=now[^;&|]*--all"; then
    printf '%s' "$AI_POLICY_GIT_HISTORY_REWRITE"
    return 0
  fi

  if ai_policy_has_command "$cmd" "git[[:space:]]+push[^;&|]*[[:space:]]((--force|--force-with-lease)(=[^[:space:];|&'\"]*)?|--mirror|--delete)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "git[[:space:]]+push[^;&|]*[[:space:]]-[A-Za-z]*[fd][A-Za-z]*$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "git[[:space:]]+push[^;&|]*[[:space:]]\\+[^[:space:];|&'\"]+" \
    || ai_policy_has_command "$cmd" "git[[:space:]]+push[^;&|]*[[:space:]]:[^[:space:];|&'\"]+"; then
    printf '%s' "$AI_POLICY_GIT_FORCE_PUSH"
    return 0
  fi

  if ai_policy_has_git_push_to_main "$cmd"; then
    printf '%s' "$AI_POLICY_GIT_PUSH_MAIN"
    return 0
  fi

  if ai_policy_has_command "$cmd" "git[[:space:]]+branch[^;&|]*[[:space:]]-D$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "git[[:space:]]+branch[^;&|]*[[:space:]]-[A-Za-z]*D[A-Za-z]*$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "git[[:space:]]+branch[^;&|]*[[:space:]]-[A-Za-z]*d[A-Za-z]*f[A-Za-z]*$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "git[[:space:]]+branch[^;&|]*[[:space:]]-[A-Za-z]*f[A-Za-z]*d[A-Za-z]*$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "git[[:space:]]+branch[^;&|]*[[:space:]]-[A-Za-z]*d[A-Za-z]*[^;&|]*[[:space:]]-[A-Za-z]*f[A-Za-z]*" \
    || ai_policy_has_command "$cmd" "git[[:space:]]+branch[^;&|]*[[:space:]]-[A-Za-z]*f[A-Za-z]*[^;&|]*[[:space:]]-[A-Za-z]*d[A-Za-z]*" \
    || ai_policy_has_command "$cmd" "git[[:space:]]+branch[^;&|]*--delete[^;&|]*--force" \
    || ai_policy_has_command "$cmd" "git[[:space:]]+branch[^;&|]*--force[^;&|]*--delete" \
    || ai_policy_has_command "$cmd" "git[[:space:]]+branch[^;&|]*--delete[^;&|]*[[:space:]]-[A-Za-z]*f[A-Za-z]*" \
    || ai_policy_has_command "$cmd" "git[[:space:]]+branch[^;&|]*[[:space:]]-[A-Za-z]*f[A-Za-z]*[^;&|]*--delete" \
    || ai_policy_has_command "$cmd" "git[[:space:]]+tag[^;&|]*[[:space:]]+(-[A-Za-z]*d[A-Za-z]*|--delete)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "git[[:space:]]+worktree[[:space:]]+remove[^;&|]*[[:space:]]--force$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "git[[:space:]]+worktree[[:space:]]+remove[^;&|]*[[:space:]]-[A-Za-z]*f[A-Za-z]*$AI_POLICY_CMD_END"; then
    printf '%s' "$AI_POLICY_GIT_BRANCH_FORCE_DELETE"
    return 0
  fi

  if ai_policy_has_command "$cmd" "git[[:space:]]+clean[^;&|]*[[:space:]](--force|-[A-Za-z]*f[A-Za-z]*)$AI_POLICY_CMD_END"; then
    printf '%s' "$AI_POLICY_GIT_CLEAN_FORCE"
    return 0
  fi

  if ai_policy_has_command "$cmd" "gh[[:space:]]+auth[[:space:]]+(token|login|logout|refresh|setup-git)$AI_POLICY_CMD_END"; then
    printf '%s' "$AI_POLICY_GH_AUTH"
    return 0
  fi

  if ai_policy_has_command "$cmd" "gh[[:space:]]+pr[[:space:]]+(create|comment|merge|close|reopen|ready|edit|lock|unlock|review)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+issue[[:space:]]+(create|comment|close|reopen|edit|delete|develop|lock|unlock|transfer|pin|unpin)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+repo[[:space:]]+(create|fork|delete|archive|rename|transfer|edit|sync|set-default)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+repo[[:space:]]+deploy-key[[:space:]]+(add|delete)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+release[[:space:]]+(create|edit|delete|delete-asset|upload)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+workflow[[:space:]]+(disable|enable|run)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+run[[:space:]]+(cancel|rerun|delete)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+cache[[:space:]]+delete$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+secret[[:space:]]+(set|delete)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+variable[[:space:]]+(set|delete)$AI_POLICY_CMD_END" \
    || ai_policy_has_gh_api_mutation "$cmd" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+codespace[[:space:]]+(create|delete|edit|rebuild|stop)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+gist[[:space:]]+(create|edit|delete)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+(gpg-key|ssh-key)[[:space:]]+(add|delete)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+label[[:space:]]+(create|edit|delete|clone)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+alias[[:space:]]+(set|delete)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+config[[:space:]]+set$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+extension[[:space:]]+(install|remove|upgrade)$AI_POLICY_CMD_END"; then
    printf '%s' "$AI_POLICY_GH_REMOTE_MUTATION"
    return 0
  fi

  # Checked last so command-specific violations (amend, bypass, …) win first:
  # a plain `git commit` is otherwise allowed, and we only block it on the
  # protected branch where work must land on a feature branch instead.
  if ai_policy_has_git_commit_on_main "$cmd"; then
    printf '%s' "$AI_POLICY_GIT_COMMIT_ON_MAIN"
    return 0
  fi

  return 1
}

# Soft-guidance policies nudge toward a better command instead of forbidding an
# action. No soft guidance policies are currently active.
ai_policy_is_soft_guidance() {
  return 1
}

# Self-block guard for *executing* hooks. PreToolUse Bash hooks that run the
# command themselves (`bash -c "$CMD"`) must never run a policy-violating command:
# the executing hook's side effect lands regardless of what no-direct-db.sh or the
# harness deny globs decide in parallel (G1 — the amend rewrote HEAD even though
# the agent saw a "blocked" message). Call this *before* the lock/exec so a
# forbidden command is denied before any mutation.
# Requires ai_emit_block from common.sh (executing hooks already source it).
ai_preflight_or_block() {
  local cmd="$1"
  local reason

  if reason=$(ai_policy_violation_reason "$cmd"); then
    ai_policy_is_soft_guidance "$reason" && return 0
    ai_emit_block "$reason"
  fi
  return 0
}

ai_is_git_commit_cmd() {
  [[ "$1" =~ (^|[[:space:];|&])git[[:space:]]+commit($|[[:space:]]) ]]
}

ai_is_git_commit_dry_run() {
  [[ "$1" =~ (^|[[:space:]])--dry-run($|[[:space:]]) ]]
}

ai_has_force_verify_prefix() {
  [[ "$1" =~ ^FORCE_VERIFY=1[[:space:]]+ ]]
}

ai_strip_force_verify_prefix() {
  local cmd="$1"
  if ai_has_force_verify_prefix "$cmd"; then
    printf '%s' "${cmd#FORCE_VERIFY=1 }"
  else
    printf '%s' "$cmd"
  fi
}

ai_is_wrapped_bun_cmd() {
  [[ "$1" =~ $AI_WRAPPED_BUN_RE ]]
}

ai_bun_script_from_cmd() {
  printf '%s' "$1" | awk '{print $3}'
}

ai_bun_script_bypasses_cache() {
  case "$1" in
    code:intel|verify:logs|verify:async:status|verify:async:tail|verify:async:stop)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ai_bun_cmd_bypasses_cache() {
  ai_is_wrapped_bun_cmd "$1" || return 1
  ai_bun_script_bypasses_cache "$(ai_bun_script_from_cmd "$1")"
}

ai_bun_cmd_bypasses_lock() {
  ai_bun_cmd_bypasses_cache "$1"
}

ai_safe_script_name() {
  local script="$1"
  printf '%s' "${script//:/_}"
}

# Fingerprint of the argv tail after `bun run <script>`, used to scope the cache
# marker to the EXACT command (H1/H2). Without this the marker keys only on the
# script name, so `bun run test -- a` and `bun run test -- a b` share a marker
# and a broader (or corrected) command replays a narrower run's cached pass/fail
# on an unchanged worktree.
#
# Normalization rules (correctness over dedup cleverness — see backlog H1):
#   - Whitespace runs collapse to single spaces (tabs/newlines too).
#   - Options keep their exact order; option order is semantically meaningful
#     (`--bail --reporter=x` != `--reporter=x --bail`), so we never sort them.
#   - ONLY the file operands AFTER a `--` separator are sorted, because a `--`
#     tail is a safely-parsed file list where order does not change which tests
#     run. The `--` separator itself is preserved so a tail differs from a
#     same-token option run.
# The wrapped-bun whitelist restricts argv to `[A-Za-z0-9._:/=-]` tokens and
# `--`, so plain whitespace word-splitting here is safe (no quotes/globs).
ai_bun_argv_fingerprint() {
  local cmd="$1"
  local -a tokens=()
  local -a pre=()
  local -a post=()
  local tail seen_sep=0 tok normalized

  # Drop `bun run <script>`; keep the rest as the argv tail.
  read -r -a tokens <<< "$cmd"
  tail="${tokens[*]:3}"

  seen_sep=0
  for tok in $tail; do
    if [ "$seen_sep" -eq 0 ] && [ "$tok" = "--" ]; then
      seen_sep=1
      continue
    fi
    if [ "$seen_sep" -eq 1 ]; then
      post+=("$tok")
    else
      pre+=("$tok")
    fi
  done

  normalized="${pre[*]}"
  if [ "$seen_sep" -eq 1 ]; then
    # Sort only the post-`--` file operands; re-attach behind the separator.
    local sorted
    sorted=$(printf '%s\n' "${post[@]}" | LC_ALL=C sort | tr '\n' ' ')
    sorted="${sorted% }"
    normalized="${normalized:+$normalized }-- $sorted"
  fi

  printf '%s' "$normalized" | sha256sum | cut -c1-16
}

# Marker filename for a wrapped bun command: `last.<script_safe>.<argv_fp>`.
# Baking the argv fingerprint into the filename (rather than an in-marker field)
# keeps the schema simple and avoids cross-argv collisions. All three call sites
# — Claude bun-run-quiet.sh and the Codex pre/post hooks — derive the marker
# through this helper so they stay in lockstep.
ai_bun_marker_name() {
  local cmd="$1"
  local script script_safe argv_fp
  script=$(ai_bun_script_from_cmd "$cmd")
  script_safe=$(ai_safe_script_name "$script")
  argv_fp=$(ai_bun_argv_fingerprint "$cmd")
  printf 'last.%s.%s' "$script_safe" "$argv_fp"
}

ai_append_flaky_note() {
  local script="$1"
  local summary="$2"

  case "$script" in
    *test*|*e2e*)
      printf '%s\n\n%s' "$summary" "$AI_FLAKY_NOTE"
      ;;
    *)
      printf '%s' "$summary"
      ;;
  esac
}
