#!/bin/bash

set -u

HOOK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$HOOK_LIB/common.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/cache.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/stop-policy.sh"

AI_SESSION_STATE_EDIT_KILL_SWITCH=".no-edit-lint"
AI_SESSION_STATE_PROTECTED_EDITS_MARKER=".allow-protected-edits"
AI_SESSION_STATE_MAX_LINES=20

ai_session_state_add_line() {
  AI_SESSION_STATE_LINES+=("$1")
}

ai_session_state_dirty_summary() {
  local repo_root="$1"
  local status

  status=$(ai_stop_git_readonly -C "$repo_root" status --porcelain --untracked-files=normal 2>/dev/null || true)
  if [ -z "$status" ]; then
    printf 'clean'
    return 0
  fi

  printf '%s\n' "$status" | awk '
    {
      total += 1
      if (substr($0, 1, 2) == "??") {
        untracked += 1
      } else {
        if (substr($0, 1, 1) != " ") staged += 1
        if (substr($0, 2, 1) != " ") unstaged += 1
      }
    }
    END {
      printf "dirty: %d changed (%d staged, %d unstaged, %d untracked)", total, staged, unstaged, untracked
    }
  '
}

ai_session_state_fast_commit_status() {
  local repo_root="$1"
  local common_dir

  common_dir=$(ai_stop_git_readonly -C "$repo_root" rev-parse --git-common-dir 2>/dev/null || true)
  [ -n "$common_dir" ] || { printf 'inactive'; return 0; }
  case "$common_dir" in
    /*) ;;
    *) common_dir="$repo_root/$common_dir" ;;
  esac
  if [ -f "$common_dir/musi-fast-commit" ]; then
    printf 'active'
  else
    printf 'inactive'
  fi
}

ai_session_state_active_kill_switches() {
  local repo_root="$1"
  local switches=()
  local switch

  for switch in \
    "$AI_STOP_COMMIT_KILL_SWITCH" \
    "$AI_STOP_E2E_KILL_SWITCH" \
    "$AI_STOP_ASYNC_KILL_SWITCH" \
    "$AI_STOP_VERIFY_KILL_SWITCH" \
    "$AI_STOP_LINT_WARNINGS_KILL_SWITCH" \
    "$AI_SESSION_STATE_EDIT_KILL_SWITCH"; do
    [ -f "$repo_root/$switch" ] || continue
    switches+=("$switch")
  done

  [ "${#switches[@]}" -gt 0 ] || return 1
  printf '%s\n' "${switches[@]}" | sort \
    | awk 'NR > 1 { printf ", " } { printf "%s", $0 }'
}

ai_session_state_active_safety_overrides() {
  local repo_root="$1"
  local marker

  marker="$AI_SESSION_STATE_PROTECTED_EDITS_MARKER"
  [ -f "$repo_root/$marker" ] || return 1
  printf '%s' "$marker"
}

ai_session_state_cached_verify_failure() {
  local repo_root="$1"
  local log_dir wrapper head mode exit_code failing_gates

  log_dir="${MUSI_VERIFY_LOG_DIR:-$(musi_standard_verify_log_dir "$repo_root")}"
  wrapper="$log_dir/meta/wrapper.json"
  [ -f "$wrapper" ] || return 1

  mode=$(ai_stop_verify_meta_string "$wrapper" mode)
  head=$(ai_stop_verify_meta_string "$wrapper" head)
  exit_code=$(ai_stop_verify_meta_int "$wrapper" exit_code)

  [ -n "$mode" ] || return 1
  [ -n "$head" ] || return 1
  ai_is_integer "$exit_code" || return 1
  [ "$exit_code" -ne 0 ] || return 1

  failing_gates=$(ai_stop_verify_failing_gates "$log_dir/meta")
  if [ -n "$failing_gates" ]; then
    printf 'cached verify: %s exit %s at %s; failing gate(s): %s' \
      "$mode" "$exit_code" "$head" "$failing_gates"
  else
    printf 'cached verify: %s exit %s at %s' "$mode" "$exit_code" "$head"
  fi
}

ai_session_state_async_status() {
  local repo_root="$1"
  local state pid exit_code status elapsed log_dir

  state=$(ai_stop_async_latest_state "$repo_root")
  [ -n "$state" ] && [ -f "$state" ] || return 1

  pid=$(ai_stop_async_state_value "$state" pid || printf '')
  exit_code=$(ai_stop_async_state_value "$state" exit_code || printf '')
  elapsed=$(ai_stop_async_elapsed "$state")
  log_dir=$(ai_stop_async_state_value "$state" log_dir || printf '')

  if [ -z "$exit_code" ]; then
    if ai_is_integer "$pid" && kill -0 "$pid" 2>/dev/null; then
      status="running"
    else
      status="failed"
      exit_code="-1"
    fi
  elif [ "$exit_code" = "0" ]; then
    return 1
  else
    status="failed"
  fi

  if [ -n "$exit_code" ]; then
    printf 'async verify: %s (PID %s, elapsed %ss, exit %s%s)' \
      "$status" "$pid" "$elapsed" "$exit_code" "${log_dir:+, log: $log_dir/async.log}"
  else
    printf 'async verify: %s (PID %s, elapsed %ss%s)' \
      "$status" "$pid" "$elapsed" "${log_dir:+, log: $log_dir/async.log}"
  fi
}

ai_session_state_header() {
  local source="$1"

  case "$source" in
    compact) printf 'Harness state after compaction:' ;;
    resume) printf 'Harness state on session resume:' ;;
    *) printf 'Harness state at session start:' ;;
  esac
}

ai_session_state_emit() {
  local repo_root="$1"
  local event_name="$2"
  local source="${3:-}"
  local branch dirty fast_commit kill_switches safety_overrides verify_failure async_status
  local interesting=0 message

  ai_stop_git_readonly -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0

  branch=$(ai_stop_current_branch "$repo_root")
  dirty=$(ai_session_state_dirty_summary "$repo_root")
  fast_commit=$(ai_session_state_fast_commit_status "$repo_root")
  if kill_switches=$(ai_session_state_active_kill_switches "$repo_root"); then
    interesting=1
  fi
  if safety_overrides=$(ai_session_state_active_safety_overrides "$repo_root"); then
    interesting=1
  fi
  if verify_failure=$(ai_session_state_cached_verify_failure "$repo_root"); then
    interesting=1
  fi
  if async_status=$(ai_session_state_async_status "$repo_root"); then
    interesting=1
  fi
  if [ "$dirty" != "clean" ] || [ "$fast_commit" = "active" ]; then
    interesting=1
  fi

  [ "$interesting" -eq 1 ] || return 0

  AI_SESSION_STATE_LINES=()
  ai_session_state_add_line "$(ai_session_state_header "$source")"
  ai_session_state_add_line "- branch: $branch"
  ai_session_state_add_line "- worktree: $dirty"
  ai_session_state_add_line "- fast-commit: $fast_commit"
  [ -z "${kill_switches:-}" ] || ai_session_state_add_line "- active kill switches: $kill_switches"
  [ -z "${safety_overrides:-}" ] || ai_session_state_add_line "- active safety overrides: $safety_overrides"
  [ -z "${verify_failure:-}" ] || ai_session_state_add_line "- $verify_failure"
  [ -z "${async_status:-}" ] || ai_session_state_add_line "- $async_status"

  message=$(printf '%s\n' "${AI_SESSION_STATE_LINES[@]}")
  message=$(ai_limit_lines "$message" "$AI_SESSION_STATE_MAX_LINES")
  ai_emit_additional_context "$event_name" "$message"
}

payload=$(ai_read_payload)
event_name=$(printf '%s' "$payload" | jq -r '.hook_event_name // "SessionStart"' 2>/dev/null || true)
[ -n "$event_name" ] || event_name="SessionStart"
source=$(printf '%s' "$payload" | jq -r '.source // empty' 2>/dev/null || true)
REPO_ROOT=$(ai_stop_git_readonly rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")

ai_session_state_emit "$REPO_ROOT" "$event_name" "$source"
exit 0
