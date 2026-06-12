#!/bin/bash
# Shared protected-file advisories for agent edit/write hook adapters.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
# shellcheck source=/dev/null
. "$SCRIPT_DIR/common.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/edited-paths.sh"

ai_protected_file_advisory() {
  local file="$1"

  case "$file" in
    */prisma/schema.prisma)
      printf "%s" "Editing Prisma schema. Create a migration with 'bun run --filter @musi/server db:migrate' - do not use db:push for schema changes that will be committed."
      ;;
    */eslint.config.js)
      printf "%s" "Editing the shared ESLint config. Run 'bun run lint' afterward to check for new violations across the codebase."
      ;;
    */.husky/*)
      printf "%s" "Editing a git hook. This affects the commit workflow for all contributors."
      ;;
    */utils/*-mutations.ts)
      printf "%s" "This is a concurrency trust boundary (see docs/CONCURRENCY.md). Verify locking behavior before changing."
      ;;
    */packages/shared/src/schemas/*)
      printf "%s" "Shared schemas are the source of truth for both server and client. Verify consumers on both sides after changing."
      ;;
    *)
      return 1
      ;;
  esac
}

ai_protected_files_hook_main() {
  local payload path abs advisory combined
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

    advisory=$(ai_protected_file_advisory "$abs" || true)
    if [ -n "$advisory" ]; then
      if [ -n "$combined" ]; then
        combined="${combined}"$'\n'"protected-files: $advisory"
      else
        combined="protected-files: $advisory"
      fi
    fi
  done < <(ai_edited_payload_paths "$payload")

  [ -n "$combined" ] && ai_emit_additional_context "PreToolUse" "$combined"

  ai_emit_continue
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  ai_protected_files_hook_main
fi
