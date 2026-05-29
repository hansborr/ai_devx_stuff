#!/bin/bash

# Per-session throttle state for the lint-coverage PostToolUse hook. Adapter-
# neutral: source after common.sh (for ai_payload_session_id / ai_is_integer)
# and cache.sh (for AI_LINT_COVERAGE_STATE_DIR). Two independent tiers — the
# noisy `ratchet` advisory and the rarer `uncovered` warning — each get their
# own counter so one tier's spam can never suppress the other.

# Hash session+repo into a stable 64-char key. The repo is always part of the
# key material because hook state lives under a shared temp root and one Codex
# session can touch multiple repos/worktrees. State files therefore never embed
# raw session ids or paths.
ai_lint_coverage_throttle_key() {
  local payload="$1"
  local repo_root="$2"
  local session_id resolved_root key_material

  resolved_root=$(realpath -m -- "$repo_root" 2>/dev/null || printf '%s' "$repo_root")
  session_id=$(ai_payload_session_id "$payload")
  if [ -n "$session_id" ]; then
    key_material="session:${session_id}:repo:${resolved_root}"
  else
    key_material="repo:${resolved_root}"
  fi

  printf '%s' "$key_material" | sha256sum | awk '{print $1}'
}

ai_lint_coverage_state_path() {
  local tier="$1"
  local key="$2"
  printf '%s/%s.%s' "$AI_LINT_COVERAGE_STATE_DIR" "$tier" "$key"
}

# TTL in seconds; integer >= 0. `0` means always emit (the detection-test
# escape hatch). Invalid input falls back to the 30-minute default, matching the
# repo's AI_BUN_TTL convention.
ai_lint_coverage_ttl() {
  local value="${AI_LINT_COVERAGE_TTL:-1800}"
  if ai_is_integer "$value" && [ "$value" -ge 0 ]; then
    printf '%s' "$value"
  else
    printf '1800'
  fi
}

# Backstop detection count; integer >= 1. TTL is the primary lever. Invalid
# input falls back to the default.
ai_lint_coverage_max_detections() {
  local value="${AI_LINT_COVERAGE_MAX_DETECTIONS:-10}"
  if ai_is_integer "$value" && [ "$value" -ge 1 ]; then
    printf '%s' "$value"
  else
    printf '10'
  fi
}

# Read a two-key state file into AI_LC_STATE_TS / AI_LC_STATE_COUNT. Requires
# exactly LAST_TS and LAST_COUNT, integer LAST_TS > 0 and integer
# LAST_COUNT >= 0, and rejects unknown keys — mirroring ai_read_bun_marker so a
# corrupt file is treated as fresh (emit) rather than silently trusted.
ai_lint_coverage_read_state() {
  local file="$1"
  local saw_ts=0
  local saw_count=0

  AI_LC_STATE_TS=0
  AI_LC_STATE_COUNT=0

  [ -f "$file" ] || return 1
  while IFS='=' read -r k v; do
    case "$k" in
      LAST_TS) AI_LC_STATE_TS=$v; saw_ts=1 ;;
      LAST_COUNT) AI_LC_STATE_COUNT=$v; saw_count=1 ;;
      *) return 1 ;;
    esac
  done < "$file"

  [ "$saw_ts" -eq 1 ] || return 1
  [ "$saw_count" -eq 1 ] || return 1
  ai_is_integer "$AI_LC_STATE_TS" || return 1
  [ "$AI_LC_STATE_TS" -gt 0 ] || return 1
  ai_is_integer "$AI_LC_STATE_COUNT" || return 1
  [ "$AI_LC_STATE_COUNT" -ge 0 ] || return 1
}

ai_lint_coverage_write_state() {
  local file="$1"
  local ts="$2"
  local count="$3"
  local dir base tmp

  dir=$(dirname "$file")
  base=$(basename "$file")
  mkdir -p "$dir" || return 1
  tmp=$(mktemp "$dir/.${base}.tmp.XXXXXX") || return 1

  if ! {
    printf 'LAST_TS=%s\n' "$ts"
    printf 'LAST_COUNT=%s\n' "$count"
  } > "$tmp"; then
    rm -f "$tmp"
    return 1
  fi

  if ! mv -f "$tmp" "$file"; then
    rm -f "$tmp"
    return 1
  fi
}

# State machine from the plan, evaluated independently per tier. Returns 0 to
# emit (and resets state to {now, 0}) or 1 to suppress (bumping the counter).
# A missing/garbage state file, a backward clock jump, an age past TTL, or
# reaching the max-detection backstop all emit. State IO failures fail toward
# emitting — a lost increment may delay a repeat but must never swallow a first
# warning.
ai_lint_coverage_should_emit() {
  local tier="$1"
  local key="$2"
  local now="$3"
  local file ttl max age

  file=$(ai_lint_coverage_state_path "$tier" "$key")
  ttl=$(ai_lint_coverage_ttl)
  max=$(ai_lint_coverage_max_detections)

  if ! ai_lint_coverage_read_state "$file"; then
    ai_lint_coverage_write_state "$file" "$now" 0 || true
    return 0
  fi

  age=$(( now - AI_LC_STATE_TS ))
  if [ "$age" -lt 0 ] || [ "$age" -ge "$ttl" ] || [ "$(( AI_LC_STATE_COUNT + 1 ))" -ge "$max" ]; then
    ai_lint_coverage_write_state "$file" "$now" 0 || true
    return 0
  fi

  if ai_lint_coverage_write_state "$file" "$AI_LC_STATE_TS" "$(( AI_LC_STATE_COUNT + 1 ))"; then
    return 1
  fi

  # Persisting the increment failed. Fail toward emitting rather than suppress a
  # repeat we can no longer trust the counter to release before TTL elapses.
  return 0
}

# Side-effect-free counterpart to ai_lint_coverage_should_emit: answers "would
# this tier emit right now?" WITHOUT writing state, so a caller can decide
# whether an expensive probe (e.g. spawning ESLint) is worth running before it
# commits an emit slot. Returns 0 to emit, 1 to suppress. Mirrors should_emit's
# release conditions exactly — a missing/garbage state file, a backward clock
# jump, an age past TTL, or reaching the max-detection backstop all emit — and a
# read failure fails toward emitting.
ai_lint_coverage_would_emit() {
  local tier="$1"
  local key="$2"
  local now="$3"
  local file ttl max age

  file=$(ai_lint_coverage_state_path "$tier" "$key")
  ttl=$(ai_lint_coverage_ttl)
  max=$(ai_lint_coverage_max_detections)

  ai_lint_coverage_read_state "$file" || return 0

  age=$(( now - AI_LC_STATE_TS ))
  if [ "$age" -lt 0 ] || [ "$age" -ge "$ttl" ] || [ "$(( AI_LC_STATE_COUNT + 1 ))" -ge "$max" ]; then
    return 0
  fi
  return 1
}
