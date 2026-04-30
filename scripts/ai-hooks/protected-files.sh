#!/bin/bash
# Shared protected-file advisories for agent edit/write hook adapters.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/common.sh"

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
  local payload file advisory

  payload=$(ai_read_payload)
  file=$(ai_payload_file_path "$payload")
  [ -z "$file" ] && ai_emit_continue

  advisory=$(ai_protected_file_advisory "$file" || true)
  if [ -n "$advisory" ]; then
    ai_emit_additional_context "PreToolUse" "protected-files: $advisory"
  fi

  ai_emit_continue
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  ai_protected_files_hook_main
fi
