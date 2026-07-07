#!/bin/bash

# Focused ai-hooks shell tests for the lint-coverage-check hook and its
# neutral throttle helper coverage. Extracted from scripts/ai-hooks/test.sh so
# this behavior family can be run on its own (`bash scripts/ai-hooks/test-lint-coverage.sh`);
# the aggregate runner invokes it as one step. Shares the generic assertions in
# test-support.sh.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../tests/lib/test-git-env.sh
. "$SCRIPT_DIR/../tests/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)

# shellcheck source=test-support.sh
. "$SCRIPT_DIR/test-support.sh"
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"
# shellcheck source=throttle-state.sh
. "$SCRIPT_DIR/throttle-state.sh"
# shellcheck source=lint-coverage-state.sh
. "$SCRIPT_DIR/lint-coverage-state.sh"

TMP_ROOT=$(mktemp -d /tmp/musi-ai-hooks-lint-coverage-test.XXXXXX)
LINT_COVERAGE_REPO_TMP="$TMP_ROOT/lint-coverage-repo"
trap 'rm -rf "$TMP_ROOT"' EXIT

AI_BUN_LOG_DIR="$TMP_ROOT/bun-logs"
AI_PRECOMMIT_LOG_DIR="$TMP_ROOT/pre-commit-logs"

assert_throttle_state_read_fails() {
  local file="$1"
  local content="$2"

  printf '%s\n' "$content" > "$file"
  if ai_throttle_read_state "$file"; then
    fail "corrupt throttle state unexpectedly parsed: $content"
  fi
}

tidy_payload_for_file() {
  local file="$1"

  jq -n --arg file "$file" '{tool_name:"Edit",tool_input:{file_path:$file}}'
}

tidy_relative_path() {
  realpath --relative-to="${HOOK_FIXTURE_REPO_ROOT:-$REPO_ROOT}" "$1"
}

# --- lint-coverage-check hook ------------------------------------------------
rm -rf "$LINT_COVERAGE_REPO_TMP"
mkdir -p "$LINT_COVERAGE_REPO_TMP/scripts/ai-hooks" "$LINT_COVERAGE_REPO_TMP/src/ratcheted" "$LINT_COVERAGE_REPO_TMP/node_modules/.bin"
# Copy the production dependency set the hook now sources (cache.sh ->
# output-filter.sh + verify-metadata.sh, plus the new throttle helper) so the
# fixture matches production wiring rather than stubbing the chain out.
cp "$REPO_ROOT/scripts/ai-hooks/common.sh" \
  "$REPO_ROOT/scripts/ai-hooks/cache.sh" \
  "$REPO_ROOT/scripts/ai-hooks/output-filter.sh" \
  "$REPO_ROOT/scripts/ai-hooks/edited-paths.sh" \
  "$REPO_ROOT/scripts/ai-hooks/throttle-state.sh" \
  "$REPO_ROOT/scripts/ai-hooks/lint-coverage-state.sh" \
  "$REPO_ROOT/scripts/ai-hooks/lint-coverage-check.sh" \
  "$LINT_COVERAGE_REPO_TMP/scripts/ai-hooks/"
mkdir -p "$LINT_COVERAGE_REPO_TMP/scripts/lib"
cp "$REPO_ROOT/scripts/lib/verify-metadata.sh" "$LINT_COVERAGE_REPO_TMP/scripts/lib/"
git -C "$LINT_COVERAGE_REPO_TMP" init -q
HOOK_FIXTURE_REPO_ROOT="$LINT_COVERAGE_REPO_TMP"
LINT_COVERAGE_PINNED_LOG="$TMP_ROOT/lint-coverage-pinned.log"
# Dedicated, fresh throttle/cache state so lint-coverage runs never touch the
# shared /tmp root and each throttle sub-test starts from a known state.
LINT_COVERAGE_STATE_DIR="$TMP_ROOT/lint-coverage-state"
LINT_COVERAGE_CACHE_STATE="$TMP_ROOT/lint-coverage-cache"
cat > "$LINT_COVERAGE_REPO_TMP/lint-ratchet.baseline.json" <<'JSON'
{
  "version": 1,
  "tests": {
    "ratchet/fixture": {
      "ruleId": "fixture/rule",
      "mode": "no-new",
      "target": 0,
      "metric": "message-count",
      "files": [
        "src/ratcheted/**/*.ts"
      ],
      "ignores": [
        "src/ratcheted/**/*.test.ts"
      ],
      "ruleOptions": [],
      "configHash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "ruleSourceHash": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "items": {}
    }
  }
}
JSON
cat > "$LINT_COVERAGE_REPO_TMP/node_modules/.bin/eslint" <<'EOF'
#!/bin/bash
set -u

printf 'eslint' >> "$LINT_COVERAGE_PINNED_LOG"
for arg in "$@"; do
  printf '\t%s' "$arg" >> "$LINT_COVERAGE_PINNED_LOG"
done
printf '\n' >> "$LINT_COVERAGE_PINNED_LOG"

target=""
for arg in "$@"; do
  target="$arg"
done

case "$target" in
  *uncovered*)
    printf 'undefined\n'
    ;;
  *)
    printf '{"rules":{}}\n'
    ;;
esac
EOF
chmod +x "$LINT_COVERAGE_REPO_TMP/node_modules/.bin/eslint"

# Fake `bun` for the lint-coverage hook: emulates
#   bun <script> --edit-ratchet-coverage <relpath>...
# against the fixture's single ratchet/fixture floor (files src/ratcheted/**/*.ts,
# ignores src/ratcheted/**/*.test.ts, ruleId fixture/rule). The real baseline parse
# and glob matcher are covered end-to-end by scripts/tests/test-lint-ratchet.sh; this
# stub isolates the hook's bash logic (uncovered-branch wiring, row parsing,
# tier bucketing, degrade-on-failure). LC_BUN_FAIL=1 forces a non-zero exit so the
# hook's "engine failed -> fall back to the uncovered tier" path can be exercised.
LINT_COVERAGE_FAKE_BIN="$TMP_ROOT/lint-coverage-bin"
mkdir -p "$LINT_COVERAGE_FAKE_BIN"
cat > "$LINT_COVERAGE_FAKE_BIN/bun" <<'EOF'
#!/bin/bash
set -u
mode=""
for arg in "$@"; do
  case "$arg" in --edit-ratchet-coverage) mode="coverage" ;; esac
done
[ "$mode" = "coverage" ] || exit 0
[ "${LC_BUN_FAIL:-0}" = "1" ] && exit 3
emit=0
for arg in "$@"; do
  if [ "$arg" = "--edit-ratchet-coverage" ]; then emit=1; continue; fi
  [ "$emit" = "1" ] || continue
  case "$arg" in
    src/ratcheted/*.test.ts) ;;
    src/ratcheted/*.ts) printf 'ratchet-covered\t%s\tfixture/rule\n' "$arg" ;;
  esac
done
exit 0
EOF
chmod +x "$LINT_COVERAGE_FAKE_BIN/bun"

run_lint_coverage_hook() {
  local payload="$1"

  # Detection tests run with TTL=0 (always emit) so the throttle state machine
  # never changes their expectations; throttle tests set AI_LINT_COVERAGE_TTL,
  # AI_LINT_COVERAGE_MAX_DETECTIONS, and AI_FAKE_NOW explicitly before calling.
    LINT_COVERAGE_PINNED_LOG="$LINT_COVERAGE_PINNED_LOG" \
    AI_STATE_ROOT="$LINT_COVERAGE_CACHE_STATE" \
    AI_THROTTLE_STATE_DIR="$LINT_COVERAGE_STATE_DIR" \
    AI_BUN_LOG_DIR="$AI_BUN_LOG_DIR" \
    AI_PRECOMMIT_LOG_DIR="$AI_PRECOMMIT_LOG_DIR" \
    AI_LINT_COVERAGE_TTL="${AI_LINT_COVERAGE_TTL:-0}" \
    AI_LINT_COVERAGE_MAX_DETECTIONS="${AI_LINT_COVERAGE_MAX_DETECTIONS:-10}" \
    AI_FAKE_NOW="${AI_FAKE_NOW:-}" \
    LC_BUN_FAIL="${LC_BUN_FAIL:-0}" \
    PATH="$LINT_COVERAGE_FAKE_BIN:$PATH" \
    bash "$LINT_COVERAGE_REPO_TMP/scripts/ai-hooks/lint-coverage-check.sh" <<< "$payload"
}

lint_coverage_payload_for_session() {
  local file="$1"
  local session="$2"

  jq -n --arg file "$file" --arg sid "$session" \
    '{session_id:$sid,tool_name:"Edit",tool_input:{file_path:$file}}'
}

lint_coverage_context() {
  jq -r '.hookSpecificOutput.additionalContext // empty' <<< "$1"
}

LINT_COVERAGE_COVERED_TS="$LINT_COVERAGE_REPO_TMP/src/covered.ts"
LINT_COVERAGE_COVERED_TS_REL=$(tidy_relative_path "$LINT_COVERAGE_COVERED_TS")
printf 'const covered = 1;\n' > "$LINT_COVERAGE_COVERED_TS"
: > "$LINT_COVERAGE_PINNED_LOG"
LINT_COVERAGE_OUTPUT=$(run_lint_coverage_hook "$(tidy_payload_for_file "$LINT_COVERAGE_COVERED_TS_REL")") \
  || fail "lint coverage hook should not fail for covered Claude .ts payload"
assert_hook_continue_json "$LINT_COVERAGE_OUTPUT"
LINT_COVERAGE_EXPECTED_LOG=$(printf 'eslint\t--print-config\t%s' "$LINT_COVERAGE_COVERED_TS")
[ "$(cat "$LINT_COVERAGE_PINNED_LOG")" = "$LINT_COVERAGE_EXPECTED_LOG" ] \
  || fail "Claude lint coverage command log mismatch: $(cat "$LINT_COVERAGE_PINNED_LOG")"

LINT_COVERAGE_UNCOVERED_JSONC="$LINT_COVERAGE_REPO_TMP/src/uncovered.jsonc"
LINT_COVERAGE_UNCOVERED_JSONC_REL=$(tidy_relative_path "$LINT_COVERAGE_UNCOVERED_JSONC")
printf '{ "uncovered": true }\n' > "$LINT_COVERAGE_UNCOVERED_JSONC"
: > "$LINT_COVERAGE_PINNED_LOG"
LINT_COVERAGE_OUTPUT=$(run_lint_coverage_hook "$(tidy_payload_for_file "$LINT_COVERAGE_UNCOVERED_JSONC_REL")") \
  || fail "lint coverage hook should not fail for uncovered Claude .jsonc payload"
assert_hook_json "$LINT_COVERAGE_OUTPUT"
LINT_COVERAGE_CONTEXT=$(lint_coverage_context "$LINT_COVERAGE_OUTPUT")
assert_contains "$LINT_COVERAGE_CONTEXT" "NOT covered by ESLint at all"
assert_contains "$LINT_COVERAGE_CONTEXT" "  - $LINT_COVERAGE_UNCOVERED_JSONC_REL"
assert_contains "$LINT_COVERAGE_CONTEXT" "lint-coverage-map.md"
assert_contains "$LINT_COVERAGE_CONTEXT" "bun run docs:lint-coverage-map:suggest"
assert_contains "$LINT_COVERAGE_CONTEXT" $'\nbun run docs:lint-coverage-map:suggest\n'
LINT_COVERAGE_EXPECTED_LOG=$(printf 'eslint\t--print-config\t%s' "$LINT_COVERAGE_UNCOVERED_JSONC")
[ "$(cat "$LINT_COVERAGE_PINNED_LOG")" = "$LINT_COVERAGE_EXPECTED_LOG" ] \
  || fail "Claude lint coverage JSONC command log mismatch: $(cat "$LINT_COVERAGE_PINNED_LOG")"

LINT_COVERAGE_RATCHETED_TS="$LINT_COVERAGE_REPO_TMP/src/ratcheted/uncovered-ratchet.ts"
LINT_COVERAGE_RATCHETED_TS_REL=$(tidy_relative_path "$LINT_COVERAGE_RATCHETED_TS")
printf 'const ratcheted = 1;\n' > "$LINT_COVERAGE_RATCHETED_TS"
: > "$LINT_COVERAGE_PINNED_LOG"
LINT_COVERAGE_OUTPUT=$(run_lint_coverage_hook "$(tidy_payload_for_file "$LINT_COVERAGE_RATCHETED_TS_REL")") \
  || fail "lint coverage hook should not fail for ratchet-covered payload"
assert_hook_json "$LINT_COVERAGE_OUTPUT"
LINT_COVERAGE_CONTEXT=$(lint_coverage_context "$LINT_COVERAGE_OUTPUT")
assert_contains "$LINT_COVERAGE_CONTEXT" "covered only by lint:ratchet"
assert_contains "$LINT_COVERAGE_CONTEXT" "  - $LINT_COVERAGE_RATCHETED_TS_REL (fixture/rule)"
assert_contains "$LINT_COVERAGE_CONTEXT" "accepted floor, not an error"
assert_contains "$LINT_COVERAGE_CONTEXT" "For the full ratchet picture: bun run lint:ratchet"
assert_contains "$LINT_COVERAGE_CONTEXT" "For structured local/* guidance only: bun run lint:agent:local-rules:changed"
assert_not_contains "$LINT_COVERAGE_CONTEXT" "For structured per-rule fix guidance"
assert_not_contains "$LINT_COVERAGE_CONTEXT" "NOT covered by ESLint at all"
LINT_COVERAGE_EXPECTED_LOG=$(printf 'eslint\t--print-config\t%s' "$LINT_COVERAGE_RATCHETED_TS")
[ "$(cat "$LINT_COVERAGE_PINNED_LOG")" = "$LINT_COVERAGE_EXPECTED_LOG" ] \
  || fail "Claude lint coverage ratcheted command log mismatch: $(cat "$LINT_COVERAGE_PINNED_LOG")"

LINT_COVERAGE_RATCHET_IGNORED_TS="$LINT_COVERAGE_REPO_TMP/src/ratcheted/uncovered-ratchet.test.ts"
LINT_COVERAGE_RATCHET_IGNORED_TS_REL=$(tidy_relative_path "$LINT_COVERAGE_RATCHET_IGNORED_TS")
printf 'const ratchetIgnored = 1;\n' > "$LINT_COVERAGE_RATCHET_IGNORED_TS"
: > "$LINT_COVERAGE_PINNED_LOG"
LINT_COVERAGE_OUTPUT=$(run_lint_coverage_hook "$(tidy_payload_for_file "$LINT_COVERAGE_RATCHET_IGNORED_TS_REL")") \
  || fail "lint coverage hook should not fail for ratchet-ignored uncovered payload"
assert_hook_json "$LINT_COVERAGE_OUTPUT"
LINT_COVERAGE_CONTEXT=$(lint_coverage_context "$LINT_COVERAGE_OUTPUT")
assert_contains "$LINT_COVERAGE_CONTEXT" "NOT covered by ESLint at all"
assert_contains "$LINT_COVERAGE_CONTEXT" "  - $LINT_COVERAGE_RATCHET_IGNORED_TS_REL"
LINT_COVERAGE_EXPECTED_LOG=$(printf 'eslint\t--print-config\t%s' "$LINT_COVERAGE_RATCHET_IGNORED_TS")
[ "$(cat "$LINT_COVERAGE_PINNED_LOG")" = "$LINT_COVERAGE_EXPECTED_LOG" ] \
  || fail "Claude lint coverage ratchet-ignored command log mismatch: $(cat "$LINT_COVERAGE_PINNED_LOG")"

# A failing ratchet-coverage query (engine error, missing/malformed baseline)
# degrades to the louder uncovered tier instead of dropping the file: the same
# ratcheted path that is normally "covered only by lint:ratchet" falls back to
# "NOT covered by ESLint at all" when the query exits non-zero.
LINT_COVERAGE_BUNFAIL_TS="$LINT_COVERAGE_REPO_TMP/src/ratcheted/uncovered-bunfail.ts"
LINT_COVERAGE_BUNFAIL_TS_REL=$(tidy_relative_path "$LINT_COVERAGE_BUNFAIL_TS")
printf 'const bunfail = 1;\n' > "$LINT_COVERAGE_BUNFAIL_TS"
LINT_COVERAGE_OUTPUT=$(LC_BUN_FAIL=1 run_lint_coverage_hook "$(tidy_payload_for_file "$LINT_COVERAGE_BUNFAIL_TS_REL")") \
  || fail "lint coverage hook should not fail when the ratchet coverage query fails"
LINT_COVERAGE_CONTEXT=$(lint_coverage_context "$LINT_COVERAGE_OUTPUT")
assert_contains "$LINT_COVERAGE_CONTEXT" "NOT covered by ESLint at all"
assert_contains "$LINT_COVERAGE_CONTEXT" "  - $LINT_COVERAGE_BUNFAIL_TS_REL"
assert_not_contains "$LINT_COVERAGE_CONTEXT" "covered only by lint:ratchet"

LINT_COVERAGE_MD="$LINT_COVERAGE_REPO_TMP/src/note.md"
LINT_COVERAGE_MD_REL=$(tidy_relative_path "$LINT_COVERAGE_MD")
printf '# note\n' > "$LINT_COVERAGE_MD"
: > "$LINT_COVERAGE_PINNED_LOG"
LINT_COVERAGE_OUTPUT=$(run_lint_coverage_hook "$(tidy_payload_for_file "$LINT_COVERAGE_MD_REL")") \
  || fail "lint coverage hook should not fail for non-lintable payload"
assert_hook_continue_json "$LINT_COVERAGE_OUTPUT"
[ ! -s "$LINT_COVERAGE_PINNED_LOG" ] || fail "non-lintable file should not invoke pinned tools"

LINT_COVERAGE_CODEX_UNCOVERED_TS="$LINT_COVERAGE_REPO_TMP/src/codex-uncovered.ts"
LINT_COVERAGE_CODEX_COVERED_JSON="$LINT_COVERAGE_REPO_TMP/src/codex-covered.json"
LINT_COVERAGE_CODEX_RATCHETED_TS="$LINT_COVERAGE_REPO_TMP/src/ratcheted/codex-uncovered-ratchet.ts"
LINT_COVERAGE_CODEX_MISSING="$LINT_COVERAGE_REPO_TMP/src/codex-missing.ts"
printf 'const uncovered = 1;\n' > "$LINT_COVERAGE_CODEX_UNCOVERED_TS"
printf '{ "covered": true }\n' > "$LINT_COVERAGE_CODEX_COVERED_JSON"
printf 'const ratcheted = 1;\n' > "$LINT_COVERAGE_CODEX_RATCHETED_TS"
LINT_COVERAGE_CODEX_UNCOVERED_TS_REL=$(tidy_relative_path "$LINT_COVERAGE_CODEX_UNCOVERED_TS")
LINT_COVERAGE_CODEX_COVERED_JSON_REL=$(tidy_relative_path "$LINT_COVERAGE_CODEX_COVERED_JSON")
LINT_COVERAGE_CODEX_RATCHETED_TS_REL=$(tidy_relative_path "$LINT_COVERAGE_CODEX_RATCHETED_TS")
LINT_COVERAGE_CODEX_MISSING_REL=$(tidy_relative_path "$LINT_COVERAGE_CODEX_MISSING")
LINT_COVERAGE_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  "*** Add File: $LINT_COVERAGE_CODEX_UNCOVERED_TS_REL" \
  '+const uncovered = 1;' \
  "*** Update File: $LINT_COVERAGE_CODEX_COVERED_JSON_REL" \
  '@@' \
  '-{ "covered": false }' \
  '+{ "covered": true }' \
  "*** Update File: $LINT_COVERAGE_CODEX_RATCHETED_TS_REL" \
  '@@' \
  '-const ratcheted = 0;' \
  '+const ratcheted = 1;' \
  "*** Update File: $LINT_COVERAGE_CODEX_UNCOVERED_TS_REL" \
  '@@' \
  '-const uncovered = 0;' \
  '+const uncovered = 1;' \
  "*** Delete File: $LINT_COVERAGE_CODEX_MISSING_REL" \
  '*** End Patch')
LINT_COVERAGE_CODEX_PAYLOAD=$(jq -n --arg command "$LINT_COVERAGE_PATCH" --arg ignored "node_modules/ignored.ts" \
  '{tool_name:"apply_patch",tool_input:{file_path:$ignored,command:$command}}')
: > "$LINT_COVERAGE_PINNED_LOG"
LINT_COVERAGE_OUTPUT=$(run_lint_coverage_hook "$LINT_COVERAGE_CODEX_PAYLOAD") \
  || fail "lint coverage hook should not fail for Codex apply_patch payload"
assert_hook_json "$LINT_COVERAGE_OUTPUT"
LINT_COVERAGE_CONTEXT=$(lint_coverage_context "$LINT_COVERAGE_OUTPUT")
assert_contains "$LINT_COVERAGE_CONTEXT" "NOT covered by ESLint at all"
assert_contains "$LINT_COVERAGE_CONTEXT" "  - $LINT_COVERAGE_CODEX_UNCOVERED_TS_REL"
assert_not_contains "$LINT_COVERAGE_CONTEXT" "$LINT_COVERAGE_CODEX_COVERED_JSON_REL"
assert_contains "$LINT_COVERAGE_CONTEXT" "covered only by lint:ratchet"
assert_contains "$LINT_COVERAGE_CONTEXT" "  - $LINT_COVERAGE_CODEX_RATCHETED_TS_REL (fixture/rule)"
assert_not_contains "$LINT_COVERAGE_CONTEXT" "$LINT_COVERAGE_CODEX_MISSING_REL"
assert_not_contains "$LINT_COVERAGE_CONTEXT" "node_modules/ignored.ts"
LINT_COVERAGE_EXPECTED_LOG=$(printf 'eslint\t--print-config\t%s\neslint\t--print-config\t%s\neslint\t--print-config\t%s' "$LINT_COVERAGE_CODEX_UNCOVERED_TS" "$LINT_COVERAGE_CODEX_COVERED_JSON" "$LINT_COVERAGE_CODEX_RATCHETED_TS")
[ "$(cat "$LINT_COVERAGE_PINNED_LOG")" = "$LINT_COVERAGE_EXPECTED_LOG" ] \
  || fail "Codex lint coverage command log mismatch: $(cat "$LINT_COVERAGE_PINNED_LOG")"

# --- neutral throttle state helpers ------------------------------------------
THROTTLE_STATE_FILE="$TMP_ROOT/throttle-state-unit"
LC_NOW=$(date +%s)
printf 'LAST_TS=%s\nLAST_COUNT=4\n' "$LC_NOW" > "$THROTTLE_STATE_FILE"
ai_throttle_read_state "$THROTTLE_STATE_FILE" || fail "valid throttle state should parse"
[ "$AI_THROTTLE_STATE_TS" = "$LC_NOW" ] || fail "throttle state ts mismatch (got $AI_THROTTLE_STATE_TS)"
[ "$AI_THROTTLE_STATE_COUNT" = "4" ] || fail "throttle state count mismatch (got $AI_THROTTLE_STATE_COUNT)"

assert_throttle_state_read_fails "$THROTTLE_STATE_FILE" "LAST_TS=$LC_NOW"
assert_throttle_state_read_fails "$THROTTLE_STATE_FILE" "LAST_COUNT=1"
assert_throttle_state_read_fails "$THROTTLE_STATE_FILE" "LAST_TS=$LC_NOW
LAST_COUNT=1
LAST_BOGUS=2"
assert_throttle_state_read_fails "$THROTTLE_STATE_FILE" "LAST_TS=not-a-time
LAST_COUNT=1"
assert_throttle_state_read_fails "$THROTTLE_STATE_FILE" "LAST_TS=0
LAST_COUNT=1"
assert_throttle_state_read_fails "$THROTTLE_STATE_FILE" "LAST_TS=-5
LAST_COUNT=1"
assert_throttle_state_read_fails "$THROTTLE_STATE_FILE" "LAST_TS=$LC_NOW
LAST_COUNT=x"
assert_throttle_state_read_fails "$THROTTLE_STATE_FILE" "LAST_TS=$LC_NOW
LAST_COUNT=-1"

if grep -qE '^ai_lint_coverage_(throttle_key|state_path|read_state|write_state|should_emit|would_emit)[[:space:]]*\(\)' "$SCRIPT_DIR/lint-coverage-state.sh"; then
  fail "lint-coverage-state.sh should not expose neutral throttle compatibility wrappers"
fi

# Invalid TTL / max-detection env values fall back to the documented defaults;
# valid values (including TTL=0, the always-emit escape hatch) pass through.
[ "$(AI_LINT_COVERAGE_TTL=abc; ai_lint_coverage_ttl)" = "1800" ] || fail "non-integer TTL should default"
[ "$(AI_LINT_COVERAGE_TTL=-5; ai_lint_coverage_ttl)" = "1800" ] || fail "negative TTL should default"
[ "$(AI_LINT_COVERAGE_TTL=0; ai_lint_coverage_ttl)" = "0" ] || fail "zero TTL should be allowed"
[ "$(AI_LINT_COVERAGE_TTL=60; ai_lint_coverage_ttl)" = "60" ] || fail "valid TTL should pass through"
[ "$(AI_LINT_COVERAGE_MAX_DETECTIONS=abc; ai_lint_coverage_max_detections)" = "10" ] || fail "non-integer max should default"
[ "$(AI_LINT_COVERAGE_MAX_DETECTIONS=0; ai_lint_coverage_max_detections)" = "10" ] || fail "zero max should default"
[ "$(AI_LINT_COVERAGE_MAX_DETECTIONS=-3; ai_lint_coverage_max_detections)" = "10" ] || fail "negative max should default"
[ "$(AI_LINT_COVERAGE_MAX_DETECTIONS=5; ai_lint_coverage_max_detections)" = "5" ] || fail "valid max should pass through"

# Suppress-branch write failure must fail toward emitting: a readable in-window
# state with counter room normally suppresses, but if persisting the bumped
# counter fails, the warning still emits rather than relying on a counter that
# can no longer advance. Mirrors the ai_write_bun_marker mv-failure pattern.
LC_WF_DIR="$TMP_ROOT/lint-coverage-writefail-state"
mkdir -p "$LC_WF_DIR"
LC_WF_FILE="$LC_WF_DIR/uncovered.writefail"
printf 'LAST_TS=900000\nLAST_COUNT=0\n' > "$LC_WF_FILE"
if (
  AI_THROTTLE_STATE_DIR="$LC_WF_DIR" ai_throttle_should_emit uncovered writefail 900000 1800 10
); then
  fail "readable in-window state with counter room should suppress when writes succeed"
fi
printf 'LAST_TS=900000\nLAST_COUNT=0\n' > "$LC_WF_FILE"
if (
  ai_throttle_write_state() { return 1; }
  AI_THROTTLE_STATE_DIR="$LC_WF_DIR" ai_throttle_should_emit uncovered writefail 900000 1800 10
); then
  : # emitted: failed increment write correctly fell back to emitting
else
  fail "suppress-branch write failure should fail toward emitting"
fi

assert_throttle_decisions_agree() {
  local label="$1"
  local state="$2"
  local now="$3"
  local ttl="$4"
  local max="$5"
  local expected="$6"
  local tier="agree-$label"
  local key="key-$label"
  local would_dir="$TMP_ROOT/throttle-agree-$label-would"
  local should_dir="$TMP_ROOT/throttle-agree-$label-should"
  local would_status should_status

  rm -rf "$would_dir" "$should_dir"
  mkdir -p "$would_dir" "$should_dir"
  if [ -n "$state" ]; then
    printf '%s\n' "$state" > "$would_dir/$tier.$key"
    printf '%s\n' "$state" > "$should_dir/$tier.$key"
  fi

  set +e
  AI_THROTTLE_STATE_DIR="$would_dir" ai_throttle_would_emit "$tier" "$key" "$now" "$ttl" "$max"
  would_status=$?
  AI_THROTTLE_STATE_DIR="$should_dir" ai_throttle_should_emit "$tier" "$key" "$now" "$ttl" "$max"
  should_status=$?
  set -e

  [ "$would_status" -eq "$should_status" ] \
    || fail "would_emit/should_emit disagreement for $label: $would_status vs $should_status"
  [ "$should_status" -eq "$expected" ] \
    || fail "unexpected throttle decision for $label: expected $expected got $should_status"
}

assert_throttle_decisions_agree "missing" "" 1000 1800 10 0
assert_throttle_decisions_agree "corrupt" "not a valid state file" 1000 1800 10 0
assert_throttle_decisions_agree "clock-jump" "LAST_TS=2000
LAST_COUNT=0" 1000 1800 10 0
assert_throttle_decisions_agree "ttl-expiry" "LAST_TS=1000
LAST_COUNT=0" 2800 1800 10 0
assert_throttle_decisions_agree "max-release" "LAST_TS=1000
LAST_COUNT=2" 1000 1800 3 0
assert_throttle_decisions_agree "in-window" "LAST_TS=1000
LAST_COUNT=0" 1000 1800 3 1

# --- lint-coverage throttle end-to-end ---------------------------------------
COMBINED_LC_PATCH=$(printf '%s\n' \
  '*** Begin Patch' \
  "*** Update File: $LINT_COVERAGE_CODEX_UNCOVERED_TS_REL" \
  '@@' \
  '-const uncovered = 0;' \
  '+const uncovered = 1;' \
  "*** Update File: $LINT_COVERAGE_CODEX_RATCHETED_TS_REL" \
  '@@' \
  '-const ratcheted = 0;' \
  '+const ratcheted = 1;' \
  '*** End Patch')
combined_lc_payload_for_session() {
  jq -n --arg command "$COMBINED_LC_PATCH" --arg sid "$1" \
    '{session_id:$sid,tool_name:"apply_patch",tool_input:{command:$command}}'
}

# Same session: emit, suppress, suppress, re-emit on the MAX_DETECTIONS-th
# subsequent detection. now is pinned so age stays under TTL throughout.
rm -rf "$LINT_COVERAGE_STATE_DIR"
LC_PAYLOAD_A=$(lint_coverage_payload_for_session "$LINT_COVERAGE_UNCOVERED_JSONC_REL" "session-a")
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=3 AI_FAKE_NOW=100000 run_lint_coverage_hook "$LC_PAYLOAD_A")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=3 AI_FAKE_NOW=100000 run_lint_coverage_hook "$LC_PAYLOAD_A")
assert_hook_continue_json "$LC_OUT"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=3 AI_FAKE_NOW=100000 run_lint_coverage_hook "$LC_PAYLOAD_A")
assert_hook_continue_json "$LC_OUT"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=3 AI_FAKE_NOW=100000 run_lint_coverage_hook "$LC_PAYLOAD_A")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"

# TTL elapsed: a suppressed session re-emits once the clock advances past TTL.
rm -rf "$LINT_COVERAGE_STATE_DIR"
LC_PAYLOAD_TIME=$(lint_coverage_payload_for_session "$LINT_COVERAGE_UNCOVERED_JSONC_REL" "session-time")
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=200000 run_lint_coverage_hook "$LC_PAYLOAD_TIME")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=200000 run_lint_coverage_hook "$LC_PAYLOAD_TIME")
assert_hook_continue_json "$LC_OUT"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=201801 run_lint_coverage_hook "$LC_PAYLOAD_TIME")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"

# Backward clock jump re-emits and resets even with counter room under MAX: a
# negative age cannot be trusted, so the suppress path is skipped.
rm -rf "$LINT_COVERAGE_STATE_DIR"
LC_PAYLOAD_CLOCK=$(lint_coverage_payload_for_session "$LINT_COVERAGE_UNCOVERED_JSONC_REL" "session-clock")
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=900000 run_lint_coverage_hook "$LC_PAYLOAD_CLOCK")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=899900 run_lint_coverage_hook "$LC_PAYLOAD_CLOCK")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"

# Different session id: fresh state, re-emits even at the same instant.
LC_PAYLOAD_B=$(lint_coverage_payload_for_session "$LINT_COVERAGE_UNCOVERED_JSONC_REL" "session-b")
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=200000 run_lint_coverage_hook "$LC_PAYLOAD_B")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"

# No session id: first emits, second suppresses through the repo fallback key.
rm -rf "$LINT_COVERAGE_STATE_DIR"
LC_PAYLOAD_NOSESS=$(tidy_payload_for_file "$LINT_COVERAGE_UNCOVERED_JSONC_REL")
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=300000 run_lint_coverage_hook "$LC_PAYLOAD_NOSESS")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=300000 run_lint_coverage_hook "$LC_PAYLOAD_NOSESS")
assert_hook_continue_json "$LC_OUT"

# Tier independence: a tier (b) emit is not blocked by a prior tier (a) emit on
# the same session/instant — the two tiers keep separate counters.
rm -rf "$LINT_COVERAGE_STATE_DIR"
LC_PAYLOAD_RATCHET=$(lint_coverage_payload_for_session "$LINT_COVERAGE_RATCHETED_TS_REL" "session-tier")
LC_PAYLOAD_UNCOV=$(lint_coverage_payload_for_session "$LINT_COVERAGE_UNCOVERED_JSONC_REL" "session-tier")
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=2 AI_FAKE_NOW=400000 run_lint_coverage_hook "$LC_PAYLOAD_RATCHET")
assert_contains "$(lint_coverage_context "$LC_OUT")" "covered only by lint:ratchet"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=2 AI_FAKE_NOW=400000 run_lint_coverage_hook "$LC_PAYLOAD_UNCOV")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"

# Both tiers in one payload emit together in a single additional-context block.
rm -rf "$LINT_COVERAGE_STATE_DIR"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=2 AI_FAKE_NOW=500000 run_lint_coverage_hook "$(combined_lc_payload_for_session "session-both")")
LC_CONTEXT=$(lint_coverage_context "$LC_OUT")
assert_contains "$LC_CONTEXT" "covered only by lint:ratchet"
assert_contains "$LC_CONTEXT" "NOT covered by ESLint at all"

# When one tier is suppressed, a combined payload still emits the other tier.
# Drive the ratchet tier to a near-suppress state on its own, then a combined
# payload suppresses ratchet but emits the still-fresh uncovered tier.
rm -rf "$LINT_COVERAGE_STATE_DIR"
LC_PAYLOAD_RATCHET_MIX=$(lint_coverage_payload_for_session "$LINT_COVERAGE_CODEX_RATCHETED_TS_REL" "session-mix")
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=2 AI_FAKE_NOW=600000 run_lint_coverage_hook "$LC_PAYLOAD_RATCHET_MIX")
assert_contains "$(lint_coverage_context "$LC_OUT")" "covered only by lint:ratchet"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=2 AI_FAKE_NOW=600000 run_lint_coverage_hook "$(combined_lc_payload_for_session "session-mix")")
LC_CONTEXT=$(lint_coverage_context "$LC_OUT")
assert_contains "$LC_CONTEXT" "NOT covered by ESLint at all"
assert_not_contains "$LC_CONTEXT" "covered only by lint:ratchet"

# Garbage state file is treated as fresh and re-emits. With MAX=10 and a pinned
# clock a valid {count:0} state would suppress the second call, so the re-emit
# can only be the corrupt file failing the read.
rm -rf "$LINT_COVERAGE_STATE_DIR"
LC_PAYLOAD_GARBAGE=$(lint_coverage_payload_for_session "$LINT_COVERAGE_UNCOVERED_JSONC_REL" "session-garbage")
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=700000 run_lint_coverage_hook "$LC_PAYLOAD_GARBAGE")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"
LC_GARBAGE_STATE=$(find "$LINT_COVERAGE_STATE_DIR" -type f -name 'uncovered.*' | head -n 1)
[ -n "$LC_GARBAGE_STATE" ] || fail "expected an uncovered throttle state file after first emit"
printf 'not a valid state file\n' > "$LC_GARBAGE_STATE"
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=700000 run_lint_coverage_hook "$LC_PAYLOAD_GARBAGE")
assert_contains "$(lint_coverage_context "$LC_OUT")" "NOT covered by ESLint at all"

# Covered edits emit nothing and never create throttle state.
rm -rf "$LINT_COVERAGE_STATE_DIR"
LC_PAYLOAD_COVERED=$(lint_coverage_payload_for_session "$LINT_COVERAGE_COVERED_TS_REL" "session-covered")
LC_OUT=$(AI_LINT_COVERAGE_TTL=1800 AI_LINT_COVERAGE_MAX_DETECTIONS=10 AI_FAKE_NOW=800000 run_lint_coverage_hook "$LC_PAYLOAD_COVERED")
assert_hook_continue_json "$LC_OUT"
LC_STATE_FILE_COUNT=$(find "$LINT_COVERAGE_STATE_DIR" -type f | wc -l)
[ "$LC_STATE_FILE_COUNT" -eq 0 ] || fail "covered edit should not create throttle state"

# --- ai_throttle_would_emit (read-only throttle probe) -----------------------
# The ratchet-regression hook throttles BEFORE spending a lint, so the probe
# must answer "would this tier emit?" without writing state.
RR_WE_DIR="$TMP_ROOT/would-emit-state"
rm -rf "$RR_WE_DIR"
mkdir -p "$RR_WE_DIR"
( AI_THROTTLE_STATE_DIR="$RR_WE_DIR" ai_throttle_would_emit ratchetreg:probe key-we 1000 1800 10 ) \
  || fail "would_emit should emit for a fresh tier"
[ "$(find "$RR_WE_DIR" -type f | wc -l)" -eq 0 ] || fail "would_emit must not write state for a fresh tier"
printf 'LAST_TS=1000\nLAST_COUNT=0\n' > "$RR_WE_DIR/ratchetreg:probe.key-we"
if ( AI_THROTTLE_STATE_DIR="$RR_WE_DIR" ai_throttle_would_emit ratchetreg:probe key-we 1000 1800 10 ); then
  fail "would_emit should suppress an in-window tier with counter room"
fi
( AI_THROTTLE_STATE_DIR="$RR_WE_DIR" ai_throttle_would_emit ratchetreg:probe key-we 999999 1800 10 ) \
  || fail "would_emit should emit once age passes TTL"
grep -qF "LAST_COUNT=0" "$RR_WE_DIR/ratchetreg:probe.key-we" \
  || fail "would_emit must not mutate throttle state"


printf 'ai-hooks lint-coverage tests passed\n'
