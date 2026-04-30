#!/bin/bash

set -u

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo /workspace)
HOOK_LIB="$REPO_ROOT/scripts/ai-hooks"
# shellcheck source=/dev/null
. "$HOOK_LIB/common.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/policy.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/cache.sh"

PAYLOAD=$(ai_read_payload)
CMD=$(ai_payload_command "$PAYLOAD")
[ -z "$CMD" ] && ai_emit_continue

TOOL_USE_ID=$(ai_payload_tool_use_id "$PAYLOAD")
ai_cache_init

if REASON=$(ai_policy_violation_reason "$CMD"); then
  ai_emit_block "$REASON"
fi

if [ -n "$TOOL_USE_ID" ] && ai_is_git_commit_cmd "$CMD"; then
  HEAD_BEFORE=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo none)
  {
    printf 'HEAD_BEFORE=%s\n' "$HEAD_BEFORE"
    printf 'START_TS=%s\n' "$(date +%s)"
  } > "$AI_GIT_STATE_DIR/$TOOL_USE_ID"
fi

FORCE_VERIFY_REQ=""
if ai_has_force_verify_prefix "$CMD"; then
  FORCE_VERIFY_REQ=1
fi
MATCH_CMD=$(ai_strip_force_verify_prefix "$CMD")

if ai_is_wrapped_bun_cmd "$MATCH_CMD"; then
  SCRIPT=$(ai_bun_script_from_cmd "$MATCH_CMD")
  SCRIPT_SAFE=$(ai_safe_script_name "$SCRIPT")
  LOG="$AI_BUN_LOG_DIR/$SCRIPT_SAFE.log"
  MARKER="$AI_BUN_LOG_DIR/last.$SCRIPT_SAFE"
  CUR_FP=$(ai_worktree_fingerprint "$REPO_ROOT")

  if ai_read_bun_marker "$MARKER" && [ -z "$FORCE_VERIFY_REQ" ] && [ "${FORCE_VERIFY:-}" != "1" ]; then
    NOW=$(date +%s)
    AGE=$((NOW - AI_MARKER_LAST_TS))

    if [ "$AGE" -lt "$AI_BUN_TTL" ] && [ "$AI_MARKER_LAST_FP" = "$CUR_FP" ]; then
      if [ "$AI_MARKER_LAST_EXIT" -eq 0 ]; then
        ai_emit_block "Skipped rerun: $SCRIPT cached OK (${AGE}s ago, unchanged worktree) - prefix command with FORCE_VERIFY=1 to re-run. Full log: $LOG"
      fi

      ai_emit_block "$(ai_bun_cached_failure_summary "$SCRIPT" "$LOG" "$AGE" "$AI_MARKER_LAST_EXIT")"
    fi
  fi

  if [ -n "$TOOL_USE_ID" ]; then
    {
      printf 'SCRIPT=%s\n' "$SCRIPT"
      printf 'LOG=%s\n' "$LOG"
      printf 'CUR_FP=%s\n' "$CUR_FP"
      printf 'START_TS=%s\n' "$(date +%s)"
    } > "$AI_BUN_STATE_DIR/$TOOL_USE_ID"
  fi
fi

ai_emit_continue
