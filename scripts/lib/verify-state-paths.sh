#!/usr/bin/env bash
# Repository/worktree identity and the standard gate state paths: the
# git-readonly wrapper, the fingerprint primitives every gate trust boundary
# validates against, the worktree and git-common-dir identity keys, and the
# musi_standard_* state/lock/marker path family derived from those keys. Also
# the single definition of the four shared MUSI_GATE_* timing budgets.
#
# Every gate state file is keyed by an identity hash rather than by repo path
# text, so parallel worktrees of the same repository never collide on a marker,
# a log dir, or a lock — and the git-common-dir key deliberately does collide
# across worktrees for the state that must be shared (the commit queue).
#
# Owns: MUSI_GATE_MARKER_FRESHNESS_SECONDS,
# MUSI_GATE_INTERACTIVE_TIMEOUT_DEFAULT, MUSI_GATE_PRE_PUSH_FRESHNESS_SECONDS,
# MUSI_GATE_PRECOMMIT_REGISTRATION_TIMEOUT_DEFAULT,
# musi_git_readonly, musi_fingerprint_digest_file, musi_fingerprint_is_valid,
# musi_require_fingerprint, ai_worktree_fingerprint, ai_marker_age_within_ttl,
# musi_repo_root_for_state, musi_worktree_identity_path, musi_worktree_key,
# musi_git_common_identity_path, musi_git_common_key, musi_standard_state_root,
# musi_standard_state_path, musi_standard_common_state_path,
# musi_standard_precommit_marker, musi_standard_verify_log_dir,
# musi_standard_verify_history_dir, musi_standard_verify_lock,
# musi_standard_bun_log_dir, musi_standard_bun_lock,
# musi_standard_git_commit_lock, musi_standard_commit_queue_lock.
# Does NOT own the verify-marker paths (scripts/lib/verify-markers.sh), the
# fast-commit paths (scripts/lib/verify-fast-commit.sh), or the staged
# fingerprints (scripts/lib/verify-path-policy.sh); all three derive from the
# identity and fingerprint helpers here.
#
# Source order: none — this leaf calls nothing outside itself and is the base
# layer three of the other five build on: scripts/lib/verify-fast-commit.sh,
# scripts/lib/verify-markers.sh, and scripts/lib/verify-path-policy.sh
# (verify-commit-queue.sh and verify-run-meta.sh call nothing from here). Leaf
# libs never source each other; scripts/lib/verify-metadata.sh is the sole
# public entry point and owns the ordering, and it sources this leaf first so
# the MUSI_GATE_* budgets are defined before any later leaf could read one.
# Consumers keep sourcing that aggregator.
#
# Standing invariant: no source-time side effects. Unlike the other five leaves
# this one is not function definitions only — the four MUSI_GATE_* constants
# below are top-level assignments (plus the re-source guard). They are plain
# integer literals: no command substitution, no filesystem or git access, and no
# reads of the environment, so sourcing this file still touches nothing beyond
# the shell's own function and variable tables.

if [ -n "${__MUSI_VERIFY_STATE_PATHS_SOURCED:-}" ]; then
  return 0
fi
__MUSI_VERIFY_STATE_PATHS_SOURCED=1

# --- Shared gate timing budgets ----------------------------------------------
# Single definition for the timing literals the local gates would otherwise
# re-type. Every consumer outside scripts/lib (the Husky gates, verification
# scripts, and quiet hooks) reaches them by sourcing
# scripts/lib/verify-metadata.sh before it needs a budget; the marker helpers in
# scripts/lib/verify-markers.sh source nothing themselves and see the budgets
# because the aggregator sources that leaf alongside this one. Either way these
# constants are the one place to change a window. Env overrides stay at each
# call site (MUSI_INTERACTIVE_TIMEOUT, MUSI_PRE_PUSH_VERIFY_FRESHNESS_SECONDS,
# MUSI_PRECOMMIT_REGISTRATION_TIMEOUT); these are only the defaults those
# overrides fall back to.
# shellcheck disable=SC2034 # Consumed by scripts/lib/verify-markers.sh, .husky/pre-commit, and scripts/verify.sh.
MUSI_GATE_MARKER_FRESHNESS_SECONDS=120     # success-marker / short-circuit freshness
# shellcheck disable=SC2034 # Consumed by gates, verification scripts, and quiet hooks.
MUSI_GATE_INTERACTIVE_TIMEOUT_DEFAULT=2400 # default for MUSI_INTERACTIVE_TIMEOUT watchdog
# shellcheck disable=SC2034 # Consumed by .husky/pre-push.
MUSI_GATE_PRE_PUSH_FRESHNESS_SECONDS=3600  # pre-push full-verify evidence freshness
# shellcheck disable=SC2034 # Consumed by .husky/pre-commit.
MUSI_GATE_PRECOMMIT_REGISTRATION_TIMEOUT_DEFAULT=45 # registration admission hang guard

musi_git_readonly() {
  GIT_OPTIONAL_LOCKS=0 git "$@"
}

musi_fingerprint_digest_file() {
  local input_file="$1"
  local digest_line

  digest_line=$(sha256sum "$input_file") || return 1
  digest_line="${digest_line%% *}"
  musi_fingerprint_is_valid "$digest_line" || return 1
  printf '%s\n' "$digest_line"
}

musi_fingerprint_is_valid() {
  local fingerprint="${1:-}"

  case "$fingerprint" in
    ''|*[!0-9a-f]*) return 1 ;;
  esac
  [ "${#fingerprint}" -eq 64 ]
}

# Run a fingerprint producer and emit its digest only when the command succeeds
# and returns exactly one valid SHA-256 value. Callers use this at every cache,
# marker, or metadata trust boundary so a failed command substitution can never
# turn an empty string into matching provenance.
musi_require_fingerprint() {
  local label="$1"
  shift
  local fingerprint

  if ! fingerprint=$("$@"); then
    printf '%s: fingerprint computation failed.\n' "$label" >&2
    return 1
  fi
  if ! musi_fingerprint_is_valid "$fingerprint"; then
    printf '%s: fingerprint computation returned an invalid digest.\n' "$label" >&2
    return 1
  fi
  printf '%s\n' "$fingerprint"
}

ai_worktree_fingerprint() {
  local repo_root="$1"
  local input_file untracked_file

  input_file=$(mktemp "${TMPDIR:-/tmp}/musi-worktree-fingerprint.XXXXXX") || return 1
  untracked_file=$(mktemp "${TMPDIR:-/tmp}/musi-worktree-untracked.XXXXXX") || {
    rm -f "$input_file"
    return 1
  }

  if ! musi_git_readonly -C "$repo_root" rev-parse HEAD > "$input_file" 2>/dev/null; then
    printf 'none\n' > "$input_file"
  fi
  # --binary matches ai_staged_fingerprint: without it a tracked binary
  # file's content change collapses to the constant "Binary files ... differ"
  # diff text, so swapping binary content would not change the fingerprint.
  # --no-ext-diff keeps user-configured diff drivers out of this trust boundary.
  if ! musi_git_readonly -C "$repo_root" diff --no-ext-diff --binary HEAD >> "$input_file" 2>/dev/null \
     || ! musi_git_readonly -C "$repo_root" ls-files --others --exclude-standard -z > "$untracked_file" 2>/dev/null \
     || ! (cd "$repo_root" && xargs -0 -r sha256sum < "$untracked_file" >> "$input_file" 2>/dev/null); then
    rm -f "$input_file" "$untracked_file"
    return 1
  fi

  rm -f "$untracked_file"
  if ! musi_fingerprint_digest_file "$input_file"; then
    rm -f "$input_file"
    return 1
  fi
  rm -f "$input_file"
}

# Shared freshness floor for the wrapped-bun/stop marker readers. Mirrors
# musi_success_marker_matches: a negative age (future-dated marker, e.g. after
# clock skew) is stale, never fresh — otherwise a future timestamp satisfies
# `age < ttl` forever and replays a cached verdict past its TTL.
ai_marker_age_within_ttl() {
  local age="$1" ttl="$2"

  [ "$age" -ge 0 ] && [ "$age" -lt "$ttl" ]
}

musi_repo_root_for_state() {
  local repo_root="${1:-}"

  if [ -n "$repo_root" ]; then
    printf '%s' "$repo_root"
    return 0
  fi

  if [ -n "${REPO_ROOT:-}" ]; then
    printf '%s' "$REPO_ROOT"
    return 0
  fi

  git rev-parse --show-toplevel 2>/dev/null || printf '/workspace'
}

musi_worktree_identity_path() {
  local repo_root resolved

  repo_root=$(musi_repo_root_for_state "${1:-}")
  if [ -d "$repo_root" ] && resolved=$(cd "$repo_root" && pwd -P); then
    printf '%s' "$resolved"
    return 0
  fi

  printf '%s' "$repo_root"
}

musi_worktree_key() {
  local repo_root="${1:-}"

  musi_worktree_identity_path "$repo_root" | sha256sum | awk '{print $1}'
}

musi_git_common_identity_path() {
  local repo_root common_dir resolved

  repo_root=$(musi_repo_root_for_state "${1:-}")
  if common_dir=$(git -C "$repo_root" rev-parse --git-common-dir 2>/dev/null); then
    case "$common_dir" in
      /*) ;;
      *) common_dir="$repo_root/$common_dir" ;;
    esac
    if [ -d "$common_dir" ] && resolved=$(cd "$common_dir" && pwd -P); then
      printf '%s' "$resolved"
      return 0
    fi
    printf '%s' "$common_dir"
    return 0
  fi

  musi_worktree_identity_path "$repo_root"
}

musi_git_common_key() {
  local repo_root="${1:-}"

  musi_git_common_identity_path "$repo_root" | sha256sum | awk '{print $1}'
}

musi_standard_state_root() {
  local state_root="${MUSI_VERIFY_STATE_ROOT:-/tmp}"

  state_root="${state_root%/}"
  [ -n "$state_root" ] || state_root="/"
  printf '%s' "$state_root"
}

musi_standard_state_path() {
  local name="$1"
  local repo_root="${2:-}"
  local state_root

  state_root=$(musi_standard_state_root)
  if [ "$state_root" = "/" ]; then
    printf '/%s.%s' "$name" "$(musi_worktree_key "$repo_root")"
    return 0
  fi

  printf '%s/%s.%s' \
    "$state_root" \
    "$name" \
    "$(musi_worktree_key "$repo_root")"
}

musi_standard_common_state_path() {
  local name="$1"
  local repo_root="${2:-}"
  local state_root

  state_root=$(musi_standard_state_root)
  if [ "$state_root" = "/" ]; then
    printf '/%s.%s' "$name" "$(musi_git_common_key "$repo_root")"
    return 0
  fi

  printf '%s/%s.%s' \
    "$state_root" \
    "$name" \
    "$(musi_git_common_key "$repo_root")"
}

musi_standard_precommit_marker() {
  local repo_root="${1:-}"

  printf '%s' "${MUSI_STANDARD_PRECOMMIT_MARKER:-$(musi_standard_state_path musi-pre-commit-last "$repo_root")}"
}

musi_standard_verify_log_dir() {
  local repo_root="${1:-}"

  printf '%s' "${MUSI_STANDARD_VERIFY_LOG_DIR:-$(musi_standard_state_path musi-pre-commit-logs "$repo_root")}"
}

musi_standard_verify_history_dir() {
  local repo_root="${1:-}"

  printf '%s' "${MUSI_STANDARD_VERIFY_HISTORY_DIR:-$(musi_standard_state_path musi-verify-history "$repo_root")}"
}

musi_standard_verify_lock() {
  local repo_root="${1:-}"

  printf '%s' "${MUSI_STANDARD_VERIFY_LOCK:-$(musi_standard_state_path musi-pre-commit.lock "$repo_root")}"
}

musi_standard_bun_log_dir() {
  local repo_root="${1:-}"

  printf '%s' "${MUSI_STANDARD_BUN_LOG_DIR:-$(musi_standard_state_path musi-bun-logs "$repo_root")}"
}

musi_standard_bun_lock() {
  local repo_root="${1:-}"

  printf '%s' "${MUSI_STANDARD_BUN_LOCK:-$(musi_standard_state_path musi-bun.lock "$repo_root")}"
}

musi_standard_git_commit_lock() {
  local repo_root="${1:-}"

  printf '%s' "${MUSI_STANDARD_GIT_COMMIT_LOCK:-$(musi_standard_state_path musi-git-commit.lock "$repo_root")}"
}

musi_standard_commit_queue_lock() {
  local repo_root="${1:-}"

  printf '%s' "${MUSI_STANDARD_COMMIT_QUEUE_LOCK:-$(musi_standard_common_state_path musi-commit-queue.lock "$repo_root")}"
}
