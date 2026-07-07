#!/bin/bash

# Shared Stop-hook policies. Keep adapter-specific behavior in .claude wrappers;
# this file decides whether a Stop event should show a user-visible warning.

AI_STOP_COMMIT_KILL_SWITCH=".no-stop-uncommitted"
AI_STOP_E2E_KILL_SWITCH=".no-stop-e2e"
AI_STOP_E2E_MAX_NOTIFY="${AI_STOP_E2E_MAX_NOTIFY:-2}"
AI_STOP_ASYNC_KILL_SWITCH=".no-stop-async-verify"
AI_STOP_ASYNC_MAX_NOTIFY="${AI_STOP_ASYNC_MAX_NOTIFY:-2}"
AI_STOP_ASYNC_STATE_ROOT="${MUSI_VERIFY_ASYNC_STATE_ROOT:-/tmp/musi-verify-async}"
AI_STOP_VERIFY_KILL_SWITCH=".no-stop-verify-changed"
AI_STOP_VERIFY_LEGACY_KILL_SWITCH=".no-stop-verify"
AI_STOP_VERIFY_MAX_NOTIFY="${AI_STOP_VERIFY_MAX_NOTIFY:-2}"
AI_STOP_LINT_WARNINGS_KILL_SWITCH=".no-stop-lint-warnings"
# Wall-clock cap for the live eslint scan the lint-warnings reminder runs. This
# is the only Stop subcheck that spawns real work instead of reading a cached
# marker, and it shares a single Stop budget (30s) with the other subchecks, so
# it must bound its own runtime well under that ceiling.
AI_STOP_LINT_WARNINGS_TIMEOUT_SECONDS="${AI_STOP_LINT_WARNINGS_TIMEOUT_SECONDS:-12}"
AI_TIDY_STOP_WARNING_FILE_CAP="${AI_TIDY_STOP_WARNING_FILE_CAP:-10}"
AI_TIDY_STOP_WARNING_RULE_CAP="${AI_TIDY_STOP_WARNING_RULE_CAP:-${AI_TIDY_WARNING_RULE_CAP:-5}}"

ai_stop_repo_key() {
  local repo_root="$1"

  printf '%s' "$repo_root" | sha256sum | awk '{print $1}'
}

ai_stop_scoped_repo_key() {
  local repo_root="$1"
  local scope="${2:-}"

  if [ -z "$scope" ]; then
    ai_stop_repo_key "$repo_root"
    return 0
  fi

  printf 'repo=%s\nscope=%s' "$repo_root" "$scope" | sha256sum | awk '{print $1}'
}

ai_stop_marker_path() {
  local repo_root="$1"
  local scope="${2:-}"

  printf '%s/last.%s' "$AI_STOP_STATE_DIR" "$(ai_stop_scoped_repo_key "$repo_root" "$scope")"
}

ai_stop_with_readonly_git() {
  GIT_OPTIONAL_LOCKS=0 "$@"
}

ai_stop_git_readonly() {
  ai_stop_with_readonly_git git "$@"
}

ai_stop_has_uncommitted_changes() {
  local repo_root="$1"

  [ -n "$(ai_stop_git_readonly -C "$repo_root" status --porcelain --untracked-files=normal 2>/dev/null)" ]
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
  mkdir -p "$dir" || return 1
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

  branch=$(ai_stop_git_readonly -C "$repo_root" branch --show-current 2>/dev/null || true)
  [ -n "$branch" ] || branch="detached HEAD"
  printf '%s' "$branch"
}

ai_stop_dirty_message() {
  local branch="$1"
  local repo_root="$2"
  local suffix

  suffix="Silence this warning with: touch $repo_root/$AI_STOP_COMMIT_KILL_SWITCH"

  if [ "$branch" = "main" ]; then
    printf '%s\n\n%s' \
      "This repo has uncommitted changes on main. Check out a new branch, then commit the work before handoff." \
      "$suffix"
    return 0
  fi

  printf '%s\n\n%s' \
    "This repo has uncommitted changes on branch '$branch'. Commit the work before handoff." \
    "$suffix"
}

ai_stop_commit_reminder_disabled() {
  local repo_root="$1"
  [ -f "$repo_root/$AI_STOP_COMMIT_KILL_SWITCH" ]
}

ai_stop_commit_reminder() {
  local repo_root="$1"
  local scope="${2:-}"
  local marker fp branch

  ai_stop_git_readonly -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1

  marker=$(ai_stop_marker_path "$repo_root" "$scope")
  if ai_stop_commit_reminder_disabled "$repo_root"; then
    rm -f "$marker"
    return 1
  fi

  if ! ai_stop_has_uncommitted_changes "$repo_root"; then
    rm -f "$marker"
    return 1
  fi

  fp=$(ai_stop_with_readonly_git ai_worktree_fingerprint "$repo_root")
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

# Returns 0 with a user warning on stdout when cached e2e is failing, 1
# otherwise. Reads only the `last.e2e*` markers bun-run-quiet
# writes (argv-scoped, H1/H2: the newest e2e run on this worktree, whatever its
# argv); Stop hooks must not launch multi-minute verification.
ai_stop_e2e_status() {
  local repo_root="$1"
  local marker counter fp branch
  local exit_code="" age now count log

  ai_stop_e2e_disabled "$repo_root" && return 1
  ai_stop_git_readonly -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1

  log="$AI_BUN_LOG_DIR/e2e.log"
  marker=$(ai_newest_bun_marker_for_base "$AI_BUN_LOG_DIR" e2e || true)
  counter=$(ai_stop_e2e_counter_path "$repo_root")
  fp=$(ai_stop_with_readonly_git ai_worktree_fingerprint "$repo_root")
  branch=$(ai_stop_current_branch "$repo_root")

  if [ -n "$marker" ] && ai_read_bun_marker "$marker"; then
    now=$(date +%s)
    age=$((now - AI_MARKER_LAST_TS))
    if [ "$age" -lt "${AI_BUN_TTL:-3600}" ] && [ "$AI_MARKER_LAST_FP" = "$fp" ]; then
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
    "This warning repeats at most $AI_STOP_E2E_MAX_NOTIFY times for the same change set. Silence it with: touch $repo_root/$AI_STOP_E2E_KILL_SWITCH"
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
  ai_stop_git_readonly -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1
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
  suffix="This warning repeats at most $AI_STOP_ASYNC_MAX_NOTIFY times for the same run. Silence it with: touch $repo_root/$AI_STOP_ASYNC_KILL_SWITCH"

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
  local scope="${2:-}"
  printf '%s/verify.%s' "$AI_STOP_STATE_DIR" "$(ai_stop_scoped_repo_key "$repo_root" "$scope")"
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

# Collects the names of the gates whose per-step meta records a non-zero exit,
# sorted and comma-joined, derived from metadata rather than hard-coded. Gates
# short-circuit in serial mode (only the first failing step's meta exists) and
# run fully in parallel mode, so this reports whatever non-zero meta is present
# without implying it is the only problem. Prints nothing when no step meta is
# available (the caller then falls back to the generic message).
ai_stop_verify_failing_gates() {
  local meta_dir="$1"
  local file base name step_exit
  local names=""

  [ -d "$meta_dir" ] || return 0
  for file in "$meta_dir"/*.json; do
    [ -e "$file" ] || continue
    base=$(basename "$file")
    [ "$base" = "wrapper.json" ] && continue
    step_exit=$(ai_stop_verify_meta_int "$file" exit_code)
    ai_is_integer "$step_exit" || continue
    [ "$step_exit" -ne 0 ] || continue
    name=$(ai_stop_verify_meta_string "$file" name)
    [ -n "$name" ] || continue
    names+="$name"$'\n'
  done

  [ -n "$names" ] || return 0
  printf '%s' "$names" | sort -u \
    | awk 'NR > 1 { printf ", " } { printf "%s", $0 } END { if (NR > 0) printf "\n" }'
}

# Reports the cached `verify:changed` / pre-commit run when its wrapper meta
# matches the current checked state and exit_code != 0. Pre-commit is matched
# against the source/config state its tasks read, full serial verify against
# the full worktree, and changed verify against the staged snapshot.
# Reads only `$LOG_DIR/meta/wrapper.json`; never starts verification. A wrapper
# whose fingerprint no longer matches is treated as stale and skipped silently.
ai_stop_verify_status() {
  local repo_root="$1"
  local scope="${2:-}"
  local log_dir wrapper fp recorded_fp head mode exit_code counter count
  local source_label current_head failing_gates first_line
  local suffix

  ai_stop_verify_disabled "$repo_root" && return 1
  ai_stop_git_readonly -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1

  log_dir="${MUSI_VERIFY_LOG_DIR:-$(musi_standard_verify_log_dir "$repo_root")}"
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

  current_head=$(ai_stop_git_readonly -C "$repo_root" rev-parse HEAD 2>/dev/null || echo none)
  [ "$current_head" = "$head" ] || return 1

  case "$mode" in
    parallel-precommit) fp=$(ai_stop_with_readonly_git ai_precommit_fingerprint "$repo_root") ;;
    serial-verify|parallel-verify) fp=$(ai_stop_with_readonly_git ai_worktree_fingerprint "$repo_root") ;;
    serial-verify-changed|parallel-verify-changed) fp=$(ai_stop_with_readonly_git ai_staged_fingerprint "$repo_root") ;;
    *) return 1 ;;
  esac
  counter=$(ai_stop_verify_counter_path "$repo_root" "$scope")

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
    serial-verify|parallel-verify) source_label="cached verify" ;;
    serial-verify-changed|parallel-verify-changed) source_label="cached verify:changed" ;;
  esac

  failing_gates=$(ai_stop_verify_failing_gates "$log_dir/meta")
  if [ -n "$failing_gates" ]; then
    first_line="$source_label run is failing (exit $exit_code at $head); failing gate(s): $failing_gates. Inspect: bun run verify:logs"
  else
    first_line="$source_label run is failing (exit $exit_code at $head). Inspect: bun run verify:logs"
  fi

  suffix="This warning repeats at most $AI_STOP_VERIFY_MAX_NOTIFY times for the same change set. Silence it with: touch $repo_root/$AI_STOP_VERIFY_KILL_SWITCH"

  printf '%s\n\n%s' "$first_line" "$suffix"
}

ai_stop_append_message() {
  local current="$1"
  local next_message="$2"

  if [ -n "$current" ]; then
    printf '%s\n\n%s' "$current" "$next_message"
  else
    printf '%s' "$next_message"
  fi
}

ai_stop_positive_int_or_default() {
  local value="$1"
  local default="$2"

  if ai_is_integer "$value" && [ "$value" -ge 1 ]; then
    printf '%s' "$value"
  else
    printf '%s' "$default"
  fi
}

ai_stop_lint_warnings_file_cap() {
  ai_stop_positive_int_or_default "$AI_TIDY_STOP_WARNING_FILE_CAP" 10
}

ai_stop_lint_warnings_rule_cap() {
  ai_stop_positive_int_or_default "$AI_TIDY_STOP_WARNING_RULE_CAP" 5
}

ai_stop_lint_warnings_timeout_seconds() {
  ai_stop_positive_int_or_default "$AI_STOP_LINT_WARNINGS_TIMEOUT_SECONDS" 12
}

ai_stop_lint_warnings_disabled() {
  local repo_root="$1"

  [ -f "$repo_root/$AI_STOP_LINT_WARNINGS_KILL_SWITCH" ]
}

ai_stop_lint_warning_eslint_supported() {
  local path="$1"

  case "${path,,}" in
    *.js|*.jsx|*.mjs|*.cjs|*.ts|*.tsx|*.mts|*.cts|*.json|*.jsonc|*.json5)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ai_stop_lint_warning_changed_paths() {
  local repo_root="$1"
  local path

  {
    ai_stop_git_readonly -C "$repo_root" diff -z --name-only --diff-filter=ACMR HEAD 2>/dev/null || true
    ai_stop_git_readonly -C "$repo_root" diff -z --cached --name-only --diff-filter=ACMR 2>/dev/null || true
    ai_stop_git_readonly -C "$repo_root" ls-files -z --others --exclude-standard 2>/dev/null || true
  } | sort -zu | while IFS= read -r -d '' path; do
    [ -n "$path" ] || continue
    [ -f "$repo_root/$path" ] || continue
    ai_stop_lint_warning_eslint_supported "$path" || continue
    printf '%s\0' "$path"
  done
}

ai_stop_lint_warning_branch() {
  local repo_root="$1"

  ai_stop_git_readonly -C "$repo_root" symbolic-ref --quiet --short HEAD 2>/dev/null \
    || ai_stop_git_readonly -C "$repo_root" rev-parse --short HEAD 2>/dev/null \
    || printf 'unknown'
}

ai_stop_lint_warning_rule_summary() {
  local json="$1"
  local cap="$2"

  printf '%s' "$json" | jq -r --argjson cap "$cap" '
    [.[].messages[] | select(.severity == 1) | (.ruleId // "(unknown rule)")]
    | sort
    | group_by(.)
    | map({rule: .[0], count: length})
    | sort_by(.rule)
    | sort_by(-.count)
    | .[0:$cap]
    | map("\(.rule): \(.count)")
    | join(", ")
  ' 2>/dev/null || true
}

ai_stop_lint_warning_path_summary() {
  local -n paths_ref="$1"
  local out="" path

  for path in "${paths_ref[@]}"; do
    if [ -n "$out" ]; then
      out="$out, $path"
    else
      out="$path"
    fi
  done
  printf '%s' "$out"
}

ai_stop_lint_warnings_reminder() {
  local repo_root="$1"
  local marker fp branch file_cap rule_cap skipped json warning_count rules paths_text
  local -a paths=()
  local -a capped_paths=()

  ai_stop_lint_warnings_disabled "$repo_root" && return 1
  ai_stop_git_readonly -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1

  fp=$(ai_stop_with_readonly_git ai_worktree_fingerprint "$repo_root")
  branch=$(ai_stop_lint_warning_branch "$repo_root")
  marker=$(ai_stop_marker_path "$repo_root" "lint-warnings")
  if ai_stop_read_marker "$marker" \
     && [ "$AI_STOP_MARKER_FP" = "$fp" ] \
     && [ "$AI_STOP_MARKER_BRANCH" = "$branch" ]; then
    return 1
  fi

  while IFS= read -r -d '' path; do
    paths+=("$path")
  done < <(ai_stop_lint_warning_changed_paths "$repo_root")

  if [ "${#paths[@]}" -eq 0 ]; then
    rm -f "$marker"
    return 1
  fi

  file_cap=$(ai_stop_lint_warnings_file_cap)
  rule_cap=$(ai_stop_lint_warnings_rule_cap)
  for path in "${paths[@]}"; do
    [ "${#capped_paths[@]}" -lt "$file_cap" ] || break
    capped_paths+=("$path")
  done
  skipped=$((${#paths[@]} - ${#capped_paths[@]}))

  # Bound the live eslint scan so it cannot blow the shared 30s Stop budget and
  # silently time out the whole Stop policy (losing the other reminders too).
  # On overrun (timeout exit 124) or any eslint failure/crash, skip the lint
  # check only and leave the dedup marker untouched so the rest of the Stop
  # policy still reports and this check retries on the next stop -- distinct
  # from a genuine zero-warnings clean run, which clears the marker below.
  local eslint_budget eslint_status
  eslint_budget=$(ai_stop_lint_warnings_timeout_seconds)
  json=$(cd "$repo_root" && timeout "${eslint_budget}s" node_modules/.bin/eslint -f json --no-warn-ignored "${capped_paths[@]}" 2>/dev/null)
  eslint_status=$?
  [ "$eslint_status" -eq 0 ] || return 1
  [ -n "$json" ] || return 1
  warning_count=$(printf '%s' "$json" | jq '[.[].warningCount] | add // 0' 2>/dev/null) || return 1
  case "$warning_count" in
    ''|*[!0-9]*) return 1 ;;
  esac

  if [ "$warning_count" -le 0 ]; then
    rm -f "$marker"
    return 1
  fi

  ai_stop_write_marker "$marker" "$fp" "$branch" || true
  rules=$(ai_stop_lint_warning_rule_summary "$json" "$rule_cap")
  paths_text=$(ai_stop_lint_warning_path_summary capped_paths)

  printf 'tidy-edited-file: changed files have %s eslint warning(s) that block `bun run lint`: %s\n' \
    "$warning_count" "$rules"
  printf 'Changed files scanned: %s\n' "$paths_text"
  if [ "$skipped" -gt 0 ]; then
    printf '%s changed eslint-supported file(s) not scanned due to Stop hook cap %s.\n' \
      "$skipped" "$file_cap"
  fi
  printf 'Run `bun run lint` for the full lint output.'
}

ai_stop_policy_messages() {
  local repo_root="$1"
  local messages="" next_message

  if next_message=$(ai_stop_commit_reminder "$repo_root"); then
    messages=$(ai_stop_append_message "$messages" "$next_message")
  fi

  if next_message=$(ai_stop_e2e_status "$repo_root"); then
    messages=$(ai_stop_append_message "$messages" "$next_message")
  fi

  if next_message=$(ai_stop_async_verify_status "$repo_root"); then
    messages=$(ai_stop_append_message "$messages" "$next_message")
  fi

  if next_message=$(ai_stop_verify_status "$repo_root"); then
    messages=$(ai_stop_append_message "$messages" "$next_message")
  fi

  if next_message=$(ai_stop_lint_warnings_reminder "$repo_root"); then
    messages=$(ai_stop_append_message "$messages" "$next_message")
  fi

  [ -n "$messages" ] || return 1
  printf '%s' "$messages"
}
