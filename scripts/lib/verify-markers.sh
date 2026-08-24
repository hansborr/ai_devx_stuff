#!/usr/bin/env bash
# Success markers and the verify-marker bridge: the on-disk marker codec
# (read/match/write), the land-time re-stamp, the standard verify:changed and
# verify marker paths, and the pre-commit bridge that lets a verify run that
# just passed stand in for the pre-commit gate.
#
# A marker records exactly LAST_TS / LAST_HEAD / LAST_HASH and is honoured only
# when the fingerprint is well-formed, all three fields match the current state,
# and the age is inside the freshness window. A negative age (a future-dated
# marker after clock skew) is stale, never fresh — otherwise a future timestamp
# would satisfy `age < ttl` forever and replay a cached verdict past its TTL.
#
# Owns: musi_read_success_marker, musi_success_marker_matches,
# musi_write_success_marker, musi_restamp_verify_marker,
# musi_standard_verify_changed_marker, musi_standard_verify_full_marker,
# musi_try_single_verify_marker_bridge, musi_try_verify_marker_bridge, and the
# MUSI_MARKER_LAST_* / MUSI_MARKER_MATCH_AGE / MUSI_VERIFY_BRIDGE_*
# out-variables those functions publish to their callers.
# Does NOT own the pre-commit marker path (musi_standard_precommit_marker) or
# the freshness budget (MUSI_GATE_MARKER_FRESHNESS_SECONDS), both from
# scripts/lib/verify-state-paths.sh.
#
# Source order: calls musi_fingerprint_is_valid, musi_require_fingerprint,
# musi_standard_state_path, musi_standard_precommit_marker and
# ai_worktree_fingerprint from scripts/lib/verify-state-paths.sh (whose
# MUSI_GATE_MARKER_FRESHNESS_SECONDS it also reads), plus ai_staged_fingerprint
# and ai_precommit_fingerprint from scripts/lib/verify-path-policy.sh. Bash
# resolves every one of those at call time, so no ordering is required — and
# leaf libs never source each other regardless: verify-metadata.sh is the sole
# public entry point and owns the ordering. Consumers keep sourcing that
# aggregator.
#
# Standing invariant: function definitions only, no source-time side effects
# (the re-source guard below is the sole exception).

if [ -n "${__MUSI_VERIFY_MARKERS_SOURCED:-}" ]; then
  return 0
fi
__MUSI_VERIFY_MARKERS_SOURCED=1

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
