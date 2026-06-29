#!/bin/bash
# Shared protected-file advisories for agent edit/write hook adapters.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
# shellcheck source=/dev/null
. "$SCRIPT_DIR/common.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/cache.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/throttle-state.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/edited-paths.sh"

ai_protected_files_throttle_ttl() {
  local value="${AI_PROTECTED_FILES_THROTTLE_TTL:-1800}"
  if ai_is_integer "$value" && [ "$value" -ge 0 ]; then printf '%s' "$value"; else printf '1800'; fi
}

ai_protected_files_throttle_max_detections() {
  local value="${AI_PROTECTED_FILES_THROTTLE_MAX_DETECTIONS:-10}"
  if ai_is_integer "$value" && [ "$value" -ge 1 ]; then printf '%s' "$value"; else printf '10'; fi
}

ai_protected_file_advisory_entry() {
  local file="$1"
  local advisory key

  case "$file" in
    */prisma/schema.prisma)
      key="prisma-schema"
      advisory="Editing Prisma schema. Create a migration with 'bun run --filter @musi/server db:migrate' - do not use db:push for schema changes that will be committed."
      ;;
    */packages/server/src/routers/*)
      key="guide-trpc-router"
      advisory="Editing a tRPC router. See docs/guides/add-trpc-procedure.md before adding or changing procedures."
      ;;
    */packages/server/src/socket/*)
      key="guide-socket"
      advisory="Editing the Socket.io surface. See docs/guides/add-socket-broadcast.md before adding or changing broadcasts."
      ;;
    */packages/shared/src/rules/*)
      key="guide-rules"
      advisory="Editing shared rules logic. See docs/guides/change-rules-logic.md before changing 5E rules behavior."
      ;;
    */e2e/*)
      key="guide-e2e"
      advisory="Editing Playwright e2e coverage. See docs/guides/add-e2e-test.md before adding or changing e2e flows."
      ;;
    */lint-ratchet.baseline.json)
      key="tamper-lint-ratchet-baseline"
      advisory="Tamper advisory: editing the lint-ratchet baseline should reflect intentional debt movement, not bypass a regression. Run 'bun run lint:ratchet:check-baseline' afterward."
      ;;
    */eslint.config.js)
      key="tamper-eslint-config"
      advisory="Editing the shared ESLint config. Tamper advisory: do not weaken lint coverage or rules to make a change pass; run 'bun run lint' afterward to check for new violations across the codebase."
      ;;
    */scripts/eslint-disable-register.sh|*/scripts/suppression-register.sh)
      key="tamper-suppression-register"
      advisory="Tamper advisory: editing suppression registers changes the allowed suppression surface. Keep allowlists narrow, reasoned, and covered by the register smoke tests."
      ;;
    */.husky/*)
      key="git-hook"
      advisory="Editing a git hook. This affects the commit workflow for all contributors."
      ;;
    */utils/*-mutations.ts)
      key="concurrency-mutation-boundary"
      advisory="This is a concurrency trust boundary (see docs/CONCURRENCY.md). Verify locking behavior before changing."
      ;;
    */packages/shared/src/schemas/*)
      key="shared-schema"
      advisory="Shared schemas are the source of truth for both server and client. Verify consumers on both sides after changing."
      ;;
    *)
      return 1
      ;;
  esac

  printf '%s\t%s' "$key" "$advisory"
}

ai_protected_file_advisory_key() {
  local file="$1"
  local entry

  entry=$(ai_protected_file_advisory_entry "$file") || return 1
  printf "%s" "${entry%%$'\t'*}"
}

ai_protected_file_advisory() {
  local file="$1"
  local entry

  entry=$(ai_protected_file_advisory_entry "$file") || return 1
  printf "%s" "${entry#*$'\t'}"
}

ai_protected_file_advisory_should_emit() {
  local payload="$1"
  local advisory_key="$2"
  local throttle_key now ttl max

  throttle_key=$(ai_throttle_key "$payload" "$REPO_ROOT")
  now=$(ai_now)
  ttl=$(ai_protected_files_throttle_ttl)
  max=$(ai_protected_files_throttle_max_detections)

  ai_throttle_should_emit "protected-files:$advisory_key" "$throttle_key" "$now" "$ttl" "$max"
}

ai_protected_files_hook_main() {
  local payload path abs advisory advisory_key combined entry
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

    if entry=$(ai_protected_file_advisory_entry "$abs"); then
      advisory_key="${entry%%$'\t'*}"
      advisory="${entry#*$'\t'}"
    else
      continue
    fi

    if ai_protected_file_advisory_should_emit "$payload" "$advisory_key"; then
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
