#!/bin/bash
# test-scripts.sh — run shell smoke tests for verification scripts.
#
# Default: runs the full smoke suite with bounded parallelism. Set
# MUSI_SCRIPTS_CONCURRENCY=1 for the old sequential, halt-on-first-failure
# debugging view.
# With --changed, only smoke tests whose subjects (or the smoke test files
# themselves) changed vs the base branch run; if no relevant change is
# detected, the wrapper exits 0 with a no-op message — same shape as
# lint-changed/test-changed. If the base branch cannot be resolved, it falls
# back to the full smoke suite.
#
# Why this exists: verify's lint/typecheck/test slots never exercise the
# shell wrappers themselves, so a regression in `scripts/verify.sh` or
# `scripts/migration-safety-scan.sh` slipped past `bun run verify:changed`
# as a "no Vitest-relevant changes" no-op. test:scripts gives verify a
# fourth slot that is loud about script-only edits.
#
# Usage:
#   bash scripts/test-scripts.sh           # run all smoke tests
#   bash scripts/test-scripts.sh --changed # only smoke tests whose subjects
#                                          # changed vs main
#
# Env (tests only):
#   MUSI_SCRIPTS_CHANGED_FILES — newline-separated list of changed files,
#                                supplied by tests in lieu of `git diff`.
#   MUSI_SCRIPTS_RUNNER        — command (single token) used to invoke each
#                                smoke test; default `bash`. Tests use this
#                                to stub execution without running the real
#                                smoke tests.
#   MUSI_SCRIPTS_CONCURRENCY   — selected-smoke concurrency override; default
#                                is min(8, nproc), falling back to 4.
#   MUSI_SCRIPTS_LOG_DIR       — parallel-mode per-smoke log directory;
#                                default /tmp/musi-test-scripts-logs.

set -u

CHANGED=0
case "${1:-}" in
  --changed) CHANGED=1 ;;
  '') ;;
  *) printf 'test:scripts: unknown argument: %s\n' "$1" >&2
     printf 'usage: test-scripts.sh [--changed]\n' >&2
     exit 2 ;;
esac

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT" || exit 1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATH_POLICY_QUERY="${MUSI_PATH_POLICY_QUERY:-$SCRIPT_DIR/path-policy-query.ts}"
PATH_POLICY_BUN="${MUSI_PATH_POLICY_BUN:-bun}"

path_policy_query_lines() {
  local query="$1"
  local tmp status

  tmp=$(mktemp "${TMPDIR:-/tmp}/musi-test-scripts-policy.XXXXXX") || return 2
  if ! "$PATH_POLICY_BUN" --config=/dev/null "$PATH_POLICY_QUERY" "$query" >"$tmp"; then
    rm -f "$tmp"
    return 2
  fi
  tr '\0' '\n' <"$tmp"
  status=$?
  rm -f "$tmp"
  return "$status"
}

path_policy_args_have_match() {
  local query="$1"
  local tmp
  shift

  [ "$#" -gt 0 ] || return 1
  tmp=$(mktemp "${TMPDIR:-/tmp}/musi-test-scripts-policy.XXXXXX") || return 2
  if ! printf '%s\0' "$@" | "$PATH_POLICY_BUN" --config=/dev/null "$PATH_POLICY_QUERY" "$query" >"$tmp"; then
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

resolve_changed_ref() {
  local base="main"
  if git rev-parse --verify "$base" >/dev/null 2>&1; then
    printf '%s\n' "$base"
    return 0
  fi
  if git rev-parse --verify "origin/$base" >/dev/null 2>&1; then
    printf '%s\n' "origin/$base"
    return 0
  fi
  return 1
}

read_changed_files() {
  if [ -n "${MUSI_SCRIPTS_CHANGED_FILES:-}" ]; then
    printf '%s\n' "$MUSI_SCRIPTS_CHANGED_FILES"
    return 0
  fi
  local ref
  ref="$(resolve_changed_ref)" || return 1
  git diff --name-only --diff-filter=ACMRD "$ref"...HEAD 2>/dev/null || true
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    git diff --name-only --diff-filter=ACMRD HEAD 2>/dev/null || true
  fi
}

read_deleted_files() {
  if [ -n "${MUSI_SCRIPTS_DELETED_FILES:-}" ]; then
    printf '%s\n' "$MUSI_SCRIPTS_DELETED_FILES"
    return 0
  fi
  if [ -n "${MUSI_SCRIPTS_CHANGED_FILES:-}" ]; then
    return 0
  fi
  local ref
  ref="$(resolve_changed_ref)" || return 1
  git diff --name-only --diff-filter=D "$ref"...HEAD 2>/dev/null || true
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    git diff --name-only --diff-filter=D HEAD 2>/dev/null || true
  fi
}

select_smoke_tests() {
  if [ "$CHANGED" -eq 0 ]; then
    path_policy_query_lines script-smoke-test-names < /dev/null
    return $?
  fi
  if [ -z "${MUSI_SCRIPTS_CHANGED_FILES:-}" ] && ! resolve_changed_ref >/dev/null; then
    printf "test:scripts: neither 'main' nor 'origin/main' exists — running full smoke suite.\n" >&2
    path_policy_query_lines script-smoke-test-names < /dev/null
    return $?
  fi
  local f deletion_match
  local -a changed=()
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    changed+=("$f")
  done < <(read_changed_files)
  if [ "${#changed[@]}" -eq 0 ]; then
    return 0
  fi
  local -a deleted=()
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    deleted+=("$f")
  done < <(read_deleted_files)
  deletion_match=0
  path_policy_args_have_match deletion-class:script-smoke-sensitive "${deleted[@]}" || deletion_match=$?
  if [ "$deletion_match" -eq 0 ]; then
    printf "test:scripts: script deletion staged — running full smoke suite.\n" >&2
    path_policy_query_lines script-smoke-test-names < /dev/null
    return $?
  fi
  if [ "$deletion_match" -gt 1 ]; then
    return "$deletion_match"
  fi
  printf '%s\0' "${changed[@]}" | path_policy_query_lines script-smoke-tests
}

SELECTED=()
selection_tmp=$(mktemp "${TMPDIR:-/tmp}/musi-test-scripts-selection.XXXXXX") || exit 2
if ! select_smoke_tests >"$selection_tmp"; then
  rm -f "$selection_tmp"
  exit 2
fi
mapfile -t SELECTED <"$selection_tmp"
rm -f "$selection_tmp"

if [ "${#SELECTED[@]}" -eq 0 ]; then
  if [ "$CHANGED" -eq 1 ]; then
    echo "test:scripts: no script smoke tests selected by changed file set."
    exit 0
  fi
  echo "test:scripts: no smoke tests configured."
  exit 0
fi

RUNNER="${MUSI_SCRIPTS_RUNNER:-bash}"
LOG_DIR="${MUSI_SCRIPTS_LOG_DIR:-/tmp/musi-test-scripts-logs}"
LOG_TAIL_LINES=30

default_scripts_concurrency() {
  local cpu_count

  cpu_count="$(nproc 2>/dev/null)" || cpu_count=4
  if [[ ! "$cpu_count" =~ ^[1-9][0-9]*$ ]]; then
    cpu_count=4
  fi
  if [ "$cpu_count" -lt 8 ]; then
    printf '%s\n' "$cpu_count"
    return 0
  fi
  printf '8\n'
}

resolve_scripts_concurrency() {
  local concurrency="${MUSI_SCRIPTS_CONCURRENCY:-}"

  if [ -z "$concurrency" ]; then
    default_scripts_concurrency
    return 0
  fi
  if [[ ! "$concurrency" =~ ^[1-9][0-9]*$ ]]; then
    printf 'test:scripts: MUSI_SCRIPTS_CONCURRENCY must be a positive integer, got: %s\n' \
      "$concurrency" >&2
    return 2
  fi
  printf '%s\n' "$concurrency"
}

summarize_selected_smokes() {
  local passed="" failed="" name status

  for name in "${SELECTED[@]}"; do
    if [ -v "SMOKE_STATUS[$name]" ]; then
      status="${SMOKE_STATUS[$name]}"
      if [ "$status" -eq 0 ]; then
        passed="$passed $name"
      else
        failed="$failed $name"
      fi
    fi
  done

  if [ -n "$failed" ]; then
    printf '\ntest:scripts: FAILED — passed:%s failed:%s\n' "$passed" "$failed" >&2
    return 1
  fi

  printf 'test:scripts: OK —%s\n' "$passed"
}

run_selected_sequential() {
  local name passed="" failed=""

  for name in "${SELECTED[@]}"; do
    printf 'test:scripts: running %s...\n' "$name"
    if env -u GIT_DIR -u GIT_INDEX_FILE -u GIT_WORK_TREE -u GIT_PREFIX -u GIT_COMMON_DIR \
      "$RUNNER" "scripts/$name.sh"; then
      passed="$passed $name"
      continue
    fi
    failed="$failed $name"
    printf 'test:scripts: %s FAILED\n' "$name" >&2
    break
  done

  if [ -n "$failed" ]; then
    printf '\ntest:scripts: FAILED — passed:%s failed:%s\n' "$passed" "$failed" >&2
    return 1
  fi

  printf 'test:scripts: OK —%s\n' "$passed"
}

musi_scripts_forward_child_signal() {
  local signal="$1"
  local pid="$2"

  trap - INT TERM
  if [ -n "$pid" ]; then
    kill -s "$signal" "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}

musi_scripts_run_logged_child() {
  local name="$1"
  local log_file="$2"
  local child_pid=""
  local exit_code=0
  local start_time end_time elapsed

  start_time="$(date +%s)"
  trap 'musi_scripts_forward_child_signal INT "$child_pid"; exit 130' INT
  trap 'musi_scripts_forward_child_signal TERM "$child_pid"; exit 143' TERM

  env -u GIT_DIR -u GIT_INDEX_FILE -u GIT_WORK_TREE -u GIT_PREFIX -u GIT_COMMON_DIR \
    --default-signal=INT --default-signal=TERM \
    "$RUNNER" "scripts/$name.sh" >"$log_file" 2>&1 &
  child_pid=$!
  wait "$child_pid" || exit_code=$?

  trap - INT TERM
  end_time="$(date +%s)"
  elapsed=$((end_time - start_time))
  if [ "$exit_code" -eq 0 ]; then
    printf 'test:scripts: %s OK (%ss)\n' "$name" "$elapsed"
  else
    printf 'test:scripts: %s FAILED (%ss)\n' "$name" "$elapsed" >&2
  fi
  exit "$exit_code"
}

ACTIVE_PIDS=()
ACTIVE_NAMES=()
NEXT_SMOKE_INDEX=0
STOP_STARTING=0
declare -A SMOKE_STATUS=()
declare -A SMOKE_LOGS=()

musi_scripts_wait_active_with_signal() {
  local signal="$1"
  local exit_code="$2"
  local pid

  trap - INT TERM
  STOP_STARTING=1
  for pid in "${ACTIVE_PIDS[@]}"; do
    kill -s "$signal" "$pid" 2>/dev/null || true
  done
  for pid in "${ACTIVE_PIDS[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
  exit "$exit_code"
}

musi_scripts_on_sigint() {
  musi_scripts_wait_active_with_signal INT 130
}

musi_scripts_on_sigterm() {
  musi_scripts_wait_active_with_signal TERM 143
}

musi_scripts_remove_active_pid() {
  local pid="$1"
  local index

  for index in "${!ACTIVE_PIDS[@]}"; do
    if [ "${ACTIVE_PIDS[$index]}" = "$pid" ]; then
      unset 'ACTIVE_PIDS[$index]'
      unset 'ACTIVE_NAMES[$index]'
      ACTIVE_PIDS=("${ACTIVE_PIDS[@]}")
      ACTIVE_NAMES=("${ACTIVE_NAMES[@]}")
      return 0
    fi
  done
  return 1
}

musi_scripts_name_for_pid() {
  local pid="$1"
  local index

  for index in "${!ACTIVE_PIDS[@]}"; do
    if [ "${ACTIVE_PIDS[$index]}" = "$pid" ]; then
      printf '%s\n' "${ACTIVE_NAMES[$index]}"
      return 0
    fi
  done
  return 1
}

musi_scripts_start_next() {
  local name log_file

  name="${SELECTED[$NEXT_SMOKE_INDEX]}"
  log_file="$LOG_DIR/$name.log"
  : >"$log_file" || return 1
  SMOKE_LOGS["$name"]="$log_file"
  printf 'test:scripts: running %s...\n' "$name"
  musi_scripts_run_logged_child "$name" "$log_file" &
  ACTIVE_PIDS+=("$!")
  ACTIVE_NAMES+=("$name")
  NEXT_SMOKE_INDEX=$((NEXT_SMOKE_INDEX + 1))
}

musi_scripts_fill_slots() {
  local concurrency="$1"

  while [ "$STOP_STARTING" -eq 0 ] \
    && [ "${#ACTIVE_PIDS[@]}" -lt "$concurrency" ] \
    && [ "$NEXT_SMOKE_INDEX" -lt "${#SELECTED[@]}" ]; do
    musi_scripts_start_next || return 1
  done
}

musi_scripts_wait_for_one() {
  local completed_pid=""
  local exit_code=0
  local name

  wait -n -p completed_pid "${ACTIVE_PIDS[@]}" || exit_code=$?
  if [ -z "$completed_pid" ]; then
    return 0
  fi
  name="$(musi_scripts_name_for_pid "$completed_pid")" || return 1
  SMOKE_STATUS["$name"]="$exit_code"
  if [ "$exit_code" -ne 0 ]; then
    STOP_STARTING=1
  fi
  musi_scripts_remove_active_pid "$completed_pid"
}

print_failed_log_tails() {
  local name log_file

  for name in "${SELECTED[@]}"; do
    if [ -v "SMOKE_STATUS[$name]" ] && [ "${SMOKE_STATUS[$name]}" -ne 0 ]; then
      log_file="${SMOKE_LOGS[$name]}"
      printf '\ntest:scripts: last %s log lines for %s (%s):\n' \
        "$LOG_TAIL_LINES" "$name" "$log_file" >&2
      tail -n "$LOG_TAIL_LINES" "$log_file" >&2 || true
    fi
  done
}

run_selected_parallel() {
  local concurrency="$1"

  mkdir -p "$LOG_DIR" || return 1
  trap musi_scripts_on_sigint INT
  trap musi_scripts_on_sigterm TERM

  musi_scripts_fill_slots "$concurrency" || return 1
  while [ "${#ACTIVE_PIDS[@]}" -gt 0 ]; do
    musi_scripts_wait_for_one || return 1
    musi_scripts_fill_slots "$concurrency" || return 1
  done

  trap - INT TERM
  if summarize_selected_smokes; then
    return 0
  fi
  print_failed_log_tails
  return 1
}

SCRIPTS_CONCURRENCY="$(resolve_scripts_concurrency)" || exit $?

if [ "$SCRIPTS_CONCURRENCY" -eq 1 ]; then
  run_selected_sequential
  exit $?
fi

run_selected_parallel "$SCRIPTS_CONCURRENCY"
