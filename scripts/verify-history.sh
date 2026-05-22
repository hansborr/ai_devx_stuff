#!/usr/bin/env bash
# Print recent persisted verify/pre-commit run metadata snapshots.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./verify-metadata.sh
. "$SCRIPT_DIR/verify-metadata.sh"

HISTORY_DIR="${MUSI_VERIFY_HISTORY_DIR:-/tmp/musi-verify-history}"
LIMIT=20

usage() {
  printf 'usage: verify-history.sh [--limit N]\n' >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --limit)
      shift
      if [ "$#" -eq 0 ]; then
        usage
        exit 2
      fi
      LIMIT="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'verify:history: unknown argument: %s\n' "$1" >&2
      usage
      exit 2
      ;;
  esac
  shift
done

case "$LIMIT" in
  ''|*[!0-9]*)
    printf 'verify:history: --limit must be a non-negative integer, got: %s\n' "$LIMIT" >&2
    exit 2
    ;;
esac

format_epoch() {
  local epoch="$1"

  date -u -d "@$epoch" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf '%s\n' "$epoch"
}

print_history_row() {
  local file="$1"
  local base file_epoch file_mode file_exit json wrapper mode start_time elapsed exit_code head start_epoch timestamp

  base="$(basename "$file")"
  file_epoch=""
  file_mode=""
  file_exit=""
  if [[ "$base" =~ ^([0-9]+)-(.+)-([0-9]+)\.json$ ]]; then
    file_epoch="${BASH_REMATCH[1]}"
    file_mode="${BASH_REMATCH[2]}"
    file_exit="${BASH_REMATCH[3]}"
  fi

  json=""
  wrapper=""
  if json=$(sed -n '1p' "$file" 2>/dev/null); then
    wrapper=$(musi_run_meta_wrapper_fragment "$json")
  fi

  mode=$(musi_run_meta_json_string_field "$wrapper" mode)
  start_time=$(musi_run_meta_json_string_field "$wrapper" start_time)
  elapsed=$(musi_run_meta_json_int_field "$wrapper" elapsed_seconds)
  exit_code=$(musi_run_meta_json_int_field "$wrapper" exit_code)
  head=$(musi_run_meta_json_string_field "$wrapper" head)

  [ -n "$mode" ] || mode="$file_mode"
  [ -n "$exit_code" ] || exit_code="$file_exit"
  [ -n "$elapsed" ] || elapsed="?"
  [ -n "$head" ] || head="-"
  if [ "$head" != "-" ]; then
    head="${head:0:8}"
  fi

  if start_epoch=$(musi_run_meta_start_epoch "$start_time" "$elapsed"); then
    timestamp=$(format_epoch "$start_epoch")
  elif [ -n "$file_epoch" ]; then
    timestamp=$(format_epoch "$file_epoch")
  else
    timestamp="?"
  fi

  printf '%-20s  %-22s  %5s  %7s  %s\n' "$timestamp" "${mode:--}" "${exit_code:--}" "${elapsed}s" "$head"
}

printf '%-20s  %-22s  %5s  %7s  %s\n' TIMESTAMP MODE EXIT ELAPSED HEAD

[ "$LIMIT" -gt 0 ] || exit 0
[ -d "$HISTORY_DIR" ] || exit 0

count=0
while IFS= read -r file; do
  [ -n "$file" ] || continue
  [ "$count" -lt "$LIMIT" ] || break
  print_history_row "$file"
  count=$((count + 1))
done < <(find "$HISTORY_DIR" -maxdepth 1 -type f -name '*.json' | sort -r)
