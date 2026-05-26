#!/bin/bash
# Run ESLint only on files changed vs the base branch plus staged changes.
# Exits 0 with a no-op message when no lintable files changed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/verify-metadata.sh"
# shellcheck source=scripts/parallel-runner.sh
. "$SCRIPT_DIR/parallel-runner.sh"
LINT_SHELL="$SCRIPT_DIR/lint-shell.sh"
LINT_CONFIG_SENSORS="$SCRIPT_DIR/lint-config-sensors.sh"
PATH_POLICY_QUERY="$SCRIPT_DIR/path-policy-query.ts"

BASE="${1:-main}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

musi_changed_gate_fail_if_unstaged "$REPO_ROOT" "lint:changed"

path_policy_has_match() {
  local query="$1"
  shift

  IFS= read -r -d '' < <(printf '%s\0' "$@" | bun --config=/dev/null "$PATH_POLICY_QUERY" "$query")
}

run_full_lint() {
  musi_parallel_init "musi-lint-changed"
  musi_parallel_install_traps

  musi_parallel_start "ShellCheck" "shell" bash "$LINT_SHELL"
  musi_parallel_start "config sensors" "config" bash "$LINT_CONFIG_SENSORS"
  musi_parallel_start "ESLint" "eslint" eslint --cache --cache-location node_modules/.cache/eslint/ --max-warnings=0 .

  musi_parallel_wait_all "lint:changed"
  exit "$MUSI_PARALLEL_EXIT"
}

run_changed_lint() {
  musi_parallel_init "musi-lint-changed"
  musi_parallel_install_traps

  musi_parallel_start "ShellCheck" "shell" bash "$LINT_SHELL" --changed "$BASE"
  musi_parallel_start "config sensors" "config" bash "$LINT_CONFIG_SENSORS" --changed "$BASE"

  if [ "${#FILES[@]}" -eq 0 ]; then
    echo "lint:changed: no staged/base changed lintable files vs $BASE — skipping lint."
  else
    echo "lint:changed: checking ${#FILES[@]} staged/base changed working-tree file(s) with eslint."
    musi_parallel_start "ESLint" "eslint" eslint --cache --cache-location node_modules/.cache/eslint/ --max-warnings=0 --no-warn-ignored "${FILES[@]}"
  fi

  musi_parallel_wait_all "lint:changed"
  exit "$MUSI_PARALLEL_EXIT"
}

# Resolve the base ref: prefer local, fall back to origin/<base>.
if git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  :
elif git rev-parse --verify "origin/$BASE" >/dev/null 2>&1; then
  BASE="origin/$BASE"
else
  echo "lint:changed: neither '$BASE' nor 'origin/$BASE' exists — checking full repo working tree with ShellCheck, config sensors, and eslint." >&2
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
  echo "lint:changed: lint-affecting staged/base config changed — checking full repo working tree with ShellCheck, config sensors, and eslint."
  run_full_lint
fi

run_changed_lint
