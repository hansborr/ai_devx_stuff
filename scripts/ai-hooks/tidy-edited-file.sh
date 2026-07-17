#!/bin/bash
# Shared post-edit per-file formatter/autofix hook for agent adapters.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
REPO_ROOT=$(realpath -m "$REPO_ROOT")
# Git common dir shared by every worktree of this repository. An edited file is
# treated as in-repo (and formatted like a primary edit) exactly when the
# worktree containing it shares this common dir, so a sibling drain-lane
# worktree is first-class and an unrelated checkout is skipped.
REPO_COMMON=$(git -C "$REPO_ROOT" rev-parse --git-common-dir 2>/dev/null || printf '%s' "$REPO_ROOT/.git")
case "$REPO_COMMON" in
  /*) : ;;
  *) REPO_COMMON="$REPO_ROOT/$REPO_COMMON" ;;
esac
REPO_COMMON=$(realpath -m "$REPO_COMMON")
# shellcheck source=/dev/null
. "$SCRIPT_DIR/common.sh"

# Base directory relative edited paths resolve against. Defaults to the hook's
# own checkout; ai_tidy_hook_main upgrades it to the payload's shell cwd when
# present so a lane edit's relative paths resolve inside the lane.
AI_TIDY_BASE_DIR="$REPO_ROOT"

AI_TIDY_MAX_OUTPUT_LINES="${AI_TIDY_MAX_OUTPUT_LINES:-30}"
AI_TIDY_SKIP_MISSING_DELETED="missing/deleted file"

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
    realpath -m -- "$AI_TIDY_BASE_DIR/$path"
  fi
}

ai_tidy_relative_path() {
  local path="$1"
  local root="${2:-$REPO_ROOT}"

  if [ "$path" = "$root" ]; then
    printf '.'
  else
    printf '%s' "${path#"$root"/}"
  fi
}

# The worktree root that contains ABS, but only when that worktree belongs to
# THIS repository — i.e. it shares REPO_COMMON. A sibling worktree of the same
# repo (a drain lane) resolves to its own root; a path in an unrelated
# repository, or no repository at all, returns non-zero so the caller skips it
# as outside the repository. ABS may not exist yet (a fresh Add/Write), so the
# search climbs to the nearest existing ancestor before asking Git.
ai_tidy_file_root() {
  local abs="$1"
  local dir root common

  dir=$(dirname -- "$abs")
  while [ ! -d "$dir" ]; do
    case "$dir" in
      /|.|"") return 1 ;;
    esac
    dir=$(dirname -- "$dir")
  done

  root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || return 1
  common=$(git -C "$dir" rev-parse --git-common-dir 2>/dev/null) || return 1
  # A relative common dir is relative to the directory git ran in ($dir), not to
  # the worktree root; resolve it there before comparing.
  case "$common" in
    /*) : ;;
    *) common="$dir/$common" ;;
  esac
  [ "$(realpath -m -- "$common")" = "$REPO_COMMON" ] || return 1
  printf '%s' "$root"
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
  local absolute_path="$1"
  local file_root="$2"
  local real_path classify_path

  # .git / node_modules segments are unsupported in any worktree. Classify from
  # the file-root-relative path when the root is known so a repo checked out
  # under an out-of-repo prefix that itself contains a `.git`/`node_modules`
  # segment (e.g. .../node_modules/some-repo/...) is not mistaken for an
  # in-repo unsupported path; fall back to the absolute path when the root is
  # unknown (the "outside repository" branch below then handles it).
  classify_path="$absolute_path"
  if [ -n "$file_root" ]; then
    classify_path="${absolute_path#"$file_root"/}"
  fi
  if ai_tidy_path_segment_unsupported "$classify_path"; then
    printf 'unsupported path'
    return 0
  fi

  if [ -z "$file_root" ]; then
    printf 'outside repository'
    return 0
  fi

  if [ ! -e "$absolute_path" ]; then
    printf '%s' "$AI_TIDY_SKIP_MISSING_DELETED"
    return 0
  fi

  if [ ! -f "$absolute_path" ]; then
    printf 'not a regular file'
    return 0
  fi

  # A symlink must not lead the formatter out of every worktree of this repo.
  real_path=$(realpath -- "$absolute_path" 2>/dev/null || true)
  if [ -n "$real_path" ] && ! ai_tidy_file_root "$real_path" >/dev/null; then
    printf 'outside repository'
    return 0
  fi

  if ai_tidy_binary_file "$absolute_path"; then
    printf 'binary file'
    return 0
  fi

  return 1
}

ai_tidy_run_file() {
  local absolute_path="$1"
  local file_root="$2"
  local relative_path prettier_output prettier_status
  local eslint_output eslint_status before_hash after_hash
  local prettier_bin eslint_bin

  relative_path=$(ai_tidy_relative_path "$absolute_path" "$file_root")
  before_hash=$(git -C "$file_root" hash-object --no-filters -- "$absolute_path" 2>/dev/null || true)

  # Run the file's own worktree tools from that worktree so a lane edit picks up
  # the lane's prettier/eslint config exactly like a primary edit does; fall back
  # to the hook checkout's binaries if the lane has not installed its own yet.
  prettier_bin="$file_root/node_modules/.bin/prettier"
  [ -x "$prettier_bin" ] || prettier_bin="$REPO_ROOT/node_modules/.bin/prettier"
  eslint_bin="$file_root/node_modules/.bin/eslint"
  [ -x "$eslint_bin" ] || eslint_bin="$REPO_ROOT/node_modules/.bin/eslint"

  prettier_output=$(cd "$file_root" && "$prettier_bin" --write --ignore-unknown "$absolute_path" 2>&1)
  prettier_status=$?

  eslint_output=""
  eslint_status=0
  if ai_tidy_eslint_supported "$absolute_path"; then
    eslint_output=$(cd "$file_root" && "$eslint_bin" --fix --no-warn-ignored "$absolute_path" 2>&1)
    eslint_status=$?
  fi

  if [ "$prettier_status" -eq 0 ] && [ "$eslint_status" -eq 0 ]; then
    after_hash=$(git -C "$file_root" hash-object --no-filters -- "$absolute_path" 2>/dev/null || true)
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
  local payload message result skip_reason path payload_cwd absolute_path file_root
  local -a paths=()
  local -A seen=()

  if [ "${SKIP_TIDY_HOOK:-0}" = "1" ]; then
    ai_emit_additional_context "PostToolUse" "tidy-edited-file: skipped because SKIP_TIDY_HOOK=1"
  fi

  payload=$(ai_read_payload)

  # Relative edited paths resolve against the payload's shell cwd when present (a
  # lane edit's paths are lane-relative), else the hook's own checkout.
  payload_cwd=$(ai_payload_cwd "$payload")
  [ -n "$payload_cwd" ] && AI_TIDY_BASE_DIR="$payload_cwd"

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
    absolute_path=$(ai_tidy_absolute_path "$path")
    file_root=$(ai_tidy_file_root "$absolute_path") || file_root=""
    if skip_reason=$(ai_tidy_skip_reason "$absolute_path" "$file_root"); then
      if [ "$skip_reason" = "$AI_TIDY_SKIP_MISSING_DELETED" ]; then
        result=""
      else
        result=$(printf 'tidy-edited-file: %s skipped (%s)\n' "$path" "$skip_reason")
      fi
    else
      result=$(ai_tidy_run_file "$absolute_path" "$file_root")
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
