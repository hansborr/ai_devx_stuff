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
# shellcheck source=/dev/null
. "$SCRIPT_DIR/edited-paths.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/cache.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/lint-coverage-state.sh"

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

# Ask the ratchet engine whether the committed baseline tracks this path, and if
# so for which rule(s). The matcher lives in scripts/lint-ratchet/ratchet-globs.ts
# (shared with the authoritative gate) so this hook no longer carries its own copy
# of the ratchet glob semantics. Output row, when matched:
#   ratchet-covered<TAB><relpath><TAB><comma-separated rule ids>
# Any tooling failure, a missing/malformed baseline, or a non-matching path
# yields no row -> non-zero, so the caller falls back to the louder uncovered tier.
ai_lint_coverage_is_ratchet_covered() {
  local relative_path="$1"
  local baseline_path="$REPO_ROOT/lint-ratchet.baseline.json"
  local row rules

  [ -f "$baseline_path" ] || return 1
  command -v bun >/dev/null 2>&1 || return 1

  row=$(bun "$REPO_ROOT/scripts/lint-ratchet.ts" --edit-ratchet-coverage "$relative_path" 2>/dev/null) \
    || return 1
  [ -n "$row" ] || return 1
  # First row only (one path in -> at most one row); split off the rule-id field.
  IFS=$'\t' read -r _ _ rules <<< "$row"
  printf '%s' "$rules"
  return 0
}

# Classify one file into a coverage tier. Prints a tab-delimited record the
# main loop buckets — `ratchet<TAB>relative/path<TAB>rule list` or
# `uncovered<TAB>relative/path` — and returns non-zero as the internal "captured
# this file" signal. A fully-covered file prints nothing and returns 0. Message
# prose is composed later so throttling can drop a whole tier at once.
ai_lint_coverage_check_file() {
  local absolute_path="$1"
  local relative_path="$2"
  local config_output ratchet_rules

  # Ask ESLint if it has config for this file. With flat config, ignored or
  # uncovered files produce the literal string "undefined".
  config_output=$(node_modules/.bin/eslint --print-config "$absolute_path" 2>/dev/null) || true

  if [ "$config_output" = "undefined" ] || [ -z "$config_output" ]; then
    # A ratchet entry tracks a single rule's message count, not the full ESLint
    # rule set, so an ESLint-ignored file is not really "covered" — record it in
    # the softer `ratchet` tier naming the tracked rule(s) instead of the louder
    # `uncovered` warning.
    if ratchet_rules=$(ai_lint_coverage_is_ratchet_covered "$relative_path"); then
      printf 'ratchet\t%s\t%s\n' "$relative_path" "$ratchet_rules"
      return 1
    fi

    printf 'uncovered\t%s\n' "$relative_path"
    return 1
  fi
  return 0
}

AI_LINT_COVERAGE_MAX_PATHS=25

# Render a bounded bullet list from the buckets. Each argument is one entry:
# for the ratchet tier `relative/path<TAB>rule list`, for the uncovered tier the
# bare `relative/path`. Caps at AI_LINT_COVERAGE_MAX_PATHS lines with an
# "... and N more" suffix so a large patch does not dump a huge hook message.
ai_lint_coverage_bullets() {
  local tier="$1"
  shift
  local total=$#
  local shown=0
  local entry path rules

  for entry in "$@"; do
    if [ "$shown" -ge "$AI_LINT_COVERAGE_MAX_PATHS" ]; then
      printf '  ... and %s more\n' "$(( total - AI_LINT_COVERAGE_MAX_PATHS ))"
      break
    fi
    if [ "$tier" = ratchet ]; then
      path="${entry%%$'\t'*}"
      rules="${entry#*$'\t'}"
      printf '  - %s (%s)\n' "$path" "$rules"
    else
      printf '  - %s\n' "$entry"
    fi
    shown=$(( shown + 1 ))
  done
}

ai_lint_coverage_throttle_note() {
  local ttl max minutes
  ttl=$(ai_lint_coverage_ttl)
  max=$(ai_lint_coverage_max_detections)
  minutes=$(( ttl / 60 ))
  printf "This reminder is throttled per session: it won't repeat until about %s min pass, %s more matching edit batches are detected, or a new top-level session starts." \
    "$minutes" "$max"
}

# Compose the full tier message: header, bounded path list, generic map-pointing
# body, throttle note. Each entry argument follows ai_lint_coverage_bullets.
ai_lint_coverage_compose() {
  local tier="$1"
  shift
  local header body bullets

  bullets=$(ai_lint_coverage_bullets "$tier" "$@")
  if [ "$tier" = ratchet ]; then
    header="lint-coverage (info): file(s) you just edited are covered only by lint:ratchet (single-rule floors), not full ESLint:"
    body="That's an accepted floor, not an error. If you added a new lint surface (a new directory or file group), add a row in docs/agent_notes/lint-coverage-map.md. The per-file counts there are descriptive, but new surfaces/globs should get a row."
  else
    header="lint-coverage (WARNING): file(s) you just edited are NOT covered by ESLint at all:"
    body="If it should be linted, add it to eslint.config.js and the relevant tsconfig. Either way, account for it in docs/agent_notes/lint-coverage-map.md; verify:changed / pre-commit will block on source-relevant files matching no coverage-map row."
  fi

  printf '%s\n%s\n%s\n\n%s' "$header" "$bullets" "$body" "$(ai_lint_coverage_throttle_note)"
}

ai_lint_coverage_main() {
  local payload path absolute_path relative_path result tier rest key now message tier_message throttle_ttl throttle_max
  local -a paths=()
  local -A seen=()
  local -a ratchet_entries=()
  local -a uncovered_entries=()

  cd "$REPO_ROOT" || ai_emit_continue
  ai_cache_init

  payload=$(ai_read_payload)
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if [ -z "${seen[$path]+x}" ]; then
      paths+=("$path")
      seen[$path]=1
    fi
  done < <(ai_edited_payload_paths "$payload")

  [ "${#paths[@]}" -gt 0 ] || ai_emit_continue

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
      tier="${result%%$'\t'*}"
      rest="${result#*$'\t'}"
      case "$tier" in
        ratchet) ratchet_entries+=("$rest") ;;
        uncovered) uncovered_entries+=("$rest") ;;
      esac
    }
  done

  # Covered/non-lintable edits never reach a tier, so they touch no state.
  if [ "${#ratchet_entries[@]}" -eq 0 ] && [ "${#uncovered_entries[@]}" -eq 0 ]; then
    ai_emit_continue
  fi

  key=$(ai_throttle_key "$payload" "$REPO_ROOT")
  now=$(ai_now)
  throttle_ttl=$(ai_lint_coverage_ttl)
  throttle_max=$(ai_lint_coverage_max_detections)

  message=""
  if [ "${#ratchet_entries[@]}" -gt 0 ] && ai_throttle_should_emit ratchet "$key" "$now" "$throttle_ttl" "$throttle_max"; then
    message=$(ai_lint_coverage_compose ratchet "${ratchet_entries[@]}")
  fi
  if [ "${#uncovered_entries[@]}" -gt 0 ] && ai_throttle_should_emit uncovered "$key" "$now" "$throttle_ttl" "$throttle_max"; then
    tier_message=$(ai_lint_coverage_compose uncovered "${uncovered_entries[@]}")
    if [ -n "$message" ]; then
      message="${message}"$'\n\n'"$tier_message"
    else
      message="$tier_message"
    fi
  fi

  if [ -n "$message" ]; then
    ai_emit_additional_context "PostToolUse" "$message"
  fi

  ai_emit_continue
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  ai_lint_coverage_main
fi
