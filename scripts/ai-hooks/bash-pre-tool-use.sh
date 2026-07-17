#!/bin/bash
# Shared Bash-surface PreToolUse aggregate: command policy blocks, git-commit
# state capture, and the wrapped-`bun run` cache check. Consumes the
# tool_input.command payload dialect; Codex execs this directly and the Copilot
# adapter normalizes its payload first. Claude deliberately covers the same
# surfaces through its direct adapters (no-direct-db, git-commit-quiet,
# bun-run-quiet) because it can rewrite commands via updatedInput.

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

PAYLOAD=$(ai_read_payload)
CMD=$(ai_payload_command "$PAYLOAD")
[ -z "$CMD" ] && ai_emit_continue

TOOL_USE_ID=$(ai_payload_tool_use_id "$PAYLOAD")
ai_cache_init

# Resolve the checkout the command acts on — its leading `cd <dir>`/`git -C <dir>`
# form, else the payload cwd, else this hook's own repo root — so branch-scoped
# policy is judged against that checkout, not the hook process cwd. Pushes have
# no executing wrapper, so this pre hook is the only gate that can stop a
# `cd <main> && git push` issued from a feature worktree; without the resolved
# root the push-to-main guard reads the feature branch and lets it through.
# Reused below for the commit HEAD snapshot so the post hook reads the same root.
WORK_ROOT=$(git -C "$(ai_resolve_target_dir "$CMD" "$(ai_payload_cwd "$PAYLOAD")" "$REPO_ROOT")" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$REPO_ROOT")

if REASON=$(ai_policy_violation_reason "$CMD" "$WORK_ROOT"); then
  ai_emit_block "$REASON"
fi

if ADVISORY=$(ai_policy_advisory_context "$CMD"); then
  ai_emit_additional_context "PreToolUse" "$ADVISORY"
fi

if [ -n "$TOOL_USE_ID" ] && ai_is_git_commit_cmd "$CMD"; then
  # Snapshot HEAD in the checkout the commit lands in (the already-resolved
  # WORK_ROOT), not REPO_ROOT (the hook file's own checkout). A /workspace-rooted
  # hook process observing a linked worktree commit would otherwise never see
  # HEAD move — J. Persist WORK_ROOT so the post hook reads back the same root.
  HEAD_BEFORE=$(git -C "$WORK_ROOT" rev-parse HEAD 2>/dev/null || echo none)
  {
    printf 'HEAD_BEFORE=%s\n' "$HEAD_BEFORE"
    printf 'WORK_ROOT=%s\n' "$WORK_ROOT"
    printf 'START_TS=%s\n' "$(date +%s)"
  } > "$AI_GIT_STATE_DIR/$TOOL_USE_ID"
fi

FORCE_VERIFY_REQ=""
if ai_has_force_verify_prefix "$CMD"; then
  FORCE_VERIFY_REQ=1
fi
MATCH_CMD=$(ai_strip_force_verify_prefix "$CMD")

if ai_is_wrapped_bun_cmd "$MATCH_CMD"; then
  if ai_bun_cmd_bypasses_cache "$MATCH_CMD"; then
    ai_emit_continue
  fi

  SCRIPT=$(ai_bun_script_from_cmd "$MATCH_CMD")
  SCRIPT_SAFE=$(ai_safe_script_name "$SCRIPT")
  LOG="$AI_BUN_LOG_DIR/$SCRIPT_SAFE.log"
  # Argv-scoped marker (H1/H2): keyed on the exact argv tail so a broader or
  # corrected command does not replay a narrower/older run's cached state.
  MARKER="$AI_BUN_LOG_DIR/$(ai_bun_marker_name "$MATCH_CMD")"
  CUR_FP_VALID=1
  if ! CUR_FP=$(musi_require_fingerprint \
    "Bash pre-tool cache" ai_worktree_fingerprint "$REPO_ROOT"); then
    CUR_FP_VALID=0
    CUR_FP=""
  fi

  if [ "$CUR_FP_VALID" -eq 1 ] \
    && ai_read_bun_marker "$MARKER" \
    && [ -z "$FORCE_VERIFY_REQ" ] \
    && [ "${FORCE_VERIFY:-}" != "1" ]; then
    NOW=$(date +%s)
    AGE=$((NOW - AI_MARKER_LAST_TS))

    if ai_marker_age_within_ttl "$AGE" "$AI_BUN_TTL" && [ "$AI_MARKER_LAST_FP" = "$CUR_FP" ]; then
      if [ "$AI_MARKER_LAST_EXIT" -eq 0 ]; then
        ai_emit_block "Skipped rerun: $SCRIPT cached OK (${AGE}s ago, unchanged worktree) - prefix command with FORCE_VERIFY=1 to re-run. Full log: $LOG"
      fi

      ai_emit_block "$(ai_bun_cached_failure_summary "$SCRIPT" "$LOG" "$AGE" "$AI_MARKER_LAST_EXIT")"
    fi
  fi

  if [ -n "$TOOL_USE_ID" ] && [ "$CUR_FP_VALID" -eq 1 ]; then
    {
      printf 'SCRIPT=%s\n' "$SCRIPT"
      printf 'LOG=%s\n' "$LOG"
      printf 'CUR_FP=%s\n' "$CUR_FP"
      printf 'START_TS=%s\n' "$(date +%s)"
    } > "$AI_BUN_STATE_DIR/$TOOL_USE_ID"
  fi
fi

ai_emit_continue
