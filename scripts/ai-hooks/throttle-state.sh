#!/bin/bash

# Adapter-neutral per-tier throttle state. Source after common.sh (for
# ai_payload_session_id / ai_is_integer) and cache.sh (for AI_THROTTLE_STATE_DIR).
# State files are ephemeral edit-loop cache, so the neutral default path does not
# migrate old lint-coverage-named files.

# Hash session+repo into a stable 64-char key. The repo is always part of the
# key material because hook state lives under a shared temp root and one Codex
# session can touch multiple repos/worktrees. State files therefore never embed
# raw session ids or paths.
ai_throttle_key() {
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

ai_throttle_state_path() {
  local tier="$1"
  local key="$2"
  printf '%s/%s.%s' "$AI_THROTTLE_STATE_DIR" "$tier" "$key"
}

# Read a two-key state file into AI_THROTTLE_STATE_TS /
# AI_THROTTLE_STATE_COUNT. Requires exactly LAST_TS and LAST_COUNT, integer
# LAST_TS > 0 and integer LAST_COUNT >= 0, and rejects unknown keys, mirroring
# ai_read_bun_marker so a corrupt file is treated as fresh (emit) rather than
# silently trusted.
ai_throttle_read_state() {
  local file="$1"
  local saw_ts=0
  local saw_count=0

  AI_THROTTLE_STATE_TS=0
  AI_THROTTLE_STATE_COUNT=0

  [ -f "$file" ] || return 1
  while IFS='=' read -r k v; do
    case "$k" in
      LAST_TS) AI_THROTTLE_STATE_TS=$v; saw_ts=1 ;;
      LAST_COUNT) AI_THROTTLE_STATE_COUNT=$v; saw_count=1 ;;
      *) return 1 ;;
    esac
  done < "$file"

  [ "$saw_ts" -eq 1 ] || return 1
  [ "$saw_count" -eq 1 ] || return 1
  ai_is_integer "$AI_THROTTLE_STATE_TS" || return 1
  [ "$AI_THROTTLE_STATE_TS" -gt 0 ] || return 1
  ai_is_integer "$AI_THROTTLE_STATE_COUNT" || return 1
  [ "$AI_THROTTLE_STATE_COUNT" -ge 0 ] || return 1
}

ai_throttle_write_state() {
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

ai_throttle_release_due() {
  local last_ts="$1"
  local last_count="$2"
  local now="$3"
  local ttl="$4"
  local max="$5"
  local age

  age=$(( now - last_ts ))
  if [ "$age" -lt 0 ] || [ "$age" -ge "$ttl" ] || [ "$(( last_count + 1 ))" -ge "$max" ]; then
    return 0
  fi
  return 1
}

# State machine evaluated independently per tier. Returns 0 to emit (and resets
# state to {now, 0}) or 1 to suppress (bumping the counter). A missing/garbage
# state file, a backward clock jump, an age past TTL, or reaching the
# max-detection backstop all emit. State IO failures fail toward emitting: a
# lost increment may delay a repeat but must never swallow a first warning.
ai_throttle_should_emit() {
  local tier="$1"
  local key="$2"
  local now="$3"
  local ttl="$4"
  local max="$5"
  local file

  file=$(ai_throttle_state_path "$tier" "$key")

  if ! ai_throttle_read_state "$file"; then
    ai_throttle_write_state "$file" "$now" 0 || true
    return 0
  fi

  if ai_throttle_release_due "$AI_THROTTLE_STATE_TS" "$AI_THROTTLE_STATE_COUNT" "$now" "$ttl" "$max"; then
    ai_throttle_write_state "$file" "$now" 0 || true
    return 0
  fi

  if ai_throttle_write_state "$file" "$AI_THROTTLE_STATE_TS" "$(( AI_THROTTLE_STATE_COUNT + 1 ))"; then
    return 1
  fi

  # Persisting the increment failed. Fail toward emitting rather than suppress a
  # repeat we can no longer trust the counter to release before TTL elapses.
  return 0
}

# Side-effect-free counterpart to ai_throttle_should_emit: answers "would this
# tier emit right now?" WITHOUT writing state, so a caller can decide whether an
# expensive probe (e.g. spawning ESLint) is worth running before it commits an
# emit slot. Returns 0 to emit, 1 to suppress. Mirrors should_emit's release
# conditions exactly.
ai_throttle_would_emit() {
  local tier="$1"
  local key="$2"
  local now="$3"
  local ttl="$4"
  local max="$5"
  local file

  file=$(ai_throttle_state_path "$tier" "$key")

  ai_throttle_read_state "$file" || return 0
  ai_throttle_release_due "$AI_THROTTLE_STATE_TS" "$AI_THROTTLE_STATE_COUNT" "$now" "$ttl" "$max" && return 0
  return 1
}
