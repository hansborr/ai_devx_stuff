# shellcheck shell=bash
# shellcheck disable=SC2034
# Thin argv adapter for eslint-main-cache.ts. The TypeScript module owns cache
# identity, pruning, partition validation, locations, and exact ESLint args;
# this file only transports and validates its versioned NUL-delimited records.

MUSI_ESLINT_MAIN_CACHE_ARGS=()
declare -A MUSI_ESLINT_MAIN_CACHE_PLAN_ARGS=()
declare -A MUSI_ESLINT_MAIN_CACHE_PLAN_ARG_COUNT=()

readonly MUSI_ESLINT_MAIN_CACHE_RECORD_MAGIC="musi-eslint-cache-plan-v1"
MUSI_ESLINT_MAIN_CACHE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly MUSI_ESLINT_MAIN_CACHE_LIB_DIR
readonly MUSI_ESLINT_MAIN_CACHE_CORE_DEFAULT="$MUSI_ESLINT_MAIN_CACHE_LIB_DIR/eslint-main-cache.ts"

musi_eslint_main_cache_reset_plans() {
  MUSI_ESLINT_MAIN_CACHE_ARGS=()
  MUSI_ESLINT_MAIN_CACHE_PLAN_ARGS=()
  MUSI_ESLINT_MAIN_CACHE_PLAN_ARG_COUNT=()
}

musi_eslint_main_cache_invalid_record() {
  printf 'eslint-main-cache: invalid cache-plan record: %s\n' "$1" >&2
  musi_eslint_main_cache_reset_plans
  return 2
}

musi_eslint_main_cache_load_plans() {
  local repo_root="${1:-}"
  [ -n "$repo_root" ] || {
    printf 'eslint-main-cache: repository root is required\n' >&2
    return 2
  }
  shift
  [ "$#" -gt 0 ] || {
    printf 'eslint-main-cache: at least one partition key is required\n' >&2
    return 2
  }

  local core="${MUSI_ESLINT_MAIN_CACHE_CORE:-$MUSI_ESLINT_MAIN_CACHE_CORE_DEFAULT}"
  local record_file
  record_file="$(mktemp "${TMPDIR:-/tmp}/musi-eslint-main-cache-records.XXXXXX")" || return 1
  if ! bun "$core" --shell-records "$repo_root" "$@" > "$record_file"; then
    rm -f "$record_file"
    musi_eslint_main_cache_reset_plans
    return 1
  fi

  local -a expected_keys=("$@") records=()
  mapfile -d '' -t records < "$record_file"
  rm -f "$record_file"

  [ "${records[0]:-}" = "$MUSI_ESLINT_MAIN_CACHE_RECORD_MAGIC" ] \
    || musi_eslint_main_cache_invalid_record "wrong or missing version" \
    || return $?
  local plan_count="${records[1]:-}"
  [[ "$plan_count" =~ ^[0-9]+$ ]] \
    || musi_eslint_main_cache_invalid_record "non-numeric plan count" \
    || return $?
  [ "$plan_count" -eq "${#expected_keys[@]}" ] \
    || musi_eslint_main_cache_invalid_record "plan count does not match request" \
    || return $?

  musi_eslint_main_cache_reset_plans
  # Each plan declares its own argument count, so the vector stays opaque here:
  # the adapter checks framing (key, absolute identity directory, a cache
  # location under it) and leaves the ESLint flags to the TypeScript tuple type.
  local plan_index record_index=2 key identity_directory argument_count argument_index
  local cache_location_seen
  for ((plan_index = 0; plan_index < plan_count; plan_index += 1)); do
    key="${records[record_index]:-}"
    identity_directory="${records[record_index + 1]:-}"
    argument_count="${records[record_index + 2]:-}"
    record_index=$((record_index + 3))
    [ "$key" = "${expected_keys[plan_index]}" ] \
      || musi_eslint_main_cache_invalid_record "partition key mismatch" \
      || return $?
    case "$identity_directory" in
      /*) ;;
      *) musi_eslint_main_cache_invalid_record "identity directory is not absolute" || return $? ;;
    esac
    [[ "$argument_count" =~ ^[1-9][0-9]*$ ]] \
      && [ $((record_index + argument_count)) -le "${#records[@]}" ] \
      || musi_eslint_main_cache_invalid_record "invalid or truncated argument count" \
      || return $?

    cache_location_seen=0
    for ((argument_index = 0; argument_index < argument_count; argument_index += 1)); do
      MUSI_ESLINT_MAIN_CACHE_PLAN_ARGS["$key:$argument_index"]="${records[record_index + argument_index]}"
      case "${records[record_index + argument_index]}" in
        "$identity_directory"/*) cache_location_seen=1 ;;
      esac
    done
    [ "$cache_location_seen" -eq 1 ] \
      || musi_eslint_main_cache_invalid_record "no cache location under the identity directory" \
      || return $?
    MUSI_ESLINT_MAIN_CACHE_PLAN_ARG_COUNT["$key"]="$argument_count"
    record_index=$((record_index + argument_count))
  done
  [ "$record_index" -eq "${#records[@]}" ] \
    || musi_eslint_main_cache_invalid_record "trailing fields" \
    || return $?
}

musi_eslint_main_cache_args_for_key() {
  local key="${1:-}"
  local argument_count="${MUSI_ESLINT_MAIN_CACHE_PLAN_ARG_COUNT[$key]:-}"
  [ -n "$argument_count" ] || {
    printf 'eslint-main-cache: no validated cache plan for key %s\n' "$key" >&2
    return 2
  }
  MUSI_ESLINT_MAIN_CACHE_ARGS=()
  local argument_index
  for ((argument_index = 0; argument_index < argument_count; argument_index += 1)); do
    MUSI_ESLINT_MAIN_CACHE_ARGS+=("${MUSI_ESLINT_MAIN_CACHE_PLAN_ARGS[$key:$argument_index]}")
  done
}
