#!/bin/bash
# PostToolUse hook: advisory warning when an edit introduces or worsens a fresh
# minimal-TS lint-ratchet finding in the file you just edited — earlier than the
# commit/verify sweep. Strictly advisory: it never blocks and degrades to
# silence on any tooling failure. Type-aware ratchets are intentionally NOT
# checked here (they rebuild a TS program; verify/commit stays authoritative).
#
# Two-step + throttled + content-cached so it stays occasional and cheap:
#   1. ask the ratchet engine which minimal-TS ratchets match the edited paths
#      (no ESLint), so we can throttle BEFORE spending a lint;
#   2. lint only the surviving (file, ratchet) targets and report regressions.
#
# Throttle state is shared with lint-coverage (same dir + session/repo key) but
# uses a distinct per-(file,rule) `ratchetreg:*` tier, so neither hook can
# suppress or reset the other. A no-regression lint never burns an emit slot.

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

# Disable entirely with: touch <repo>/.no-edit-lint (mirrors the stop-policy
# .no-stop-uncommitted kill-switch pattern).
AI_RATCHET_REGRESSION_KILL_SWITCH=".no-edit-lint"
# Content-hash cache: a successful lint records sha1(file content | target set)
# so an identical re-save of the same file and target set skips ESLint entirely.
AI_RATCHET_REGRESSION_CONTENT_DIR="${AI_RATCHET_REGRESSION_CONTENT_DIR:-$AI_STATE_ROOT/ratchet-regression-content}"

# TTL/backstop knobs, independent of the lint-coverage tier. TTL is the primary
# lever; the throttle machine reused from lint-coverage-state.sh reads these
# through AI_LINT_COVERAGE_TTL / AI_LINT_COVERAGE_MAX_DETECTIONS (set in main).
ai_ratchet_regression_ttl() {
  local value="${AI_RATCHET_REGRESSION_TTL:-1800}"
  if ai_is_integer "$value" && [ "$value" -ge 0 ]; then printf '%s' "$value"; else printf '1800'; fi
}

ai_ratchet_regression_max() {
  local value="${AI_RATCHET_REGRESSION_MAX:-10}"
  if ai_is_integer "$value" && [ "$value" -ge 1 ]; then printf '%s' "$value"; else printf '10'; fi
}

# Cap on targets checked per edit event (defends the hot path); dropped targets
# are noted alongside any warning, never silently swallowed.
ai_ratchet_regression_max_targets() {
  local value="${AI_RATCHET_REGRESSION_MAX_TARGETS:-3}"
  if ai_is_integer "$value" && [ "$value" -ge 1 ]; then printf '%s' "$value"; else printf '3'; fi
}

# Only the JS/TS family carries minimal-TS ratchets; skip everything else before
# spending a discovery call. Non-matching paths would discover zero targets
# anyway, so this is purely a cost guard.
ai_ratchet_regression_is_lintable() {
  local file="$1"
  case "${file,,}" in
    *.js | *.jsx | *.mjs | *.cjs | *.ts | *.tsx | *.mts | *.cts) return 0 ;;
    *) return 1 ;;
  esac
}

ai_ratchet_regression_sha1() {
  printf '%s' "$1" | sha1sum | awk '{print $1}'
}

# Per-(file,rule) throttle tier. Rule ids contain "/", so both components are
# hashed — the raw id must never reach a state-file path segment.
ai_ratchet_regression_tier() {
  local relpath="$1"
  local rule_id="$2"
  printf 'ratchetreg:%s:%s' \
    "$(ai_ratchet_regression_sha1 "$relpath")" "$(ai_ratchet_regression_sha1 "$rule_id")"
}

ai_ratchet_regression_content_path() {
  printf '%s/%s' "$AI_RATCHET_REGRESSION_CONTENT_DIR" "$(ai_ratchet_regression_sha1 "$1")"
}

# Token identifying a checked file: its content hash plus the (sorted) set of
# ratchet ids that matched it. A byte change or a newly-matching ratchet (e.g. a
# freshly added rule) changes the token and forces a re-check.
ai_ratchet_regression_content_token() {
  local absolute_path="$1"
  local target_ids="$2"
  local content
  content=$(git -C "$REPO_ROOT" hash-object --no-filters -- "$absolute_path" 2>/dev/null || true)
  [ -n "$content" ] || content=$(sha1sum "$absolute_path" 2>/dev/null | awk '{print $1}')
  ai_ratchet_regression_sha1 "${content}|${target_ids}"
}

# Sorted, comma-joined unique ratchet ids matching one file in the capped rows.
ai_ratchet_regression_ids_for_path() {
  local relpath="$1"
  shift
  local row testid out=""
  for row in "$@"; do
    IFS=$'\t' read -r _ rrel testid _ <<< "$row"
    [ "$rrel" = "$relpath" ] || continue
    out+="$testid"$'\n'
  done
  printf '%s' "$out" | sort -u | paste -sd, -
}

ai_ratchet_regression_resolve_paths() {
  local payload="$1"
  local path absolute_path relative_path
  local -A seen=()

  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if [[ "$path" = /* ]]; then
      absolute_path=$(realpath -m -- "$path")
    else
      absolute_path=$(realpath -m -- "$REPO_ROOT/$path")
    fi
    case "$absolute_path" in "$REPO_ROOT"/*) ;; *) continue ;; esac
    relative_path="${absolute_path#"$REPO_ROOT"/}"
    case "$relative_path" in node_modules/* | .git/* | */node_modules/*) continue ;; esac
    ai_ratchet_regression_is_lintable "$relative_path" || continue
    # Skip deleted/missing files: a removed path is never a fresh regression.
    [ -f "$absolute_path" ] || continue
    if [ -z "${seen[$relative_path]+x}" ]; then
      seen[$relative_path]=1
      printf '%s\n' "$relative_path"
    fi
  done < <(ai_edited_payload_paths "$payload")
}

# Compose the advisory from confirmed regression bullets and any dropped-target
# note. Body names the authoritative gate and the kill-switch.
ai_ratchet_regression_compose() {
  local dropped="$1"
  shift
  local header body note
  header="lint-ratchet (WARNING): your edit introduced or worsened a ratchet finding in file(s) you just edited:"
  body="Run bun run lint:ratchet before committing. Type-aware ratchets are not checked in this edit-time hook. Disable entirely with: touch $REPO_ROOT/$AI_RATCHET_REGRESSION_KILL_SWITCH"
  printf '%s\n' "$header"
  printf '%s\n' "$@"
  if [ "$dropped" -gt 0 ]; then
    note="  (+$dropped more matching target(s) not checked this edit; run bun run lint:ratchet for the full picture.)"
    printf '%s\n' "$note"
  fi
  printf '%s' "$body"
}

ai_ratchet_regression_main() {
  local payload key now discovery edit_output tmp_targets rc max_targets dropped
  local row relpath ruleid reason line kind converted unit
  local ids token cache_file loc tier
  local -a edited_paths=() target_rows=() lint_rows=() bullets=()
  local -A fresh_token=() lint_file=() matched=() checked_count=()

  if [ "${AI_RATCHET_REGRESSION_DISABLE:-0}" = "1" ]; then ai_emit_continue; fi
  cd "$REPO_ROOT" || ai_emit_continue
  [ -f "$REPO_ROOT/$AI_RATCHET_REGRESSION_KILL_SWITCH" ] && ai_emit_continue
  command -v bun >/dev/null 2>&1 || ai_emit_continue
  ai_cache_init
  mkdir -p "$AI_RATCHET_REGRESSION_CONTENT_DIR" 2>/dev/null || true

  # Drive the shared throttle machine with this hook's own TTL/backstop. Read by
  # ai_lint_coverage_ttl / _max_detections in the sourced lint-coverage-state.sh.
  # shellcheck disable=SC2034
  AI_LINT_COVERAGE_TTL="$(ai_ratchet_regression_ttl)"
  # shellcheck disable=SC2034
  AI_LINT_COVERAGE_MAX_DETECTIONS="$(ai_ratchet_regression_max)"

  payload=$(ai_read_payload)
  while IFS= read -r relpath; do
    [ -n "$relpath" ] && edited_paths+=("$relpath")
  done < <(ai_ratchet_regression_resolve_paths "$payload")
  [ "${#edited_paths[@]}" -gt 0 ] || ai_emit_continue

  # Step 1: discovery (no ESLint). A tooling failure degrades to silence.
  discovery=$(bun "$REPO_ROOT/scripts/lint-ratchet.ts" --edit-check-targets "${edited_paths[@]}" 2>/dev/null) || ai_emit_continue
  [ -n "$discovery" ] || ai_emit_continue

  max_targets=$(ai_ratchet_regression_max_targets)
  dropped=0
  while IFS= read -r row; do [ -n "$row" ] && target_rows+=("$row"); done <<< "$discovery"
  if [ "${#target_rows[@]}" -gt "$max_targets" ]; then
    dropped=$(( ${#target_rows[@]} - max_targets ))
    target_rows=("${target_rows[@]:0:max_targets}")
  fi

  key=$(ai_lint_coverage_throttle_key "$payload" "$REPO_ROOT")
  now=$(ai_now)

  # Step 1b: content-cache short-circuit + throttle-before-lint. A file whose
  # (content, target set) is unchanged since its last lint is skipped whole; for
  # the rest, each target is dropped if its tier would currently suppress.
  for row in "${target_rows[@]}"; do
    IFS=$'\t' read -r kind relpath _ ruleid <<< "$row"
    [ "$kind" = "target" ] || continue
    matched[$relpath]=$(( ${matched[$relpath]:-0} + 1 ))
    if [ -z "${fresh_token[$relpath]+x}" ]; then
      ids=$(ai_ratchet_regression_ids_for_path "$relpath" "${target_rows[@]}")
      token=$(ai_ratchet_regression_content_token "$REPO_ROOT/$relpath" "$ids")
      cache_file=$(ai_ratchet_regression_content_path "$relpath")
      if [ -f "$cache_file" ] && [ "$(cat "$cache_file" 2>/dev/null)" = "$token" ]; then
        fresh_token[$relpath]="cached"
        continue
      fi
      fresh_token[$relpath]="$token"
    fi
    [ "${fresh_token[$relpath]}" = "cached" ] && continue
    tier=$(ai_ratchet_regression_tier "$relpath" "$ruleid")
    if ai_lint_coverage_would_emit "$tier" "$key" "$now"; then
      lint_rows+=("$row")
      lint_file[$relpath]=1
    fi
  done

  [ "${#lint_rows[@]}" -gt 0 ] || ai_emit_continue

  # Step 2: lint only the surviving targets.
  tmp_targets=$(mktemp "${TMPDIR:-/tmp}/musi-ratchetreg.XXXXXX") || ai_emit_continue
  printf '%s\n' "${lint_rows[@]}" > "$tmp_targets"
  edit_output=$(bun "$REPO_ROOT/scripts/lint-ratchet.ts" --edit-check --targets-file "$tmp_targets" 2>/dev/null)
  rc=$?
  rm -f "$tmp_targets"
  [ "$rc" -eq 0 ] || ai_emit_continue

  # Tally what the engine ACTUALLY linted (`checked` rows) and collect confirmed
  # regressions. Parse with a non-whitespace separator (\x1f) so an empty `line`
  # field is preserved instead of collapsed by tab-as-IFS-whitespace.
  unit=$'\x1f'
  while IFS= read -r row; do
    [ -n "$row" ] || continue
    converted=${row//$'\t'/$unit}
    IFS="$unit" read -r kind relpath _ ruleid reason line _ _ <<< "$converted"
    case "$kind" in
      checked)
        checked_count[$relpath]=$(( ${checked_count[$relpath]:-0} + 1 ))
        ;;
      regression)
        tier=$(ai_ratchet_regression_tier "$relpath" "$ruleid")
        # Confirm the emit only now that a regression is real, burning one slot
        # and advancing/resetting the per-(file,rule) throttle counter.
        if ai_lint_coverage_should_emit "$tier" "$key" "$now"; then
          if [ -n "$line" ]; then loc="$relpath:$line"; else loc="$relpath"; fi
          bullets+=("  - $loc ($ruleid — $reason)")
        fi
        ;;
    esac
  done <<< "$edit_output"

  # Record the content token ONLY for files whose FULL matched target set the
  # engine actually linted (matched == checked). This refuses to cache bytes
  # behind a soft skip (drift / missing baseline) or a throttle-dropped target,
  # so an identical re-save is re-checked once that condition clears.
  for relpath in "${!lint_file[@]}"; do
    [ "${checked_count[$relpath]:-0}" -gt 0 ] || continue
    [ "${matched[$relpath]:-0}" -eq "${checked_count[$relpath]:-0}" ] || continue
    printf '%s' "${fresh_token[$relpath]}" > "$(ai_ratchet_regression_content_path "$relpath")" 2>/dev/null || true
  done

  [ "${#bullets[@]}" -gt 0 ] || ai_emit_continue
  ai_emit_additional_context "PostToolUse" "$(ai_ratchet_regression_compose "$dropped" "${bullets[@]}")"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  ai_ratchet_regression_main
fi
