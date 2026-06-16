#!/usr/bin/env bash
# Helpers for verification timing metadata shared by pre-commit, verify, and
# verify:logs. Writers create per-step fragments first so parallel pre-commit
# children never append to the same file concurrently; the wrapper combines
# fragments into run-meta.json at the end of the run.
#
# Kept in scripts/lib so the dash-invoked smoke test in
# `scripts/tests/test-dependency-freshness.sh` can source it without pulling in
# `scripts/ai-hooks/cache.sh` (which contains bash-only constructs).
# `ai_worktree_fingerprint` is defined here for the same reason; cache.sh
# sources this file and re-exports it for ai-hooks callers.

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

musi_path_policy_query_lines() {
  local query="$1"
  local script bun_bin tmp status
  script="$(musi_path_policy_query_script)"
  bun_bin="${MUSI_PATH_POLICY_BUN:-bun}"
  tmp=$(mktemp "${TMPDIR:-/tmp}/musi-path-policy-query.XXXXXX") || return 2
  if ! "$bun_bin" --config=/dev/null "$script" "$query" > "$tmp"; then
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

  printf '%s\n' "$path" | musi_path_policy_query_lines "$query" | grep -q .
}

ai_staged_fingerprint() {
  local repo_root="$1"

  {
    git -C "$repo_root" rev-parse HEAD 2>/dev/null || echo none
    git -C "$repo_root" diff --cached --binary --diff-filter=ACMRD
  } | sha256sum | awk '{print $1}'
}

musi_changed_gate_relevant_path() {
  local path="$1"

  musi_path_policy_path_matches source-relevant "$path"
}

musi_staged_has_source_relevant_change() {
  local tmp

  tmp=$(mktemp "${TMPDIR:-/tmp}/musi-staged-source.XXXXXX") || return 2
  if ! {
    git diff --cached --name-only --diff-filter=ACMRD 2>/dev/null || true
  } | musi_path_policy_query_lines source-relevant:precommit-staged > "$tmp"; then
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
  (
    cd "$repo_root" || exit 2
    {
      git diff --name-only --diff-filter=ACMRD 2>/dev/null || true
      git ls-files --others --exclude-standard 2>/dev/null || true
    } | sort -u | musi_path_policy_query_lines source-relevant | while IFS= read -r file; do
      [ -n "$file" ] || continue
      printf '%s\n' "$file"
    done
  ) > "$tmp"

  if [ -s "$tmp" ]; then
    printf '%s: source-relevant unstaged or untracked changes are present.\n' "$label" >&2
    printf '%s: stage the intended commit, or stash/restore unrelated source-relevant work, before running changed verification.\n' "$label" >&2
    while IFS= read -r file; do
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

  {
    git -C "$repo_root" rev-parse HEAD 2>/dev/null || echo none
    git -C "$repo_root" diff --cached --binary --diff-filter=ACMRD
    (
      cd "$repo_root" || exit 1
      {
        git diff --name-only --diff-filter=ACMRD HEAD 2>/dev/null
      } | sort -u | musi_path_policy_query_lines source-relevant:precommit-tracked | while IFS= read -r file; do
        [ -n "$file" ] || continue
        if [ -f "$file" ]; then
          sha256sum "$file"
        else
          printf 'deleted %s\n' "$file"
        fi
      done
      git ls-files --others --exclude-standard 2>/dev/null | sort -u | musi_path_policy_query_lines source-relevant | while IFS= read -r file; do
        [ -n "$file" ] || continue
        [ -f "$file" ] || continue
        sha256sum "$file"
      done
    )
  } | sha256sum | awk '{print $1}'
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
  local freshness_seconds="${4:-120}"
  local now age

  MUSI_MARKER_MATCH_AGE=""

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

musi_classify_staged_script_input() {
  MUSI_STAGED_SCRIPT_ALL="$(git diff --cached --name-only --diff-filter=ACMRD 2>/dev/null || true)"
  MUSI_STAGED_SCRIPT_DELETED="$(git diff --cached --name-only --diff-filter=D 2>/dev/null || true)"

  [ -n "$MUSI_STAGED_SCRIPT_ALL" ] || return 2

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
  current_precommit_hash=$(ai_precommit_fingerprint "$repo_root")
  if ! musi_write_success_marker "$precommit_marker" "$current_head" "$current_precommit_hash"; then
    printf 'pre-commit: WARN: failed to write marker %s\n' "$precommit_marker" >&2
  fi
  printf 'pre-commit: %s passed %ss ago for this staged/worktree state — skipping (set FORCE_VERIFY=1 to re-run).\n' \
    "$label" "$age"
}

musi_try_verify_marker_bridge() {
  local repo_root="$1"
  local precommit_marker="${2:-${MUSI_PRECOMMIT_MARKER:-$(musi_standard_precommit_marker "$repo_root")}}"
  local freshness_seconds="${3:-120}"
  local current_head current_staged_hash current_worktree_hash changed_marker full_marker

  [ "${FORCE_VERIFY:-}" = "1" ] && return 1

  current_head=$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || echo none)
  current_staged_hash=$(ai_staged_fingerprint "$repo_root")
  current_worktree_hash=$(ai_worktree_fingerprint "$repo_root")
  changed_marker="${MUSI_VERIFY_MARKER_CHANGED:-$(musi_standard_verify_changed_marker "$repo_root")}"
  full_marker="${MUSI_VERIFY_MARKER_FULL:-$(musi_standard_verify_full_marker "$repo_root")}"

  musi_try_single_verify_marker_bridge "$repo_root" "$precommit_marker" "$changed_marker" \
    "verify:changed" "$freshness_seconds" "$current_head" "$current_staged_hash" \
    && return 0
  musi_try_single_verify_marker_bridge "$repo_root" "$precommit_marker" "$full_marker" \
    "verify" "$freshness_seconds" "$current_head" "$current_worktree_hash"
}

musi_meta_json_escape() {
  local s="${1-}"
  printf '%s' "$s" | awk '
    {
      gsub(/\\/, "\\\\")
      gsub(/"/, "\\\"")
      gsub(/\t/, "\\t")
      gsub(/\r/, "\\r")
      if (NR > 1) {
        printf "\\n"
      }
      printf "%s", $0
    }
  '
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

musi_run_meta_wrapper_fragment() {
  local json="$1"

  printf '%s\n' "$json" | sed -n 's/^.*"wrapper":\({[^}]*}\).*$/\1/p'
}

musi_run_meta_json_string_field() {
  local json="$1"
  local key="$2"

  printf '%s\n' "$json" | sed -n "s/^.*\"$key\":\"\\([^\"]*\\)\".*$/\\1/p"
}

musi_run_meta_json_int_field() {
  local json="$1"
  local key="$2"

  printf '%s\n' "$json" | sed -n "s/^.*\"$key\":\\([0-9][0-9]*\\).*$/\\1/p"
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
  if ! json=$(sed -n '1p' "$run_meta" 2>/dev/null); then
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

musi_write_step_meta() {
  local file="$1"
  local name="$2"
  local mode="$3"
  local start_epoch="$4"
  local start_time="$5"
  local end_epoch="$6"
  local end_time="$7"
  local exit_code="$8"
  local command="$9"
  local elapsed=$((end_epoch - start_epoch))
  [ "$elapsed" -lt 0 ] && elapsed=0

  mkdir -p "$(dirname "$file")"
  {
    printf '{'
    printf '"name":"%s",' "$(musi_meta_json_escape "$name")"
    printf '"mode":"%s",' "$(musi_meta_json_escape "$mode")"
    printf '"start_time":"%s",' "$(musi_meta_json_escape "$start_time")"
    printf '"end_time":"%s",' "$(musi_meta_json_escape "$end_time")"
    printf '"elapsed_seconds":%s,' "$elapsed"
    printf '"exit_code":%s,' "$exit_code"
    printf '"command":"%s"' "$(musi_meta_json_escape "$command")"
    printf '}\n'
  } > "$file"
}

musi_write_wrapper_meta() {
  local file="$1"
  local mode="$2"
  local start_epoch="$3"
  local start_time="$4"
  local end_epoch="$5"
  local end_time="$6"
  local exit_code="$7"
  local command="$8"
  local head="${9:-}"
  local fingerprint="${10:-}"
  local elapsed=$((end_epoch - start_epoch))
  [ "$elapsed" -lt 0 ] && elapsed=0

  mkdir -p "$(dirname "$file")"
  {
    printf '{'
    printf '"name":"wrapper",'
    printf '"mode":"%s",' "$(musi_meta_json_escape "$mode")"
    printf '"start_time":"%s",' "$(musi_meta_json_escape "$start_time")"
    printf '"end_time":"%s",' "$(musi_meta_json_escape "$end_time")"
    printf '"elapsed_seconds":%s,' "$elapsed"
    printf '"exit_code":%s,' "$exit_code"
    printf '"head":"%s",' "$(musi_meta_json_escape "$head")"
    printf '"fingerprint":"%s",' "$(musi_meta_json_escape "$fingerprint")"
    printf '"command":"%s"' "$(musi_meta_json_escape "$command")"
    printf '}\n'
  } > "$file"
}

musi_combine_run_meta() {
  local log_dir="$1"
  local mode="$2"
  local wrapper_fragment="$3"
  local output="$log_dir/run-meta.json"
  local first=1 fragment

  {
    printf '{'
    printf '"version":1,'
    printf '"mode":"%s",' "$(musi_meta_json_escape "$mode")"
    printf '"generated_at":"%s",' "$(date -Iseconds)"
    printf '"wrapper":'
    if [ -f "$wrapper_fragment" ]; then
      cat "$wrapper_fragment"
    else
      printf 'null'
    fi
    printf ',"steps":['
    for fragment in "$log_dir"/meta/*.json; do
      [ -f "$fragment" ] || continue
      [ "$fragment" = "$wrapper_fragment" ] && continue
      if [ "$first" -eq 0 ]; then
        printf ','
      fi
      first=0
      cat "$fragment"
    done
    printf ']}\n'
  } > "$output"
}
