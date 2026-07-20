#!/bin/bash

# Focused ai-hooks shell tests for Copilot payload wiring: the .copilot/hooks
# adapters translate Copilot's camelCase payloads (toolArgs as a JSON string,
# no per-call tool_use_id; native matcher selection happens in repo config)
# into the shared body dialect and translate Claude-shaped responses into
# Copilot hook output. Runs standalone (`bash scripts/ai-hooks/test-copilot-wiring.sh`);
# the aggregate runner invokes it as one step.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../tests/lib/test-git-env.sh
. "$SCRIPT_DIR/../tests/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)

# shellcheck source=test-support.sh
. "$SCRIPT_DIR/test-support.sh"

TMP_ROOT=$(mktemp -d /tmp/musi-ai-hooks-copilot-wiring-test.XXXXXX)
trap 'rm -rf "$TMP_ROOT"' EXIT

# The payload builders below stay per-backend by design: they encode Copilot's
# camelCase toolArgs dialect (toolArgs as a JSON string, synthesized session
# ids), so they are backend fixtures rather than test-support.sh candidates.
copilot_edit_payload() {
  local path="$1"

  jq -n --arg path "$path" \
    '{sessionId: "copilot-wiring-session", timestamp: 1, cwd: "/",
      toolName: "edit",
      toolArgs: ({path: $path, old_str: "a", new_str: "b"} | tojson)}'
}

copilot_bash_payload() {
  local command="$1"

  jq -n --arg command "$command" \
    '{sessionId: "copilot-wiring-session", timestamp: 1, cwd: "/",
      toolName: "bash",
      toolArgs: ({command: $command} | tojson)}'
}

copilot_bash_result_payload() {
  local command="$1"
  local text="$2"

  jq -n --arg command "$command" --arg text "$text" \
    '{sessionId: "copilot-wiring-session", timestamp: 1, cwd: "/",
      toolName: "bash",
      toolArgs: ({command: $command} | tojson),
      toolResult: {resultType: "success", textResultForLlm: $text}}'
}

# --- protected-files Copilot wiring -------------------------------------------
PROTECTED_OUTPUT=$(
  copilot_edit_payload "packages/server/prisma/schema.prisma" \
    | AI_STATE_ROOT="$TMP_ROOT/protected-state" \
      AI_PROTECTED_FILES_THROTTLE_TTL=0 \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" \
      bash "$REPO_ROOT/.copilot/hooks/protected-files.sh"
)
assert_hook_json "$PROTECTED_OUTPUT"
PROTECTED_CONTEXT=$(jq -r '.additionalContext // empty' <<< "$PROTECTED_OUTPUT")
assert_contains "$PROTECTED_CONTEXT" "protected-files: Editing Prisma schema. Create a migration"

PROTECTED_NEGATIVE_OUTPUT=$(
  copilot_edit_payload "packages/server/src/main.ts" \
    | AI_STATE_ROOT="$TMP_ROOT/protected-state" \
      AI_PROTECTED_FILES_THROTTLE_TTL=0 \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" \
      bash "$REPO_ROOT/.copilot/hooks/protected-files.sh"
)
assert_no_output "$PROTECTED_NEGATIVE_OUTPUT" "copilot protected-files on unprotected path"

PROTECTED_VIEW_OUTPUT=$(
  jq -n '{sessionId: "copilot-wiring-session", toolName: "view",
          toolArgs: ({path: "packages/server/prisma/schema.prisma"} | tojson)}' \
    | AI_STATE_ROOT="$TMP_ROOT/protected-state" \
      AI_PROTECTED_FILES_THROTTLE_TTL=0 \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" \
      bash "$REPO_ROOT/.copilot/hooks/protected-files.sh"
)
assert_no_output "$PROTECTED_VIEW_OUTPUT" "copilot protected-files on non-edit tool"

# --- doc-length Copilot wiring -------------------------------------------------
DOC_LENGTH_DOC="$TMP_ROOT/AGENTS.md"
for _ in $(seq 1 251); do
  printf 'line\n' >> "$DOC_LENGTH_DOC"
done
DOC_LENGTH_OUTPUT=$(
  copilot_edit_payload "$DOC_LENGTH_DOC" \
    | CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$REPO_ROOT/.copilot/hooks/doc-length.sh"
)
assert_hook_json "$DOC_LENGTH_OUTPUT"
DOC_LENGTH_CONTEXT=$(jq -r '.additionalContext // empty' <<< "$DOC_LENGTH_OUTPUT")
assert_contains "$DOC_LENGTH_CONTEXT" "AGENTS.md is 251 lines"

SHORT_DOC="$TMP_ROOT/short/AGENTS.md"
mkdir -p "$(dirname "$SHORT_DOC")"
printf 'short\n' > "$SHORT_DOC"
DOC_LENGTH_NEGATIVE_OUTPUT=$(
  copilot_edit_payload "$SHORT_DOC" \
    | CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$REPO_ROOT/.copilot/hooks/doc-length.sh"
)
assert_no_output "$DOC_LENGTH_NEGATIVE_OUTPUT" "copilot doc-length on short doc"

# --- prisma-generate Copilot wiring --------------------------------------------
PRISMA_FAKE_BIN="$TMP_ROOT/prisma-fake-bin"
PRISMA_SENTINEL="$TMP_ROOT/prisma-generate-called"
make_prisma_sentinel_bun_shim "$PRISMA_FAKE_BIN"

PRISMA_OUTPUT=$(
  copilot_edit_payload "packages/server/prisma/schema.prisma" \
    | AI_STATE_ROOT="$TMP_ROOT/prisma-state-root" \
      AI_PRISMA_STATE_DIR="$TMP_ROOT/prisma-state-dir" \
      AI_PRISMA_TEST_SENTINEL="$PRISMA_SENTINEL" \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" \
      PATH="$PRISMA_FAKE_BIN:$PATH" \
      bash "$REPO_ROOT/.copilot/hooks/prisma-generate.sh" 2>/dev/null
)
assert_no_output "$PRISMA_OUTPUT" "copilot prisma hook on clean generate"
[ -e "$PRISMA_SENTINEL" ] || fail "copilot prisma hook should invoke prisma generate for schema edit"
rm -f "$PRISMA_SENTINEL"

PRISMA_NEGATIVE_OUTPUT=$(
  copilot_edit_payload "packages/server/src/main.ts" \
    | AI_STATE_ROOT="$TMP_ROOT/prisma-negative-state-root" \
      AI_PRISMA_STATE_DIR="$TMP_ROOT/prisma-negative-state-dir" \
      AI_PRISMA_TEST_SENTINEL="$PRISMA_SENTINEL" \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" \
      PATH="$PRISMA_FAKE_BIN:$PATH" \
      bash "$REPO_ROOT/.copilot/hooks/prisma-generate.sh" 2>/dev/null
)
assert_no_output "$PRISMA_NEGATIVE_OUTPUT" "copilot prisma hook on non-schema edit"
[ ! -e "$PRISMA_SENTINEL" ] || fail "copilot prisma hook should not invoke prisma generate for non-schema edit"

# --- pre-tool-use Copilot wiring (policy deny + surface filter) ----------------
POLICY_CMD='psql -h localhost -c "select 1"'
POLICY_OUTPUT=$(
  copilot_bash_payload "$POLICY_CMD" \
    | AI_STATE_ROOT="$TMP_ROOT/pre-state" \
      AI_BUN_LOG_DIR="$TMP_ROOT/pre-bun-logs" \
      bash "$REPO_ROOT/.copilot/hooks/pre-tool-use.sh"
)
assert_hook_json "$POLICY_OUTPUT"
[ "$(jq -r '.permissionDecision // empty' <<< "$POLICY_OUTPUT")" = "deny" ] \
  || fail "copilot pre hook should deny policy violations: $POLICY_OUTPUT"
POLICY_REASON=$(jq -r '.permissionDecisionReason // empty' <<< "$POLICY_OUTPUT")
assert_contains "$POLICY_REASON" "Do not use PostgreSQL CLI tools directly"

BENIGN_OUTPUT=$(
  copilot_bash_payload "echo hi" \
    | AI_STATE_ROOT="$TMP_ROOT/pre-state" \
      AI_BUN_LOG_DIR="$TMP_ROOT/pre-bun-logs" \
      bash "$REPO_ROOT/.copilot/hooks/pre-tool-use.sh"
)
assert_no_output "$BENIGN_OUTPUT" "copilot pre hook on benign command"

NON_BASH_OUTPUT=$(
  copilot_edit_payload "packages/server/src/main.ts" \
    | AI_STATE_ROOT="$TMP_ROOT/pre-state" \
      AI_BUN_LOG_DIR="$TMP_ROOT/pre-bun-logs" \
      bash "$REPO_ROOT/.copilot/hooks/pre-tool-use.sh"
)
assert_no_output "$NON_BASH_OUTPUT" "copilot pre hook on non-bash tool"

# --- synthesized tool_use_id uniqueness ---------------------------------------
ID_STATE_ROOT="$TMP_ROOT/id-state"
ID_LOG_DIR="$TMP_ROOT/id-logs"
ID_FIRST_OUTPUT=$(
  copilot_bash_payload "bun run lint:changed" \
    | AI_STATE_ROOT="$ID_STATE_ROOT" \
      AI_BUN_LOG_DIR="$ID_LOG_DIR" \
      bash "$REPO_ROOT/.copilot/hooks/pre-tool-use.sh"
)
assert_no_output "$ID_FIRST_OUTPUT" "copilot pre hook on first synthesized-id command"
ID_SECOND_OUTPUT=$(
  copilot_bash_payload "bun run typecheck" \
    | AI_STATE_ROOT="$ID_STATE_ROOT" \
      AI_BUN_LOG_DIR="$ID_LOG_DIR" \
      bash "$REPO_ROOT/.copilot/hooks/pre-tool-use.sh"
)
assert_no_output "$ID_SECOND_OUTPUT" "copilot pre hook on second synthesized-id command"
mapfile -t ID_STATE_FILES < <(
  find "$ID_STATE_ROOT/bun" -maxdepth 1 -type f -name 'copilot-copilot-wiring-session-*' | sort
)
[ "${#ID_STATE_FILES[@]}" -eq 2 ] \
  || fail "copilot pre hook should synthesize distinct state files per command, got ${#ID_STATE_FILES[@]}"
[ "$(basename "${ID_STATE_FILES[0]}")" != "$(basename "${ID_STATE_FILES[1]}")" ] \
  || fail "copilot synthesized tool_use_id should differ for different commands"

# --- pre/post wrapped bun correlation via synthesized tool_use_id --------------
BUN_STATE_ROOT="$TMP_ROOT/bun-state"
BUN_LOG_DIR="$TMP_ROOT/bun-logs"
BUN_CMD="bun run lint:changed"
PRE_BUN_OUTPUT=$(
  copilot_bash_payload "$BUN_CMD" \
    | AI_STATE_ROOT="$BUN_STATE_ROOT" \
      AI_BUN_LOG_DIR="$BUN_LOG_DIR" \
      bash "$REPO_ROOT/.copilot/hooks/pre-tool-use.sh"
)
assert_no_output "$PRE_BUN_OUTPUT" "copilot pre hook on uncached wrapped bun run"
BUN_STATE_FILES=("$BUN_STATE_ROOT/bun/copilot-copilot-wiring-session-"*)
[ -f "${BUN_STATE_FILES[0]}" ] \
  || fail "copilot pre hook should store bun state under a synthesized tool_use_id"

BUN_FAIL_TEXT=$(printf '%s\n' \
  'some lint failure output' \
  'error: script "lint:changed" exited with code 1' \
  '<shellId: 0 completed with exit code 1>')
POST_BUN_OUTPUT=$(
  copilot_bash_result_payload "$BUN_CMD" "$BUN_FAIL_TEXT" \
    | AI_STATE_ROOT="$BUN_STATE_ROOT" \
      AI_BUN_LOG_DIR="$BUN_LOG_DIR" \
      bash "$REPO_ROOT/.copilot/hooks/post-tool-use.sh"
)
assert_hook_json "$POST_BUN_OUTPUT"
POST_BUN_TEXT=$(jq -r '.modifiedResult.textResultForLlm // empty' <<< "$POST_BUN_OUTPUT")
# The elapsed suffix ("exit 1, 0s") proves the pre state's START_TS was
# correlated through the synthesized tool_use_id.
assert_contains "$POST_BUN_TEXT" "lint:changed failed (exit 1,"
[ ! -f "${BUN_STATE_FILES[0]}" ] \
  || fail "copilot post hook should consume the synthesized tool_use_id state file"
BUN_MARKER=("$BUN_LOG_DIR/last.lint_changed."*)
[ -f "${BUN_MARKER[0]}" ] || fail "copilot post hook should write the bun marker"
grep -q 'LAST_EXIT=1' "${BUN_MARKER[0]}" \
  || fail "copilot bun marker should record the parsed shellId exit code"

POST_PLAIN_OUTPUT=$(
  copilot_bash_result_payload "echo hi" "hi"$'\n''<shellId: 0 completed with exit code 0>' \
    | AI_STATE_ROOT="$BUN_STATE_ROOT" \
      AI_BUN_LOG_DIR="$BUN_LOG_DIR" \
      bash "$REPO_ROOT/.copilot/hooks/post-tool-use.sh"
)
assert_no_output "$POST_PLAIN_OUTPUT" "copilot post hook on unwrapped command"

# --- backlog-note-lint Copilot wiring ----------------------------------------
BACKLOG_COPILOT_DIR="$TMP_ROOT/backlog"
mkdir -p "$BACKLOG_COPILOT_DIR/pack"
BACKLOG_COPILOT_DIRTY="$BACKLOG_COPILOT_DIR/pack/dirty.md"
printf '# Dirty note\n\nNo front matter here.\n' > "$BACKLOG_COPILOT_DIRTY"
BACKLOG_COPILOT_OUTPUT=$(
  copilot_edit_payload "$BACKLOG_COPILOT_DIRTY" \
    | AI_BACKLOG_NOTES_DIR="$BACKLOG_COPILOT_DIR" \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$REPO_ROOT/.copilot/hooks/backlog-note-lint.sh"
)
assert_hook_json "$BACKLOG_COPILOT_OUTPUT"
BACKLOG_COPILOT_CONTEXT=$(jq -r '.additionalContext // empty' <<< "$BACKLOG_COPILOT_OUTPUT")
assert_contains "$BACKLOG_COPILOT_CONTEXT" "backlog:lint advisory findings"
assert_contains "$BACKLOG_COPILOT_CONTEXT" "Missing Status:"

BACKLOG_COPILOT_OUTSIDE="$TMP_ROOT/not-backlog/note.md"
mkdir -p "$(dirname "$BACKLOG_COPILOT_OUTSIDE")"
printf '# Outside\n\nno front matter\n' > "$BACKLOG_COPILOT_OUTSIDE"
BACKLOG_COPILOT_NEGATIVE_OUTPUT=$(
  copilot_edit_payload "$BACKLOG_COPILOT_OUTSIDE" \
    | AI_BACKLOG_NOTES_DIR="$BACKLOG_COPILOT_DIR" \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$REPO_ROOT/.copilot/hooks/backlog-note-lint.sh"
)
assert_no_output "$BACKLOG_COPILOT_NEGATIVE_OUTPUT" "copilot backlog-note-lint on non-backlog note"

printf 'copilot wiring ai-hooks tests passed\n'
