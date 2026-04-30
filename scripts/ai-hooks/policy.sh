#!/bin/bash

# Shared policy checks and verification command matching.

AI_POLICY_HOOK_BYPASS="Hook bypass is not allowed. Pre-commit hooks must always run."
AI_POLICY_POSTGRES="Do not use PostgreSQL CLI tools directly. You are in a container - use Prisma for all DB operations: 'bun run --filter @musi/server db:push' for schema, 'bun run --filter @musi/server db:seed' for seeding, or Prisma CLI commands routed through the repo scripts. Credentials are in .devcontainer/.env."
AI_POLICY_REDIS="Do not use redis-cli directly. You are in a container - Redis is managed by the app. If you need to inspect Redis state, read the app code or use 'bun run' scripts."
AI_POLICY_DOCKER="Do not run docker or docker-compose commands. You are in a container - PostgreSQL and Redis are already running and managed by the dev container. Use Prisma CLI for database operations."
AI_POLICY_CHANGEME="Wrong database credentials. 'ThisIsNotTheRealDatabasePassword' is not the password for this environment. Read .devcontainer/.env for the correct credentials."
AI_FLAKY_NOTE="Note: If this failure looks flaky (passes in isolation, fails under load), confirm with a focused rerun before treating it as product breakage."

AI_WRAPPED_BUN_RE='^bun run (lint|lint:changed|lint:fix|typecheck|test|test:changed|test:server|test:client|test:shared|test:coverage|e2e|format|format:check|format:changed|build)( --[A-Za-z0-9._=-]+)*$'

ai_policy_violation_reason() {
  local cmd="$1"

  if grep -qE -- '(^|[[:space:]])HUSKY=0([[:space:]]|$)|--no-verify|\bgit[[:space:]]+commit\b.*(^|[[:space:]])-[A-Za-z]*n[A-Za-z]*([[:space:]]|$)' <<< "$cmd"; then
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

  if grep -qE '(^|[;&|][[:space:]]*)docker([[:space:]]|-)' <<< "$cmd"; then
    printf '%s' "$AI_POLICY_DOCKER"
    return 0
  fi

  if grep -qF 'ThisIsNotTheRealDatabasePassword' <<< "$cmd"; then
    printf '%s' "$AI_POLICY_CHANGEME"
    return 0
  fi

  return 1
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

ai_safe_script_name() {
  local script="$1"
  printf '%s' "${script//:/_}"
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
