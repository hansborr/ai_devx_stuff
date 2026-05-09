#!/bin/bash
# Repo-owned Vitest runner.
#
# Package scripts call this instead of invoking Vitest directly so known
# third-party warning noise is filtered for humans and agents even when no AI
# hook adapter intercepts the command.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || {
  cd "$SCRIPT_DIR/.."
  pwd
})"

# shellcheck source=/dev/null
. "$SCRIPT_DIR/ai-hooks/output-filter.sh"

ai_vitest_should_compact_success() {
  [ "${MUSI_VITEST_COMPACT_SUCCESS:-1}" != "0" ] || return 1
  [ "${MUSI_VITEST_VERBOSE_SUCCESS:-}" != "1" ] || return 1
  [ "${1:-}" = run ] || return 1
}

ai_vitest_normalize_output() {
  local esc nbsp
  esc="$(printf '\033')"
  nbsp="$(printf '\302\240')"

  LC_ALL=C sed -E \
    -e "s/${esc}\\[[0-?]*[ -/]*[@-~]//g" \
    -e "s/${nbsp}/ /g"
}

ai_vitest_summary_line() {
  local output="$1"
  local normalized tests_line files_line tests_passed files_passed

  normalized=$(printf '%s\n' "$output" | ai_vitest_normalize_output)

  if [[ "$normalized" == *"No test files found"* ]]; then
    printf 'Vitest OK: no tests found.\n'
    return 0
  fi

  tests_line=$(
    printf '%s\n' "$normalized" \
      | awk '/^[[:space:]]*Tests[[:space:]]/ { sub(/^[[:space:]]*Tests[[:space:]]+/, ""); print; exit }'
  )
  files_line=$(
    printf '%s\n' "$normalized" \
      | awk '/^[[:space:]]*Test Files[[:space:]]/ { sub(/^[[:space:]]*Test Files[[:space:]]+/, ""); print; exit }'
  )
  tests_passed=$(printf '%s\n' "$tests_line" | sed -nE 's/.*(^|[[:space:]])([0-9]+)[[:space:]]+passed([[:space:]]|$).*/\2/p' | head -n 1)
  files_passed=$(printf '%s\n' "$files_line" | sed -nE 's/.*(^|[[:space:]])([0-9]+)[[:space:]]+passed([[:space:]]|$).*/\2/p' | head -n 1)

  if [ -n "$tests_passed" ] && [ -n "$files_passed" ]; then
    printf 'Vitest OK: %s %s passed in %s %s.\n' \
      "$tests_passed" "$([ "$tests_passed" = 1 ] && printf test || printf tests)" \
      "$files_passed" "$([ "$files_passed" = 1 ] && printf file || printf files)"
    return 0
  fi

  if [ -n "$tests_line" ]; then
    printf 'Vitest OK: %s\n' "$tests_line"
    return 0
  fi

  if [ -n "$files_line" ]; then
    printf 'Vitest OK: %s\n' "$files_line"
    return 0
  fi

  printf 'Vitest OK.\n'
}

if [ -n "${MUSI_VITEST_BIN:-}" ]; then
  VITEST_CMD=("$MUSI_VITEST_BIN")
elif [ -x "$REPO_ROOT/node_modules/.bin/vitest" ]; then
  VITEST_CMD=("$REPO_ROOT/node_modules/.bin/vitest")
else
  VITEST_CMD=(vitest)
fi

if ai_vitest_should_compact_success "$@"; then
  VITEST_OUTPUT=$(mktemp /tmp/musi-vitest-output.XXXXXX)
  FILTERED_OUTPUT=$(mktemp /tmp/musi-vitest-filtered.XXXXXX)
  trap 'rm -f "$VITEST_OUTPUT" "$FILTERED_OUTPUT"' EXIT

  "${VITEST_CMD[@]}" "$@" > "$VITEST_OUTPUT" 2>&1
  EXIT_CODE=$?
  ai_filter_known_output_noise < "$VITEST_OUTPUT" > "$FILTERED_OUTPUT"

  if [ "$EXIT_CODE" -eq 0 ]; then
    ai_vitest_summary_line "$(cat "$FILTERED_OUTPUT")"
  else
    cat "$FILTERED_OUTPUT"
  fi

  exit "$EXIT_CODE"
fi

"${VITEST_CMD[@]}" "$@" 2>&1 | ai_filter_known_output_noise
exit "${PIPESTATUS[0]}"
