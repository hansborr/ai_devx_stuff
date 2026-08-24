#!/usr/bin/env bash
# Shared decimal parser for verification memory-wait timeout policy.

musi_memory_wait_timeout_parse() {
  if [ "$#" -ne 2 ]; then
    printf 'usage: musi_memory_wait_timeout_parse <value> <label>\n' >&2
    return 2
  fi

  local value="$1" label="$2" input="$1"
  case "$value" in
    '' | *[!0-9]*)
      printf '%s: invalid MUSI_VERIFY_MEMORY_WAIT_TIMEOUT=%s; expected whole seconds\n' \
        "$label" "$input" >&2
      return 2
      ;;
  esac

  while [ "${value#0}" != "$value" ]; do
    value="${value#0}"
  done
  value="${value:-0}"

  # shellcheck disable=SC2071 # Equal-length decimal strings compare lexically before any integer parse.
  if [ "${#value}" -gt 19 ] \
     || { [ "${#value}" -eq 19 ] \
          && [[ "$value" > 9223372036854775807 ]]; }; then
    printf '%s: invalid MUSI_VERIFY_MEMORY_WAIT_TIMEOUT=%s; value exceeds the supported whole-second range\n' \
      "$label" "$input" >&2
    return 2
  fi

  printf '%s\n' "$value"
}
