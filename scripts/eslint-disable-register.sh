#!/usr/bin/env bash
# Report eslint-disable usage without blocking diagnostics.
#
# Counts actual ESLint directive comments only. Prose mentions in docs are
# intentionally ignored so the register reflects suppressions contributors can
# act on in code.
set -uo pipefail

REPO_ROOT="${1:-}"
if [[ -z "$REPO_ROOT" ]]; then
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    printf 'WARN: eslint-disable register unavailable — not inside a git repository\n' >&2
    exit 0
  }
fi

if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf 'WARN: eslint-disable register unavailable — %s is not a git repository\n' "$REPO_ROOT" >&2
  exit 0
fi

PATTERN='(^|[[:space:]])(//|/\*)[[:space:]]*eslint-disable(-next-line|-line)?($|[[:space:]])'

total=0
inline=0
broad=0
missing_total=0
missing_inline=0
missing_broad=0
missing_entries=()

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

record_match() {
  local path="$1" line_no="$2" text="$3"
  local kind=broad
  if [[ "$text" == *eslint-disable-next-line* || "$text" == *eslint-disable-line* ]]; then
    kind=inline
  fi

  total=$((total + 1))
  if [[ "$kind" == inline ]]; then
    inline=$((inline + 1))
  else
    broad=$((broad + 1))
  fi

  if [[ "$text" != *"--"* ]]; then
    missing_total=$((missing_total + 1))
    if [[ "$kind" == inline ]]; then
      missing_inline=$((missing_inline + 1))
    else
      missing_broad=$((missing_broad + 1))
    fi
    missing_entries+=("$path:$line_no [$kind] $(trim "$text")")
  fi
}

while IFS= read -r -d '' file; do
  line_no=0
  while IFS= read -r text || [[ -n "$text" ]]; do
    line_no=$((line_no + 1))
    if [[ "$text" =~ $PATTERN ]]; then
      record_match "$file" "$line_no" "$text"
    fi
  done < "$REPO_ROOT/$file"
done < <(
  git -C "$REPO_ROOT" ls-files -z --cached --others --exclude-standard -- \
    '*.cjs' \
    '*.js' \
    '*.jsx' \
    '*.mjs' \
    '*.ts' \
    '*.tsx' \
    ':(exclude)docs/**' \
    ':(exclude)node_modules/**' \
    ':(exclude)packages/server/prisma/generated/**'
)

printf 'PASS: eslint-disable register total=%d inline=%d broad=%d\n' \
  "$total" "$inline" "$broad"

if (( missing_total > 0 )); then
  printf 'WARN: eslint-disable register missing reasons total=%d inline=%d broad=%d — add '"'"'-- reason'"'"' to each directive\n' \
    "$missing_total" "$missing_inline" "$missing_broad"
  for entry in "${missing_entries[@]}"; do
    printf '  - %s\n' "$entry"
  done
else
  printf 'PASS: eslint-disable register all suppressions include -- reason\n'
fi

exit 0
