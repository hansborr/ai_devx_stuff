#!/bin/bash
# Shared hot-doc length advisories for agent edit/write hooks and pre-commit.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
# shellcheck source=/dev/null
. "$SCRIPT_DIR/common.sh"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/doc-length-policy.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/edited-paths.sh"

ai_doc_length_hook_main() {
  local payload path abs surface advisory combined
  local -A seen=()

  payload=$(ai_read_payload)
  path=""
  combined=""

  while IFS= read -r path; do
    [ -n "$path" ] || continue
    abs=$(ai_resolve_edited_payload_path "$payload" "$path" "$REPO_ROOT")

    if [ -n "${seen[$abs]+x}" ]; then
      continue
    fi
    seen[$abs]=1

    surface=$(musi_doc_length_rule_surface "$abs" || true)
    [ "$surface" = "edit" ] || continue

    advisory=$(musi_doc_length_advisory "$abs" || true)
    if [ -n "$advisory" ]; then
      if [ -n "$combined" ]; then
        combined="${combined}"$'\n\n'"$advisory"
      else
        combined="$advisory"
      fi
    fi
  done < <(ai_edited_payload_paths "$payload")

  [ -n "$combined" ] && ai_emit_additional_context "PostToolUse" "$combined"

  ai_emit_continue
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  ai_doc_length_hook_main
fi
