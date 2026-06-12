#!/bin/bash

# Focused ai-hooks shell tests for Codex apply_patch payload wiring. Extracted
# from scripts/ai-hooks/test.sh so the Codex adapter shape can be run on its own
# (`bash scripts/ai-hooks/test-codex-wiring.sh`); the aggregate runner invokes
# it as one step.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../tests/lib/test-git-env.sh
. "$SCRIPT_DIR/../tests/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)

# shellcheck source=test-support.sh
. "$SCRIPT_DIR/test-support.sh"

TMP_ROOT=$(mktemp -d /tmp/musi-ai-hooks-codex-wiring-test.XXXXXX)
trap 'rm -rf "$TMP_ROOT"' EXIT

# --- protected-files Codex wiring --------------------------------------------
PROTECTED_CODEX_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  '*** Update File: packages/server/prisma/schema.prisma' \
  '@@' \
  '-old' \
  '+new' \
  '*** Update File: .husky/pre-commit' \
  '@@' \
  '-old' \
  '+new' \
  '*** End Patch')
PROTECTED_CODEX_OUTPUT=$(
  jq -n --arg command "$PROTECTED_CODEX_PATCH" '{tool_name:"apply_patch",tool_input:{command:$command}}' \
    | CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$REPO_ROOT/.codex/hooks/protected-files.sh"
)
assert_hook_json "$PROTECTED_CODEX_OUTPUT"
[ "$(jq -r '.hookSpecificOutput.hookEventName // empty' <<< "$PROTECTED_CODEX_OUTPUT")" = "PreToolUse" ] \
  || fail "Codex protected-files hook should emit PreToolUse context: $PROTECTED_CODEX_OUTPUT"
PROTECTED_CODEX_CONTEXT=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$PROTECTED_CODEX_OUTPUT")
assert_contains "$PROTECTED_CODEX_CONTEXT" "protected-files: Editing Prisma schema. Create a migration"
assert_contains "$PROTECTED_CODEX_CONTEXT" "protected-files: Editing a git hook."

PROTECTED_CODEX_NEGATIVE_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  '*** Update File: packages/server/src/main.ts' \
  '@@' \
  '-old' \
  '+new' \
  '*** End Patch')
PROTECTED_CODEX_NEGATIVE_OUTPUT=$(
  jq -n --arg command "$PROTECTED_CODEX_NEGATIVE_PATCH" '{tool_name:"apply_patch",tool_input:{command:$command}}' \
    | CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$REPO_ROOT/.codex/hooks/protected-files.sh"
)
assert_hook_continue_json "$PROTECTED_CODEX_NEGATIVE_OUTPUT"

PROTECTED_SUBDIR_ROOT="$TMP_ROOT/protected-subdir"
PROTECTED_SUBDIR_PACKAGE="$PROTECTED_SUBDIR_ROOT/packages/shared"
mkdir -p "$PROTECTED_SUBDIR_PACKAGE/src/schemas"
printf 'export const localSchema = true;\n' > "$PROTECTED_SUBDIR_PACKAGE/src/schemas/local-codex-schema.ts"
PROTECTED_SUBDIR_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  '*** Update File: src/schemas/local-codex-schema.ts' \
  '@@' \
  '-old' \
  '+new' \
  '*** End Patch')
PROTECTED_SUBDIR_OUTPUT=$(
  cd "$PROTECTED_SUBDIR_PACKAGE" || exit 1
  jq -n --arg command "$PROTECTED_SUBDIR_PATCH" '{tool_name:"apply_patch",tool_input:{command:$command}}' \
    | CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$REPO_ROOT/.codex/hooks/protected-files.sh"
)
assert_hook_json "$PROTECTED_SUBDIR_OUTPUT"
PROTECTED_SUBDIR_CONTEXT=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$PROTECTED_SUBDIR_OUTPUT")
assert_contains "$PROTECTED_SUBDIR_CONTEXT" "Shared schemas are the source of truth"

# --- doc-length Codex wiring --------------------------------------------------
DOC_LENGTH_AGENTS_DOC="$TMP_ROOT/AGENTS.md"
for _ in $(seq 1 251); do
  printf 'line\n' >> "$DOC_LENGTH_AGENTS_DOC"
done
DOC_LENGTH_CLAUDE_DOC="$TMP_ROOT/sub/CLAUDE.md"
mkdir -p "$(dirname "$DOC_LENGTH_CLAUDE_DOC")"
for _ in $(seq 1 252); do
  printf 'line\n' >> "$DOC_LENGTH_CLAUDE_DOC"
done
DOC_LENGTH_CODEX_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  "*** Update File: $DOC_LENGTH_AGENTS_DOC" \
  '@@' \
  '-line' \
  '+line' \
  "*** Update File: $DOC_LENGTH_CLAUDE_DOC" \
  '@@' \
  '-line' \
  '+line' \
  '*** End Patch')
DOC_LENGTH_CODEX_OUTPUT=$(
  jq -n --arg command "$DOC_LENGTH_CODEX_PATCH" '{tool_name:"apply_patch",tool_input:{command:$command}}' \
    | CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$REPO_ROOT/.codex/hooks/doc-length.sh"
)
assert_hook_json "$DOC_LENGTH_CODEX_OUTPUT"
[ "$(jq -r '.hookSpecificOutput.hookEventName // empty' <<< "$DOC_LENGTH_CODEX_OUTPUT")" = "PostToolUse" ] \
  || fail "Codex doc-length hook should emit PostToolUse context: $DOC_LENGTH_CODEX_OUTPUT"
DOC_LENGTH_CODEX_CONTEXT=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$DOC_LENGTH_CODEX_OUTPUT")
assert_contains "$DOC_LENGTH_CODEX_CONTEXT" "AGENTS.md is 251 lines"
assert_contains "$DOC_LENGTH_CODEX_CONTEXT" "CLAUDE.md is 252 lines"

SHORT_CODEX_DOC="$TMP_ROOT/short/AGENTS.md"
mkdir -p "$(dirname "$SHORT_CODEX_DOC")"
printf 'short\n' > "$SHORT_CODEX_DOC"
DOC_LENGTH_CODEX_NEGATIVE_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  "*** Update File: $SHORT_CODEX_DOC" \
  '@@' \
  '-short' \
  '+short' \
  '*** End Patch')
DOC_LENGTH_CODEX_NEGATIVE_OUTPUT=$(
  jq -n --arg command "$DOC_LENGTH_CODEX_NEGATIVE_PATCH" '{tool_name:"apply_patch",tool_input:{command:$command}}' \
    | CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$REPO_ROOT/.codex/hooks/doc-length.sh"
)
assert_hook_continue_json "$DOC_LENGTH_CODEX_NEGATIVE_OUTPUT"

DOC_LENGTH_SUBDIR="$TMP_ROOT/doc-subdir"
mkdir -p "$DOC_LENGTH_SUBDIR"
DOC_LENGTH_SUBDIR_AGENTS="$DOC_LENGTH_SUBDIR/AGENTS.md"
for _ in $(seq 1 251); do
  printf 'line\n' >> "$DOC_LENGTH_SUBDIR_AGENTS"
done
DOC_LENGTH_SUBDIR_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  '*** Update File: AGENTS.md' \
  '@@' \
  '-line' \
  '+line' \
  '*** End Patch')
DOC_LENGTH_SUBDIR_OUTPUT=$(
  cd "$DOC_LENGTH_SUBDIR" || exit 1
  jq -n --arg command "$DOC_LENGTH_SUBDIR_PATCH" '{tool_name:"apply_patch",tool_input:{command:$command}}' \
    | CLAUDE_PROJECT_DIR="$REPO_ROOT" bash "$REPO_ROOT/.codex/hooks/doc-length.sh"
)
assert_hook_json "$DOC_LENGTH_SUBDIR_OUTPUT"
DOC_LENGTH_SUBDIR_CONTEXT=$(jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$DOC_LENGTH_SUBDIR_OUTPUT")
assert_contains "$DOC_LENGTH_SUBDIR_CONTEXT" "AGENTS.md is 251 lines"

# --- prisma-generate Codex wiring --------------------------------------------
PRISMA_CODEX_FAKE_BIN="$TMP_ROOT/prisma-codex-fake-bin"
PRISMA_CODEX_SENTINEL="$TMP_ROOT/prisma-codex-generate-called"
mkdir -p "$PRISMA_CODEX_FAKE_BIN"
{
  printf '#!/bin/bash\n'
  printf 'touch "$AI_PRISMA_TEST_SENTINEL"\n'
  printf 'exit 0\n'
} > "$PRISMA_CODEX_FAKE_BIN/bun"
chmod +x "$PRISMA_CODEX_FAKE_BIN/bun"

PRISMA_CODEX_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  '*** Update File: packages/server/prisma/schema.prisma' \
  '@@' \
  '-old' \
  '+new' \
  '*** End Patch')
PRISMA_CODEX_STATE_ROOT="$TMP_ROOT/prisma-codex-state-root"
PRISMA_CODEX_STATE_DIR="$TMP_ROOT/prisma-codex-state-dir"
PRISMA_CODEX_OUTPUT=$(
  jq -n --arg command "$PRISMA_CODEX_PATCH" '{tool_name:"apply_patch",tool_input:{command:$command}}' \
    | AI_STATE_ROOT="$PRISMA_CODEX_STATE_ROOT" \
      AI_PRISMA_STATE_DIR="$PRISMA_CODEX_STATE_DIR" \
      AI_PRISMA_TEST_SENTINEL="$PRISMA_CODEX_SENTINEL" \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" \
      PATH="$PRISMA_CODEX_FAKE_BIN:$PATH" \
      bash "$REPO_ROOT/.codex/hooks/prisma-generate.sh" 2>/dev/null
)
assert_hook_continue_json "$PRISMA_CODEX_OUTPUT"
[ -e "$PRISMA_CODEX_SENTINEL" ] || fail "Codex prisma hook should invoke prisma generate for schema apply_patch"
rm -f "$PRISMA_CODEX_SENTINEL"

PRISMA_CODEX_RELATIVE_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  '*** Update File: prisma/schema.prisma' \
  '@@' \
  '-old' \
  '+new' \
  '*** End Patch')
PRISMA_CODEX_RELATIVE_STATE_ROOT="$TMP_ROOT/prisma-codex-relative-state-root"
PRISMA_CODEX_RELATIVE_STATE_DIR="$TMP_ROOT/prisma-codex-relative-state-dir"
PRISMA_CODEX_RELATIVE_OUTPUT=$(
  cd "$REPO_ROOT/packages/server"
  jq -n --arg command "$PRISMA_CODEX_RELATIVE_PATCH" '{tool_name:"apply_patch",tool_input:{command:$command}}' \
    | AI_STATE_ROOT="$PRISMA_CODEX_RELATIVE_STATE_ROOT" \
      AI_PRISMA_STATE_DIR="$PRISMA_CODEX_RELATIVE_STATE_DIR" \
      AI_PRISMA_TEST_SENTINEL="$PRISMA_CODEX_SENTINEL" \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" \
      PATH="$PRISMA_CODEX_FAKE_BIN:$PATH" \
      bash "$REPO_ROOT/.codex/hooks/prisma-generate.sh" 2>/dev/null
)
assert_hook_continue_json "$PRISMA_CODEX_RELATIVE_OUTPUT"
[ -e "$PRISMA_CODEX_SENTINEL" ] \
  || fail "Codex prisma hook should invoke prisma generate for cwd-relative schema apply_patch"
rm -f "$PRISMA_CODEX_SENTINEL"

PRISMA_CODEX_NEGATIVE_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  '*** Update File: packages/server/src/main.ts' \
  '@@' \
  '-old' \
  '+new' \
  '*** End Patch')
PRISMA_CODEX_NEGATIVE_STATE_ROOT="$TMP_ROOT/prisma-codex-negative-state-root"
PRISMA_CODEX_NEGATIVE_STATE_DIR="$TMP_ROOT/prisma-codex-negative-state-dir"
PRISMA_CODEX_NEGATIVE_OUTPUT=$(
  jq -n --arg command "$PRISMA_CODEX_NEGATIVE_PATCH" '{tool_name:"apply_patch",tool_input:{command:$command}}' \
    | AI_STATE_ROOT="$PRISMA_CODEX_NEGATIVE_STATE_ROOT" \
      AI_PRISMA_STATE_DIR="$PRISMA_CODEX_NEGATIVE_STATE_DIR" \
      AI_PRISMA_TEST_SENTINEL="$PRISMA_CODEX_SENTINEL" \
      CLAUDE_PROJECT_DIR="$REPO_ROOT" \
      PATH="$PRISMA_CODEX_FAKE_BIN:$PATH" \
      bash "$REPO_ROOT/.codex/hooks/prisma-generate.sh" 2>/dev/null
)
assert_hook_continue_json "$PRISMA_CODEX_NEGATIVE_OUTPUT"
[ ! -e "$PRISMA_CODEX_SENTINEL" ] || fail "Codex prisma hook should not invoke prisma generate for non-schema apply_patch"

printf 'codex wiring ai-hooks tests passed\n'
