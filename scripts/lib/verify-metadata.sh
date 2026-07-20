#!/usr/bin/env bash
# Helpers for verification timing metadata shared by pre-commit, verify, and
# verify:logs. Writers create per-step fragments first so parallel pre-commit
# children never append to the same file concurrently; the wrapper combines
# fragments into run-meta.json at the end of the run.
#
# Kept in scripts/lib so gate scripts and smoke tests can source it without
# pulling in `scripts/ai-hooks/cache.sh`. Every sourcer is bash (there is no
# dash/POSIX-sh constraint); the real contract is staying sourceable under
# `set -euo pipefail` with stable function names and out-variables.
# `ai_worktree_fingerprint` is defined here for the same reason; cache.sh
# sources this file and re-exports it for ai-hooks callers.
#
# Run-meta JSON parsing/serialization lives in the TS codec
# `scripts/lib/verify-metadata-core.ts` per the substrate ruling
# (docs/ai-harness.md); the musi_run_meta_* / musi_write_*_meta /
# musi_combine_run_meta functions below are thin shims around it.

# --- Shared gate timing budgets ----------------------------------------------
# Single definition for the timing literals the local gates would otherwise
# re-type. Every consumer (the Husky gates, verification scripts, quiet hooks,
# and the helpers below) sources this file before it needs a budget, so these
# constants are the one place to change a window. Env overrides stay at each
# call site (MUSI_INTERACTIVE_TIMEOUT, MUSI_PRE_PUSH_VERIFY_FRESHNESS_SECONDS);
# these are only the defaults those overrides fall back to.
#
# NOTE: musi_count_commit_queue_waiters' own 3600s ticket-age backstop is a
# different semantic (a reused-PID ghost-ticket bound, not verify freshness) and
# is intentionally *not* one of these constants.
MUSI_GATE_MARKER_FRESHNESS_SECONDS=120     # success-marker / short-circuit freshness
# shellcheck disable=SC2034 # Consumed by gates, verification scripts, and quiet hooks.
MUSI_GATE_INTERACTIVE_TIMEOUT_DEFAULT=2400 # default for MUSI_INTERACTIVE_TIMEOUT watchdog
# shellcheck disable=SC2034 # Consumed by .husky/pre-push.
MUSI_GATE_PRE_PUSH_FRESHNESS_SECONDS=3600  # pre-push full-verify evidence freshness

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

# Directory of waiter tickets parked on a shared commit-queue lock. Keyed off the
# lock path itself (not the repo root) so an MUSI_COMMIT_QUEUE_LOCK override — the
# test seam and any bespoke lock — carries its waiters alongside it.
musi_commit_queue_waiter_dir() {
  local queue_lock="$1"

  printf '%s.waiters' "$queue_lock"
}

# Register this lane's waiter ticket: one file named by PID, recording the target
# worktree and the start epoch. Peers read it to report queue depth; the epoch
# lets them expire an abandoned ticket. Best-effort — a failed registration only
# costs an under-count in someone's heartbeat, never correctness.
musi_register_commit_queue_waiter() {
  local waiter_dir="$1"
  local pid="$2"
  local worktree="$3"

  mkdir -p "$waiter_dir" 2>/dev/null || return 1
  printf 'PID=%s WORKTREE=%s STARTED=%s\n' "$pid" "$worktree" "$(date +%s)" \
    > "$waiter_dir/$pid" 2>/dev/null || return 1
}

musi_remove_commit_queue_waiter() {
  local waiter_dir="$1"
  local pid="$2"

  rm -f "$waiter_dir/$pid" 2>/dev/null || true
}

# Prune dead/expired tickets from a waiter dir and print the count of live
# waiters other than self_pid. A ticket is dead when its owner PID is gone (the
# SIGKILLed-lane case — the lane could not run its own cleanup) or when it is
# older than max_age (a backstop so a reused PID cannot keep a ghost ticket alive
# forever). Pruning on read means an abandoned wait self-heals for the next lane.
musi_count_commit_queue_waiters() {
  local waiter_dir="$1"
  local self_pid="$2"
  local max_age="${3:-3600}"
  local now count ticket pid started age

  [ -d "$waiter_dir" ] || { printf '0'; return 0; }
  now=$(date +%s)
  count=0
  for ticket in "$waiter_dir"/*; do
    [ -e "$ticket" ] || continue
    pid=$(basename "$ticket")
    case "$pid" in
      ''|*[!0-9]*) rm -f "$ticket" 2>/dev/null; continue ;;
    esac
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$ticket" 2>/dev/null
      continue
    fi
    started=$(sed -n 's/.*STARTED=\([0-9][0-9]*\).*/\1/p' "$ticket" 2>/dev/null)
    case "$started" in
      ''|*[!0-9]*) : ;;
      *)
        age=$((now - started))
        if [ "$age" -gt "$max_age" ]; then
          rm -f "$ticket" 2>/dev/null
          continue
        fi
        ;;
    esac
    [ "$pid" = "$self_pid" ] && continue
    count=$((count + 1))
  done
  printf '%s' "$count"
}

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

musi_path_policy_query_script() {
  if [ -n "${MUSI_PATH_POLICY_QUERY:-}" ]; then
    printf '%s\n' "$MUSI_PATH_POLICY_QUERY"
    return 0
  fi

  if [ -n "${REPO_ROOT:-}" ] && [ -f "$REPO_ROOT/scripts/path-policy/path-policy-query.ts" ]; then
    printf '%s\n' "$REPO_ROOT/scripts/path-policy/path-policy-query.ts"
    return 0
  fi

  if [ -n "${BASH_SOURCE:-}" ]; then
    printf '%s\n' "$(cd "$(dirname "$BASH_SOURCE")/.." && pwd)/path-policy/path-policy-query.ts"
    return 0
  fi

  printf '%s\n' "$(cd "$(dirname "$0")/.." && pwd)/path-policy/path-policy-query.ts"
}

musi_path_policy_query_nul() {
  local query="$1"
  local script bun_bin tmp
  script="$(musi_path_policy_query_script)"
  bun_bin="${MUSI_PATH_POLICY_BUN:-bun}"
  tmp=$(mktemp "${TMPDIR:-/tmp}/musi-path-policy-query.XXXXXX") || return 2
  if ! "$bun_bin" --config=/dev/null "$script" "$query" > "$tmp"; then
    rm -f "$tmp"
    return 2
  fi
  if ! cat "$tmp"; then
    rm -f "$tmp"
    return 2
  fi
  rm -f "$tmp"
}

musi_path_policy_query_lines() {
  local query="$1"
  local tmp status
  tmp=$(mktemp "${TMPDIR:-/tmp}/musi-path-policy-lines.XXXXXX") || return 2
  if ! musi_path_policy_query_nul "$query" > "$tmp"; then
    rm -f "$tmp"
    return 2
  fi
  tr '\0' '\n' < "$tmp"
  status=$?
  rm -f "$tmp"
  return "$status"
}

musi_path_policy_path_matches() {
  local query="$1"
  local path="$2"
  local tmp status

  tmp=$(mktemp "${TMPDIR:-/tmp}/musi-path-policy-match.XXXXXX") || return 2
  if ! printf '%s\0' "$path" | musi_path_policy_query_nul "$query" > "$tmp"; then
    rm -f "$tmp"
    return 2
  fi
  status=1
  [ -s "$tmp" ] && status=0
  rm -f "$tmp"
  return "$status"
}

ai_staged_fingerprint() {
  local repo_root="$1"
  local input_file

  input_file=$(mktemp "${TMPDIR:-/tmp}/musi-staged-fingerprint.XXXXXX") || return 1
  if ! musi_git_readonly -C "$repo_root" rev-parse HEAD > "$input_file" 2>/dev/null; then
    printf 'none\n' > "$input_file"
  fi
  if ! musi_git_readonly -C "$repo_root" diff --no-ext-diff --cached --binary --diff-filter=ACMRD >> "$input_file"; then
    rm -f "$input_file"
    return 1
  fi
  if ! musi_fingerprint_digest_file "$input_file"; then
    rm -f "$input_file"
    return 1
  fi
  rm -f "$input_file"
}

musi_changed_gate_relevant_path() {
  local path="$1"

  musi_path_policy_path_matches source-relevant "$path"
}

musi_staged_has_source_relevant_change() {
  local tmp

  tmp=$(mktemp "${TMPDIR:-/tmp}/musi-staged-source.XXXXXX") || return 2
  if ! (set -o pipefail; \
    git diff --cached --name-only -z --diff-filter=ACMRD 2>/dev/null \
      | musi_path_policy_query_nul source-relevant:precommit-staged) > "$tmp"; then
    rm -f "$tmp"
    return 2
  fi
  if [ -s "$tmp" ]; then
    rm -f "$tmp"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

ai_precommit_tracked_relevant_path() {
  local path="$1"

  musi_path_policy_path_matches source-relevant:precommit-tracked "$path"
}

ai_precommit_untracked_relevant_path() {
  local path="$1"

  musi_changed_gate_relevant_path "$path"
}

musi_changed_gate_fail_if_unstaged() {
  local repo_root="$1"
  local label="${2:-changed verification}"
  local tmp file

  tmp=$(mktemp "${TMPDIR:-/tmp}/musi-changed-gate.XXXXXX") || return 2
  if ! (
    cd "$repo_root" || exit 2
    set -o pipefail
    {
      git diff --name-only -z --diff-filter=ACMRD 2>/dev/null \
        && git ls-files --others --exclude-standard -z 2>/dev/null
    } | sort -z -u | musi_path_policy_query_nul source-relevant
  ) > "$tmp"; then
    printf '%s: source-relevant path selection failed.\n' "$label" >&2
    rm -f "$tmp"
    return 2
  fi

  if [ -s "$tmp" ]; then
    printf '%s: source-relevant unstaged or untracked changes are present.\n' "$label" >&2
    printf '%s: stage the intended commit, or stash/restore unrelated source-relevant work, before running changed verification.\n' "$label" >&2
    while IFS= read -r -d '' file; do
      [ -n "$file" ] || continue
      printf '%s:   - %s\n' "$label" "$file" >&2
    done < "$tmp"
    rm -f "$tmp"
    return 1
  fi

  rm -f "$tmp"
  return 0
}

ai_precommit_fingerprint() {
  local repo_root="$1"
  local input_file paths_file selected_file file hash_status

  input_file=$(mktemp "${TMPDIR:-/tmp}/musi-precommit-fingerprint.XXXXXX") || return 1
  paths_file=$(mktemp "${TMPDIR:-/tmp}/musi-precommit-paths.XXXXXX") || {
    rm -f "$input_file"
    return 1
  }
  selected_file=$(mktemp "${TMPDIR:-/tmp}/musi-precommit-selected.XXXXXX") || {
    rm -f "$input_file" "$paths_file"
    return 1
  }

  if ! musi_git_readonly -C "$repo_root" rev-parse HEAD > "$input_file" 2>/dev/null; then
    printf 'none\n' > "$input_file"
  fi
  # Fast-commit mode skips slow pre-commit test slots; fold its presence in so
  # a partial (fast) success marker cannot short-circuit a later full
  # pre-commit at the same HEAD/diff. Absent ⇒ byte-identical to the legacy
  # fingerprint. The marker lives in the Git common dir (worktree-shared).
  if [ -f "$(musi_git_common_identity_path "$repo_root")/musi-fast-commit" ]; then
    printf 'fast-commit=1\n' >> "$input_file"
  fi
  if ! musi_git_readonly -C "$repo_root" diff --no-ext-diff --cached --binary --diff-filter=ACMRD >> "$input_file" \
     || ! musi_git_readonly -C "$repo_root" diff --no-ext-diff --name-only -z --diff-filter=ACMRD HEAD > "$paths_file" 2>/dev/null \
     || ! (set -o pipefail; sort -z -u "$paths_file" | musi_path_policy_query_nul source-relevant:precommit-tracked) > "$selected_file"; then
    rm -f "$input_file" "$paths_file" "$selected_file"
    return 1
  fi

  hash_status=0
  while IFS= read -r -d '' file; do
    [ -n "$file" ] || continue
    if [ -f "$repo_root/$file" ]; then
      (cd "$repo_root" && sha256sum "$file") >> "$input_file" || {
        hash_status=$?
        break
      }
    else
      printf 'deleted\0%s\0' "$file" >> "$input_file"
    fi
  done < "$selected_file"
  if [ "$hash_status" -ne 0 ] \
     || ! musi_git_readonly -C "$repo_root" ls-files --others --exclude-standard -z > "$paths_file" 2>/dev/null \
     || ! (set -o pipefail; sort -z -u "$paths_file" | musi_path_policy_query_nul source-relevant) > "$selected_file"; then
    rm -f "$input_file" "$paths_file" "$selected_file"
    return 1
  fi

  hash_status=0
  while IFS= read -r -d '' file; do
    [ -n "$file" ] || continue
    [ -f "$repo_root/$file" ] || continue
    (cd "$repo_root" && sha256sum "$file") >> "$input_file" || {
      hash_status=$?
      break
    }
  done < "$selected_file"
  rm -f "$paths_file" "$selected_file"
  if [ "$hash_status" -ne 0 ]; then
    rm -f "$input_file"
    return 1
  fi
  if ! musi_fingerprint_digest_file "$input_file"; then
    rm -f "$input_file"
    return 1
  fi
  rm -f "$input_file"
}

musi_read_success_marker() {
  local marker="$1"
  local saw_ts saw_head saw_hash k v
  saw_ts=0
  saw_head=0
  saw_hash=0

  MUSI_MARKER_LAST_TS=0
  MUSI_MARKER_LAST_HEAD=""
  MUSI_MARKER_LAST_HASH=""

  [ -f "$marker" ] || return 1
  while IFS='=' read -r k v || [ -n "$k$v" ]; do
    case "$k" in
      LAST_TS)
        [ "$saw_ts" -eq 0 ] || return 1
        MUSI_MARKER_LAST_TS=$v
        saw_ts=1
        ;;
      LAST_HEAD)
        [ "$saw_head" -eq 0 ] || return 1
        MUSI_MARKER_LAST_HEAD=$v
        saw_head=1
        ;;
      LAST_HASH)
        [ "$saw_hash" -eq 0 ] || return 1
        MUSI_MARKER_LAST_HASH=$v
        saw_hash=1
        ;;
      *)
        return 1
        ;;
    esac
  done < "$marker"

  [ "$saw_ts" -eq 1 ] || return 1
  [ "$saw_head" -eq 1 ] || return 1
  [ "$saw_hash" -eq 1 ] || return 1
  case "$MUSI_MARKER_LAST_TS" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$MUSI_MARKER_LAST_TS" -gt 0 ] || return 1
  [ -n "$MUSI_MARKER_LAST_HEAD" ] || return 1
  case "$MUSI_MARKER_LAST_HASH" in
    ''|*[!0-9a-f]*) return 1 ;;
  esac
  [ "${#MUSI_MARKER_LAST_HASH}" -eq 64 ] || return 1
}

musi_success_marker_matches() {
  local marker="$1"
  local current_head="$2"
  local current_hash="$3"
  local freshness_seconds="${4:-$MUSI_GATE_MARKER_FRESHNESS_SECONDS}"
  local now age

  MUSI_MARKER_MATCH_AGE=""

  musi_fingerprint_is_valid "$current_hash" || return 1
  musi_read_success_marker "$marker" || return 1
  now=$(date +%s)
  age=$((now - MUSI_MARKER_LAST_TS))
  [ "$age" -ge 0 ] || return 1
  [ "$age" -lt "$freshness_seconds" ] || return 1
  [ "$MUSI_MARKER_LAST_HEAD" = "$current_head" ] || return 1
  [ "$MUSI_MARKER_LAST_HASH" = "$current_hash" ] || return 1

  MUSI_MARKER_MATCH_AGE=$age
}

musi_write_success_marker() {
  local marker="$1"
  local head="$2"
  local hash="$3"
  local marker_dir marker_base marker_tmp

  musi_fingerprint_is_valid "$hash" || return 1
  marker_dir=$(dirname "$marker")
  marker_base=$(basename "$marker")
  mkdir -p "$marker_dir" || return 1
  marker_tmp=$(mktemp "$marker_dir/.${marker_base}.tmp.XXXXXX") || marker_tmp=""
  if [ -n "$marker_tmp" ] && {
    printf 'LAST_TS=%s\n' "$(date +%s)"
    printf 'LAST_HEAD=%s\n' "$head"
    printf 'LAST_HASH=%s\n' "$hash"
  } > "$marker_tmp" && mv -f "$marker_tmp" "$marker"; then
    return 0
  fi

  [ -n "$marker_tmp" ] && rm -f "$marker_tmp"
  return 1
}

# Re-stamp a passing full-verify success marker onto a new HEAD whose tree is
# byte-identical to the already-verified tree (e.g. a `--no-ff` merge commit that
# records new parents but no new tree content). This lets `land.sh` publish a
# merge commit on the strength of the verify that just passed on the merged
# branch tip, instead of forcing a redundant full re-verify.
#
# SAFETY: this only rewrites the HEAD/hash the pre-push gate reads — it must
# never move a pass onto a tree that verify did not cover. The caller is
# responsible for confirming tree equality (the merge tree == the verified tree)
# BEFORE calling; here we additionally refuse unless the source marker is a
# genuinely fresh, matching pass for the verified HEAD — same HEAD, same
# fingerprint, and written within the freshness window. An aged marker (even one
# whose tree still matches) is refused rather than resurrected: re-stamping an
# expired pass would defeat the freshness contract the pre-push gate relies on.
#
# Args: <marker> <expected_verified_hash> <new_head> <new_hash> <verified_head> \
#       [freshness_seconds]
#   expected_verified_hash - the fingerprint the caller independently recomputed
#     for the verified tree; must equal the marker's recorded LAST_HASH.
#   new_head / new_hash    - the HEAD and worktree fingerprint to stamp (the
#     merge commit and its own fingerprint).
#   verified_head          - the HEAD the source pass verified; must equal the
#     marker's recorded LAST_HEAD.
#   freshness_seconds      - max marker age accepted (default
#     MUSI_GATE_MARKER_FRESHNESS_SECONDS, the standard success-marker freshness).
# Returns: 0 re-stamped; nonzero refused (missing, stale, or non-matching
#   source marker — no write performed).
musi_restamp_verify_marker() {
  local marker="$1"
  local expected_verified_hash="$2"
  local new_head="$3"
  local new_hash="$4"
  local verified_head="$5"
  local freshness_seconds="${6:-$MUSI_GATE_MARKER_FRESHNESS_SECONDS}"

  musi_success_marker_matches "$marker" "$verified_head" "$expected_verified_hash" \
    "$freshness_seconds" || return 1
  musi_write_success_marker "$marker" "$new_head" "$new_hash"
}

musi_standard_verify_changed_marker() {
  local repo_root="${1:-}"

  printf '%s' "${MUSI_STANDARD_VERIFY_MARKER_CHANGED:-$(musi_standard_state_path musi-verify-changed-last "$repo_root")}"
}

musi_standard_verify_full_marker() {
  local repo_root="${1:-}"

  printf '%s' "${MUSI_STANDARD_VERIFY_MARKER_FULL:-$(musi_standard_state_path musi-verify-last "$repo_root")}"
}

musi_staged_has_script_relevant_deletion() {
  local tmp
  tmp=$(mktemp "${TMPDIR:-/tmp}/musi-script-deletion.XXXXXX") || return 2
  printf '%s\n' "$1" | musi_path_policy_query_lines deletion-class:script-smoke-sensitive > "$tmp"
  if [ -s "$tmp" ]; then
    rm -f "$tmp"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

musi_nul_paths_are_line_safe() {
  local path

  while IFS= read -r -d '' path; do
    case "$path" in
      *$'\n'*) return 1 ;;
    esac
  done
  return 0
}

musi_classify_staged_script_input() {
  local all_file deleted_file line_safe_rc=0

  all_file=$(mktemp "${TMPDIR:-/tmp}/musi-staged-script-all.XXXXXX") || return 2
  deleted_file=$(mktemp "${TMPDIR:-/tmp}/musi-staged-script-deleted.XXXXXX") || {
    rm -f "$all_file"
    return 2
  }
  if ! git diff --cached --name-only -z --diff-filter=ACMRD > "$all_file" 2>/dev/null \
     || ! git diff --cached --name-only -z --diff-filter=D > "$deleted_file" 2>/dev/null; then
    rm -f "$all_file" "$deleted_file"
    return 2
  fi

  [ -s "$all_file" ] || {
    rm -f "$all_file" "$deleted_file"
    return 2
  }
  musi_nul_paths_are_line_safe < "$all_file" || line_safe_rc=$?
  if [ "$line_safe_rc" -ne 0 ]; then
    rm -f "$all_file" "$deleted_file"
    # The changed-smoke handoff uses environment variables, which cannot carry
    # NUL records. Conservatively request the full suite for newline paths.
    return 1
  fi

  # shellcheck disable=SC2034 # Read by scripts/verify/steps-lib.sh after classification.
  MUSI_STAGED_SCRIPT_ALL="$(tr '\0' '\n' < "$all_file")"
  # shellcheck disable=SC2034 # Read by scripts/verify/steps-lib.sh after classification.
  MUSI_STAGED_SCRIPT_DELETED="$(tr '\0' '\n' < "$deleted_file")"
  rm -f "$all_file" "$deleted_file"

  if [ -n "$MUSI_STAGED_SCRIPT_DELETED" ] \
     && musi_staged_has_script_relevant_deletion "$MUSI_STAGED_SCRIPT_DELETED"; then
    return 1
  fi

  return 0
}

musi_try_single_verify_marker_bridge() {
  local repo_root="$1"
  local precommit_marker="$2"
  local verify_marker="$3"
  local label="$4"
  local freshness_seconds="$5"
  local current_head="$6"
  local current_verify_hash="$7"
  local current_precommit_hash age

  musi_success_marker_matches "$verify_marker" "$current_head" "$current_verify_hash" "$freshness_seconds" || return 1
  age=$MUSI_MARKER_MATCH_AGE
  current_precommit_hash=$(musi_require_fingerprint \
    "pre-commit marker bridge" ai_precommit_fingerprint "$repo_root") || return 2
  if ! musi_write_success_marker "$precommit_marker" "$current_head" "$current_precommit_hash"; then
    printf 'pre-commit: WARN: failed to write marker %s\n' "$precommit_marker" >&2
    return 2
  fi
  # Publish which marker bridged and the state it stamped so the pre-commit hook
  # can record the bridged commit (these values are otherwise function-local),
  # mirroring how musi_success_marker_matches exports MUSI_MARKER_MATCH_AGE.
  # shellcheck disable=SC2034 # Consumed by .husky/pre-commit's bridge recording.
  MUSI_VERIFY_BRIDGE_KIND="$label"
  # shellcheck disable=SC2034 # Consumed by .husky/pre-commit's bridge recording.
  MUSI_VERIFY_BRIDGE_HEAD="$current_head"
  # shellcheck disable=SC2034 # Consumed by .husky/pre-commit's bridge recording.
  MUSI_VERIFY_BRIDGE_FINGERPRINT="$current_precommit_hash"
  printf 'pre-commit: %s passed %ss ago for this staged/worktree state — skipping (set FORCE_VERIFY=1 to re-run).\n' \
    "$label" "$age"
}

musi_try_verify_marker_bridge() {
  local repo_root="$1"
  local precommit_marker="${2:-${MUSI_PRECOMMIT_MARKER:-$(musi_standard_precommit_marker "$repo_root")}}"
  local freshness_seconds="${3:-$MUSI_GATE_MARKER_FRESHNESS_SECONDS}"
  local current_head current_staged_hash current_worktree_hash changed_marker full_marker

  [ "${FORCE_VERIFY:-}" = "1" ] && return 1

  current_head=$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || echo none)
  current_staged_hash=$(musi_require_fingerprint \
    "pre-commit verify:changed bridge" ai_staged_fingerprint "$repo_root") || return 2
  current_worktree_hash=$(musi_require_fingerprint \
    "pre-commit verify bridge" ai_worktree_fingerprint "$repo_root") || return 2
  changed_marker="${MUSI_VERIFY_MARKER_CHANGED:-$(musi_standard_verify_changed_marker "$repo_root")}"
  full_marker="${MUSI_VERIFY_MARKER_FULL:-$(musi_standard_verify_full_marker "$repo_root")}"

  local bridge_rc=0
  musi_try_single_verify_marker_bridge "$repo_root" "$precommit_marker" "$changed_marker" \
    "verify:changed" "$freshness_seconds" "$current_head" "$current_staged_hash" \
    || bridge_rc=$?
  case "$bridge_rc" in
    0) return 0 ;;
    1) ;;
    *) return 2 ;;
  esac
  musi_try_single_verify_marker_bridge "$repo_root" "$precommit_marker" "$full_marker" \
    "verify" "$freshness_seconds" "$current_head" "$current_worktree_hash"
}

# --- Run-meta JSON codec shims ----------------------------------------------
# The codec entrypoint is scripts/lib/verify-metadata-core.ts; resolution and
# override seam mirror musi_path_policy_query_script (MUSI_PATH_POLICY_QUERY):
#   MUSI_VERIFY_META_CORE - absolute path to the codec entrypoint
#   MUSI_VERIFY_META_BUN  - bun binary used to spawn it
# Core exit codes (fail closed, distinct per class): 0 ok, 1 verdict refusal,
# 2 usage, 3 malformed JSON, 4 invalid argument, 5 invalid fingerprint.
musi_verify_meta_core_script() {
  if [ -n "${MUSI_VERIFY_META_CORE:-}" ]; then
    printf '%s\n' "$MUSI_VERIFY_META_CORE"
    return 0
  fi

  if [ -n "${REPO_ROOT:-}" ] && [ -f "$REPO_ROOT/scripts/lib/verify-metadata-core.ts" ]; then
    printf '%s\n' "$REPO_ROOT/scripts/lib/verify-metadata-core.ts"
    return 0
  fi

  if [ -n "${BASH_SOURCE:-}" ]; then
    printf '%s\n' "$(cd "$(dirname "$BASH_SOURCE")" && pwd)/verify-metadata-core.ts"
    return 0
  fi

  printf '%s\n' "$(cd "$(dirname "$0")" && pwd)/verify-metadata-core.ts"
}

musi_verify_meta_core() {
  local script bun_bin
  script="$(musi_verify_meta_core_script)"
  bun_bin="${MUSI_VERIFY_META_BUN:-bun}"
  "$bun_bin" --config=/dev/null "$script" "$@"
}

musi_meta_command_string() {
  local out="" arg
  for arg in "$@"; do
    if [ -z "$out" ]; then
      out="$arg"
    else
      out="$out $arg"
    fi
  done
  printf '%s' "$out"
}

# Extractor shims. Legacy sed out-contract preserved: on empty input or any
# codec failure they emit nothing and return 0 — consumers already treat an
# empty result as missing/malformed metadata and fail closed on it.
musi_run_meta_wrapper_fragment() {
  local json="$1"
  local out

  [ -n "$json" ] || return 0
  out=$(printf '%s\n' "$json" | musi_verify_meta_core wrapper-fragment) || return 0
  printf '%s\n' "$out"
}

musi_run_meta_json_string_field() {
  local json="$1"
  local key="$2"
  local out

  [ -n "$json" ] || return 0
  out=$(printf '%s\n' "$json" | musi_verify_meta_core string-field "$key") || return 0
  [ -n "$out" ] || return 0
  printf '%s\n' "$out"
}

musi_run_meta_json_int_field() {
  local json="$1"
  local key="$2"
  local out

  [ -n "$json" ] || return 0
  out=$(printf '%s\n' "$json" | musi_verify_meta_core int-field "$key") || return 0
  [ -n "$out" ] || return 0
  printf '%s\n' "$out"
}

musi_run_meta_warn() {
  printf 'verify history: WARN: %s\n' "$*" >&2
}

musi_run_meta_start_epoch() {
  local start_time="$1"
  local elapsed_seconds="${2:-}"
  local epoch now

  if [ -n "$start_time" ] && epoch=$(date -d "$start_time" +%s 2>/dev/null); then
    case "$epoch" in
      ''|*[!0-9]*) ;;
      *) printf '%s\n' "$epoch"; return 0 ;;
    esac
  fi

  case "$elapsed_seconds" in
    ''|*[!0-9]*) return 1 ;;
  esac
  now=$(date +%s)
  epoch=$((now - elapsed_seconds))
  [ "$epoch" -lt 0 ] && epoch=0
  printf '%s\n' "$epoch"
}

musi_prune_run_meta_history() {
  local history_dir="$1"
  local limit="$2"
  local keep_from files

  case "$limit" in
    ''|*[!0-9]*)
      musi_run_meta_warn "invalid MUSI_VERIFY_HISTORY_LIMIT '$limit'; using 50"
      limit=50
      ;;
  esac

  keep_from=$((limit + 1))
  (
    cd "$history_dir" || exit 1
    files=$(ls -1t -- *.json 2>/dev/null || true)
    [ -n "$files" ] || exit 0
    printf '%s\n' "$files" | tail -n +"$keep_from" | xargs -r rm --
  )
}

musi_persist_run_meta_history() {
  local log_dir="$1"
  local history_dir="$2"
  local run_meta="$log_dir/run-meta.json"
  local limit="${MUSI_VERIFY_HISTORY_LIMIT:-50}"
  local json wrapper mode start_time elapsed_seconds exit_code start_epoch target

  if [ ! -f "$run_meta" ]; then
    musi_run_meta_warn "missing run metadata at $run_meta"
    return 0
  fi
  # Whole-file read (not first-line): pre-port combine wrote multi-line
  # run-meta documents, and the codec parses either shape as one document.
  if ! json=$(cat "$run_meta" 2>/dev/null); then
    musi_run_meta_warn "could not read run metadata at $run_meta"
    return 0
  fi

  wrapper=$(musi_run_meta_wrapper_fragment "$json")
  if [ -z "$wrapper" ]; then
    musi_run_meta_warn "could not find wrapper metadata in $run_meta"
    return 0
  fi

  mode=$(musi_run_meta_json_string_field "$wrapper" mode)
  start_time=$(musi_run_meta_json_string_field "$wrapper" start_time)
  elapsed_seconds=$(musi_run_meta_json_int_field "$wrapper" elapsed_seconds)
  exit_code=$(musi_run_meta_json_int_field "$wrapper" exit_code)

  case "$mode" in
    ''|*[!A-Za-z0-9._-]*)
      musi_run_meta_warn "malformed wrapper mode in $run_meta"
      return 0
      ;;
  esac
  case "$exit_code" in
    ''|*[!0-9]*)
      musi_run_meta_warn "malformed wrapper exit_code in $run_meta"
      return 0
      ;;
  esac
  if ! start_epoch=$(musi_run_meta_start_epoch "$start_time" "$elapsed_seconds"); then
    musi_run_meta_warn "malformed wrapper start_time in $run_meta"
    return 0
  fi

  if ! mkdir -p "$history_dir"; then
    musi_run_meta_warn "could not create history directory $history_dir"
    return 0
  fi

  target="$history_dir/$start_epoch-$mode-$exit_code.json"
  if ! cp "$run_meta" "$target"; then
    musi_run_meta_warn "could not write history file $target"
    return 0
  fi

  if ! musi_prune_run_meta_history "$history_dir" "$limit"; then
    musi_run_meta_warn "could not prune history directory $history_dir"
  fi

  return 0
}

# Record a minimal audit entry when a pre-commit short-circuit (fresh
# success marker) or a manual-verify marker bridge admits a commit without
# running any steps. Those paths exit before a run-meta.json exists, so unlike
# musi_persist_run_meta_history (which copies an existing run-meta) this writes
# the entry directly, using the same <epoch>-<mode>-<exit>.json history naming
# so bridged/marker landings stay greppable after the fact.
#
# Deliberately writes ONLY under history_dir: it is never handed the live
# LOG_DIR/meta/wrapper.json that .husky/pre-push reads as its verify-evidence
# fallback, so a bridged commit leaves that evidence untouched. Best-effort and
# non-fatal — the commit is already admitted, so a recording problem only warns.
#
# Args: <history_dir> <mode> <head> <fingerprint> <satisfied_marker>
#   mode: precommit-marker | precommit-bridged (embedded in the filename)
musi_record_precommit_shortcircuit() {
  local history_dir="$1"
  local mode="$2"
  local head="$3"
  local fingerprint="$4"
  local satisfied="$5"
  local limit="${MUSI_VERIFY_HISTORY_LIMIT:-50}"
  local epoch iso target json rc

  epoch=$(date +%s)
  iso=$(date -Iseconds)
  # The codec validates mode (filename-safe charset) and fingerprint and emits
  # the combined-run-meta-shaped audit document with an empty steps list.
  rc=0
  json=$(musi_verify_meta_core shortcircuit-meta \
    "$mode" "$head" "$fingerprint" "$satisfied" "$iso" < /dev/null 2>/dev/null) || rc=$?
  if [ "$rc" -ne 0 ]; then
    case "$rc" in
      4) musi_run_meta_warn "refusing to record short-circuit with malformed mode '$mode'" ;;
      5) musi_run_meta_warn "refusing to record short-circuit with invalid fingerprint" ;;
      *) musi_run_meta_warn "could not build short-circuit metadata (core exit $rc)" ;;
    esac
    return 0
  fi
  if [ -z "$json" ]; then
    musi_run_meta_warn "could not build short-circuit metadata (empty codec output)"
    return 0
  fi

  if ! mkdir -p "$history_dir"; then
    musi_run_meta_warn "could not create history directory $history_dir"
    return 0
  fi

  target="$history_dir/$epoch-$mode-0.json"
  if ! printf '%s\n' "$json" > "$target"; then
    musi_run_meta_warn "could not write history file $target"
    return 0
  fi

  if ! musi_prune_run_meta_history "$history_dir" "$limit"; then
    musi_run_meta_warn "could not prune history directory $history_dir"
  fi
  return 0
}

# Writer shims. The codec builds the document; bash keeps mkdir and the file
# write. The document is captured before the write, so a codec failure returns
# nonzero without truncating or half-writing the target file.
#
# Argv-only codec spawns redirect stdin from /dev/null: these shims run inside
# `git commit` and foreground verify, where the inherited stdin can be an
# interactive terminal, and must never hand the codec a readable stdin it
# could block on. The codec independently skips stdin for these subcommands.
musi_write_step_meta() {
  local file="$1"
  shift
  local out

  out=$(musi_verify_meta_core step-meta "$@" < /dev/null) || return 1
  [ -n "$out" ] || return 1
  mkdir -p "$(dirname "$file")" || return 1
  printf '%s\n' "$out" > "$file"
}

# Argument order is unchanged: <file> <mode> <start_epoch> <start_time>
# <end_epoch> <end_time> <exit_code> <command> [head] [fingerprint]. The codec
# refuses an invalid fingerprint (exit 5) before anything touches the file.
musi_write_wrapper_meta() {
  local file="$1"
  shift
  local out

  out=$(musi_verify_meta_core wrapper-meta "${1:-}" "${2:-}" "${3:-}" "${4:-}" "${5:-}" \
    "${6:-}" "${7:-}" "${8:-}" "${9:-}" < /dev/null) || return 1
  [ -n "$out" ] || return 1
  mkdir -p "$(dirname "$file")" || return 1
  printf '%s\n' "$out" > "$file"
}

# Re-stamp a passing verify wrapper.json (the pre-push evidence fallback that
# `.husky/pre-push` reads at `<verify-log-dir>/meta/wrapper.json`) onto a new
# HEAD/fingerprint, so no artifact still points at the pre-merge HEAD after a
# re-stamped land. Preserves mode/start_time/command and refreshes end_time to
# now. Refuses unless the existing wrapper records a passing (exit 0)
# serial/parallel verify — it never fabricates a fresh pass from nothing.
#
# Args: <wrapper_json> <new_head> <new_fingerprint>
# Returns: 0 re-stamped; 1 missing or non-passing wrapper.
musi_restamp_verify_wrapper() {
  local wrapper="$1"
  local new_head="$2"
  local new_fingerprint="$3"
  local json out now_epoch now_iso

  [ -f "$wrapper" ] || return 1
  json=$(cat "$wrapper" 2>/dev/null) || return 1
  [ -n "$json" ] || return 1

  now_epoch=$(date +%s)
  now_iso=$(date -Iseconds)
  # The codec refuses (exit 1) unless the wrapper records a passing
  # serial/parallel verify, and preserves mode/start_time/command; only a
  # successful transform overwrites the file.
  out=$(printf '%s\n' "$json" | musi_verify_meta_core restamp-wrapper \
    "$new_head" "$new_fingerprint" "$now_epoch" "$now_iso") || return 1
  [ -n "$out" ] || return 1
  printf '%s\n' "$out" > "$wrapper"
}

# Bash globs the fragment files (orchestration) and hands the codec one
# single-line JSON document per stdin line: line 1 is the wrapper fragment (or
# the literal `null` when it is missing), the rest are step fragments. The
# codec drops malformed fragments instead of embedding garbage, so
# run-meta.json is always well-formed JSON; on a codec/spawn failure the stale
# output is removed rather than left lying (fail closed, non-fatal like the
# legacy writer).
musi_combine_run_meta() {
  local log_dir="$1"
  local mode="$2"
  local wrapper_fragment="$3"
  local output="$log_dir/run-meta.json"
  local fragment wrapper_line out

  wrapper_line=""
  if [ -f "$wrapper_fragment" ]; then
    wrapper_line=$(sed -n '1p' "$wrapper_fragment" 2>/dev/null) || wrapper_line=""
  fi
  [ -n "$wrapper_line" ] || wrapper_line=null

  if ! out=$(
    {
      printf '%s\n' "$wrapper_line"
      for fragment in "$log_dir"/meta/*.json; do
        [ -f "$fragment" ] || continue
        [ "$fragment" = "$wrapper_fragment" ] && continue
        sed -n '1p' "$fragment"
      done
    } | musi_verify_meta_core combine "$mode" "$(date -Iseconds)"
  ); then
    musi_run_meta_warn "could not combine run metadata into $output"
    rm -f "$output"
    return 0
  fi
  # Empty output means the spawn was intercepted (e.g. a stubbed bun): treat
  # it like a codec failure rather than writing an empty document.
  if [ -z "$out" ]; then
    musi_run_meta_warn "could not combine run metadata into $output"
    rm -f "$output"
    return 0
  fi
  printf '%s\n' "$out" > "$output"
}
