#!/bin/bash
# Shared Bash-surface PostToolUse aggregate: git-commit result summaries and
# wrapped-`bun run` log/marker capture plus output quieting. Consumes the
# tool_input.command / tool_response payload dialect; Codex execs this directly
# and the Copilot adapter normalizes its payload first. Claude deliberately
# keeps commit output handling in its git-commit-quiet adapter instead.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
HOOK_LIB="$SCRIPT_DIR"
# shellcheck source=/dev/null
. "$HOOK_LIB/common.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/policy.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/cache.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/commit-output.sh"

PAYLOAD=$(ai_read_payload)
CMD=$(ai_payload_command "$PAYLOAD")
[ -z "$CMD" ] && ai_emit_continue

TOOL_USE_ID=$(ai_payload_tool_use_id "$PAYLOAD")
ai_cache_init

RESPONSE=$(ai_response_json_from_payload "$PAYLOAD")
EXIT_CODE=$(printf '%s' "$RESPONSE" | jq -r '.exit_code // empty' 2>/dev/null || true)
COMBINED=$(ai_combined_response_text "$RESPONSE")

if ai_is_git_commit_cmd "$CMD"; then
  STATE_FILE=""
  HEAD_BEFORE=""
  START_TS=""
  WORK_ROOT=""
  if [ -n "$TOOL_USE_ID" ]; then
    STATE_FILE="$AI_GIT_STATE_DIR/$TOOL_USE_ID"
    HEAD_BEFORE=$(ai_read_state_value "$STATE_FILE" HEAD_BEFORE 2>/dev/null || true)
    START_TS=$(ai_read_state_value "$STATE_FILE" START_TS 2>/dev/null || true)
    WORK_ROOT=$(ai_read_state_value "$STATE_FILE" WORK_ROOT 2>/dev/null || true)
  fi
  # Fall back to re-resolving the commit's checkout when the pre hook left no
  # WORK_ROOT (older state file, or no tool_use_id): observe HEAD in the target
  # worktree, not REPO_ROOT (the hook file's own checkout) — J.
  [ -z "$WORK_ROOT" ] \
    && WORK_ROOT=$(git -C "$(ai_resolve_target_dir "$CMD" "$(ai_payload_cwd "$PAYLOAD")" "$REPO_ROOT")" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$REPO_ROOT")
  HEAD_AFTER=$(git -C "$WORK_ROOT" rev-parse HEAD 2>/dev/null || echo none)
  DRY_RUN=0
  if ai_is_git_commit_dry_run "$CMD"; then
    DRY_RUN=1
  fi

  [ -n "$STATE_FILE" ] && rm -f "$STATE_FILE"

  if [ "$DRY_RUN" -ne 1 ] && [ -n "$HEAD_BEFORE" ] && [ "$HEAD_AFTER" != "$HEAD_BEFORE" ]; then
    ai_emit_block "$(ai_commit_success_summary "$WORK_ROOT" "$HEAD_BEFORE" "$HEAD_AFTER")"
  fi

  if SUMMARY=$(ai_precommit_failure_summary "$COMBINED" "$AI_PRECOMMIT_LOG_DIR"); then
    :
  elif [ "$DRY_RUN" -eq 1 ]; then
    SUMMARY=$(ai_commit_dry_run_summary "$COMBINED")
  elif [ -n "$HEAD_BEFORE" ] && [ "$HEAD_AFTER" = "$HEAD_BEFORE" ] && [ "$EXIT_CODE" = "0" ]; then
    SUMMARY=$(ai_commit_no_landing_summary "$HEAD_BEFORE" "$COMBINED")
  elif [ "$EXIT_CODE" = "124" ] || [ "$EXIT_CODE" = "130" ] || [ "$EXIT_CODE" = "143" ] || { [ -z "$EXIT_CODE" ] && [ -z "$COMBINED" ]; }; then
    DETAIL="The agent did not observe a completed commit result before the tool returned."
    if ai_is_integer "${START_TS:-}"; then
      DETAIL="$DETAIL Elapsed before post-hook summary: $(( $(date +%s) - START_TS ))s."
    fi
    if [ -n "$EXIT_CODE" ]; then
      SUMMARY=$(ai_commit_maybe_running_summary "Commit status unknown (exit $EXIT_CODE)." "$HEAD_BEFORE" "$COMBINED" "$DETAIL")
    else
      SUMMARY=$(ai_commit_maybe_running_summary "Commit status unknown." "$HEAD_BEFORE" "$COMBINED" "$DETAIL")
    fi
  else
    if [ -n "$EXIT_CODE" ]; then
      SUMMARY=$(ai_commit_generic_summary "Commit finished with exit $EXIT_CODE." "$COMBINED")
    else
      SUMMARY=$(ai_commit_generic_summary "Commit output summary." "$COMBINED")
    fi
  fi

  ai_emit_block "$SUMMARY"
fi

MATCH_CMD=$(ai_strip_force_verify_prefix "$CMD")

if ai_is_wrapped_bun_cmd "$MATCH_CMD"; then
  if ai_bun_cmd_bypasses_cache "$MATCH_CMD"; then
    ai_emit_continue
  fi

  SCRIPT=$(ai_bun_script_from_cmd "$MATCH_CMD")
  SCRIPT_SAFE=$(ai_safe_script_name "$SCRIPT")
  STATE_FILE=""
  START_TS=""
  CUR_FP=""
  LOG=""
  if [ -n "$TOOL_USE_ID" ]; then
    STATE_FILE="$AI_BUN_STATE_DIR/$TOOL_USE_ID"
    START_TS=$(ai_read_state_value "$STATE_FILE" START_TS 2>/dev/null || true)
    CUR_FP=$(ai_read_state_value "$STATE_FILE" CUR_FP 2>/dev/null || true)
    LOG=$(ai_read_state_value "$STATE_FILE" LOG 2>/dev/null || true)
  fi
  [ -z "$LOG" ] && LOG="$AI_BUN_LOG_DIR/$SCRIPT_SAFE.log"
  # Argv-scoped marker (H1/H2): must match the pre-hook's derivation so a run's
  # marker is read and written under the same exact-argv key.
  MARKER="$AI_BUN_LOG_DIR/$(ai_bun_marker_name "$MATCH_CMD")"
  [ -n "$STATE_FILE" ] && rm -f "$STATE_FILE"

  if ! ai_is_integer "${EXIT_CODE:-}"; then
    INFERRED_EXIT=$(ai_bun_exit_code_from_output "$SCRIPT" "$COMBINED")
    if ai_is_integer "${INFERRED_EXIT:-}"; then
      EXIT_CODE="$INFERRED_EXIT"
    elif ! ai_bun_output_has_error_footer "$SCRIPT" "$COMBINED"; then
      EXIT_CODE=0
    else
      EXIT_CODE=""
    fi
  fi

  if [ -n "$COMBINED" ]; then
    printf '%s\n' "$COMBINED" > "$LOG"
  else
    : > "$LOG"
  fi

  ELAPSED=""
  if ai_is_integer "${START_TS:-}"; then
    ELAPSED=$(( $(date +%s) - START_TS ))
  fi

  if ai_is_integer "${EXIT_CODE:-}" && [ "$EXIT_CODE" -lt 128 ] && [ -n "$CUR_FP" ]; then
    ai_write_bun_marker "$MARKER" "$CUR_FP" "$EXIT_CODE"
  fi

  if [ "$EXIT_CODE" = "0" ]; then
    if [ -n "$ELAPSED" ]; then
      ai_emit_additional_context "PostToolUse" "$SCRIPT OK (${ELAPSED}s) - full log: $LOG"
    fi
    ai_emit_additional_context "PostToolUse" "$SCRIPT OK - full log: $LOG"
  fi

  SUMMARY=$(ai_bun_failure_summary "$SCRIPT" "$LOG" "$EXIT_CODE" "$ELAPSED" "$COMBINED")
  ai_emit_block "$SUMMARY"
fi

ai_emit_continue
