#!/usr/bin/env bash
# Shared dependency install freshness checks.
#
# Sourced by both `scripts/doctor.sh` (bash) and `.husky/pre-commit`, which
# Husky invokes via `sh -e` — keep this file POSIX-compatible. No `local`,
# no `[[ ... ]]`, no `$'\t'`, no arrays. Variables that escape the function
# scope are namespaced with `musi_dep_*` to avoid colliding with callers.

# Print a stable content digest of file $1 on stdout, or nothing when no
# digest tool is available (callers fall back to the legacy mtime check).
# POSIX-only: no `local`, no bashisms.
musi_dependency_digest() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" 2>/dev/null | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1
  fi
}

# Record the current bun.lock content digest under node_modules so a later
# freshness check can compare CONTENT rather than mtime. Invoked from
# `scripts/write-install-digest.sh` (root postinstall) after `bun install`.
# Best-effort: returns 0 even when the marker can't be written so it never
# fails an install.
musi_dependency_write_marker() {
  musi_dep_repo_root="$1"
  musi_dep_lock="$musi_dep_repo_root/bun.lock"
  musi_dep_nm="$musi_dep_repo_root/node_modules"
  [ -f "$musi_dep_lock" ] || return 0
  [ -d "$musi_dep_nm" ] || return 0
  musi_dep_digest_value="$(musi_dependency_digest "$musi_dep_lock")"
  [ -n "$musi_dep_digest_value" ] || return 0
  printf '%s\n' "$musi_dep_digest_value" > "$musi_dep_nm/.musi-install-digest" 2>/dev/null || return 0
  return 0
}

musi_dependency_freshness() {
  musi_dep_repo_root="$1"
  musi_dep_lock="$musi_dep_repo_root/bun.lock"
  musi_dep_nm="$musi_dep_repo_root/node_modules"
  musi_dep_bin="$musi_dep_nm/.bin"
  musi_dep_digest_marker="$musi_dep_nm/.musi-install-digest"

  if [ ! -f "$musi_dep_lock" ]; then
    printf 'warn\tno bun.lock at %s\n' "$musi_dep_lock"
    return 0
  fi
  if [ ! -d "$musi_dep_nm" ]; then
    printf 'missing\tnode_modules missing - run '\''bun install'\''\n'
    return 0
  fi
  if [ ! -d "$musi_dep_bin" ]; then
    printf 'stale\t%s missing - run '\''bun install'\''\n' "$musi_dep_bin"
    return 0
  fi

  # Preferred signal: compare the lockfile's CONTENT digest to the digest
  # recorded at the last `bun install`. `bun install` re-saves bun.lock (and
  # bumps its mtime) even on a no-op, so the historical `bun.lock -nt .bin`
  # mtime check reported a phantom 'stale' immediately after a clean install
  # and never cleared. The digest is immune to that race. Requires both a
  # digest tool and a marker (written by postinstall); otherwise fall back.
  musi_dep_now_digest="$(musi_dependency_digest "$musi_dep_lock")"
  if [ -n "$musi_dep_now_digest" ] && [ -f "$musi_dep_digest_marker" ]; then
    musi_dep_saved_digest="$(cat "$musi_dep_digest_marker" 2>/dev/null)"
    if [ "$musi_dep_now_digest" = "$musi_dep_saved_digest" ]; then
      printf 'fresh\tnode_modules in sync with bun.lock\n'
    else
      printf 'stale\tbun.lock changed since last install - run '\''bun install'\''\n'
    fi
    return 0
  fi

  # Legacy mtime fallback: no digest tool, or an install that predates the
  # digest marker. Keeps the historical behavior until the next `bun install`
  # writes a marker.
  if [ "$musi_dep_lock" -nt "$musi_dep_bin" ]; then
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
