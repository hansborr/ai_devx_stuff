#!/bin/bash
# Run Prettier only on files changed vs the base branch (plus staged/unstaged).
# Exits 0 with a no-op message when no formattable files changed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATH_POLICY_QUERY="$SCRIPT_DIR/path-policy-query.ts"

command -v prettier >/dev/null 2>&1 || { echo "format:changed: prettier not found — run 'bun install' first." >&2; exit 1; }

CHECK_MODE=0
BASE="main"
BASE_SET=0
for arg in "$@"; do
  case "$arg" in
    --check)
      CHECK_MODE=1
      ;;
    *)
      if [ "$BASE_SET" -eq 1 ]; then
        echo "format:changed: unexpected argument '$arg'." >&2
        echo "usage: format-changed.sh [--check] [base]" >&2
        exit 2
      fi
      BASE="$arg"
      BASE_SET=1
      ;;
  esac
done

PRETTIER_ACTION="--write"
ACTION_LABEL="Formatting"
SKIP_LABEL="format"
FALLBACK_LABEL="format"
if [ "$CHECK_MODE" -eq 1 ]; then
  PRETTIER_ACTION="--check"
  ACTION_LABEL="Checking formatting for"
  SKIP_LABEL="format check"
  FALLBACK_LABEL="format check"
fi

# Resolve the base ref: prefer local, fall back to origin/<base>.
if git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  :
elif git rev-parse --verify "origin/$BASE" >/dev/null 2>&1; then
  BASE="origin/$BASE"
else
  echo "format:changed: neither '$BASE' nor 'origin/$BASE' exists — running full $FALLBACK_LABEL instead." >&2
  exec prettier "$PRETTIER_ACTION" --ignore-unknown .
fi

# Collect changed + staged + unstaged files (NUL-delimited for space-safety),
# filter through shared format-candidate policy, then keep existing files and
# deduplicate. --ignore-unknown lets Prettier silently skip files it has no
# parser for (e.g. .sql, .sh, .toml).
declare -A SEEN
FILES=()
CHANGED_PATHS_TMP="$(mktemp -t musi-format-changed.paths.XXXXXX)"
FORMAT_CANDIDATES_TMP="$(mktemp -t musi-format-changed.candidates.XXXXXX)"

cleanup_format_changed_tmp() {
  rm -f "$CHANGED_PATHS_TMP" "$FORMAT_CANDIDATES_TMP"
}
trap cleanup_format_changed_tmp EXIT

{
  git diff -z --name-only --diff-filter=ACMR "$BASE"...HEAD
  git diff -z --name-only --diff-filter=ACMR
  git diff -z --name-only --diff-filter=ACMR --cached
} > "$CHANGED_PATHS_TMP"

bun --config=/dev/null "$PATH_POLICY_QUERY" format-check-candidate \
  < "$CHANGED_PATHS_TMP" > "$FORMAT_CANDIDATES_TMP"

while IFS= read -r -d '' f; do
  [ -f "$f" ] || continue
  [ -n "${SEEN[$f]:-}" ] && continue
  SEEN[$f]=1
  FILES+=("$f")
done < "$FORMAT_CANDIDATES_TMP"

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "No changed files vs $BASE — skipping $SKIP_LABEL."
  exit 0
fi

echo "$ACTION_LABEL ${#FILES[@]} changed file(s)..."
cleanup_format_changed_tmp
trap - EXIT
exec prettier "$PRETTIER_ACTION" --ignore-unknown "${FILES[@]}"
