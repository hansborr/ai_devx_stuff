#!/usr/bin/env bash
# ShellCheck floor for maintained shell scripts and hooks.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/lib/verify-metadata.sh"

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
    return $?
  fi

  while IFS= read -r -d '' file; do
    printf '%s\0' "${file#./}"
  done < <(find . -path ./.git -prune -o -type f -print0 | sort -z)
}

collect_full_files() {
  local file candidates_file selected_file

  candidates_file=$(mktemp "${TMPDIR:-/tmp}/musi-lint-shell-input.XXXXXX") || return 2
  selected_file=$(mktemp "${TMPDIR:-/tmp}/musi-lint-shell-selected.XXXXXX") || {
    rm -f "$candidates_file"
    return 2
  }
  if ! collect_repo_files > "$candidates_file" \
     || ! musi_path_policy_query_nul shell-surface < "$candidates_file" > "$selected_file"; then
    printf 'lint:shell: path selection failed for shell-surface.\n' >&2
    rm -f "$candidates_file" "$selected_file"
    return 2
  fi
  while IFS= read -r -d '' file; do
    add_file "$file"
  done < "$selected_file"
  rm -f "$candidates_file" "$selected_file"
}

collect_changed_files() {
  # shellcheck source=scripts/lib/changed-base.sh
  . "$SCRIPT_DIR/lib/changed-base.sh"

  musi_changed_gate_fail_if_unstaged "$REPO_ROOT" "lint:shell:changed"

  if musi_resolve_changed_base "$BASE"; then
    BASE="$MUSI_CHANGED_BASE"
  else
    echo "lint:shell: $MUSI_CHANGED_BASE_ERROR — checking full maintained shell set." >&2
    collect_full_files
    return 0
  fi

  local candidates_file selected_file
  candidates_file=$(mktemp "${TMPDIR:-/tmp}/musi-lint-shell-changed.XXXXXX") || return 2
  selected_file=$(mktemp "${TMPDIR:-/tmp}/musi-lint-shell-selected.XXXXXX") || {
    rm -f "$candidates_file"
    return 2
  }
  if ! git diff -z --name-only --diff-filter=ACMRD "$BASE"...HEAD > "$candidates_file" \
     || ! git diff -z --name-only --diff-filter=ACMRD --cached >> "$candidates_file" \
     || ! musi_path_policy_query_nul shell-surface < "$candidates_file" > "$selected_file"; then
    printf 'lint:shell: path selection failed for shell-surface.\n' >&2
    rm -f "$candidates_file" "$selected_file"
    return 2
  fi
  while IFS= read -r -d '' file; do
    add_file "$file"
  done < "$selected_file"
  rm -f "$candidates_file" "$selected_file"
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
lint:shell: install shellcheck with your system package manager (dnf/apt/brew); see https://github.com/koalaman/shellcheck#installing, then rerun this command.
EOF
  exit 1
}

if [ "$MODE" = changed ]; then
  echo "lint:shell: checking ${#FILES[@]} staged/base changed maintained shell file(s) with ShellCheck."
else
  echo "lint:shell: checking ${#FILES[@]} maintained shell file(s) with ShellCheck."
fi

# Info floor so pattern-safety checks like SC2295 gate; these info codes are
# excluded as reviewed noise on this codebase: SC1091 (un-followable dynamic
# sources), SC2015 (intentional a && b || c), SC2016 (literal $ in single
# quotes), SC2030/SC2031 (subshell-scoped variables), SC2317 (trap/indirectly
# invoked functions read as unreachable).
SHELLCHECK_INFO_EXCLUDES="SC1091,SC2015,SC2016,SC2030,SC2031,SC2317"
exec "$SHELLCHECK_BIN" --external-sources --severity=info \
  --exclude="$SHELLCHECK_INFO_EXCLUDES" "${FILES[@]}"
