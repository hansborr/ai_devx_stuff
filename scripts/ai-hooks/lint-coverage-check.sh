#!/bin/bash
# PostToolUse hook: warn when an edited/created file is not covered by ESLint.
#
# General-purpose: works with any ESLint config by querying ESLint's own
# resolution. No hardcoded paths or project-specific allowlists needed.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
REPO_ROOT=$(realpath -m "$REPO_ROOT")
# shellcheck source=/dev/null
. "$SCRIPT_DIR/common.sh"

ai_lint_coverage_payload_tool_name() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true
}

ai_lint_coverage_patch_paths() {
  local patch="$1"

  printf '%s\n' "$patch" | awk '
    /^\*\*\* (Add|Update|Delete) File: / {
      sub(/^\*\*\* (Add|Update|Delete) File: /, "")
      sub(/\r$/, "")
      print
      next
    }
    /^\*\*\* Move to: / {
      sub(/^\*\*\* Move to: /, "")
      sub(/\r$/, "")
      print
    }
  '
}

ai_lint_coverage_payload_paths() {
  local payload="$1"
  local tool_name file command

  tool_name=$(ai_lint_coverage_payload_tool_name "$payload")
  if [ "$tool_name" = "apply_patch" ]; then
    command=$(ai_payload_command "$payload")
    ai_lint_coverage_patch_paths "$command"
    return 0
  fi

  file=$(ai_payload_file_path "$payload")
  [ -n "$file" ] && printf '%s\n' "$file"
}

ai_lint_coverage_is_lintable() {
  local file="$1"

  case "${file,,}" in
    *.js|*.jsx|*.mjs|*.cjs|*.ts|*.tsx|*.mts|*.cts|*.json|*.jsonc|*.json5)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ai_lint_coverage_check_file() {
  local absolute_path="$1"
  local relative_path="$2"
  local config_output

  # Ask ESLint if it has config for this file. With flat config, ignored or
  # uncovered files produce the literal string "undefined".
  config_output=$(npx eslint --print-config "$absolute_path" 2>/dev/null) || true

  if [ "$config_output" = "undefined" ] || [ -z "$config_output" ]; then
    printf 'lint-coverage: WARNING - %s is NOT covered by ESLint. ' "$relative_path"
    printf 'If this file should be linted, update eslint.config.js (and any relevant tsconfig) to include it.\n'
    return 1
  fi
  return 0
}

ai_lint_coverage_main() {
  local payload path absolute_path relative_path result message
  local -a paths=()
  local -A seen=()

  cd "$REPO_ROOT" || ai_emit_continue

  payload=$(ai_read_payload)
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if [ -z "${seen[$path]+x}" ]; then
      paths+=("$path")
      seen[$path]=1
    fi
  done < <(ai_lint_coverage_payload_paths "$payload")

  [ "${#paths[@]}" -gt 0 ] || ai_emit_continue

  message=""
  for path in "${paths[@]}"; do
    if [[ "$path" = /* ]]; then
      absolute_path=$(realpath -m -- "$path")
    else
      absolute_path=$(realpath -m -- "$REPO_ROOT/$path")
    fi

    case "$absolute_path" in
      "$REPO_ROOT"/*) ;;
      *) continue ;;
    esac

    relative_path="${absolute_path#"$REPO_ROOT"/}"
    ai_lint_coverage_is_lintable "$relative_path" || continue

    case "$relative_path" in
      node_modules/*|.git/*|*/node_modules/*) continue ;;
    esac

    [ -f "$absolute_path" ] || continue

    result=$(ai_lint_coverage_check_file "$absolute_path" "$relative_path") || {
      if [ -n "$message" ]; then
        message="${message}"$'\n'"$result"
      else
        message="$result"
      fi
    }
  done

  if [ -n "$message" ]; then
    ai_emit_additional_context "PostToolUse" "$message"
  fi

  ai_emit_continue
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  ai_lint_coverage_main
fi
