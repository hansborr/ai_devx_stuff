#!/bin/bash

# Focused ai-hooks shell tests for the tidy-edited-file hook. Extracted from
# scripts/ai-hooks/test.sh so this behavior family can be run on its own
# (`bash scripts/ai-hooks/test-tidy.sh`); the aggregate runner invokes it as one
# step. Shares the generic assertions in test-support.sh.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../tests/lib/test-git-env.sh
. "$SCRIPT_DIR/../tests/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)

# shellcheck source=test-support.sh
. "$SCRIPT_DIR/test-support.sh"

TMP_ROOT=$(mktemp -d /tmp/musi-ai-hooks-tidy-test.XXXXXX)
TIDY_REPO_TMP="$TMP_ROOT/tidy-repo"
trap 'rm -rf "$TMP_ROOT"' EXIT

# The full ESLint extension policy is shared by tidy, coverage, and Stop. Keep
# the matrix here beside tidy's behavior fixtures and pin the three consumers
# to the same helper so a future extension change cannot land partially.
# shellcheck source=edited-paths.sh
. "$SCRIPT_DIR/edited-paths.sh"
for supported in fixture.js fixture.JSX fixture.mjs fixture.cjs fixture.ts fixture.tsx fixture.mts fixture.cts fixture.json fixture.jsonc fixture.json5; do
  ai_edited_path_eslint_supported "$supported" \
    || fail "shared ESLint extension matrix should include $supported"
done
for unsupported in fixture.md fixture.yaml fixture.prisma; do
  if ai_edited_path_eslint_supported "$unsupported"; then
    fail "shared ESLint extension matrix should exclude $unsupported"
  fi
done
grep -qF 'ai_edited_path_eslint_supported "$absolute_path"' "$SCRIPT_DIR/tidy-edited-file.sh" \
  || fail "tidy must consume the shared ESLint extension helper"
grep -qF 'ai_edited_path_eslint_supported "$relative_path"' "$SCRIPT_DIR/lint-coverage-check.sh" \
  || fail "lint coverage must consume the shared ESLint extension helper"
grep -qF 'ai_edited_path_eslint_supported "$path"' "$SCRIPT_DIR/stop-policy.sh" \
  || fail "Stop lint warnings must consume the shared ESLint extension helper"
if (
  # shellcheck source=ratchet-regression-check.sh
  . "$SCRIPT_DIR/ratchet-regression-check.sh"
  ai_ratchet_regression_is_lintable fixture.json
); then
  fail "ratchet regression must retain its narrower JS/TS-only extension policy"
fi

# --- tidy-edited-file hook ----------------------------------------------------
rm -rf "$TIDY_REPO_TMP"
mkdir -p "$TIDY_REPO_TMP/scripts/ai-hooks" "$TIDY_REPO_TMP/src" "$TIDY_REPO_TMP/node_modules/.bin"
cp "$REPO_ROOT/scripts/ai-hooks/common.sh" \
  "$REPO_ROOT/scripts/ai-hooks/edited-paths.sh" \
  "$REPO_ROOT/scripts/ai-hooks/tidy-edited-file.sh" "$TIDY_REPO_TMP/scripts/ai-hooks/"
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

# Stop-time lint-warning coverage owns residual warn-level violations. If the
# tidy hook accidentally runs a second, non-mutating `eslint -f json` pass, this
# stub still emits a warning fixture so the tests catch the mid-edit regression.
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
  local tool_name="${2:-Edit}"
  local payload_cwd="${3:-}"

  jq -n --arg file "$file" --arg tool_name "$tool_name" --arg payload_cwd "$payload_cwd" '
    {tool_name:$tool_name,tool_input:{file_path:$file}}
    + if $payload_cwd == "" then {} else {cwd:$payload_cwd} end
  '
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
TIDY_EXPECTED_LOG=$(printf 'prettier\t--write\t--ignore-unknown\t%s\neslint\t--fix\t--no-warn-ignored\t%s' "$TIDY_TS" "$TIDY_TS")
[ "$(cat "$TIDY_PINNED_LOG")" = "$TIDY_EXPECTED_LOG" ] \
  || fail "Claude .ts tidy command log mismatch: $(cat "$TIDY_PINNED_LOG")"
[ "$(cat "$TIDY_TS")" = 'const value = { answer: 1 };' ] \
  || fail "Claude .ts tidy should format the fixture: $(cat "$TIDY_TS")"

TIDY_WRITE_TS="$TIDY_REPO_TMP/src/write-needs-formatting.ts"
TIDY_WRITE_TS_REL=$(tidy_relative_path "$TIDY_WRITE_TS")
printf 'const writeValue={answer:1}\n' > "$TIDY_WRITE_TS"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(TIDY_PINNED_PRETTIER_FORMAT_FIXTURE=1 run_tidy_hook "$(tidy_payload_for_file "$TIDY_WRITE_TS_REL" Write)") \
  || fail "tidy hook should not fail for Claude Write payload"
assert_hook_json "$TIDY_OUTPUT"
TIDY_CONTEXT=$(tidy_context "$TIDY_OUTPUT")
[ "$TIDY_CONTEXT" = "tidy-edited-file: $TIDY_WRITE_TS_REL tidied" ] \
  || fail "Claude Write tidy should report changed file, got: $TIDY_CONTEXT"
TIDY_EXPECTED_LOG=$(printf 'prettier\t--write\t--ignore-unknown\t%s\neslint\t--fix\t--no-warn-ignored\t%s' "$TIDY_WRITE_TS" "$TIDY_WRITE_TS")
[ "$(cat "$TIDY_PINNED_LOG")" = "$TIDY_EXPECTED_LOG" ] \
  || fail "Claude Write tidy command log mismatch: $(cat "$TIDY_PINNED_LOG")"

TIDY_CLEAN_TS="$TIDY_REPO_TMP/src/already-tidy.ts"
TIDY_CLEAN_TS_REL=$(tidy_relative_path "$TIDY_CLEAN_TS")
printf 'const clean = { answer: 1 };\n' > "$TIDY_CLEAN_TS"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file "$TIDY_CLEAN_TS_REL")") \
  || fail "tidy hook should not fail for already-tidy .ts payload"
assert_hook_continue_json "$TIDY_OUTPUT"
TIDY_EXPECTED_LOG=$(printf 'prettier\t--write\t--ignore-unknown\t%s\neslint\t--fix\t--no-warn-ignored\t%s' "$TIDY_CLEAN_TS" "$TIDY_CLEAN_TS")
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

# A repo checked out under an out-of-repo prefix that itself contains a
# node_modules segment must still tidy its own files: the .git / node_modules
# classification is relative to the file's own repo root, not the absolute path.
TIDY_NESTED_ROOT="$TMP_ROOT/node_modules/nested-lane"
mkdir -p "$TIDY_NESTED_ROOT/scripts/ai-hooks" "$TIDY_NESTED_ROOT/src" "$TIDY_NESTED_ROOT/node_modules/.bin"
cp "$REPO_ROOT/scripts/ai-hooks/common.sh" \
  "$REPO_ROOT/scripts/ai-hooks/edited-paths.sh" \
  "$REPO_ROOT/scripts/ai-hooks/tidy-edited-file.sh" "$TIDY_NESTED_ROOT/scripts/ai-hooks/"
cp "$TIDY_REPO_TMP/node_modules/.bin/prettier" "$TIDY_REPO_TMP/node_modules/.bin/eslint" \
  "$TIDY_NESTED_ROOT/node_modules/.bin/"
git -C "$TIDY_NESTED_ROOT" init -q
printf 'const value={answer:1}\n' > "$TIDY_NESTED_ROOT/src/nested.ts"
: > "$TIDY_PINNED_LOG"
TIDY_NESTED_OUTPUT=$(TIDY_PINNED_LOG="$TIDY_PINNED_LOG" TIDY_PINNED_PRETTIER_FORMAT_FIXTURE=1 \
  bash "$TIDY_NESTED_ROOT/scripts/ai-hooks/tidy-edited-file.sh" <<< "$(tidy_payload_for_file "src/nested.ts")") \
  || fail "tidy hook should not fail for a repo nested under a node_modules prefix"
assert_hook_json "$TIDY_NESTED_OUTPUT"
assert_not_contains "$(tidy_context "$TIDY_NESTED_OUTPUT")" "unsupported path"
[ -s "$TIDY_PINNED_LOG" ] \
  || fail "a file inside a node_modules-prefixed repo should be tidied, not skipped as unsupported"

TIDY_BINARY="$TIDY_REPO_TMP/src/blob.bin"
TIDY_BINARY_REL=$(tidy_relative_path "$TIDY_BINARY")
printf 'a\0b' > "$TIDY_BINARY"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file "$TIDY_BINARY_REL")") \
  || fail "tidy hook should not fail for binary file"
assert_hook_json "$TIDY_OUTPUT"
assert_contains "$(tidy_context "$TIDY_OUTPUT")" "WARNING:"
assert_contains "$(tidy_context "$TIDY_OUTPUT")" "$TIDY_BINARY_REL skipped (binary file)"
[ ! -s "$TIDY_PINNED_LOG" ] || fail "binary file should not invoke pinned tools"

TIDY_BINARY_PRISMA="$TIDY_REPO_TMP/packages/server/prisma/schema.prisma"
mkdir -p "$(dirname "$TIDY_BINARY_PRISMA")"
TIDY_BINARY_PRISMA_REL=$(tidy_relative_path "$TIDY_BINARY_PRISMA")
printf 'model Hidden {\0}\n' > "$TIDY_BINARY_PRISMA"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file "$TIDY_BINARY_PRISMA_REL")") \
  || fail "tidy hook should not fail for NUL-bearing Prisma source"
assert_hook_json "$TIDY_OUTPUT"
TIDY_CONTEXT=$(tidy_context "$TIDY_OUTPUT")
assert_contains "$TIDY_CONTEXT" "WARNING:"
assert_contains "$TIDY_CONTEXT" "$TIDY_BINARY_PRISMA_REL"
assert_contains "$TIDY_CONTEXT" "literal NUL may be hiding source text"
[ ! -s "$TIDY_PINNED_LOG" ] || fail "NUL-bearing Prisma source should not invoke pinned tools"

TIDY_BINARY_TS="$TIDY_REPO_TMP/src/nul-hidden.ts"
TIDY_BINARY_TS_REL=$(tidy_relative_path "$TIDY_BINARY_TS")
printf 'const hidden = "\0";\n' > "$TIDY_BINARY_TS"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file "$TIDY_BINARY_TS_REL")") \
  || fail "tidy hook should not fail for NUL-bearing TypeScript"
assert_hook_json "$TIDY_OUTPUT"
TIDY_CONTEXT=$(tidy_context "$TIDY_OUTPUT")
assert_contains "$TIDY_CONTEXT" "WARNING:"
assert_contains "$TIDY_CONTEXT" "$TIDY_BINARY_TS_REL"
assert_contains "$TIDY_CONTEXT" "literal NUL may be hiding source text"
[ ! -s "$TIDY_PINNED_LOG" ] || fail "NUL-bearing TypeScript should not invoke pinned tools"

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
TIDY_EXPECTED_LOG=$(printf 'prettier\t--write\t--ignore-unknown\t%s\neslint\t--fix\t--no-warn-ignored\t%s\nprettier\t--write\t--ignore-unknown\t%s\nprettier\t--write\t--ignore-unknown\t%s\neslint\t--fix\t--no-warn-ignored\t%s' "$TIDY_CODEX_TS" "$TIDY_CODEX_TS" "$TIDY_CODEX_MD" "$TIDY_CODEX_MOVED" "$TIDY_CODEX_MOVED")
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

# Residual warn-level eslint violations are deferred to Stop instead of being
# surfaced after every edit.
TIDY_WARN_TS="$TIDY_REPO_TMP/src/has-warning.ts"
TIDY_WARN_TS_REL=$(tidy_relative_path "$TIDY_WARN_TS")
printf 'console.log("hi");\n' > "$TIDY_WARN_TS"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(TIDY_PINNED_ESLINT_WARNINGS=1 run_tidy_hook "$(tidy_payload_for_file "$TIDY_WARN_TS_REL")") \
  || fail "tidy hook should not fail when surfacing eslint warnings"
assert_hook_continue_json "$TIDY_OUTPUT"
assert_not_contains "$(cat "$TIDY_PINNED_LOG")" $'eslint\t-f\tjson\t--no-warn-ignored'

# No residual warnings -> no advisory line and no json pass.
TIDY_NOWARN_TS="$TIDY_REPO_TMP/src/no-warning.ts"
TIDY_NOWARN_TS_REL=$(tidy_relative_path "$TIDY_NOWARN_TS")
printf 'const ok = 1;\n' > "$TIDY_NOWARN_TS"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file "$TIDY_NOWARN_TS_REL")") \
  || fail "tidy hook should not fail for a warning-free file"
assert_hook_continue_json "$TIDY_OUTPUT"
assert_not_contains "$(tidy_context "$TIDY_OUTPUT")" "eslint warning(s)"
assert_not_contains "$(cat "$TIDY_PINNED_LOG")" $'eslint\t-f\tjson\t--no-warn-ignored'

# --- Lane (sibling worktree) edits are first-class ----------------------------
# A file in a linked worktree of THIS repo formats exactly like a primary edit
# (resolved from the file's own worktree root, reported lane-relative); a file
# in an unrelated repository still skips as outside repository.
git -C "$TIDY_REPO_TMP" -c user.email=t@example.com -c user.name=t \
  commit -q --allow-empty -m "tidy fixture base commit for lane worktree"
TIDY_LANE="$TMP_ROOT/tidy-lane"
git -C "$TIDY_REPO_TMP" worktree add -q -b feat/tidy-lane "$TIDY_LANE" >/dev/null
mkdir -p "$TIDY_LANE/src"
TIDY_LANE_TS="$TIDY_LANE/src/lane-format.ts"
printf 'const laneValue={answer:1}\n' > "$TIDY_LANE_TS"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(TIDY_PINNED_PRETTIER_FORMAT_FIXTURE=1 run_tidy_hook "$(tidy_payload_for_file "$TIDY_LANE_TS")") \
  || fail "tidy hook should not fail for a lane worktree file"
assert_hook_json "$TIDY_OUTPUT"
TIDY_CONTEXT=$(tidy_context "$TIDY_OUTPUT")
[ "$TIDY_CONTEXT" = "tidy-edited-file: src/lane-format.ts tidied" ] \
  || fail "lane .ts tidy should report the lane-relative path, got: $TIDY_CONTEXT"
TIDY_EXPECTED_LOG=$(printf 'prettier\t--write\t--ignore-unknown\t%s\neslint\t--fix\t--no-warn-ignored\t%s' "$TIDY_LANE_TS" "$TIDY_LANE_TS")
[ "$(cat "$TIDY_PINNED_LOG")" = "$TIDY_EXPECTED_LOG" ] \
  || fail "lane .ts tidy command log mismatch: $(cat "$TIDY_PINNED_LOG")"
[ "$(cat "$TIDY_LANE_TS")" = 'const value = { answer: 1 };' ] \
  || fail "lane .ts tidy should format the fixture: $(cat "$TIDY_LANE_TS")"

TIDY_CWD_TS="$TIDY_LANE/src/payload-cwd.ts"
printf 'const cwdValue={answer:1}\n' > "$TIDY_CWD_TS"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(TIDY_PINNED_PRETTIER_FORMAT_FIXTURE=1 run_tidy_hook "$(tidy_payload_for_file "src/payload-cwd.ts" Edit "$TIDY_LANE")") \
  || fail "tidy hook should not fail for a relative path with sibling-worktree payload cwd"
assert_hook_json "$TIDY_OUTPUT"
TIDY_CONTEXT=$(tidy_context "$TIDY_OUTPUT")
[ "$TIDY_CONTEXT" = "tidy-edited-file: src/payload-cwd.ts tidied" ] \
  || fail "payload-cwd tidy should resolve and report the lane-relative path, got: $TIDY_CONTEXT"
TIDY_EXPECTED_LOG=$(printf 'prettier\t--write\t--ignore-unknown\t%s\neslint\t--fix\t--no-warn-ignored\t%s' "$TIDY_CWD_TS" "$TIDY_CWD_TS")
[ "$(cat "$TIDY_PINNED_LOG")" = "$TIDY_EXPECTED_LOG" ] \
  || fail "payload-cwd tidy command log mismatch: $(cat "$TIDY_PINNED_LOG")"

TIDY_OUTSIDE_REPO="$TMP_ROOT/outside-repo"
git -C "$REPO_ROOT" init -q "$TIDY_OUTSIDE_REPO"
mkdir -p "$TIDY_OUTSIDE_REPO/src"
TIDY_OUTSIDE_TS="$TIDY_OUTSIDE_REPO/src/foo.ts"
printf 'const x=1\n' > "$TIDY_OUTSIDE_TS"
: > "$TIDY_PINNED_LOG"
TIDY_OUTPUT=$(run_tidy_hook "$(tidy_payload_for_file "$TIDY_OUTSIDE_TS")") \
  || fail "tidy hook should not fail for an unrelated-repo file"
assert_hook_json "$TIDY_OUTPUT"
assert_contains "$(tidy_context "$TIDY_OUTPUT")" "$TIDY_OUTSIDE_TS skipped (outside repository)"
[ ! -s "$TIDY_PINNED_LOG" ] || fail "unrelated-repo file should not invoke pinned tools"

printf 'ai-hooks tidy tests passed\n'
