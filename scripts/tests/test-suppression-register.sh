#!/usr/bin/env bash
# Pure-shell tests for TypeScript and Stryker suppression register diagnostics.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPORT="$SCRIPT_DIR/../suppression-register.sh"

PASS=0
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT
RUN_OUTPUT=""
RUN_STATUS=0

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }
contains() { [[ "$1" == *"$2"* ]]; }

run_report() {
  set +e
  RUN_OUTPUT="$(bash "$REPORT" "$1" 2>&1)"
  RUN_STATUS=$?
  set -e
}

new_repo() {
  local name="$1"
  local repo="$TMP_ROOT/$name"
  mkdir -p "$repo"
  git -C "$repo" init -q
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  printf '%s\n' "$repo"
}

seed_file() {
  local repo="$1" path="$2"
  shift 2
  mkdir -p "$(dirname "$repo/$path")"
  printf '%s\n' "$@" > "$repo/$path"
  git -C "$repo" add "$path"
}

ts_expect_reason='// @ts-expect-error -- fixture intentionally violates contract'
ts_expect_bare='// @ts-expect-error'
ts_ignore_reason='// @ts-ignore -- legacy fixture'
ts_nocheck_reason='// @ts-nocheck -- generated fixture'
stryker_inline='// Stryker disable next-line MutatorName -- equivalent branch covered elsewhere'
stryker_broad='// Stryker disable MutatorName -- equivalent block covered elsewhere'
string_fixture='const s = "// @ts-ignore";'
block_ts_expect='/* @ts-expect-error -- block form */'

repo="$(new_repo clean)"
seed_file "$repo" src/app.ts 'const value = 1;'
run_report "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "clean repo should pass: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register total=0 ts-expect-error=0 ts-ignore=0 ts-nocheck=0 stryker=0' \
  || fail "clean repo count was wrong: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register missing reasons total=0' \
  || fail "clean repo should pass missing-reason check: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register @ts-ignore deprecation clean total=0' \
  || fail "clean repo should pass ts-ignore check: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register @ts-nocheck allowlist clean total=0' \
  || fail "clean repo should pass ts-nocheck check: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register broad Stryker disable clean total=0' \
  || fail "clean repo should pass broad Stryker check: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register all policy checks clean' \
  || fail "clean repo should print all-clean summary: $RUN_OUTPUT"
ok "reports zero suppressions"

repo="$(new_repo annotated-ts-expect)"
seed_file "$repo" src/app.ts "$ts_expect_reason" 'unknownValue();'
run_report "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "annotated ts-expect-error should pass: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register total=1 ts-expect-error=1 ts-ignore=0 ts-nocheck=0 stryker=0' \
  || fail "annotated ts-expect-error count was wrong: $RUN_OUTPUT"
if contains "$RUN_OUTPUT" 'FAIL: suppression register reasons missing'; then
  fail "annotated ts-expect-error should not fail for missing reasons: $RUN_OUTPUT"
fi
contains "$RUN_OUTPUT" 'PASS: suppression register all policy checks clean' \
  || fail "annotated ts-expect-error should be policy-clean: $RUN_OUTPUT"
ok "counts annotated ts-expect-error without missing-reason failure"

repo="$(new_repo bare-ts-expect)"
seed_file "$repo" src/app.ts "$ts_expect_bare" 'unknownValue();'
run_report "$repo"
[ "$RUN_STATUS" -eq 1 ] || fail "bare ts-expect-error should fail hard-gate: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register total=1 ts-expect-error=1 ts-ignore=0 ts-nocheck=0 stryker=0' \
  || fail "bare ts-expect-error count was wrong: $RUN_OUTPUT"
contains "$RUN_OUTPUT" "FAIL: suppression register reasons missing '-- ' separator total=1" \
  || fail "bare ts-expect-error should fail for missing reason: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'src/app.ts:1 [ts-expect-error]' \
  || fail "bare ts-expect-error site not listed: $RUN_OUTPUT"
ok "hard-gates bare ts-expect-error as missing reason"

repo="$(new_repo ts-ignore)"
seed_file "$repo" src/app.ts "$ts_ignore_reason" 'unknownValue();'
run_report "$repo"
[ "$RUN_STATUS" -eq 1 ] || fail "ts-ignore should fail hard-gate: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register total=1 ts-expect-error=0 ts-ignore=1 ts-nocheck=0 stryker=0' \
  || fail "ts-ignore count was wrong: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'FAIL: suppression register prefers @ts-expect-error over @ts-ignore total=1' \
  || fail "ts-ignore deprecation failure was missing: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'src/app.ts:1 [ts-ignore]' \
  || fail "ts-ignore site not listed: $RUN_OUTPUT"
ok "hard-gates ts-ignore deprecation"

repo="$(new_repo ts-nocheck-outside)"
seed_file "$repo" src/app.ts "$ts_nocheck_reason" 'export const generated = true;'
run_report "$repo"
[ "$RUN_STATUS" -eq 1 ] || fail "ts-nocheck outside allowlist should fail hard-gate: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register total=1 ts-expect-error=0 ts-ignore=0 ts-nocheck=1 stryker=0' \
  || fail "ts-nocheck count was wrong: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'FAIL: suppression register @ts-nocheck outside allowlist total=1' \
  || fail "ts-nocheck allowlist failure was missing: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'src/app.ts:1 [ts-nocheck]' \
  || fail "ts-nocheck outside-allowlist site not listed: $RUN_OUTPUT"
ok "hard-gates ts-nocheck outside the allowlist"

repo="$(new_repo ts-nocheck-allowlisted)"
seed_file "$repo" scripts/drift-ai/suppressions.ts "$ts_nocheck_reason" 'export const parserFixture = true;'
run_report "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "allowlisted ts-nocheck should pass: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register total=1 ts-expect-error=0 ts-ignore=0 ts-nocheck=1 stryker=0' \
  || fail "allowlisted ts-nocheck count was wrong: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register @ts-nocheck allowlist clean total=0' \
  || fail "allowlisted ts-nocheck should pass allowlist check: $RUN_OUTPUT"
if contains "$RUN_OUTPUT" 'FAIL: suppression register @ts-nocheck outside allowlist'; then
  fail "allowlisted ts-nocheck should not fail: $RUN_OUTPUT"
fi
ok "counts allowlisted ts-nocheck without outside-allowlist failure"

repo="$(new_repo stryker-inline)"
seed_file "$repo" src/rules.ts "$stryker_inline" 'export const value = true;'
run_report "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "Stryker next-line should pass: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register total=1 ts-expect-error=0 ts-ignore=0 ts-nocheck=0 stryker=1' \
  || fail "Stryker next-line count was wrong: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register broad Stryker disable clean total=0' \
  || fail "Stryker next-line should not fail as broad: $RUN_OUTPUT"
ok "counts Stryker disable next-line without broad failure"

repo="$(new_repo stryker-broad)"
seed_file "$repo" src/rules.ts "$stryker_broad" 'export const value = true;'
run_report "$repo"
[ "$RUN_STATUS" -eq 1 ] || fail "broad Stryker disable should fail hard-gate: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register total=1 ts-expect-error=0 ts-ignore=0 ts-nocheck=0 stryker=1' \
  || fail "broad Stryker count was wrong: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'FAIL: suppression register broad Stryker disable total=1' \
  || fail "broad Stryker failure was missing: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'src/rules.ts:1 [stryker]' \
  || fail "broad Stryker site not listed: $RUN_OUTPUT"
ok "hard-gates broad Stryker disable"

repo="$(new_repo string-literal)"
seed_file "$repo" src/app.ts "$string_fixture"
run_report "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "string-literal fixture should pass: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register total=0 ts-expect-error=0 ts-ignore=0 ts-nocheck=0 stryker=0' \
  || fail "string-literal fixture should not be counted: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register all policy checks clean' \
  || fail "string-literal fixture should be policy-clean: $RUN_OUTPUT"
ok "ignores string-literal suppression fixtures"

repo="$(new_repo block-comment)"
seed_file "$repo" src/app.ts "$block_ts_expect" 'unknownValue();'
run_report "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "block comment ts-expect-error should pass: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register total=1 ts-expect-error=1 ts-ignore=0 ts-nocheck=0 stryker=0' \
  || fail "block comment ts-expect-error count was wrong: $RUN_OUTPUT"
if contains "$RUN_OUTPUT" 'FAIL: suppression register reasons missing'; then
  fail "block comment ts-expect-error should not fail for missing reasons: $RUN_OUTPUT"
fi
ok "detects block-comment ts-expect-error"

not_repo="$TMP_ROOT/not-git"
mkdir -p "$not_repo"
run_report "$not_repo"
[ "$RUN_STATUS" -eq 0 ] || fail "outside git repo should exit zero: $RUN_OUTPUT"
contains "$RUN_OUTPUT" "WARN: suppression register unavailable — $not_repo is not a git repository" \
  || fail "outside git repo warning was wrong: $RUN_OUTPUT"
ok "warns and exits zero outside a git repo"

printf 'suppression register tests passed (%d)\n' "$PASS"
