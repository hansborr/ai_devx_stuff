#!/usr/bin/env bash
# Fast-commit provenance: the shared state that lets pre-push tell which commits
# were made with the slow verify slots deferred, plus the tripwire that makes the
# hand-managed musi-fast-commit toggle's disappearances attributable.
#
# Owns: musi_fast_commit_log_path, musi_fast_commit_log_lock,
# musi_fast_commit_pending_marker, musi_fast_commit_log_append,
# musi_fast_commit_log_clear, musi_fast_commit_marker_log_path,
# musi_fast_commit_marker_state_path, musi_fast_commit_marker_observe.
# Does NOT own the toggle's lifecycle (created and removed by hand) nor the
# pre-push freshness budget (MUSI_GATE_PRE_PUSH_FRESHNESS_SECONDS).
#
# Source order: calls musi_git_common_identity_path and musi_worktree_key from
# the state-path family in scripts/lib/verify-state-paths.sh.
# Bash resolves those at call time, so no ordering is required — and leaf libs
# never source each other regardless: verify-metadata.sh is the sole public
# entry point and owns the ordering. Consumers keep sourcing that aggregator.
#
# Standing invariant: function definitions only, no source-time side effects
# (the re-source guard below is the sole exception).

if [ -n "${__MUSI_VERIFY_FAST_COMMIT_SOURCED:-}" ]; then
  return 0
fi
__MUSI_VERIFY_FAST_COMMIT_SOURCED=1

# --- Fast-commit provenance state -------------------------------------------
# Fast-commit mode defers slow verify slots at commit time; the pre-push
# backstop then demands a fresh full verify before any such commit is
# published. Three pieces of shared state coordinate this:
#   - the mode toggle (musi-fast-commit) and the provenance log
#     (musi-fast-commit-log) live in the Git common dir, shared by every
#     worktree, because pre-push in any worktree must see every lane's fast
#     commits;
#   - the pending marker is per-worktree (keyed like the standard state paths)
#     so parallel lanes committing at once cannot delete or consume each
#     other's in-flight markers between pre-commit and post-commit.

musi_fast_commit_log_path() {
  printf '%s/musi-fast-commit-log' "$(musi_git_common_identity_path "${1:-}")"
}

# Lock guarding every append/clear of the provenance log. Kept beside the log in
# the Git common dir so all worktrees serialize on one inode: a concurrent
# post-commit append can never be lost to a pre-push clear's
# read-filter-rename, and the log is never observed truncated or partial.
musi_fast_commit_log_lock() {
  printf '%s/musi-fast-commit-log.lock' "$(musi_git_common_identity_path "${1:-}")"
}

# Per-worktree in-flight marker pre-commit leaves for post-commit to convert
# into a logged commit SHA. Suffixed by the committing worktree's key so a
# sibling lane's pre-commit prepare-rm or post-commit consume touches only its
# own marker.
musi_fast_commit_pending_marker() {
  printf '%s/musi-fast-commit-pending.%s' \
    "$(musi_git_common_identity_path "${1:-}")" \
    "$(musi_worktree_key "${1:-}")"
}

# Append HEAD to the provenance log under the shared lock, de-duplicating so a
# retried post-commit cannot double-record. No-op when head is empty.
musi_fast_commit_log_append() {
  local repo_root="$1"
  local head="$2"
  local log lock

  [ -n "$head" ] || return 0
  log="$(musi_fast_commit_log_path "$repo_root")"
  lock="$(musi_fast_commit_log_lock "$repo_root")"
  mkdir -p "$(dirname "$log")" || return 1
  (
    flock 9 || exit 1
    if [ ! -f "$log" ] || ! grep -qxF "$head" "$log"; then
      printf '%s\n' "$head" >> "$log"
    fi
  ) 9<>"$lock"
}

# Remove the given commits from the provenance log under the shared lock. The
# temp file is created beside the log (same directory, same filesystem) so the
# replacement is an atomic rename rather than a cross-filesystem copy-then-
# unlink through which a concurrent reader could observe a partial log.
musi_fast_commit_log_clear() {
  local repo_root="$1"
  local commits="$2"
  local log lock tmp

  [ -n "$commits" ] || return 0
  log="$(musi_fast_commit_log_path "$repo_root")"
  lock="$(musi_fast_commit_log_lock "$repo_root")"
  [ -f "$log" ] || return 0
  mkdir -p "$(dirname "$lock")" || return 1
  (
    flock 9 || exit 1
    [ -f "$log" ] || exit 0
    tmp=$(mktemp "$log.XXXXXX") || exit 1
    grep -vxF -f <(printf '%s\n' "$commits") "$log" > "$tmp" || true
    mv "$tmp" "$log"
  ) 9<>"$lock"
}

# --- Fast-commit marker tripwire --------------------------------------------
# The musi-fast-commit toggle is created and removed by hand (touch/rm); no
# production code owns its lifecycle, yet it has been observed to vanish
# mid-session, forcing "re-touch before every commit" folklore in lane prompts.
# This tripwire records the toggle's presence each time pre-commit consults it
# and appends a line to a dedicated transition log whenever presence flips, so
# the next observed vanish is attributable (path + pid + timestamp) rather than
# folklore. The log and its last-observed-state sidecar live beside the toggle in
# the Git common dir (worktree-shared). Kept separate from the commit-SHA
# provenance log so free-text transition lines never corrupt that log's
# exact-line append/clear. The observer never blocks a commit: it always
# succeeds.

musi_fast_commit_marker_log_path() {
  printf '%s/musi-fast-commit-marker-log' "$(musi_git_common_identity_path "${1:-}")"
}

musi_fast_commit_marker_state_path() {
  printf '%s/musi-fast-commit-marker-state' "$(musi_git_common_identity_path "${1:-}")"
}

# Observe the toggle's current presence, compare it to the last recorded
# observation, and append a created/removed transition line when it flips. The
# first observation records a baseline silently — there is no prior state to
# compare. Serialized on the provenance log lock so concurrent lane pre-commits
# cannot interleave a read-modify-write of the state sidecar. Always returns 0.
musi_fast_commit_marker_observe() {
  local repo_root="$1"
  local marker state_file log lock cur

  marker="$(musi_git_common_identity_path "$repo_root")/musi-fast-commit"
  state_file="$(musi_fast_commit_marker_state_path "$repo_root")"
  log="$(musi_fast_commit_marker_log_path "$repo_root")"
  lock="$(musi_fast_commit_log_lock "$repo_root")"
  mkdir -p "$(dirname "$state_file")" 2>/dev/null || return 0
  if [ -e "$marker" ]; then
    cur=present
  else
    cur=absent
  fi
  (
    flock 9 || exit 0
    local prev transition
    prev=$(cat "$state_file" 2>/dev/null || printf 'unknown')
    if [ "$prev" != "$cur" ]; then
      if [ "$prev" != unknown ]; then
        if [ "$cur" = present ]; then
          transition=created
        else
          transition=removed
        fi
        printf '%s observed-by-pid=%s %s %s\n' "$(date -Iseconds)" "$$" "$transition" "$marker" >> "$log"
      fi
      printf '%s\n' "$cur" > "$state_file"
    fi
  ) 9<>"$lock"
  return 0
}
