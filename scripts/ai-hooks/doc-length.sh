#!/bin/bash
# Shared hot-doc length advisories for agent edit/write hooks and pre-commit.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
# shellcheck source=/dev/null
. "$SCRIPT_DIR/common.sh"
# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/doc-length-policy.sh"

ai_doc_length_rule() {
  musi_doc_length_set_rule "$1"
}

ai_doc_length_advisory_for_count() {
  musi_doc_length_advisory_for_count "$1" "$2"
}

ai_doc_length_advisory() {
  musi_doc_length_advisory "$1"
}

ai_doc_length_hook_main() {
  local payload file advisory

  payload=$(ai_read_payload)
  file=$(ai_payload_file_path "$payload")
  [ -z "$file" ] && ai_emit_continue

  advisory=$(ai_doc_length_advisory "$file" || true)
  if [ -n "$advisory" ]; then
    ai_emit_additional_context "PostToolUse" "$advisory"
  fi

  ai_emit_continue
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  ai_doc_length_hook_main
fi
