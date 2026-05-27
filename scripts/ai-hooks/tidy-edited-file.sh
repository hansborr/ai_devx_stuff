#!/bin/bash
# Shared post-edit per-file formatter/autofix hook for agent adapters.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
REPO_ROOT=$(realpath -m "$REPO_ROOT")
# shellcheck source=/dev/null
. "$SCRIPT_DIR/common.sh"

AI_TIDY_MAX_OUTPUT_LINES="${AI_TIDY_MAX_OUTPUT_LINES:-30}"

ai_tidy_payload_tool_name() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true
}

ai_tidy_patch_paths() {
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

ai_tidy_payload_paths() {
  local payload="$1"
  local tool_name file command

  tool_name=$(ai_tidy_payload_tool_name "$payload")
  if [ "$tool_name" = "apply_patch" ]; then
    command=$(ai_payload_command "$payload")
    ai_tidy_patch_paths "$command"
    return 0
  fi

  file=$(ai_payload_file_path "$payload")
  [ -n "$file" ] && printf '%s\n' "$file"
}

ai_tidy_absolute_path() {
  local path="$1"

  if [[ "$path" = /* ]]; then
    realpath -m -- "$path"
  else
    realpath -m -- "$REPO_ROOT/$path"
  fi
}

ai_tidy_relative_path() {
  local path="$1"

  if [ "$path" = "$REPO_ROOT" ]; then
    printf '.'
  else
    printf '%s' "${path#"$REPO_ROOT"/}"
  fi
}

ai_tidy_path_segment_unsupported() {
  local relative_path="$1"

  case "$relative_path" in
    .git|.git/*|*/.git|*/.git/*|node_modules|node_modules/*|*/node_modules|*/node_modules/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ai_tidy_binary_file() {
  local file="$1"

  [ -s "$file" ] || return 1
  if LC_ALL=C grep -Iq '' "$file"; then
    return 1
  fi
  return 0
}

ai_tidy_eslint_supported() {
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

ai_tidy_bounded_tail() {
  local text="$1"
  local max_lines="${2:-$AI_TIDY_MAX_OUTPUT_LINES}"
  local line_count

  line_count=$(printf '%s\n' "$text" | wc -l | tr -d ' ')
  if [ "$line_count" -gt "$max_lines" ]; then
    printf '... truncated (%s lines total; last %s lines) ...\n' "$line_count" "$max_lines"
    printf '%s\n' "$text" | tail -n "$max_lines"
  else
    printf '%s' "$text"
  fi
}

ai_tidy_skip_reason() {
  local requested_path="$1"
  local absolute_path real_path relative_path

  absolute_path=$(ai_tidy_absolute_path "$requested_path")
  case "$absolute_path" in
    "$REPO_ROOT"/*) ;;
    *) printf 'outside repository'; return 0 ;;
  esac

  relative_path=$(ai_tidy_relative_path "$absolute_path")
  if ai_tidy_path_segment_unsupported "$relative_path"; then
    printf 'unsupported path'
    return 0
  fi

  if [ ! -e "$absolute_path" ]; then
    printf 'missing/deleted file'
    return 0
  fi

  if [ ! -f "$absolute_path" ]; then
    printf 'not a regular file'
    return 0
  fi

  real_path=$(realpath -- "$absolute_path" 2>/dev/null || true)
  case "$real_path" in
    "$REPO_ROOT"/*) ;;
    *) printf 'outside repository'; return 0 ;;
  esac

  if ai_tidy_binary_file "$absolute_path"; then
    printf 'binary file'
    return 0
  fi

  return 1
}

ai_tidy_run_file() {
  local requested_path="$1"
  local absolute_path relative_path prettier_output prettier_status
  local eslint_output eslint_status before_hash after_hash

  absolute_path=$(ai_tidy_absolute_path "$requested_path")
  relative_path=$(ai_tidy_relative_path "$absolute_path")
  before_hash=$(git hash-object --no-filters -- "$absolute_path" 2>/dev/null || true)

  prettier_output=$(node_modules/.bin/prettier --write --ignore-unknown "$absolute_path" 2>&1)
  prettier_status=$?

  eslint_output=""
  eslint_status=0
  if ai_tidy_eslint_supported "$absolute_path"; then
    eslint_output=$(node_modules/.bin/eslint --fix --no-warn-ignored "$absolute_path" 2>&1)
    eslint_status=$?
  fi

  if [ "$prettier_status" -eq 0 ] && [ "$eslint_status" -eq 0 ]; then
    after_hash=$(git hash-object --no-filters -- "$absolute_path" 2>/dev/null || true)
    if [ -n "$before_hash" ] && [ -n "$after_hash" ] && [ "$before_hash" != "$after_hash" ]; then
      printf 'tidy-edited-file: %s tidied\n' "$relative_path"
    fi
    return 0
  fi

  printf 'tidy-edited-file: %s ERROR (non-blocking)\n' "$relative_path"
  if [ "$prettier_status" -ne 0 ]; then
    printf 'prettier exited %s' "$prettier_status"
    if [ -n "$prettier_output" ]; then
      printf '\n--- prettier output ---\n%s' "$(ai_tidy_bounded_tail "$prettier_output")"
    fi
    printf '\n'
  fi
  if [ "$eslint_status" -ne 0 ]; then
    printf 'eslint exited %s' "$eslint_status"
    if [ -n "$eslint_output" ]; then
      printf '\n--- eslint output ---\n%s' "$(ai_tidy_bounded_tail "$eslint_output")"
    fi
    printf '\n'
  fi
}

ai_tidy_hook_main() {
  local payload message result skip_reason path
  local -a paths=()
  local -A seen=()

  if [ "${SKIP_TIDY_HOOK:-0}" = "1" ]; then
    ai_emit_additional_context "PostToolUse" "tidy-edited-file: skipped because SKIP_TIDY_HOOK=1"
  fi

  cd "$REPO_ROOT" || ai_emit_additional_context "PostToolUse" "tidy-edited-file: skipped because repo root is unavailable: $REPO_ROOT"

  payload=$(ai_read_payload)
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if [ -z "${seen[$path]+x}" ]; then
      paths+=("$path")
      seen[$path]=1
    fi
  done < <(ai_tidy_payload_paths "$payload")

  [ "${#paths[@]}" -gt 0 ] || ai_emit_continue

  message=""
  for path in "${paths[@]}"; do
    if skip_reason=$(ai_tidy_skip_reason "$path"); then
      result=$(printf 'tidy-edited-file: %s skipped (%s)\n' "$path" "$skip_reason")
    else
      result=$(ai_tidy_run_file "$path")
    fi

    if [ -n "$result" ]; then
      if [ -n "$message" ]; then
        message="${message}"$'\n'"$result"
      else
        message="$result"
      fi
    fi
  done

  if [ -z "$message" ]; then
    ai_emit_continue
  fi
  ai_emit_additional_context "PostToolUse" "$message"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  ai_tidy_hook_main
fi
