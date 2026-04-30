#!/bin/bash
# Run ESLint only on files changed vs the base branch (plus staged/unstaged).
# Exits 0 with a no-op message when no lintable files changed.
set -eu

BASE="${1:-main}"

# Resolve the base ref: prefer local, fall back to origin/<base>.
if git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  :
elif git rev-parse --verify "origin/$BASE" >/dev/null 2>&1; then
  BASE="origin/$BASE"
else
  echo "lint:changed: neither '$BASE' nor 'origin/$BASE' exists — running full lint instead." >&2
  exec eslint --cache --cache-location node_modules/.cache/eslint/ .
fi

# Collect changed + staged + unstaged files (NUL-delimited for space-safety),
# filter to lintable extensions and existing files, deduplicate.
declare -A SEEN
FILES=()
while IFS= read -r -d '' f; do
  case "$f" in
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) ;;
    *) continue ;;
  esac
  [ -f "$f" ] || continue
  [ -n "${SEEN[$f]:-}" ] && continue
  SEEN[$f]=1
  FILES+=("$f")
done < <(
  {
    git diff -z --name-only --diff-filter=ACMR "$BASE"...HEAD
    git diff -z --name-only --diff-filter=ACMR
    git diff -z --name-only --diff-filter=ACMR --cached
  }
)

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "No changed lintable files vs $BASE — skipping lint."
  exit 0
fi

echo "Linting ${#FILES[@]} changed file(s)..."
exec eslint --cache --cache-location node_modules/.cache/eslint/ --no-warn-ignored "${FILES[@]}"
