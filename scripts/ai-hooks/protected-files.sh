#!/bin/bash
# Shared protected-file advisories for agent edit/write hook adapters.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Honor a REPO_ROOT the caller already resolved, matching policy.sh's
# `${REPO_ROOT:-$(ai_repo_root)}`. Production is unchanged: every shipped
# entrypoint computes REPO_ROOT from git itself before this file is sourced or
# exec'd, so the default below is what real hook invocations still take.
REPO_ROOT="${REPO_ROOT:-$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")}"
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

ai_protected_files_allow_marker_path() {
  printf '%s/.allow-protected-edits' "$REPO_ROOT"
}

ai_protected_files_allow_marker_enabled() {
  [ -f "$(ai_protected_files_allow_marker_path)" ]
}

ai_protected_file_advisory_entry() {
  local file="$1"
  local advisory key

  # porting-knob: protected-files -- retarget repo-specific advisory and deny path tables
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
    */eslint.config.js)
      key="tamper-eslint-config"
      advisory="Editing the shared ESLint config. Tamper advisory: do not weaken lint coverage or rules to make a change pass; run 'bun run lint' afterward to check for new violations across the codebase."
      ;;
    */.husky/_/*)
      return 1
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

ai_protected_file_deny_entry() {
  local file="$1"
  local deny key

  case "$file" in
    */lint-ratchet.baseline.json)
      key="tamper-lint-ratchet-baseline"
      deny="Protected file: do not hand-edit lint-ratchet.baseline.json. For an intentional floor move, run 'bun run lint:ratchet:update' and then 'bun run lint:ratchet:check-baseline'."
      ;;
    */scripts/eslint-disable-register.sh|*/scripts/suppression-register.sh)
      key="tamper-suppression-register"
      deny="Protected file: suppression registers define the allowed suppression surface. Keep changes deliberate and run the register smoke tests after editing."
      ;;
    */docs/generated/harness-controls.md)
      key="generated-harness-controls"
      deny="Protected generated file: regenerate docs/generated/harness-controls.md with 'bun run docs:harness-controls' instead of editing it by hand."
      ;;
    */docs/generated/local-lint-rules.md)
      key="generated-lint-guidance"
      deny="Protected generated file: regenerate docs/generated/local-lint-rules.md with 'bun run docs:lint-guidance' instead of editing it by hand."
      ;;
    */docs/generated/README.md|*/docs/generated/lint-coverage-map.md|*/docs/generated/observed_flaky_tests.md)
      # docs/generated/README.md is the ownership ledger; these three files
      # are intentionally hand-maintained rather than generated artifacts.
      return 1
      ;;
    */docs/generated/*)
      key="generated-docs"
      deny="Protected generated file: regenerate the matching docs/generated artifact instead of editing it by hand."
      ;;
    */scripts/verify/steps.generated.sh)
      key="generated-verify-steps"
      deny="Protected generated file: regenerate scripts/verify/steps.generated.sh with 'bun run verify:steps' instead of editing it by hand."
      ;;
    */scripts/ai-hooks/hook-timeouts.generated.sh)
      key="generated-hook-timeouts"
      deny="Protected generated file: regenerate scripts/ai-hooks/hook-timeouts.generated.sh with 'bun run harness:hook-timeouts' instead of editing it by hand."
      ;;
    */scripts/ai-hooks/classified-bun-scripts.generated.sh)
      key="generated-classified-bun-scripts"
      deny="Protected generated file: regenerate scripts/ai-hooks/classified-bun-scripts.generated.sh with 'bun run verify:steps' instead of editing it by hand."
      ;;
    */scripts/tests/harness-check-fixture-manifest.generated.txt)
      key="generated-harness-check-fixture-manifest"
      deny="Protected generated file: regenerate scripts/tests/harness-check-fixture-manifest.generated.txt with 'bun run verify:steps' instead of editing it by hand."
      ;;
    */bun.lock)
      key="lockfile"
      deny="Protected lockfile: update bun.lock through 'bun install' instead of editing it by hand."
      ;;
    */.husky/_/*)
      key="husky-internals"
      deny="Protected Husky internals: do not edit .husky/_ by hand. Edit repo-owned hooks in .husky/ when needed, or refresh Husky internals with 'bun install'."
      ;;
    *)
      return 1
      ;;
  esac

  printf '%s\t%s' "$key" "$deny"
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

ai_protected_file_deny_key() {
  local file="$1"
  local entry

  entry=$(ai_protected_file_deny_entry "$file") || return 1
  printf "%s" "${entry%%$'\t'*}"
}

ai_protected_file_deny() {
  local file="$1"
  local entry

  entry=$(ai_protected_file_deny_entry "$file") || return 1
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
  local payload path abs advisory advisory_key combined deny denied marker entry
  local -A seen=()

  payload=$(ai_read_payload)
  path=""
  combined=""
  denied=""
  marker=$(ai_protected_files_allow_marker_path)

  while IFS= read -r path; do
    [ -n "$path" ] || continue
    abs=$(ai_resolve_edited_payload_path "$payload" "$path" "$REPO_ROOT")

    if [ -n "${seen[$abs]+x}" ]; then
      continue
    fi
    seen[$abs]=1

    if entry=$(ai_protected_file_deny_entry "$abs"); then
      deny="${entry#*$'\t'}"
      if ai_protected_files_allow_marker_enabled; then
        advisory="Repo-wide protected edit override marker is active: $marker. Without that marker, this edit would have been denied for $abs. Remove the marker after this deliberate maintenance. $deny"
        if [ -n "$combined" ]; then
          combined="${combined}"$'\n'"protected-files: $advisory"
        else
          combined="protected-files: $advisory"
        fi
      else
        if [ -n "$denied" ]; then
          denied="${denied}"$'\n'"protected-files: $deny"
        else
          denied="protected-files: $deny"
        fi
      fi
      continue
    fi

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

  [ -n "$denied" ] && ai_emit_deny "$denied"
  [ -n "$combined" ] && ai_emit_additional_context "PreToolUse" "$combined"

  ai_emit_continue
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  ai_protected_files_hook_main
fi
