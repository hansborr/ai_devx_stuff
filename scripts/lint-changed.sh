#!/bin/bash
# Run ESLint only on files changed vs the base branch plus staged changes.
# Exits 0 with a no-op message when no lintable files changed. The runtime
# import-cycle floor (drift:ai import-cycles) always runs whole-tree: a cycle
# is a global property, and the ~1.2s detector is parallel-masked.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/lib/verify-metadata.sh"
# shellcheck source=scripts/lib/parallel-runner.sh
. "$SCRIPT_DIR/lib/parallel-runner.sh"
# shellcheck source=scripts/lib/changed-base.sh
. "$SCRIPT_DIR/lib/changed-base.sh"
# shellcheck source=scripts/lib/lint-dist-preflight.sh
. "$SCRIPT_DIR/lib/lint-dist-preflight.sh"
# shellcheck source=scripts/lib/eslint-main-cache.sh
. "$SCRIPT_DIR/lib/eslint-main-cache.sh"
LINT_SHELL="$SCRIPT_DIR/lint-shell.sh"
LINT_CONFIG_SENSORS="$SCRIPT_DIR/lint-config-sensors.sh"
LINT_IMPORT_CYCLES="$SCRIPT_DIR/lint-import-cycles.sh"
PATH_POLICY_QUERY="$SCRIPT_DIR/path-policy/path-policy-query.ts"

start_import_cycles_lane() {
  musi_parallel_start "import cycles" "import-cycles" bash "$LINT_IMPORT_CYCLES"
}

BASE="${1:-main}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

musi_changed_gate_fail_if_unstaged "$REPO_ROOT" "lint:changed"

path_policy_has_match() {
  local query="$1"
  shift

  IFS= read -r -d '' < <(printf '%s\0' "$@" | bun --config=/dev/null "$PATH_POLICY_QUERY" "$query")
}

run_full_lint() {
  musi_lint_dist_preflight "$REPO_ROOT"
  musi_eslint_main_cache_args "$REPO_ROOT"

  musi_parallel_init "musi-lint-changed"
  musi_parallel_install_traps

  musi_parallel_start "ShellCheck" "shell" bash "$LINT_SHELL"
  musi_parallel_start "config sensors" "config" bash "$LINT_CONFIG_SENSORS"
  start_import_cycles_lane
  musi_parallel_start "ESLint" "eslint" eslint --max-warnings=0 \
    "${MUSI_ESLINT_MAIN_CACHE_ARGS[@]}" .

  musi_parallel_wait_all "lint:changed"
  exit "$MUSI_PARALLEL_EXIT"
}

run_changed_lint() {
  if [ "${#FILES[@]}" -gt 0 ]; then
    musi_lint_dist_preflight "$REPO_ROOT"
    musi_eslint_main_cache_args "$REPO_ROOT"
  fi

  musi_parallel_init "musi-lint-changed"
  musi_parallel_install_traps

  musi_parallel_start "ShellCheck" "shell" bash "$LINT_SHELL" --changed "$BASE"
  musi_parallel_start "config sensors" "config" bash "$LINT_CONFIG_SENSORS" --changed "$BASE"
  start_import_cycles_lane

  if [ "${#FILES[@]}" -eq 0 ]; then
    echo "lint:changed: no staged/base changed lintable files vs $BASE — skipping lint."
  else
    echo "lint:changed: checking ${#FILES[@]} staged/base changed working-tree file(s) with eslint."
    musi_parallel_start "ESLint" "eslint" eslint --max-warnings=0 --no-warn-ignored \
      "${MUSI_ESLINT_MAIN_CACHE_ARGS[@]}" "${FILES[@]}"
  fi

  musi_parallel_wait_all "lint:changed"
  exit "$MUSI_PARALLEL_EXIT"
}

# Resolve the base ref and preflight the common ancestor the triple-dot
# diff needs (see scripts/lib/changed-base.sh); on failure fall back to
# the full scan.
if musi_resolve_changed_base "$BASE"; then
  BASE="$MUSI_CHANGED_BASE"
else
  echo "lint:changed: $MUSI_CHANGED_BASE_ERROR — checking full repo working tree with ShellCheck, config sensors, import cycles, and eslint." >&2
  run_full_lint
fi

# Collect base + staged files (NUL-delimited for space-safety), filter to
# lintable policy paths and existing files, deduplicate. Unstaged source-relevant
# changes are rejected above instead of being mixed into this selection.
declare -A SEEN
CHANGED_FILES=()
FILES=()
FULL_LINT=0
while IFS= read -r -d '' f; do
  CHANGED_FILES+=("$f")
done < <(
  {
    git diff -z --name-only --diff-filter=ACMRD "$BASE"...HEAD
    git diff -z --name-only --diff-filter=ACMRD --cached
  }
)

if [ "${#CHANGED_FILES[@]}" -gt 0 ] \
   && path_policy_has_match full-scan-trigger:eslint-changed "${CHANGED_FILES[@]}"; then
  FULL_LINT=1
fi

while IFS= read -r -d '' f; do
  [ -f "$f" ] || continue
  [ -n "${SEEN[$f]:-}" ] && continue
  SEEN[$f]=1
  FILES+=("$f")
done < <(printf '%s\0' "${CHANGED_FILES[@]}" | bun --config=/dev/null "$PATH_POLICY_QUERY" lintable:eslint-changed)

if [ "$FULL_LINT" -eq 1 ]; then
  echo "lint:changed: lint-affecting staged/base config changed — checking full repo working tree with ShellCheck, config sensors, import cycles, and eslint."
  run_full_lint
fi

run_changed_lint
