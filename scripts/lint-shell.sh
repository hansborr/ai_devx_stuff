#!/usr/bin/env bash
# ShellCheck floor for maintained shell scripts and hooks.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

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

is_maintained_shell_path() {
  local path="$1" rest

  case "$path" in
    node_modules/*|*/node_modules/*|worktrees/*|*/worktrees/*|.playwright-cli/*|*/.playwright-cli/*|.husky/_/*)
      return 1
      ;;
    scripts/*.sh)
      return 0
      ;;
    .husky/*)
      rest="${path#.husky/}"
      case "$rest" in
        */*) return 1 ;;
        *) return 0 ;;
      esac
      ;;
    .codex/hooks/*.sh)
      rest="${path#.codex/hooks/}"
      case "$rest" in
        */*) return 1 ;;
        *) return 0 ;;
      esac
      ;;
    .claude/hooks/*.sh)
      rest="${path#.claude/hooks/}"
      case "$rest" in
        */*) return 1 ;;
        *) return 0 ;;
      esac
      ;;
    .devcontainer/*.sh)
      rest="${path#.devcontainer/}"
      case "$rest" in
        */*) return 1 ;;
        *) return 0 ;;
      esac
      ;;
  esac

  return 1
}

add_file() {
  local file="$1"

  is_maintained_shell_path "$file" || return 0
  [ -f "$file" ] || return 0
  [ -n "${SEEN[$file]:-}" ] && return 0
  SEEN[$file]=1
  FILES+=("$file")
}

collect_find_results() {
  local dir="$1"
  shift
  [ -d "$dir" ] || return 0
  while IFS= read -r -d '' file; do
    add_file "$file"
  done < <(find "$dir" "$@" -print0 | sort -z)
}

collect_full_files() {
  collect_find_results scripts -type f -name '*.sh' \
    -not -path '*/node_modules/*' \
    -not -path '*/worktrees/*' \
    -not -path '*/.playwright-cli/*'
  collect_find_results .husky -maxdepth 1 -type f
  collect_find_results .codex/hooks -maxdepth 1 -type f -name '*.sh'
  collect_find_results .claude/hooks -maxdepth 1 -type f -name '*.sh'
  collect_find_results .devcontainer -maxdepth 1 -type f -name '*.sh'
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
    }
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
