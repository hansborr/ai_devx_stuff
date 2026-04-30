#!/usr/bin/env bash
# Shared dependency install freshness checks.
#
# Sourced by both `scripts/doctor.sh` (bash) and `.husky/pre-commit`, which
# Husky invokes via `sh -e` — keep this file POSIX-compatible. No `local`,
# no `[[ ... ]]`, no `$'\t'`, no arrays. Variables that escape the function
# scope are namespaced with `musi_dep_*` to avoid colliding with callers.

musi_dependency_freshness() {
  musi_dep_repo_root="$1"
  musi_dep_lock="$musi_dep_repo_root/bun.lock"
  musi_dep_nm="$musi_dep_repo_root/node_modules"
  musi_dep_marker="$musi_dep_nm/.bin"

  if [ ! -f "$musi_dep_lock" ]; then
    printf 'warn\tno bun.lock at %s\n' "$musi_dep_lock"
    return 0
  fi
  if [ ! -d "$musi_dep_nm" ]; then
    printf 'missing\tnode_modules missing - run '\''bun install'\''\n'
    return 0
  fi
  if [ ! -d "$musi_dep_marker" ]; then
    printf 'stale\t%s missing - run '\''bun install'\''\n' "$musi_dep_marker"
    return 0
  fi
  if [ "$musi_dep_lock" -nt "$musi_dep_marker" ]; then
    printf 'stale\tbun.lock newer than node_modules/.bin - run '\''bun install'\''\n'
    return 0
  fi

  printf 'fresh\tnode_modules in sync with bun.lock\n'
}

musi_dependency_status() {
  musi_dep_result="$(musi_dependency_freshness "$1")"
  printf '%s\n' "$musi_dep_result" | cut -f1
}

musi_dependency_message() {
  musi_dep_result="$(musi_dependency_freshness "$1")"
  printf '%s\n' "$musi_dep_result" | cut -f2-
}
