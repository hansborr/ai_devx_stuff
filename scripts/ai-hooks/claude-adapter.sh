#!/bin/bash

# Claude Code response shapes for the .claude/hooks adapters.
# Source after common.sh.
#
# Claude is the only agent surface that can answer a tool call by rewriting it
# rather than just allowing or denying it, so its adapters emit two response
# shapes no other vendor has. They live here for the same reason Copilot's
# payload translation lives in copilot-adapter.sh: common.sh's banner keeps it
# free of vendor-specific control flow, and these are as vendor-specific as the
# harness gets. The neutral emissions every adapter shares — continue, block,
# deny, and the payload readers — stay in common.sh.

ai_claude_updated_command() {
  local command="$1"
  jq -n --arg command "$command" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { command: $command }
    }
  }'
  exit 0
}

ai_claude_result_command() {
  local message="$1"
  local prefix="${2:-$AI_RESULT_COMMAND_TMP_PREFIX}"
  local result_file quoted

  result_file=$(mktemp "$prefix.XXXXXX")
  printf '%s\n' "$message" > "$result_file"
  # Real shell escaping (printf %q), not bare double quotes: the rewritten
  # command is re-parsed by the shell when the tool runs, and double quotes
  # still expand $()/backticks and let an embedded " break out. Today's prefixes
  # are metachar-free, so this is defense-in-depth against a future caller.
  printf -v quoted '%q' "$result_file"
  ai_claude_updated_command "cat $quoted; rm -f $quoted"
}
