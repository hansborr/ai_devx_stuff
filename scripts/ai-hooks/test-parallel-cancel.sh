#!/bin/bash

# Focused tests for the PostToolBatch parallel-cancel inoculation injector
# (.claude/hooks/parallel-cancel-note.sh, Phase 2E). Runs standalone or via the
# aggregate scripts/ai-hooks/test.sh. Uses an isolated temp git repo so the
# kill-switch case can touch/rm the marker without littering the real tree and
# so the hook resolves its HOOK_LIB and REPO_ROOT inside the sandbox.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)

# shellcheck source=test-support.sh
. "$SCRIPT_DIR/test-support.sh"
# shellcheck source=claude-guidance.sh
. "$SCRIPT_DIR/claude-guidance.sh"

TMP_ROOT=$(mktemp -d /tmp/musi-parallel-cancel-test.XXXXXX)
trap 'rm -rf "$TMP_ROOT"' EXIT

PC_REPO="$TMP_ROOT/repo"
mkdir -p "$PC_REPO/scripts/ai-hooks" "$PC_REPO/.claude/hooks"
git init -q "$PC_REPO"
cp "$REPO_ROOT/scripts/ai-hooks/common.sh" \
  "$REPO_ROOT/scripts/ai-hooks/claude-guidance.sh" \
  "$PC_REPO/scripts/ai-hooks/"
cp "$REPO_ROOT/.claude/hooks/parallel-cancel-note.sh" "$PC_REPO/.claude/hooks/"
HOOK="$PC_REPO/.claude/hooks/parallel-cancel-note.sh"

run_hook() {
  printf '%s' "$1" | (cd "$PC_REPO" && bash "$HOOK")
}

# A batch where a fast bare failure cascade-cancelled a later-queued sibling:
# the cancelled sibling's tool_response carries the marker as a string, the
# shape PostToolBatch emits on CLI 2.1.158 (see Phase 0 results).
CANCEL_PAYLOAD=$(jq -n '{
  hook_event_name: "PostToolBatch",
  session_id: "sess-1",
  tool_calls: [
    {tool_name:"Bash", tool_input:{command:"sleep 8"}, tool_use_id:"a", tool_response:"slept"},
    {tool_name:"Bash", tool_input:{command:"exit 4"}, tool_use_id:"b", tool_response:"Exit code 4"},
    {tool_name:"Bash", tool_input:{command:"sleep 8"}, tool_use_id:"c", tool_response:"<tool_use_error>Cancelled: parallel tool call Bash(exit 4) errored</tool_use_error>"}
  ]
}')

OUT=$(run_hook "$CANCEL_PAYLOAD")
assert_hook_json "$OUT"
[ "$(jq -r '.hookSpecificOutput.hookEventName' <<< "$OUT")" = "PostToolBatch" ] \
  || fail "cancelled batch should emit a PostToolBatch additionalContext: $OUT"
INJECTED=$(jq -r '.hookSpecificOutput.additionalContext' <<< "$OUT")
[ "$INJECTED" = "$AI_CLAUDE_CANCEL_INOCULATION" ] \
  || fail "injected context must match the shared inoculation wording verbatim: $OUT"
[ "$(jq -r '.continue // empty' <<< "$OUT")" = "" ] \
  || fail "injection output should not also set continue: $OUT"

# Only the recorded bare-string shape counts. An object-shaped tool_response
# embedding the marker is not the shape the harness emits for a cancelled
# sibling (Phase 0: it is a plain string), so it must not inject.
OBJ_PAYLOAD=$(jq -n '{
  hook_event_name: "PostToolBatch",
  tool_calls: [
    {tool_name:"Bash", tool_input:{command:"sleep 8"}, tool_use_id:"c", tool_response:{raw:"<tool_use_error>Cancelled: parallel tool call Bash(exit 4) errored</tool_use_error>"}}
  ]
}')
assert_hook_continue_json "$(run_hook "$OBJ_PAYLOAD")"

# A clean batch (no cancel marker) injects nothing.
CLEAN_PAYLOAD=$(jq -n '{
  hook_event_name: "PostToolBatch",
  tool_calls: [
    {tool_name:"Bash", tool_input:{command:"echo hi"}, tool_use_id:"a", tool_response:"hi"},
    {tool_name:"Bash", tool_input:{command:"echo bye"}, tool_use_id:"b", tool_response:"bye"}
  ]
}')
assert_hook_continue_json "$(run_hook "$CLEAN_PAYLOAD")"

# An ordinary (non-parallel) errored call without the cancel marker is not the
# cascade and must not inject — e.g. a single failing command.
SINGLE_FAIL_PAYLOAD=$(jq -n '{
  hook_event_name: "PostToolBatch",
  tool_calls: [
    {tool_name:"Bash", tool_input:{command:"exit 4"}, tool_use_id:"b", tool_response:"Exit code 4"}
  ]
}')
assert_hook_continue_json "$(run_hook "$SINGLE_FAIL_PAYLOAD")"

# False-positive guard: a command that merely PRINTS the bare phrase (e.g.
# cat-ing this repo's docs) is not a cascade — without the <tool_use_error>
# wrapper, no injection.
PRINTS_PHRASE_PAYLOAD=$(jq -n '{
  hook_event_name: "PostToolBatch",
  tool_calls: [
    {tool_name:"Bash", tool_input:{command:"cat decisions-build.md"}, tool_use_id:"a", tool_response:"... Cancelled: parallel tool call Bash(...) errored ..."}
  ]
}')
assert_hook_continue_json "$(run_hook "$PRINTS_PHRASE_PAYLOAD")"

# False-positive guard: cat-ing a doc that quotes the FULL wrapped marker on an
# interior line. Several repo docs do exactly this. The wrapper is present but
# not at the absolute start of the response (\A), so no injection — this is the
# vector that bit the first cut of the regex.
EMBEDDED_MARKER_PAYLOAD=$(jq -n '{
  hook_event_name: "PostToolBatch",
  tool_calls: [
    {tool_name:"Bash", tool_input:{command:"cat backlog/parallel-cancel-guidance-hook.md"}, tool_use_id:"a", tool_response:"# Doc heading\n\nExample output:\n<tool_use_error>Cancelled: parallel tool call Bash(<cmd>) errored</tool_use_error>\n\nmore prose"}
  ]
}')
assert_hook_continue_json "$(run_hook "$EMBEDDED_MARKER_PAYLOAD")"

# False-positive guard: our own hard-block reason embeds the inoculation suffix,
# which quotes the phrase. A blocked call's tool_response (even wrapped) must NOT
# re-trigger the injector, because the wrapper does not immediately precede the
# phrase — "Cancelled" sits deep inside the prose, not right after the tag.
BLOCK_REASON=$(ai_claude_cancel_inoculation "Do not run docker or docker-compose commands.")
BLOCKED_CALL_PAYLOAD=$(jq -n --arg r "<tool_use_error>$BLOCK_REASON</tool_use_error>" '{
  hook_event_name: "PostToolBatch",
  tool_calls: [
    {tool_name:"Bash", tool_input:{command:"docker ps"}, tool_use_id:"a", tool_response:$r}
  ]
}')
assert_hook_continue_json "$(run_hook "$BLOCKED_CALL_PAYLOAD")"

# Empty / missing payload degrades to continue.
assert_hook_continue_json "$(run_hook "")"

# Kill switch suppresses injection even when the marker is present.
touch "$PC_REPO/.no-parallel-cancel-note"
assert_hook_continue_json "$(run_hook "$CANCEL_PAYLOAD")"
rm -f "$PC_REPO/.no-parallel-cancel-note"

printf 'parallel-cancel tests passed\n'
