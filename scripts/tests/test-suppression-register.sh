#!/usr/bin/env bash
# smoke-order: 110
# smoke-subjects: scripts/lint-suppressions.sh
# smoke-subjects: scripts/suppression-register.sh
# smoke-subjects: scripts/eslint-disable-register.sh
# smoke-subjects: scripts/data/ts-nocheck-allowlist.txt
# smoke-subjects: scripts/lib/changed-base.sh
# smoke-subjects: scripts/lib/changed-lintable-files.sh
# smoke-subjects: scripts/lib/verify-metadata.sh
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/test-suppression-register.sh
# Pure-shell tests for TypeScript and Stryker suppression register diagnostics.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPORT="$SCRIPT_DIR/../suppression-register.sh"
ALLOWLIST="$SCRIPT_DIR/../data/ts-nocheck-allowlist.txt"

PASS=0
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT
RUN_OUTPUT=""
RUN_STATUS=0

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }
contains() { [[ "$1" == *"$2"* ]]; }

[[ -s "$ALLOWLIST" ]] || fail "ts-nocheck allowlist data file is missing or empty"
if grep -q 'scripts/drift-ai/suppressions.ts' "$REPORT"; then
  fail "ts-nocheck allowlist should not remain embedded in bash"
fi
ok "ts-nocheck waivers live in the data inventory"

run_report() {
  set +e
  RUN_OUTPUT="$(bash "$REPORT" "$1" 2>&1)"
  RUN_STATUS=$?
  set -e
}

run_report_changed() {
  set +e
  RUN_OUTPUT="$(bash "$REPORT" --changed base "$1" 2>&1)"
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
contains "$RUN_OUTPUT" "add ' -- <reason>' after the directive" \
  || fail "bare ts-expect-error should explain the missing reason repair: $RUN_OUTPUT"
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
contains "$RUN_OUTPUT" 'scripts/data/ts-nocheck-allowlist.txt' \
  || fail "ts-nocheck failure should point at the data inventory: $RUN_OUTPUT"
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

repo="$(new_repo template-literal)"
seed_file "$repo" src/app.ts \
  'export const fixture = `' \
  '  // @ts-expect-error' \
  '  value(${input});' \
  '`;' \
  'export const done = true;'
run_report "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "multi-line template literal fixture should pass: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register total=0 ts-expect-error=0 ts-ignore=0 ts-nocheck=0 stryker=0' \
  || fail "directive inside multi-line template literal was counted: $RUN_OUTPUT"
ok "ignores directives inside multi-line template literals"

repo="$(new_repo template-unclosed-block)"
seed_file "$repo" src/app.ts \
  'export const fixture = `' \
  '  /* unclosed block comment inside string data' \
  '`;' \
  "$ts_expect_reason" \
  'unknownValue();'
run_report "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "unclosed /* in template fixture should pass: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register total=1 ts-expect-error=1 ts-ignore=0 ts-nocheck=0 stryker=0' \
  || fail "real directive after template with unclosed /* was not counted: $RUN_OUTPUT"
ok "does not leak template contents into block-comment state"

# Pin the accepted line-scanner tradeoff: the scanner has no regex-literal
# handling, so a code-position backtick that is NOT a template opener (here a
# regex literal) flips the file-scoped template state, and a genuine directive
# before the next backtick escapes the register — an accepted false negative,
# preferred over treating template data as code and false-failing the gate.
# Any future change that starts counting this must be deliberate.
repo="$(new_repo regex-backtick)"
seed_file "$repo" src/app.ts \
  'export const re = /[`]/;' \
  "$ts_expect_reason" \
  'unknownValue();'
run_report "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "regex-backtick fixture should pass: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register total=0 ts-expect-error=0 ts-ignore=0 ts-nocheck=0 stryker=0' \
  || fail "directive after a regex-literal backtick should stay uncounted (pinned tradeoff): $RUN_OUTPUT"
ok "pins the uncounted directive after a non-template regex-literal backtick"

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

repo="$(new_repo changed-scope)"
seed_file "$repo" src/legacy.ts "$ts_ignore_reason" 'unknownValue();'
git -C "$repo" -c commit.gpgsign=false commit -q -m "seed legacy violation"
git -C "$repo" branch base
seed_file "$repo" src/changed.ts "$ts_expect_reason" 'unknownValue();'
run_report_changed "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "changed scope should ignore unchanged violations: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register scope=changed total=1 ts-expect-error=1 ts-ignore=0 ts-nocheck=0 stryker=0' \
  || fail "changed scope summary should be labeled and scoped: $RUN_OUTPUT"
ok "changed mode scans only staged/base changed source files"

repo="$(new_repo changed-self-trigger)"
mkdir -p "$repo/scripts"
seed_file "$repo" src/legacy.ts "$ts_ignore_reason" 'unknownValue();'
cp "$REPORT" "$repo/scripts/suppression-register.sh"
# Keep the sandbox copy set closed over the scanner's sourced dependencies
# (fixture-shell-dependencies tripwire); tracked so changed mode stays clean.
mkdir -p "$repo/scripts/lib"
cp "$SCRIPT_DIR/../lib/changed-base.sh" "$repo/scripts/lib/changed-base.sh"
cp "$SCRIPT_DIR/../lib/changed-lintable-files.sh" "$repo/scripts/lib/changed-lintable-files.sh"
cp "$SCRIPT_DIR/../lib/verify-metadata.sh" "$repo/scripts/lib/verify-metadata.sh"
git -C "$repo" add scripts/suppression-register.sh scripts/lib
git -C "$repo" -c commit.gpgsign=false commit -q -m "seed scanner and violation"
git -C "$repo" branch base
printf '\n# scanner policy changed\n' >> "$repo/scripts/suppression-register.sh"
git -C "$repo" add scripts/suppression-register.sh
run_report_changed "$repo"
[ "$RUN_STATUS" -eq 1 ] || fail "scanner change should escalate and find unchanged violation: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'PASS: suppression register scope=full total=1 ts-expect-error=0 ts-ignore=1 ts-nocheck=0 stryker=0' \
  || fail "self-triggered scan should be labeled full: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'FAIL: suppression register prefers @ts-expect-error over @ts-ignore total=1' \
  || fail "self-triggered full scan missed unchanged violation: $RUN_OUTPUT"
ok "changed mode escalates when suppression scanner policy changes"

repo="$(new_repo changed-unstaged-abort)"
mkdir -p "$repo/scripts"
printf 'echo seed\n' > "$repo/scripts/tool.sh"
git -C "$repo" add scripts/tool.sh
git -C "$repo" -c commit.gpgsign=false commit -q -m "seed source-relevant script"
git -C "$repo" branch base
# An unstaged, source-relevant modification must abort --changed rather than
# false-green a partial tree. The bare gate call discarded this exit code.
printf 'echo unstaged\n' >> "$repo/scripts/tool.sh"
run_report_changed "$repo"
[ "$RUN_STATUS" -ne 0 ] || fail "unstaged source-relevant change should abort changed mode: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'source-relevant unstaged or untracked changes are present' \
  || fail "unstaged abort message missing: $RUN_OUTPUT"
ok "changed mode aborts on unstaged source-relevant changes"

not_repo="$TMP_ROOT/not-git"
mkdir -p "$not_repo"
run_report "$not_repo"
[ "$RUN_STATUS" -eq 2 ] || fail "outside git repo should fail as unchecked: $RUN_OUTPUT"
contains "$RUN_OUTPUT" "FAIL: suppression register cannot check: $not_repo is not a git repository" \
  || fail "outside git repo failure was wrong: $RUN_OUTPUT"
ok "fails outside a git repo"

# The lint-suppressions wrapper must aggregate both registers instead of
# short-circuiting on the first nonzero exit: a commit carrying both an
# eslint-disable violation and a TS suppression violation gets both classes
# reported in one gate run.
run_wrapper() {
  local repo="$1"
  set +e
  RUN_OUTPUT="$( (cd "$repo" && bash scripts/lint-suppressions.sh) 2>&1)"
  RUN_STATUS=$?
  set -e
}

seed_wrapper_scripts() {
  local repo="$1"
  mkdir -p "$repo/scripts/data" "$repo/scripts/lib"
  cp "$SCRIPT_DIR/../lint-suppressions.sh" \
    "$SCRIPT_DIR/../eslint-disable-register.sh" \
    "$SCRIPT_DIR/../suppression-register.sh" "$repo/scripts/"
  cp "$SCRIPT_DIR/../data/eslint-disable-broad-allowlist.txt" \
    "$SCRIPT_DIR/../data/ts-nocheck-allowlist.txt" "$repo/scripts/data/"
  # Both registers source the shared changed-scope libs; keep the sandbox
  # closed over them (fixture-shell-dependencies tripwire).
  cp "$SCRIPT_DIR/../lib/changed-base.sh" \
    "$SCRIPT_DIR/../lib/changed-lintable-files.sh" \
    "$SCRIPT_DIR/../lib/verify-metadata.sh" "$repo/scripts/lib/"
}

repo="$(new_repo wrapper-aggregate)"
seed_wrapper_scripts "$repo"
seed_file "$repo" src/app.ts \
  '// eslint-disable-next-line no-console' \
  'console.log(42);' \
  "$ts_ignore_reason" \
  'unknownValue();'
run_wrapper "$repo"
[ "$RUN_STATUS" -eq 1 ] || fail "wrapper should fail when both violation classes are present: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'FAIL: eslint-disable register missing reasons total=1' \
  || fail "wrapper did not report the eslint-disable violation: $RUN_OUTPUT"
contains "$RUN_OUTPUT" 'FAIL: suppression register prefers @ts-expect-error over @ts-ignore total=1' \
  || fail "wrapper short-circuited before the suppression register: $RUN_OUTPUT"
ok "wrapper aggregates both registers in one run"

repo="$(new_repo wrapper-clean)"
seed_wrapper_scripts "$repo"
seed_file "$repo" src/app.ts 'const value = 1;'
run_wrapper "$repo"
[ "$RUN_STATUS" -eq 0 ] || fail "wrapper should pass on a clean repo: $RUN_OUTPUT"
ok "wrapper passes when both registers pass"

printf 'suppression register tests passed (%d)\n' "$PASS"
