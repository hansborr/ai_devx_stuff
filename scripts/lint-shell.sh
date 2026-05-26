#!/usr/bin/env bash
# ShellCheck floor for maintained shell scripts and hooks.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"
PATH_POLICY_QUERY="$SCRIPT_DIR/path-policy-query.ts"

MODE=full
BASE=main

usage() {
  cat <<'EOF'
usage: lint-shell.sh [--changed [base]]

Default: run ShellCheck over the maintained shell-script set.
--changed: run only on maintained shell scripts changed vs base plus staged
           changes. Base defaults to main, then origin/main.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --changed)
      MODE=changed
      shift
      if [ "$#" -gt 0 ]; then
        BASE="$1"
        shift
      fi
      ;;
    *)
      printf 'lint:shell: unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

declare -A SEEN
FILES=()

add_file() {
  local file="$1"

  [ -f "$file" ] || return 0
  [ -n "${SEEN[$file]:-}" ] && return 0
  SEEN[$file]=1
  FILES+=("$file")
}

collect_repo_files() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git ls-files -z --cached --others --exclude-standard | sort -z
    return 0
  fi

  while IFS= read -r -d '' file; do
    printf '%s\0' "${file#./}"
  done < <(find . -path ./.git -prune -o -type f -print0 | sort -z)
}

collect_full_files() {
  local file

  while IFS= read -r -d '' file; do
    add_file "$file"
  done < <(collect_repo_files | bun --config=/dev/null "$PATH_POLICY_QUERY" shell-surface)
}

resolve_base_ref() {
  if git rev-parse --verify "$BASE" >/dev/null 2>&1; then
    return 0
  fi
  if git rev-parse --verify "origin/$BASE" >/dev/null 2>&1; then
    BASE="origin/$BASE"
    return 0
  fi
  return 1
}

collect_changed_files() {
  # shellcheck source=/dev/null
  . "$SCRIPT_DIR/verify-metadata.sh"

  musi_changed_gate_fail_if_unstaged "$REPO_ROOT" "lint:shell:changed"

  if ! resolve_base_ref; then
    echo "lint:shell: neither '$BASE' nor 'origin/$BASE' exists — checking full maintained shell set."
    collect_full_files
    return 0
  fi

  while IFS= read -r -d '' file; do
    add_file "$file"
  done < <(
    {
      git diff -z --name-only --diff-filter=ACMRD "$BASE"...HEAD
      git diff -z --name-only --diff-filter=ACMRD --cached
    } | bun --config=/dev/null "$PATH_POLICY_QUERY" shell-surface
  )
}

shellcheck_command() {
  local resolved

  while IFS= read -r resolved; do
    case "$resolved" in
      */node_modules/.bin/shellcheck|node_modules/.bin/shellcheck)
        continue
        ;;
    esac
    printf '%s\n' "$resolved"
    return 0
  done < <(type -P -a shellcheck 2>/dev/null || true)

  return 1
}

if [ "$MODE" = changed ]; then
  collect_changed_files
else
  collect_full_files
fi

if [ "${#FILES[@]}" -eq 0 ]; then
  if [ "$MODE" = changed ]; then
    echo "lint:shell: no staged/base changed maintained shell files vs $BASE — skipping ShellCheck."
  else
    echo "lint:shell: no maintained shell files found — skipping ShellCheck."
  fi
  exit 0
fi

SHELLCHECK_BIN="$(shellcheck_command)" || {
  cat >&2 <<'EOF'
lint:shell: shellcheck is not available.
lint:shell: install the system package with `apt install shellcheck`, then rerun this command.
EOF
  exit 1
}

if [ "$MODE" = changed ]; then
  echo "lint:shell: checking ${#FILES[@]} staged/base changed maintained shell file(s) with ShellCheck."
else
  echo "lint:shell: checking ${#FILES[@]} maintained shell file(s) with ShellCheck."
fi

exec "$SHELLCHECK_BIN" --external-sources --severity=warning "${FILES[@]}"
