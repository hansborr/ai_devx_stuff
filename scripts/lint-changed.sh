#!/bin/bash
# Run ESLint only on files changed vs the base branch plus staged changes.
# Exits 0 with a no-op message when no lintable files changed.
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/verify-metadata.sh"
LINT_SHELL="$SCRIPT_DIR/lint-shell.sh"
LINT_CONFIG_SENSORS="$SCRIPT_DIR/lint-config-sensors.sh"

BASE="${1:-main}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

musi_changed_gate_fail_if_unstaged "$REPO_ROOT" "lint:changed"

# Resolve the base ref: prefer local, fall back to origin/<base>.
if git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  :
elif git rev-parse --verify "origin/$BASE" >/dev/null 2>&1; then
  BASE="origin/$BASE"
else
  echo "lint:changed: neither '$BASE' nor 'origin/$BASE' exists — checking full repo working tree with ShellCheck, config sensors, and eslint." >&2
  bash "$LINT_SHELL"
  bash "$LINT_CONFIG_SENSORS"
  exec eslint --cache --cache-location node_modules/.cache/eslint/ --max-warnings=0 .
fi

# Collect base + staged files (NUL-delimited for space-safety), filter to
# lintable extensions and existing files, deduplicate. Unstaged source-relevant
# changes are rejected above instead of being mixed into this selection.
declare -A SEEN
FILES=()
FULL_LINT=0
while IFS= read -r -d '' f; do
  case "$f" in
    bun.lock|package.json|eslint.config.*|tsconfig*.json|.yamllint.yml|packages/*/package.json|packages/*/tsconfig*.json|eslint-rules/*)
      FULL_LINT=1
      ;;
  esac

  case "$f" in
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.jsonc) ;;
    *) continue ;;
  esac
  [ -f "$f" ] || continue
  [ -n "${SEEN[$f]:-}" ] && continue
  SEEN[$f]=1
  FILES+=("$f")
done < <(
  {
    git diff -z --name-only --diff-filter=ACMRD "$BASE"...HEAD
    git diff -z --name-only --diff-filter=ACMRD --cached
  }
)

if [ "$FULL_LINT" -eq 1 ]; then
  echo "lint:changed: lint-affecting staged/base config changed — checking full repo working tree with ShellCheck, config sensors, and eslint."
  bash "$LINT_SHELL"
  bash "$LINT_CONFIG_SENSORS"
  exec eslint --cache --cache-location node_modules/.cache/eslint/ --max-warnings=0 .
fi

bash "$LINT_SHELL" --changed "$BASE"
bash "$LINT_CONFIG_SENSORS" --changed "$BASE"

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "lint:changed: no staged/base changed lintable files vs $BASE — skipping lint."
  exit 0
fi

echo "lint:changed: checking ${#FILES[@]} staged/base changed working-tree file(s) with eslint."
exec eslint --cache --cache-location node_modules/.cache/eslint/ --max-warnings=0 --no-warn-ignored "${FILES[@]}"
