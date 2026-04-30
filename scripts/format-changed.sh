#!/bin/bash
# Run Prettier only on files changed vs the base branch (plus staged/unstaged).
# Exits 0 with a no-op message when no formattable files changed.
set -eu

command -v prettier >/dev/null 2>&1 || { echo "format:changed: prettier not found — run 'bun install' first." >&2; exit 1; }

BASE="${1:-main}"

# Resolve the base ref: prefer local, fall back to origin/<base>.
if git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  :
elif git rev-parse --verify "origin/$BASE" >/dev/null 2>&1; then
  BASE="origin/$BASE"
else
  echo "format:changed: neither '$BASE' nor 'origin/$BASE' exists — running full format instead." >&2
  exec prettier --write --ignore-unknown .
fi

# Collect changed + staged + unstaged files (NUL-delimited for space-safety),
# filter to existing files, deduplicate. --ignore-unknown lets Prettier silently
# skip files it has no parser for (e.g. .sql, .sh, .toml).
declare -A SEEN
FILES=()
while IFS= read -r -d '' f; do
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
  echo "No changed files vs $BASE — skipping format."
  exit 0
fi

echo "Formatting ${#FILES[@]} changed file(s)..."
exec prettier --write --ignore-unknown "${FILES[@]}"
