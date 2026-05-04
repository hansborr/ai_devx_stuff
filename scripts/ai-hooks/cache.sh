#!/bin/bash

# Shared cache state for verification hooks.

AI_HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$AI_HOOKS_DIR/output-filter.sh"

AI_STATE_ROOT="${AI_STATE_ROOT:-/tmp/musi-ai-hooks}"
AI_GIT_STATE_DIR="${AI_GIT_STATE_DIR:-$AI_STATE_ROOT/git}"
AI_BUN_STATE_DIR="${AI_BUN_STATE_DIR:-$AI_STATE_ROOT/bun}"
AI_STOP_STATE_DIR="${AI_STOP_STATE_DIR:-$AI_STATE_ROOT/stop}"
AI_BUN_LOG_DIR="${AI_BUN_LOG_DIR:-/tmp/musi-bun-logs}"
AI_BUN_TTL="${AI_BUN_TTL:-1800}"
AI_PRECOMMIT_LOG_DIR="${AI_PRECOMMIT_LOG_DIR:-/tmp/musi-pre-commit-logs}"

ai_cache_init() {
  mkdir -p "$AI_GIT_STATE_DIR" "$AI_BUN_STATE_DIR" "$AI_STOP_STATE_DIR" "$AI_BUN_LOG_DIR" "$AI_PRECOMMIT_LOG_DIR"
}

ai_worktree_fingerprint() {
  local repo_root="$1"

  {
    git -C "$repo_root" rev-parse HEAD 2>/dev/null || echo none
    git -C "$repo_root" diff HEAD 2>/dev/null
    (
      cd "$repo_root" || exit 1
      git ls-files --others --exclude-standard -z 2>/dev/null \
        | xargs -0 -r sha256sum 2>/dev/null
    )
  } | sha256sum | awk '{print $1}'
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

ai_write_bun_marker() {
  local marker="$1"
  local fp="$2"
  local exit_code="$3"
  local dir base tmp

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
