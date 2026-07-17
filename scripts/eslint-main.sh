#!/usr/bin/env bash
# Run the type-aware main ESLint surface in four strictly sequential processes
# so each package ProjectService program becomes collectible before the next
# scope starts. Never add ESLint --concurrency here: worker isolates duplicate
# the type program and have already OOM-killed the 16 GB host (note 73).
set -u -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=scripts/lib/eslint-main-cache.sh
. "$SCRIPT_DIR/lib/eslint-main-cache.sh"
# shellcheck source=scripts/lib/eslint-main-partitions.sh
. "$SCRIPT_DIR/lib/eslint-main-partitions.sh"

usage() {
  cat >&2 <<EOF
usage: $0 --full
       $0 --changed <path>...
       $0 --partition <name> [--format json]

  --full accepts no forwarded ESLint arguments. Replaying targets, output
  files, or stdout formats across partitions would break exclusivity or output.
  --changed classifies each path into its owning partition and runs nonempty
  partitions sequentially. --partition is diagnostic-only; it optionally emits
  one partition's JSON for parity measurements.
EOF
  exit 2
}

reject_full_args() {
  printf 'eslint-main: partitioned full lint accepts no forwarded ESLint arguments; got:' >&2
  printf ' <%s>' "$@" >&2
  printf '\n' >&2
  usage
}

validate_partition_args() {
  if [ "$#" -eq 0 ] \
    || { [ "$#" -eq 2 ] && [ "$1" = --format ] && [ "$2" = json ]; } \
    || { [ "$#" -eq 1 ] && [ "$1" = --format=json ]; }; then
    return 0
  fi
  printf 'eslint-main: --partition accepts only the diagnostic JSON format option\n' >&2
  usage
}

run_full_partition() {
  local partition="$1"
  local partition_exit=0

  musi_eslint_main_full_partition_args "$partition" || return $?
  musi_eslint_main_cache_args_for_key "$partition" || return $?
  eslint --max-warnings=0 \
    "${MUSI_ESLINT_MAIN_CACHE_ARGS[@]}" \
    "${MUSI_ESLINT_MAIN_PARTITION_ARGS[@]}" \
    "${PARTITION_ESLINT_ARGS[@]}" || partition_exit=$?
  return "$partition_exit"
}

run_changed_partition() {
  local partition="$1" file owner
  shift
  local partition_exit=0
  local -a partition_files=()

  for file in "$@"; do
    owner="$(musi_eslint_main_partition_for_path "$file")" || return $?
    if [ "$owner" = "$partition" ]; then
      partition_files+=("$file")
    fi
  done
  [ "${#partition_files[@]}" -gt 0 ] || return 0

  musi_eslint_main_cache_args_for_key "$partition" || return $?
  eslint --max-warnings=0 --no-warn-ignored \
    "${MUSI_ESLINT_MAIN_CACHE_ARGS[@]}" -- \
    "${partition_files[@]}" || partition_exit=$?
  return "$partition_exit"
}

run_all_partitions() {
  local runner="$1" partition partition_exit exit_code=0
  shift

  for partition in "${MUSI_ESLINT_MAIN_PARTITIONS[@]}"; do
    partition_exit=0
    "$runner" "$partition" "$@" || partition_exit=$?
    if [ "$partition_exit" -gt "$exit_code" ]; then
      exit_code="$partition_exit"
    fi
  done
  return "$exit_code"
}

[ "$#" -gt 0 ] || usage
mode="$1"
shift

case "$mode" in
  --full)
    [ "$#" -eq 0 ] || reject_full_args "$@"
    PARTITION_ESLINT_ARGS=()
    musi_eslint_main_cache_prepare "$REPO_ROOT" || exit $?
    run_all_partitions run_full_partition
    exit $?
    ;;
  --changed)
    [ "$#" -gt 0 ] || usage
    musi_eslint_main_cache_prepare "$REPO_ROOT" || exit $?
    run_all_partitions run_changed_partition "$@"
    exit $?
    ;;
  --partition)
    [ "$#" -gt 0 ] || usage
    partition="$1"
    shift
    validate_partition_args "$@"
    PARTITION_ESLINT_ARGS=("$@")
    musi_eslint_main_cache_prepare "$REPO_ROOT" || exit $?
    run_full_partition "$partition"
    exit $?
    ;;
  *) usage ;;
esac
