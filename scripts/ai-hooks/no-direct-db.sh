#!/bin/bash
# Hook: block hook bypasses and direct DB/infrastructure CLI commands.

set -u

HOOK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$HOOK_LIB/common.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/claude-adapter.sh"
# shellcheck source=/dev/null
. "$HOOK_LIB/policy.sh"

PAYLOAD=$(ai_read_payload)
CMD=$(ai_payload_command "$PAYLOAD")
[ -z "$CMD" ] && ai_emit_continue

# Resolve the checkout the command targets (leading `cd <dir>`/`git -C <dir>`,
# else payload cwd, else this hook's repo root) so branch-scoped policy — the
# push/commit-on-main guards — evaluates that checkout's branch, not the hook
# process cwd. A `cd <main> && git push` fired from a feature worktree must be
# judged against main; without the resolved root it reads the feature branch.
# Kept in a local name (not the global REPO_ROOT the protected-file path
# resolver reads) so that scanner's existing cwd-based behavior is untouched.
HOOK_REPO_ROOT=$(git -C "$HOOK_LIB" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
WORK_ROOT=$(git -C "$(ai_resolve_target_dir "$CMD" "$(ai_payload_cwd "$PAYLOAD")" "$HOOK_REPO_ROOT")" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$HOOK_REPO_ROOT")

declare -A POLICY_DECISION=()
ai_policy_decision POLICY_DECISION "$CMD" "$WORK_ROOT"
case "${POLICY_DECISION[verdict]-}" in
  advise)
    # Soft nudges should return guidance without turning advisory policy into a
    # hard block.
    ai_claude_result_command "${POLICY_DECISION[message]-}" "$AI_POLICY_GUIDANCE_TMP_PREFIX"
    ;;
  block) ai_emit_block "${POLICY_DECISION[message]-}" ;;
  allow) ;;
  *) ai_emit_block "$AI_POLICY_RULE_DATA_ERROR" ;;
esac

# Fail closed when the commit names a checkout that could not be resolved: the
# WORK_ROOT above then silently became this hook's own checkout, so the branch
# guard just cleared a repository it never looked at.
if REASON=$(ai_unverifiable_commit_target_reason \
  "$CMD" "$(ai_payload_cwd "$PAYLOAD")" "$HOOK_REPO_ROOT"); then
  ai_emit_block "$REASON"
fi

if ADVISORY=$(ai_policy_advisory_context "$CMD"); then
  ai_emit_additional_context "PreToolUse" "$ADVISORY"
fi

ai_emit_continue
