#!/bin/bash

# Shared cache state for verification hooks.

AI_HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# common.sh centralizes the repo-specific state-path defaults this file reads
# (AI_STATE_ROOT_PREFIX, AI_REPO_ROOT_FALLBACK, the result-command tmp prefixes,
# AI_STATE_SWEEP_STOP_GLOB_DEFAULT). Source it when a caller has not already, so
# cache.sh is self-sufficient under `set -u` (verify.sh / verify-async.sh source
# this file directly). The `+x` guard is set -u-safe and avoids a double-source
# when a hook adapter already pulled common.sh in.
if [ -z "${AI_STATE_ROOT_PREFIX+x}" ]; then
  # shellcheck source=/dev/null
  . "$AI_HOOKS_DIR/common.sh"
fi
# shellcheck source=/dev/null
. "$AI_HOOKS_DIR/output-filter.sh"
# shellcheck source=/dev/null
. "$AI_HOOKS_DIR/../lib/verify-metadata.sh"

# porting-knob: hook-state-paths -- repo-specific defaults are centralized in common.sh
AI_CACHE_REPO_ROOT="${REPO_ROOT:-$(git -C "$AI_HOOKS_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || printf '%s' "$AI_REPO_ROOT_FALLBACK")}"
AI_WORKTREE_STATE_KEY="${MUSI_WORKTREE_STATE_KEY:-$(musi_worktree_key "$AI_CACHE_REPO_ROOT")}"
AI_STATE_ROOT="${AI_STATE_ROOT:-$AI_STATE_ROOT_PREFIX.$AI_WORKTREE_STATE_KEY}"
AI_GIT_STATE_DIR="${AI_GIT_STATE_DIR:-$AI_STATE_ROOT/git}"
AI_BUN_STATE_DIR="${AI_BUN_STATE_DIR:-$AI_STATE_ROOT/bun}"
AI_STOP_STATE_DIR="${AI_STOP_STATE_DIR:-$AI_STATE_ROOT/stop}"
AI_THROTTLE_STATE_DIR="${AI_THROTTLE_STATE_DIR:-${AI_LINT_COVERAGE_STATE_DIR:-$AI_STATE_ROOT/throttle}}"
AI_LINT_COVERAGE_STATE_DIR="${AI_LINT_COVERAGE_STATE_DIR:-$AI_THROTTLE_STATE_DIR}"
AI_BUN_LOG_DIR="${AI_BUN_LOG_DIR:-$(musi_standard_bun_log_dir "$AI_CACHE_REPO_ROOT")}"
AI_BUN_TTL="${AI_BUN_TTL:-3600}"
AI_PRECOMMIT_LOG_DIR="${AI_PRECOMMIT_LOG_DIR:-$(musi_standard_verify_log_dir "$AI_CACHE_REPO_ROOT")}"

# Slow /tmp-litter GC. Two state families have no other reaper: abandoned
# ai_claude_result_command temp files (self-clean only runs when the rewritten
# tool command executes) and Stop-policy throttle markers under the
# per-worktree state roots (bun markers carry AI_BUN_TTL; stop markers do not,
# so a dropped worktree orphans them for the container's lifetime). The sweep
# is generous (days) and throttled so it costs almost nothing per hook.
AI_STATE_SWEEP_TTL_DAYS="${AI_STATE_SWEEP_TTL_DAYS:-7}"
AI_STATE_SWEEP_INTERVAL="${AI_STATE_SWEEP_INTERVAL:-3600}"

ai_cache_init() {
  mkdir -p "$AI_GIT_STATE_DIR" "$AI_BUN_STATE_DIR" "$AI_STOP_STATE_DIR" "$AI_THROTTLE_STATE_DIR" "$AI_BUN_LOG_DIR" "$AI_PRECOMMIT_LOG_DIR"
  ai_cache_sweep_stale
}

# Reap the two leak families above. Best-effort and non-fatal: every step is
# guarded so a sweep failure never breaks the hook that called ai_cache_init.
# Throttled to at most once per AI_STATE_SWEEP_INTERVAL seconds via a stamp in
# the current worktree's state root.
ai_cache_sweep_stale() {
  local stamp="$AI_STATE_ROOT/.last-sweep"
  local now last dir
  local prefix prefix_dir prefix_base stop_glob

  now=$(date +%s)
  if [ -f "$stamp" ]; then
    last=$(cat "$stamp" 2>/dev/null || printf '0')
    case "$last" in ''|*[!0-9]*) last=0 ;; esac
    [ "$((now - last))" -ge "$AI_STATE_SWEEP_INTERVAL" ] || return 0
  fi
  printf '%s' "$now" > "$stamp" 2>/dev/null || true

  # Every ai_claude_result_command prefix family leaks the same way (self-clean
  # only runs when the rewritten command executes): git-commit-quiet uses the
  # commit-result default, bun-run-quiet uses /tmp/musi-bun-result, and
  # no-direct-db uses /tmp/musi-policy-guidance. Sweep them all. Tests override
  # the list via AI_RESULT_COMMAND_TMP_PREFIXES to stay hermetic.
  local result_prefixes
  result_prefixes="${AI_RESULT_COMMAND_TMP_PREFIXES:-$AI_RESULT_COMMAND_TMP_PREFIX $AI_BUN_RESULT_TMP_PREFIX $AI_POLICY_GUIDANCE_TMP_PREFIX}"
  for prefix in $result_prefixes; do
    prefix_dir=$(dirname "$prefix")
    prefix_base=$(basename "$prefix")
    find "$prefix_dir" -maxdepth 1 -type f -name "$prefix_base.*" \
      -mtime +"$AI_STATE_SWEEP_TTL_DAYS" -delete 2>/dev/null || true
  done

  stop_glob="${AI_STATE_SWEEP_STOP_GLOB:-$AI_STATE_SWEEP_STOP_GLOB_DEFAULT}"
  for dir in $stop_glob; do
    [ -d "$dir" ] || continue
    find "$dir" -type f -mtime +"$AI_STATE_SWEEP_TTL_DAYS" -delete 2>/dev/null || true
  done
}

ai_read_bun_marker() {
  local marker="$1"
  local saw_ts=0
  local saw_fp=0
  local saw_exit=0

  AI_MARKER_LAST_TS=0
  AI_MARKER_LAST_FP=""
  AI_MARKER_LAST_EXIT=0

  [ -f "$marker" ] || return 1
  while IFS='=' read -r k v; do
    case "$k" in
      LAST_TS) AI_MARKER_LAST_TS=$v; saw_ts=1 ;;
      LAST_FP) AI_MARKER_LAST_FP=$v; saw_fp=1 ;;
      LAST_EXIT) AI_MARKER_LAST_EXIT=$v; saw_exit=1 ;;
      *) return 1 ;;
    esac
  done < "$marker"

  [ "$saw_ts" -eq 1 ] || return 1
  [ "$saw_fp" -eq 1 ] || return 1
  [ "$saw_exit" -eq 1 ] || return 1
  ai_is_integer "$AI_MARKER_LAST_TS" || return 1
  [ "$AI_MARKER_LAST_TS" -gt 0 ] || return 1
  [[ "$AI_MARKER_LAST_FP" =~ ^[0-9a-f]{64}$ ]] || return 1
  ai_is_integer "$AI_MARKER_LAST_EXIT" || return 1
  [ "$AI_MARKER_LAST_EXIT" -ge 0 ] || return 1
  [ "$AI_MARKER_LAST_EXIT" -lt 128 ] || return 1
}

# Markers are argv-scoped (`last.<base>.<argv_fp>`, H1/H2), so a single script
# can have several markers from different argv. Print the path of the newest
# marker matching `<base>` (any argv), honoring a legacy bare `last.<base>` for
# resilience across the rename. Used by readers that report per-script state
# (verify:logs, the Stop e2e reminder) and don't know the originating argv.
# Prints nothing and returns 1 when no matching marker exists.
ai_newest_bun_marker_for_base() {
  local log_dir="$1"
  local base="$2"
  local newest="" newest_mtime=0 mtime path

  while IFS= read -r path; do
    [ -f "$path" ] || continue
    mtime=$(stat -c %Y "$path" 2>/dev/null || echo 0)
    if [ "$mtime" -gt "$newest_mtime" ]; then
      newest_mtime=$mtime
      newest=$path
    fi
  done < <(
    find "$log_dir" -maxdepth 1 -type f \
      \( -name "last.$base" -o -name "last.$base.*" \) 2>/dev/null
  )

  [ -n "$newest" ] || return 1
  printf '%s\n' "$newest"
}

ai_write_bun_marker() {
  local marker="$1"
  local fp="$2"
  local exit_code="$3"
  local dir base tmp

  musi_fingerprint_is_valid "$fp" || return 1
  dir=$(dirname "$marker")
  base=$(basename "$marker")
  tmp=$(mktemp "$dir/.${base}.tmp.XXXXXX") || return 1

  if ! {
    printf 'LAST_TS=%s\n' "$(date +%s)"
    printf 'LAST_FP=%s\n' "$fp"
    printf 'LAST_EXIT=%s\n' "$exit_code"
  } > "$tmp"; then
    rm -f "$tmp"
    return 1
  fi

  if ! mv -f "$tmp" "$marker"; then
    rm -f "$tmp"
    return 1
  fi
}

ai_bun_cached_failure_summary() {
  local script="$1"
  local log="$2"
  local age="$3"
  local last_exit="$4"
  local tail_lines="${5:-40}"
  local summary

  summary="$script cached FAILURE (ran ${age}s ago, unchanged worktree - prefix command with FORCE_VERIFY=1 to re-run). Exit $last_exit. Full log: $log

--- last $tail_lines lines ---
$(tail -n 200 "$log" 2>/dev/null | ai_filter_known_output_noise | tail -n "$tail_lines")"
  summary=$(ai_append_flaky_note "$script" "$summary")
  ai_limit_lines "$summary" 80 "... truncated ({lines} lines total). Read $log for the full output."
}

ai_bun_failure_summary() {
  local script="$1"
  local log="$2"
  local exit_label="$3"
  local elapsed="$4"
  local output="$5"
  local tail_lines="${6:-40}"
  local summary

  if [ -n "$exit_label" ]; then
    summary="$script failed (exit $exit_label${elapsed:+, ${elapsed}s}). Full log: $log

--- last $tail_lines lines ---
$(printf '%s\n' "$output" | tail -n 200 | ai_filter_known_output_noise | tail -n "$tail_lines")"
  else
    summary="$script finished${elapsed:+ (${elapsed}s)}. Full log: $log

--- last $tail_lines lines ---
$(printf '%s\n' "$output" | tail -n 200 | ai_filter_known_output_noise | tail -n "$tail_lines")"
  fi

  if [ -n "$exit_label" ]; then
    summary=$(ai_append_flaky_note "$script" "$summary")
  fi
  ai_limit_lines "$summary" 80 "... truncated ({lines} lines total). Read $log for the full output."
}
