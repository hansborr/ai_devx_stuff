#!/bin/bash

# Shared edited-path extraction for PostToolUse hooks. Source after common.sh
# (for ai_payload_command / ai_payload_file_path). Handles both the Codex
# apply_patch envelope (Add/Update/Delete File + Move to headers) and the Claude
# Edit|Write file_path. Adapter-neutral: callers resolve, filter, and dedup.

ai_edited_payload_tool_name() {
  local payload="$1"
  printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true
}

ai_edited_patch_paths() {
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

ai_edited_payload_paths() {
  local payload="$1"
  local tool_name file command

  tool_name=$(ai_edited_payload_tool_name "$payload")
  if [ "$tool_name" = "apply_patch" ]; then
    command=$(ai_payload_command "$payload")
    ai_edited_patch_paths "$command"
    return 0
  fi

  file=$(ai_payload_file_path "$payload")
  [ -n "$file" ] && printf '%s\n' "$file"
}

ai_resolve_edited_payload_path() {
  local payload="$1" path="$2" repo_root="$3"
  local candidate

  if [[ "$path" = /* ]]; then
    printf '%s\n' "$path"
    return 0
  fi

  if [ "$(ai_edited_payload_tool_name "$payload")" = "apply_patch" ]; then
    candidate="$PWD/$path"
    if [ -e "$candidate" ]; then
      realpath "$candidate" 2>/dev/null || printf '%s\n' "$candidate"
      return 0
    fi
  fi

  printf '%s\n' "$repo_root/$path"
}
