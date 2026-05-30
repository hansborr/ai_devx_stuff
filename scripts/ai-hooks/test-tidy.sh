#!/bin/bash

# Focused ai-hooks shell tests for the tidy-edited-file hook. Extracted from
# scripts/ai-hooks/test.sh so this behavior family can be run on its own
# (`bash scripts/ai-hooks/test-tidy.sh`); the aggregate runner invokes it as one
# step. Shares the generic assertions in test-support.sh.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../test-git-env.sh
. "$SCRIPT_DIR/../test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)

# shellcheck source=test-support.sh
. "$SCRIPT_DIR/test-support.sh"

TMP_ROOT=$(mktemp -d /tmp/musi-ai-hooks-tidy-test.XXXXXX)
TIDY_REPO_TMP="$TMP_ROOT/tidy-repo"
trap 'rm -rf "$TMP_ROOT"' EXIT

# --- tidy-edited-file hook ----------------------------------------------------
rm -rf "$TIDY_REPO_TMP"
mkdir -p "$TIDY_REPO_TMP/scripts/ai-hooks" "$TIDY_REPO_TMP/src" "$TIDY_REPO_TMP/node_modules/.bin"
cp "$REPO_ROOT/scripts/ai-hooks/common.sh" "$REPO_ROOT/scripts/ai-hooks/tidy-edited-file.sh" "$TIDY_REPO_TMP/scripts/ai-hooks/"
git -C "$TIDY_REPO_TMP" init -q
HOOK_FIXTURE_REPO_ROOT="$TIDY_REPO_TMP"
TIDY_PINNED_LOG="$TMP_ROOT/tidy-pinned.log"
cat > "$TIDY_REPO_TMP/node_modules/.bin/prettier" <<'EOF'
#!/bin/bash
set -u

printf 'prettier' >> "$TIDY_PINNED_LOG"
for arg in "$@"; do
  printf '\t%s' "$arg" >> "$TIDY_PINNED_LOG"
done
printf '\n' >> "$TIDY_PINNED_LOG"

if [ "${TIDY_PINNED_PRETTIER_FAIL:-0}" = "1" ]; then
  printf 'prettier failed line\n'
  exit 7
fi
if [ "${TIDY_PINNED_PRETTIER_FORMAT_FIXTURE:-0}" = "1" ]; then
  target=""
  for arg in "$@"; do
    target="$arg"
  done
  [ -n "$target" ] && printf 'const value = { answer: 1 };\n' > "$target"
fi
EOF
cat > "$TIDY_REPO_TMP/node_modules/.bin/eslint" <<'EOF'
#!/bin/bash
set -u

printf 'eslint' >> "$TIDY_PINNED_LOG"
for arg in "$@"; do
  printf '\t%s' "$arg" >> "$TIDY_PINNED_LOG"
done
printf '\n' >> "$TIDY_PINNED_LOG"

if [ "${TIDY_PINNED_ESLINT_FAIL:-0}" = "1" ]; then
  i=1
  while [ "$i" -le 60 ]; do
    printf 'eslint line %02d\n' "$i"
    i=$((i + 1))
  done
  exit 8
fi

# The tidy hook runs a second, non-mutating `eslint -f json` pass after a clean
# `--fix` run to surface residual warn-level violations. Detect that pass by the
# `-f` flag and emit a json report: one severity-1 message when
# TIDY_PINNED_ESLINT_WARNINGS=1, otherwise a clean (zero-warning) report.
eslint_json_mode=0
for arg in "$@"; do
  case "$arg" in
    -f | --format) eslint_json_mode=1 ;;
  esac
done
if [ "$eslint_json_mode" = "1" ]; then
  if [ "${TIDY_PINNED_ESLINT_WARNINGS:-0}" = "1" ]; then
    printf '%s\n' '[{"filePath":"stub","errorCount":0,"warningCount":1,"messages":[{"ruleId":"no-console","severity":1,"line":3,"column":5,"message":"Unexpected console statement."}]}]'
  else
    printf '%s\n' '[{"filePath":"stub","errorCount":0,"warningCount":0,"messages":[]}]'
  fi
  exit 0
fi
EOF
chmod +x "$TIDY_REPO_TMP/node_modules/.bin/prettier" "$TIDY_REPO_TMP/node_modules/.bin/eslint"

run_tidy_hook() {
  local payload="$1"

  TIDY_PINNED_LOG="$TIDY_PINNED_LOG" \
    TIDY_PINNED_PRETTIER_FAIL="${TIDY_PINNED_PRETTIER_FAIL:-0}" \
    TIDY_PINNED_PRETTIER_FORMAT_FIXTURE="${TIDY_PINNED_PRETTIER_FORMAT_FIXTURE:-0}" \
    TIDY_PINNED_ESLINT_FAIL="${TIDY_PINNED_ESLINT_FAIL:-0}" \
    TIDY_PINNED_ESLINT_WARNINGS="${TIDY_PINNED_ESLINT_WARNINGS:-0}" \
    bash "$TIDY_REPO_TMP/scripts/ai-hooks/tidy-edited-file.sh" <<< "$payload"
}

tidy_context() {
  jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$1"
}

tidy_payload_for_file() {
  local file="$1"

  jq -n --arg file "$file" '{tool_name:"Edit",tool_input:{file_path:$file}}'
}

tidy_relative_path() {
  realpath --relative-to="${HOOK_FIXTURE_REPO_ROOT:-$REPO_ROOT}" "$1"
}

TIDY_TS="$TIDY_REPO_TMP/src/needs-formatting.ts"
TIDY_TS_REL=$(tidy_relative_path "$TIDY_TS")
printf 'const value={answer:1}\n' > "$TIDY_TS"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(TIDY_PINNED_PRETTIER_FORMAT_FIXTURE=1 run_tidy_hook "$(tidy_payload_for_file "$TIDY_TS_REL")") \
  || fail "tidy hook should not fail for Claude .ts payload"
assert_hook_json "$TIDY_OUTPUT"
TIDY_CONTEXT=$(tidy_context "$TIDY_OUTPUT")
[ "$TIDY_CONTEXT" = "tidy-edited-file: $TIDY_TS_REL tidied" ] \
  || fail "Claude .ts tidy should report changed file, got: $TIDY_CONTEXT"
assert_not_contains "$TIDY_CONTEXT" "OK"
TIDY_EXPECTED_LOG=$(printf 'prettier\t--write\t--ignore-unknown\t%s\neslint\t--fix\t--no-warn-ignored\t%s\neslint\t-f\tjson\t--no-warn-ignored\t%s' "$TIDY_TS" "$TIDY_TS" "$TIDY_TS")
[ "$(cat "$TIDY_PINNED_LOG")" = "$TIDY_EXPECTED_LOG" ] \
  || fail "Claude .ts tidy command log mismatch: $(cat "$TIDY_PINNED_LOG")"
[ "$(cat "$TIDY_TS")" = 'const value = { answer: 1 };' ] \
  || fail "Claude .ts tidy should format the fixture: $(cat "$TIDY_TS")"

TIDY_CLEAN_TS="$TIDY_REPO_TMP/src/already-tidy.ts"
TIDY_CLEAN_TS_REL=$(tidy_relative_path "$TIDY_CLEAN_TS")
printf 'const clean = { answer: 1 };\n' > "$TIDY_CLEAN_TS"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file "$TIDY_CLEAN_TS_REL")") \
  || fail "tidy hook should not fail for already-tidy .ts payload"
assert_hook_continue_json "$TIDY_OUTPUT"
TIDY_EXPECTED_LOG=$(printf 'prettier\t--write\t--ignore-unknown\t%s\neslint\t--fix\t--no-warn-ignored\t%s\neslint\t-f\tjson\t--no-warn-ignored\t%s' "$TIDY_CLEAN_TS" "$TIDY_CLEAN_TS" "$TIDY_CLEAN_TS")
[ "$(cat "$TIDY_PINNED_LOG")" = "$TIDY_EXPECTED_LOG" ] \
  || fail "already-tidy .ts command log mismatch: $(cat "$TIDY_PINNED_LOG")"

TIDY_MD="$TIDY_REPO_TMP/src/note.md"
TIDY_MD_REL=$(tidy_relative_path "$TIDY_MD")
printf '# title\n' > "$TIDY_MD"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file "$TIDY_MD_REL")") \
  || fail "tidy hook should not fail for Markdown payload"
assert_hook_continue_json "$TIDY_OUTPUT"
TIDY_EXPECTED_LOG=$'prettier\t--write\t--ignore-unknown\t'"$TIDY_MD"
[ "$(cat "$TIDY_PINNED_LOG")" = "$TIDY_EXPECTED_LOG" ] \
  || fail "Markdown tidy should only run prettier: $(cat "$TIDY_PINNED_LOG")"

TIDY_MISSING_REL=$(tidy_relative_path "$TIDY_REPO_TMP/src/missing.ts")
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file "$TIDY_MISSING_REL")") \
  || fail "tidy hook should not fail for missing file"
assert_hook_continue_json "$TIDY_OUTPUT"
[ ! -s "$TIDY_PINNED_LOG" ] || fail "missing file should not invoke pinned tools"

: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file ".git/config")") \
  || fail "tidy hook should not fail for unsupported .git path"
assert_hook_json "$TIDY_OUTPUT"
assert_contains "$(tidy_context "$TIDY_OUTPUT")" ".git/config skipped (unsupported path)"
[ ! -s "$TIDY_PINNED_LOG" ] || fail ".git path should not invoke pinned tools"

: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file "node_modules/foo.ts")") \
  || fail "tidy hook should not fail for unsupported node_modules path"
assert_hook_json "$TIDY_OUTPUT"
assert_contains "$(tidy_context "$TIDY_OUTPUT")" "node_modules/foo.ts skipped (unsupported path)"
[ ! -s "$TIDY_PINNED_LOG" ] || fail "node_modules path should not invoke pinned tools"

TIDY_BINARY="$TIDY_REPO_TMP/src/blob.bin"
TIDY_BINARY_REL=$(tidy_relative_path "$TIDY_BINARY")
printf 'a\0b' > "$TIDY_BINARY"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file "$TIDY_BINARY_REL")") \
  || fail "tidy hook should not fail for binary file"
assert_hook_json "$TIDY_OUTPUT"
assert_contains "$(tidy_context "$TIDY_OUTPUT")" "$TIDY_BINARY_REL skipped (binary file)"
[ ! -s "$TIDY_PINNED_LOG" ] || fail "binary file should not invoke pinned tools"

TIDY_CODEX_TS="$TIDY_REPO_TMP/src/codex one.ts"
TIDY_CODEX_MD="$TIDY_REPO_TMP/src/codex-note.md"
TIDY_CODEX_MOVED="$TIDY_REPO_TMP/src/moved file.ts"
TIDY_CODEX_OLD="$TIDY_REPO_TMP/src/old file.ts"
TIDY_CODEX_DELETED="$TIDY_REPO_TMP/src/deleted.ts"
printf 'const codex = 1\n' > "$TIDY_CODEX_TS"
printf '# codex\n' > "$TIDY_CODEX_MD"
printf 'const moved = 1\n' > "$TIDY_CODEX_MOVED"
TIDY_CODEX_TS_REL=$(tidy_relative_path "$TIDY_CODEX_TS")
TIDY_CODEX_MD_REL=$(tidy_relative_path "$TIDY_CODEX_MD")
TIDY_CODEX_MOVED_REL=$(tidy_relative_path "$TIDY_CODEX_MOVED")
TIDY_CODEX_OLD_REL=$(tidy_relative_path "$TIDY_CODEX_OLD")
TIDY_CODEX_DELETED_REL=$(tidy_relative_path "$TIDY_CODEX_DELETED")
TIDY_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  "*** Add File: $TIDY_CODEX_TS_REL" \
  '+const codex = 1' \
  "*** Update File: $TIDY_CODEX_MD_REL" \
  '@@' \
  '-# old' \
  '+# codex' \
  "*** Update File: $TIDY_CODEX_TS_REL" \
  '@@' \
  '-const codex = 0' \
  '+const codex = 1' \
  "*** Delete File: $TIDY_CODEX_DELETED_REL" \
  "*** Update File: $TIDY_CODEX_OLD_REL" \
  "*** Move to: $TIDY_CODEX_MOVED_REL" \
  '@@' \
  '-const moved = 0' \
  '+const moved = 1' \
  '*** End Patch')
TIDY_CODEX_PAYLOAD=$(jq -n --arg command "$TIDY_PATCH" --arg ignored "node_modules/ignored.ts" \
  '{tool_name:"apply_patch",tool_input:{file_path:$ignored,command:$command}}')
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$TIDY_CODEX_PAYLOAD") \
  || fail "tidy hook should not fail for Codex apply_patch payload"
assert_hook_json "$TIDY_OUTPUT"
TIDY_CONTEXT=$(tidy_context "$TIDY_OUTPUT")
assert_not_contains "$TIDY_CONTEXT" "OK"
assert_not_contains "$TIDY_CONTEXT" "$TIDY_CODEX_DELETED_REL skipped (missing/deleted file)"
assert_not_contains "$TIDY_CONTEXT" "$TIDY_CODEX_OLD_REL skipped (missing/deleted file)"
assert_not_contains "$TIDY_CONTEXT" "node_modules/ignored.ts"
TIDY_EXPECTED_LOG=$(printf 'prettier\t--write\t--ignore-unknown\t%s\neslint\t--fix\t--no-warn-ignored\t%s\neslint\t-f\tjson\t--no-warn-ignored\t%s\nprettier\t--write\t--ignore-unknown\t%s\nprettier\t--write\t--ignore-unknown\t%s\neslint\t--fix\t--no-warn-ignored\t%s\neslint\t-f\tjson\t--no-warn-ignored\t%s' "$TIDY_CODEX_TS" "$TIDY_CODEX_TS" "$TIDY_CODEX_TS" "$TIDY_CODEX_MD" "$TIDY_CODEX_MOVED" "$TIDY_CODEX_MOVED" "$TIDY_CODEX_MOVED")
[ "$(cat "$TIDY_PINNED_LOG")" = "$TIDY_EXPECTED_LOG" ] \
  || fail "Codex apply_patch tidy command log mismatch: $(cat "$TIDY_PINNED_LOG")"

TIDY_CODEX_FORMAT="$TIDY_REPO_TMP/src/codex-needs-formatting.ts"
TIDY_CODEX_FORMAT_REL=$(tidy_relative_path "$TIDY_CODEX_FORMAT")
printf 'const codexFormat={answer:1}\n' > "$TIDY_CODEX_FORMAT"
TIDY_FORMAT_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  "*** Update File: $TIDY_CODEX_FORMAT_REL" \
  '@@' \
  '-const codexFormat={answer:0}' \
  '+const codexFormat={answer:1}' \
  '*** End Patch')
TIDY_CODEX_FORMAT_PAYLOAD=$(jq -n --arg command "$TIDY_FORMAT_PATCH" \
  '{tool_name:"apply_patch",tool_input:{command:$command}}')
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(TIDY_PINNED_PRETTIER_FORMAT_FIXTURE=1 run_tidy_hook "$TIDY_CODEX_FORMAT_PAYLOAD") \
  || fail "tidy hook should not fail for Codex formatted apply_patch payload"
assert_hook_json "$TIDY_OUTPUT"
TIDY_CONTEXT=$(tidy_context "$TIDY_OUTPUT")
[ "$TIDY_CONTEXT" = "tidy-edited-file: $TIDY_CODEX_FORMAT_REL tidied" ] \
  || fail "Codex apply_patch tidy should report changed file, got: $TIDY_CONTEXT"
assert_not_contains "$TIDY_CONTEXT" "OK"

: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(TIDY_PINNED_PRETTIER_FAIL=1 run_tidy_hook "$(tidy_payload_for_file "$TIDY_MD_REL")") \
  || fail "tidy hook should not fail when prettier fails"
assert_hook_json "$TIDY_OUTPUT"
TIDY_CONTEXT=$(tidy_context "$TIDY_OUTPUT")
assert_contains "$TIDY_CONTEXT" "$TIDY_MD_REL ERROR (non-blocking)"
assert_contains "$TIDY_CONTEXT" "prettier exited 7"
assert_contains "$TIDY_CONTEXT" "prettier failed line"

: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(TIDY_PINNED_ESLINT_FAIL=1 run_tidy_hook "$(tidy_payload_for_file "$TIDY_TS_REL")") \
  || fail "tidy hook should not fail when eslint fails"
assert_hook_json "$TIDY_OUTPUT"
TIDY_CONTEXT=$(tidy_context "$TIDY_OUTPUT")
assert_contains "$TIDY_CONTEXT" "$TIDY_TS_REL ERROR (non-blocking)"
assert_contains "$TIDY_CONTEXT" "eslint exited 8"
assert_contains "$TIDY_CONTEXT" "truncated (60 lines total; last 30 lines)"
assert_contains "$TIDY_CONTEXT" "eslint line 31"
assert_contains "$TIDY_CONTEXT" "eslint line 60"
TIDY_ESLINT_LINE_COUNT=$(grep -c '^eslint line ' <<< "$TIDY_CONTEXT" || true)
[ "$TIDY_ESLINT_LINE_COUNT" = "30" ] \
  || fail "eslint output should be bounded to 30 lines: $TIDY_CONTEXT"
assert_not_contains "$TIDY_CONTEXT" "eslint line 01"
assert_not_contains "$TIDY_CONTEXT" "eslint line 30"

: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook '{"tool_name":"Edit","tool_input":{}}') \
  || fail "tidy hook should not fail when payload has no file path"
assert_hook_continue_json "$TIDY_OUTPUT"
[ ! -s "$TIDY_PINNED_LOG" ] || fail "no-path payload should not invoke pinned tools"

: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook 'not json') \
  || fail "tidy hook should not fail for malformed JSON payload"
assert_hook_continue_json "$TIDY_OUTPUT"
[ ! -s "$TIDY_PINNED_LOG" ] || fail "malformed payload should not invoke pinned tools"

: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(SKIP_TIDY_HOOK=1 run_tidy_hook "$(tidy_payload_for_file "$TIDY_TS_REL")") \
  || fail "tidy hook should not fail when skipped"
assert_hook_json "$TIDY_OUTPUT"
assert_contains "$(tidy_context "$TIDY_OUTPUT")" "SKIP_TIDY_HOOK=1"
[ ! -s "$TIDY_PINNED_LOG" ] || fail "SKIP_TIDY_HOOK=1 should not invoke pinned tools"

# Residual warn-level eslint violations are surfaced (non-blocking) after a
# clean --fix pass, naming the rule and location so the agent does not discover
# them only at a gate.
TIDY_WARN_TS="$TIDY_REPO_TMP/src/has-warning.ts"
TIDY_WARN_TS_REL=$(tidy_relative_path "$TIDY_WARN_TS")
printf 'console.log("hi");\n' > "$TIDY_WARN_TS"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(TIDY_PINNED_ESLINT_WARNINGS=1 run_tidy_hook "$(tidy_payload_for_file "$TIDY_WARN_TS_REL")") \
  || fail "tidy hook should not fail when surfacing eslint warnings"
assert_hook_json "$TIDY_OUTPUT"
TIDY_CONTEXT=$(tidy_context "$TIDY_OUTPUT")
assert_contains "$TIDY_CONTEXT" "$TIDY_WARN_TS_REL has 1 eslint warning(s)"
assert_contains "$TIDY_CONTEXT" 'these block `bun run lint`'
assert_contains "$TIDY_CONTEXT" "no-console at 3:5"
assert_contains "$(cat "$TIDY_PINNED_LOG")" $'eslint\t-f\tjson\t--no-warn-ignored'

# No residual warnings -> no advisory line (the json pass still runs).
TIDY_NOWARN_TS="$TIDY_REPO_TMP/src/no-warning.ts"
TIDY_NOWARN_TS_REL=$(tidy_relative_path "$TIDY_NOWARN_TS")
printf 'const ok = 1;\n' > "$TIDY_NOWARN_TS"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file "$TIDY_NOWARN_TS_REL")") \
  || fail "tidy hook should not fail for a warning-free file"
assert_hook_continue_json "$TIDY_OUTPUT"
assert_not_contains "$(tidy_context "$TIDY_OUTPUT")" "eslint warning(s)"
assert_contains "$(cat "$TIDY_PINNED_LOG")" $'eslint\t-f\tjson\t--no-warn-ignored'

printf 'ai-hooks tidy tests passed\n'
