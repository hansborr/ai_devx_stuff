#!/bin/bash

# Shared Stop-hook policies. Keep adapter-specific behavior in .claude/.codex
# wrappers; this file decides whether a Stop event should nudge the agent.
AI_STOP_REMINDER_SUFFIX="If you intentionally need to leave these changes uncommitted, stop again; this reminder will not repeat until the change set or branch changes."

AI_STOP_COMMIT_KILL_SWITCH=".no-stop-uncommitted"
AI_STOP_E2E_KILL_SWITCH=".no-stop-e2e"
AI_STOP_E2E_MAX_NOTIFY="${AI_STOP_E2E_MAX_NOTIFY:-2}"
AI_STOP_ASYNC_KILL_SWITCH=".no-stop-async-verify"
AI_STOP_ASYNC_MAX_NOTIFY="${AI_STOP_ASYNC_MAX_NOTIFY:-2}"
AI_STOP_ASYNC_STATE_ROOT="${MUSI_VERIFY_ASYNC_STATE_ROOT:-/tmp/musi-verify-async}"
AI_STOP_VERIFY_KILL_SWITCH=".no-stop-verify-changed"
AI_STOP_VERIFY_LEGACY_KILL_SWITCH=".no-stop-verify"
AI_STOP_VERIFY_MAX_NOTIFY="${AI_STOP_VERIFY_MAX_NOTIFY:-2}"

ai_stop_repo_key() {
  local repo_root="$1"

  printf '%s' "$repo_root" | sha256sum | awk '{print $1}'
}

ai_stop_marker_path() {
  local repo_root="$1"

  printf '%s/last.%s' "$AI_STOP_STATE_DIR" "$(ai_stop_repo_key "$repo_root")"
}

ai_stop_has_uncommitted_changes() {
  local repo_root="$1"

  [ -n "$(git -C "$repo_root" status --porcelain --untracked-files=normal 2>/dev/null)" ]
}

ai_stop_read_marker() {
  local marker="$1"
  local saw_fp=0
  local saw_branch=0

  AI_STOP_MARKER_FP=""
  AI_STOP_MARKER_BRANCH=""

  [ -f "$marker" ] || return 1
  while IFS='=' read -r k v; do
    case "$k" in
      LAST_FP) AI_STOP_MARKER_FP=$v; saw_fp=1 ;;
      LAST_BRANCH) AI_STOP_MARKER_BRANCH=$v; saw_branch=1 ;;
      LAST_TS) ;;
      *) return 1 ;;
    esac
  done < "$marker"

  [ "$saw_fp" -eq 1 ] || return 1
  [ "$saw_branch" -eq 1 ] || return 1
  [[ "$AI_STOP_MARKER_FP" =~ ^[0-9a-f]{64}$ ]] || return 1
  [ -n "$AI_STOP_MARKER_BRANCH" ] || return 1
}

ai_stop_write_marker() {
  local marker="$1"
  local fp="$2"
  local branch="$3"
  local dir base tmp

  dir=$(dirname "$marker")
  base=$(basename "$marker")
  tmp=$(mktemp "$dir/.${base}.tmp.XXXXXX") || return 1

  if ! {
    printf 'LAST_TS=%s\n' "$(date +%s)"
    printf 'LAST_FP=%s\n' "$fp"
    printf 'LAST_BRANCH=%s\n' "$branch"
  } > "$tmp"; then
    rm -f "$tmp"
    return 1
  fi

  if ! mv -f "$tmp" "$marker"; then
    rm -f "$tmp"
    return 1
  fi
}

ai_stop_current_branch() {
  local repo_root="$1"
  local branch

  branch=$(git -C "$repo_root" branch --show-current 2>/dev/null || true)
  [ -n "$branch" ] || branch="detached HEAD"
  printf '%s' "$branch"
}

ai_stop_dirty_message() {
  local branch="$1"
  local repo_root="$2"
  local suffix

  suffix="$AI_STOP_REMINDER_SUFFIX Disable entirely with: touch $repo_root/$AI_STOP_COMMIT_KILL_SWITCH"

  if [ "$branch" = "main" ]; then
    printf '%s\n\n%s' \
      "This repo has uncommitted changes on main. Check out a new branch, then commit the work before stopping." \
      "$suffix"
    return 0
  fi

  printf '%s\n\n%s' \
    "This repo has uncommitted changes on branch '$branch'. Commit the work before stopping." \
    "$suffix"
}

ai_stop_commit_reminder_disabled() {
  local repo_root="$1"
  [ -f "$repo_root/$AI_STOP_COMMIT_KILL_SWITCH" ]
}

ai_stop_commit_reminder() {
  local repo_root="$1"
  local marker fp branch

  git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1

  marker=$(ai_stop_marker_path "$repo_root")
  if ai_stop_commit_reminder_disabled "$repo_root"; then
    rm -f "$marker"
    return 1
  fi

  if ! ai_stop_has_uncommitted_changes "$repo_root"; then
    rm -f "$marker"
    return 1
  fi

  fp=$(ai_worktree_fingerprint "$repo_root")
  branch=$(ai_stop_current_branch "$repo_root")
  if ai_stop_read_marker "$marker" \
    && [ "$AI_STOP_MARKER_FP" = "$fp" ] \
    && [ "$AI_STOP_MARKER_BRANCH" = "$branch" ]; then
    return 1
  fi

  ai_stop_write_marker "$marker" "$fp" "$branch" || true
  ai_stop_dirty_message "$branch" "$repo_root"
}

ai_stop_e2e_disabled() {
  local repo_root="$1"
  [ -f "$repo_root/$AI_STOP_E2E_KILL_SWITCH" ]
}

ai_stop_e2e_counter_path() {
  local repo_root="$1"
  printf '%s/e2e.%s' "$AI_STOP_STATE_DIR" "$(ai_stop_repo_key "$repo_root")"
}

ai_stop_e2e_read_counter() {
  local counter="$1"
  local saw_fp=0 saw_branch=0 saw_count=0

  AI_STOP_E2E_COUNTER_FP=""
  AI_STOP_E2E_COUNTER_BRANCH=""
  AI_STOP_E2E_COUNTER_COUNT=0

  [ -f "$counter" ] || return 1
  while IFS='=' read -r k v; do
    case "$k" in
      LAST_FP) AI_STOP_E2E_COUNTER_FP=$v; saw_fp=1 ;;
      LAST_BRANCH) AI_STOP_E2E_COUNTER_BRANCH=$v; saw_branch=1 ;;
      LAST_COUNT) AI_STOP_E2E_COUNTER_COUNT=$v; saw_count=1 ;;
      *) return 1 ;;
    esac
  done < "$counter"

  [ "$saw_fp" -eq 1 ] || return 1
  [ "$saw_branch" -eq 1 ] || return 1
  [ "$saw_count" -eq 1 ] || return 1
  [[ "$AI_STOP_E2E_COUNTER_FP" =~ ^[0-9a-f]{64}$ ]] || return 1
  [ -n "$AI_STOP_E2E_COUNTER_BRANCH" ] || return 1
  ai_is_integer "$AI_STOP_E2E_COUNTER_COUNT" || return 1
  [ "$AI_STOP_E2E_COUNTER_COUNT" -ge 0 ] || return 1
}

ai_stop_e2e_write_counter() {
  local counter="$1"
  local fp="$2"
  local branch="$3"
  local count="$4"
  local dir base tmp

  dir=$(dirname "$counter")
  base=$(basename "$counter")
  tmp=$(mktemp "$dir/.${base}.tmp.XXXXXX") || return 1

  if ! {
    printf 'LAST_FP=%s\n' "$fp"
    printf 'LAST_BRANCH=%s\n' "$branch"
    printf 'LAST_COUNT=%s\n' "$count"
  } > "$tmp"; then
    rm -f "$tmp"
    return 1
  fi

  if ! mv -f "$tmp" "$counter"; then
    rm -f "$tmp"
    return 1
  fi
}

# Returns 0 with a message on stdout when the agent should be nudged about
# failing e2e, 1 otherwise. Reads only the same `last.e2e` marker
# bun-run-quiet writes; Stop hooks must not launch multi-minute verification.
ai_stop_e2e_status() {
  local repo_root="$1"
  local marker counter fp branch
  local exit_code="" age now count log

  ai_stop_e2e_disabled "$repo_root" && return 1
  git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1

  log="$AI_BUN_LOG_DIR/e2e.log"
  marker="$AI_BUN_LOG_DIR/last.e2e"
  counter=$(ai_stop_e2e_counter_path "$repo_root")
  fp=$(ai_worktree_fingerprint "$repo_root")
  branch=$(ai_stop_current_branch "$repo_root")

  if ai_read_bun_marker "$marker"; then
    now=$(date +%s)
    age=$((now - AI_MARKER_LAST_TS))
    if [ "$age" -lt "${AI_BUN_TTL:-1800}" ] && [ "$AI_MARKER_LAST_FP" = "$fp" ]; then
      exit_code=$AI_MARKER_LAST_EXIT
    fi
  fi

  if [ -z "$exit_code" ]; then
    return 1
  fi

  if [ "$exit_code" -eq 0 ]; then
    rm -f "$counter"
    return 1
  fi

  count=1
  if ai_stop_e2e_read_counter "$counter" \
    && [ "$AI_STOP_E2E_COUNTER_FP" = "$fp" ] \
    && [ "$AI_STOP_E2E_COUNTER_BRANCH" = "$branch" ]; then
    if [ "$AI_STOP_E2E_COUNTER_COUNT" -ge "$AI_STOP_E2E_MAX_NOTIFY" ]; then
      return 1
    fi
    count=$((AI_STOP_E2E_COUNTER_COUNT + 1))
  fi

  ai_stop_e2e_write_counter "$counter" "$fp" "$branch" "$count" || true

  printf '%s\n\n%s' \
    "e2e tests are failing (cached run exit $exit_code). Full log: $log" \
    "If you intentionally need to leave e2e failing, stop again; this reminder will not repeat more than $AI_STOP_E2E_MAX_NOTIFY times for the same change set. Disable entirely with: touch $repo_root/$AI_STOP_E2E_KILL_SWITCH"
}

ai_stop_async_state_value() {
  local file="$1"
  local key="$2"

  [ -f "$file" ] || return 1
  while IFS='=' read -r k v; do
    if [ "$k" = "$key" ]; then
      printf '%s' "$v"
      return 0
    fi
  done < "$file"
  return 1
}

ai_stop_async_latest_state() {
  local repo_root="$1"
  local repo_state latest state

  repo_state="$AI_STOP_ASYNC_STATE_ROOT/$(ai_stop_repo_key "$repo_root")"
  latest="$repo_state/latest"
  if [ -f "$latest" ]; then
    state=$(cat "$latest" 2>/dev/null || true)
    if [ -n "$state" ] && [ -f "$state" ]; then
      printf '%s' "$state"
      return 0
    fi
  fi

  find "$repo_state/runs" -mindepth 2 -maxdepth 2 -name state -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr | awk 'NR == 1 {print $2}'
}

ai_stop_async_elapsed() {
  local state="$1"
  local started finished now

  started=$(ai_stop_async_state_value "$state" started_epoch || printf '')
  finished=$(ai_stop_async_state_value "$state" finished_epoch || printf '')
  ai_is_integer "$started" || { printf '0'; return 0; }
  if ai_is_integer "$finished" && [ "$finished" -gt 0 ]; then
    printf '%s' "$((finished - started))"
    return 0
  fi
  now=$(date +%s)
  printf '%s' "$((now - started))"
}

ai_stop_async_disabled() {
  local repo_root="$1"
  [ -f "$repo_root/$AI_STOP_ASYNC_KILL_SWITCH" ]
}

ai_stop_async_counter_path() {
  local repo_root="$1"
  printf '%s/async.%s' "$AI_STOP_STATE_DIR" "$(ai_stop_repo_key "$repo_root")"
}

ai_stop_async_read_counter() {
  local counter="$1"
  local saw_state=0 saw_exit=0 saw_count=0

  AI_STOP_ASYNC_COUNTER_STATE=""
  AI_STOP_ASYNC_COUNTER_EXIT=""
  AI_STOP_ASYNC_COUNTER_COUNT=0

  [ -f "$counter" ] || return 1
  while IFS='=' read -r k v; do
    case "$k" in
      LAST_STATE) AI_STOP_ASYNC_COUNTER_STATE=$v; saw_state=1 ;;
      LAST_EXIT) AI_STOP_ASYNC_COUNTER_EXIT=$v; saw_exit=1 ;;
      LAST_COUNT) AI_STOP_ASYNC_COUNTER_COUNT=$v; saw_count=1 ;;
      *) return 1 ;;
    esac
  done < "$counter"

  [ "$saw_state" -eq 1 ] || return 1
  [ "$saw_exit" -eq 1 ] || return 1
  [ "$saw_count" -eq 1 ] || return 1
  [ -n "$AI_STOP_ASYNC_COUNTER_STATE" ] || return 1
  ai_is_integer "$AI_STOP_ASYNC_COUNTER_COUNT" || return 1
  [ "$AI_STOP_ASYNC_COUNTER_COUNT" -ge 0 ] || return 1
}

ai_stop_async_write_counter() {
  local counter="$1"
  local state="$2"
  local exit_code="$3"
  local count="$4"
  local dir base tmp

  dir=$(dirname "$counter")
  base=$(basename "$counter")
  mkdir -p "$dir" || return 1
  tmp=$(mktemp "$dir/.${base}.tmp.XXXXXX") || return 1

  if ! {
    printf 'LAST_STATE=%s\n' "$state"
    printf 'LAST_EXIT=%s\n' "$exit_code"
    printf 'LAST_COUNT=%s\n' "$count"
  } > "$tmp"; then
    rm -f "$tmp"
    return 1
  fi

  if ! mv -f "$tmp" "$counter"; then
    rm -f "$tmp"
    return 1
  fi
}

# Returns 0 with one short cached async-verification status message when a
# repo-local async state file exists and the run is actionable (running or
# failed). Passing runs are silent. Repeats are bounded per (state-file,
# exit-code) pair by AI_STOP_ASYNC_MAX_NOTIFY so a stale finished run does
# not fire forever. This stays a read-only Stop-hook check; it never starts
# verification.
ai_stop_async_verify_status() {
  local repo_root="$1"
  local state pid exit_code status elapsed log_dir counter count counter_key

  ai_stop_async_disabled "$repo_root" && return 1
  git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1
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
    status="passed"
  else
    status="failed"
  fi

  counter=$(ai_stop_async_counter_path "$repo_root")

  if [ "$status" = "passed" ]; then
    rm -f "$counter"
    return 1
  fi

  counter_key="$exit_code"
  count=1
  if ai_stop_async_read_counter "$counter" \
    && [ "$AI_STOP_ASYNC_COUNTER_STATE" = "$state" ] \
    && [ "$AI_STOP_ASYNC_COUNTER_EXIT" = "$counter_key" ]; then
    if [ "$AI_STOP_ASYNC_COUNTER_COUNT" -ge "$AI_STOP_ASYNC_MAX_NOTIFY" ]; then
      return 1
    fi
    count=$((AI_STOP_ASYNC_COUNTER_COUNT + 1))
  fi

  ai_stop_async_write_counter "$counter" "$state" "$counter_key" "$count" || true

  local suffix
  suffix="If you intentionally need to leave this status pending, stop again; this reminder will not repeat more than $AI_STOP_ASYNC_MAX_NOTIFY times for the same run. Disable entirely with: touch $repo_root/$AI_STOP_ASYNC_KILL_SWITCH"

  if [ -n "$exit_code" ]; then
    printf '%s\n\n%s' \
      "async verify $status (PID $pid, elapsed ${elapsed}s, exit $exit_code). Log: $log_dir/async.log" \
      "$suffix"
  else
    printf '%s\n\n%s' \
      "async verify $status (PID $pid, elapsed ${elapsed}s). Log: $log_dir/async.log" \
      "$suffix"
  fi
}

ai_stop_verify_disabled() {
  local repo_root="$1"
  [ -f "$repo_root/$AI_STOP_VERIFY_KILL_SWITCH" ] \
    || [ -f "$repo_root/$AI_STOP_VERIFY_LEGACY_KILL_SWITCH" ]
}

ai_stop_verify_counter_path() {
  local repo_root="$1"
  printf '%s/verify.%s' "$AI_STOP_STATE_DIR" "$(ai_stop_repo_key "$repo_root")"
}

ai_stop_verify_read_counter() {
  local counter="$1"
  local saw_mode=0 saw_fp=0 saw_exit=0 saw_count=0

  AI_STOP_VERIFY_COUNTER_MODE=""
  AI_STOP_VERIFY_COUNTER_FP=""
  AI_STOP_VERIFY_COUNTER_EXIT=""
  AI_STOP_VERIFY_COUNTER_COUNT=0

  [ -f "$counter" ] || return 1
  while IFS='=' read -r k v; do
    case "$k" in
      LAST_MODE) AI_STOP_VERIFY_COUNTER_MODE=$v; saw_mode=1 ;;
      LAST_FP) AI_STOP_VERIFY_COUNTER_FP=$v; saw_fp=1 ;;
      LAST_EXIT) AI_STOP_VERIFY_COUNTER_EXIT=$v; saw_exit=1 ;;
      LAST_COUNT) AI_STOP_VERIFY_COUNTER_COUNT=$v; saw_count=1 ;;
      *) return 1 ;;
    esac
  done < "$counter"

  [ "$saw_mode" -eq 1 ] || return 1
  [ "$saw_fp" -eq 1 ] || return 1
  [ "$saw_exit" -eq 1 ] || return 1
  [ "$saw_count" -eq 1 ] || return 1
  [ -n "$AI_STOP_VERIFY_COUNTER_MODE" ] || return 1
  [[ "$AI_STOP_VERIFY_COUNTER_FP" =~ ^[0-9a-f]{64}$ ]] || return 1
  ai_is_integer "$AI_STOP_VERIFY_COUNTER_COUNT" || return 1
  [ "$AI_STOP_VERIFY_COUNTER_COUNT" -ge 0 ] || return 1
}

ai_stop_verify_write_counter() {
  local counter="$1"
  local mode="$2"
  local fp="$3"
  local exit_code="$4"
  local count="$5"
  local dir base tmp

  dir=$(dirname "$counter")
  base=$(basename "$counter")
  mkdir -p "$dir" || return 1
  tmp=$(mktemp "$dir/.${base}.tmp.XXXXXX") || return 1

  if ! {
    printf 'LAST_MODE=%s\n' "$mode"
    printf 'LAST_FP=%s\n' "$fp"
    printf 'LAST_EXIT=%s\n' "$exit_code"
    printf 'LAST_COUNT=%s\n' "$count"
  } > "$tmp"; then
    rm -f "$tmp"
    return 1
  fi

  if ! mv -f "$tmp" "$counter"; then
    rm -f "$tmp"
    return 1
  fi
}

# Extract a string-valued JSON field from a flat single-object JSON file.
# Only safe for fields whose values cannot contain quote/backslash escapes —
# fine for `mode`, `head`, `fingerprint` produced by musi_write_wrapper_meta.
ai_stop_verify_meta_string() {
  local file="$1"
  local key="$2"

  [ -f "$file" ] || return 1
  awk -v keypat="\"$key\":\"" '
    {
      n = index($0, keypat)
      if (n == 0) next
      rest = substr($0, n + length(keypat))
      end = index(rest, "\"")
      if (end > 0) print substr(rest, 1, end - 1)
      exit
    }
  ' "$file"
}

ai_stop_verify_meta_int() {
  local file="$1"
  local key="$2"

  [ -f "$file" ] || return 1
  awk -v keypat="\"$key\":" '
    {
      n = index($0, keypat)
      if (n == 0) next
      rest = substr($0, n + length(keypat))
      if (match(rest, /-?[0-9]+/)) {
        print substr(rest, RSTART, RLENGTH)
      }
      exit
    }
  ' "$file"
}

# Reports the cached `verify:changed` / pre-commit run when its wrapper meta
# matches the current checked state and exit_code != 0. Pre-commit is matched
# against the source/config state its tasks read, full serial verify against
# the full worktree, and changed serial verify against the staged snapshot.
# Reads only `$LOG_DIR/meta/wrapper.json`; never starts verification. A wrapper
# whose fingerprint no longer matches is treated as stale and skipped silently.
ai_stop_verify_status() {
  local repo_root="$1"
  local log_dir wrapper fp recorded_fp head mode exit_code counter count
  local source_label current_head

  ai_stop_verify_disabled "$repo_root" && return 1
  git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1

  log_dir="${MUSI_VERIFY_LOG_DIR:-/tmp/musi-pre-commit-logs}"
  wrapper="$log_dir/meta/wrapper.json"
  [ -f "$wrapper" ] || return 1

  recorded_fp=$(ai_stop_verify_meta_string "$wrapper" fingerprint)
  head=$(ai_stop_verify_meta_string "$wrapper" head)
  mode=$(ai_stop_verify_meta_string "$wrapper" mode)
  exit_code=$(ai_stop_verify_meta_int "$wrapper" exit_code)

  [ -n "$recorded_fp" ] || return 1
  [ -n "$head" ] || return 1
  [ -n "$mode" ] || return 1
  ai_is_integer "$exit_code" || return 1
  [[ "$recorded_fp" =~ ^[0-9a-f]{64}$ ]] || return 1

  current_head=$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || echo none)
  [ "$current_head" = "$head" ] || return 1

  case "$mode" in
    parallel-precommit) fp=$(ai_precommit_fingerprint "$repo_root") ;;
    serial-verify) fp=$(ai_worktree_fingerprint "$repo_root") ;;
    serial-verify-changed) fp=$(ai_staged_fingerprint "$repo_root") ;;
    *) return 1 ;;
  esac
  counter=$(ai_stop_verify_counter_path "$repo_root")

  if [ "$recorded_fp" != "$fp" ]; then
    return 1
  fi

  if [ "$exit_code" -eq 0 ]; then
    rm -f "$counter"
    return 1
  fi

  count=1
  if ai_stop_verify_read_counter "$counter" \
    && [ "$AI_STOP_VERIFY_COUNTER_MODE" = "$mode" ] \
    && [ "$AI_STOP_VERIFY_COUNTER_FP" = "$fp" ] \
    && [ "$AI_STOP_VERIFY_COUNTER_EXIT" = "$exit_code" ]; then
    if [ "$AI_STOP_VERIFY_COUNTER_COUNT" -ge "$AI_STOP_VERIFY_MAX_NOTIFY" ]; then
      return 1
    fi
    count=$((AI_STOP_VERIFY_COUNTER_COUNT + 1))
  fi

  ai_stop_verify_write_counter "$counter" "$mode" "$fp" "$exit_code" "$count" || true

  case "$mode" in
    parallel-precommit) source_label="cached pre-commit" ;;
    serial-verify) source_label="cached verify" ;;
    serial-verify-changed) source_label="cached verify:changed" ;;
  esac

  printf '%s\n\n%s' \
    "$source_label run is failing (exit $exit_code at $head). Inspect: bun run verify:logs" \
    "If you intentionally need to leave this verification red, stop again; this reminder will not repeat more than $AI_STOP_VERIFY_MAX_NOTIFY times for the same change set. Disable entirely with: touch $repo_root/$AI_STOP_VERIFY_KILL_SWITCH"
}

ai_stop_policy_messages() {
  local repo_root="$1"
  local messages="" next_message

  if next_message=$(ai_stop_commit_reminder "$repo_root"); then
    messages="$next_message"
  fi

  if next_message=$(ai_stop_e2e_status "$repo_root"); then
    if [ -n "$messages" ]; then
      messages="$messages

$next_message"
    else
      messages="$next_message"
    fi
  fi

  if next_message=$(ai_stop_async_verify_status "$repo_root"); then
    if [ -n "$messages" ]; then
      messages="$messages

$next_message"
    else
      messages="$next_message"
    fi
  fi

  if next_message=$(ai_stop_verify_status "$repo_root"); then
    if [ -n "$messages" ]; then
      messages="$messages

$next_message"
    else
      messages="$next_message"
    fi
  fi

  [ -n "$messages" ] || return 1
  printf '%s' "$messages"
}
