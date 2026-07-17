#!/usr/bin/env bash
# smoke-order: 050
# smoke-subjects: scripts/typecheck.sh
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/test-typecheck.sh
# Pure-shell smoke tests for scripts/typecheck.sh fan-out and exit merging.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested

TYPECHECK_SCRIPT="$SCRIPT_DIR/../typecheck.sh"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

assert_contains() {
  local text="$1" needle="$2" context="$3"
  grep -qF "$needle" <<< "$text" || fail "$context missing '$needle':
$text"
}

assert_not_contains() {
  local text="$1" needle="$2" context="$3"
  if grep -qF "$needle" <<< "$text"; then
    fail "$context unexpectedly contained '$needle':
$text"
  fi
}

SANDBOX="$(mktemp -d /tmp/musi-typecheck-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

FAKE_TSC="$SANDBOX/fake-tsc"
cat > "$FAKE_TSC" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  "-b")
    lane="build"
    exit_code="${STUB_BUILD_EXIT:-0}"
    ;;
  "-p tsconfig.scripts.json")
    lane="scripts"
    exit_code="${STUB_SCRIPTS_EXIT:-0}"
    ;;
  "-p tsconfig.eslint-js.json")
    lane="eslint-js"
    exit_code="${STUB_ESLINT_JS_EXIT:-0}"
    ;;
  *)
    printf 'unexpected tsc args: %s\n' "$*" >&2
    exit 99
    ;;
esac

printf '%s stdout before\n' "$lane"
printf '%s stderr before\n' "$lane" >&2
if [ "$exit_code" -ne 0 ]; then
  printf 'src/%s.ts(1,1): error TS2322: %s failure diagnostic\n' "$lane" "$lane" >&2
fi
printf '%s stdout after\n' "$lane"
printf '%s stderr after\n' "$lane" >&2
exit "$exit_code"
STUB
chmod +x "$FAKE_TSC"

new_repo() {
  local name="$1"
  local repo="$SANDBOX/$name"
  git -C "$SANDBOX" init -q -b main "$repo"
  mkdir -p "$repo/scripts"
  cp "$TYPECHECK_SCRIPT" "$repo/scripts/typecheck.sh"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  git -C "$repo" add .
  git -C "$repo" commit -qm base
  printf '%s\n' "$repo"
}

CASE_OUTPUT=""
CASE_EXIT=0
run_typecheck_case() {
  local name="$1" build_exit="$2" scripts_exit="$3" eslint_js_exit="${4:-0}"
  local repo output_file
  repo="$(new_repo "$name")"
  output_file="$repo/output.log"
  set +e
  (
    cd "$repo"
    STUB_BUILD_EXIT="$build_exit" \
    STUB_SCRIPTS_EXIT="$scripts_exit" \
    STUB_ESLINT_JS_EXIT="$eslint_js_exit" \
    MUSI_TSC_BIN="$FAKE_TSC" \
      timeout 5s bash scripts/typecheck.sh
  ) > "$output_file" 2>&1
  CASE_EXIT=$?
  set -e
  CASE_OUTPUT="$(cat "$output_file")"
  [ "$CASE_EXIT" -ne 124 ] || fail "$name timed out:
$CASE_OUTPUT"
}

assert_prefixed_lane_output() {
  local output="$1"
  assert_contains "$output" "=== tsc -b ===" "build heading"
  assert_contains "$output" "=== tsc -p tsconfig.scripts.json ===" "scripts heading"
  assert_contains "$output" "[tsc -b] build stdout before" "build stdout"
  assert_contains "$output" "[tsc -b] build stderr before" "build stderr"
  assert_contains "$output" "[tsc -p tsconfig.scripts.json] scripts stdout before" "scripts stdout"
  assert_contains "$output" "[tsc -p tsconfig.scripts.json] scripts stderr before" "scripts stderr"
  assert_contains "$output" "=== tsc -p tsconfig.eslint-js.json ===" "eslint-js heading"
  assert_contains "$output" "[tsc -p tsconfig.eslint-js.json] eslint-js stdout before" "eslint-js stdout"
  assert_contains "$output" "[tsc -p tsconfig.eslint-js.json] eslint-js stderr before" "eslint-js stderr"
  assert_contains "$output" "[tsc -b] build stdout after" "build stdout"
  assert_contains "$output" "[tsc -p tsconfig.scripts.json] scripts stdout after" "scripts stdout"
  assert_contains "$output" "[tsc -p tsconfig.eslint-js.json] eslint-js stdout after" "eslint-js stdout"
}

bash -n "$TYPECHECK_SCRIPT" || fail "typecheck.sh fails bash -n"
ok "typecheck.sh passes bash -n"

run_typecheck_case all-green 0 0 0
[ "$CASE_EXIT" -eq 0 ] || fail "all-green should exit 0, got $CASE_EXIT:
$CASE_OUTPUT"
assert_prefixed_lane_output "$CASE_OUTPUT"
assert_not_contains "$CASE_OUTPUT" "failed with exit" "green run"
ok "all typecheck lanes passing exits 0 and preserves prefixed output"

run_typecheck_case build-fails 7 0
[ "$CASE_EXIT" -eq 7 ] || fail "build failure should exit 7, got $CASE_EXIT:
$CASE_OUTPUT"
assert_contains "$CASE_OUTPUT" "typecheck: tsc -b failed with exit 7" "build failure"
assert_contains "$CASE_OUTPUT" "typecheck: tsc -b diagnostics: 1 TypeScript error line(s)" "build diagnostics"
assert_contains "$CASE_OUTPUT" "[tsc -b] src/build.ts(1,1): error TS2322" "build excerpt"
assert_not_contains "$CASE_OUTPUT" "typecheck: tsc -p tsconfig.scripts.json failed" "build-only failure"
ok "build lane failure surfaces the build exit code"

run_typecheck_case scripts-fails 0 9
[ "$CASE_EXIT" -eq 9 ] || fail "scripts failure should exit 9, got $CASE_EXIT:
$CASE_OUTPUT"
assert_contains "$CASE_OUTPUT" "typecheck: tsc -p tsconfig.scripts.json failed with exit 9" "scripts failure"
assert_contains "$CASE_OUTPUT" "typecheck: tsc -p tsconfig.scripts.json diagnostics: 1 TypeScript error line(s)" "scripts diagnostics"
assert_contains "$CASE_OUTPUT" "[tsc -p tsconfig.scripts.json] src/scripts.ts(1,1): error TS2322" "scripts excerpt"
assert_not_contains "$CASE_OUTPUT" "typecheck: tsc -b failed" "scripts-only failure"
ok "scripts lane failure surfaces the scripts exit code"

run_typecheck_case eslint-js-fails 0 0 5
[ "$CASE_EXIT" -eq 5 ] || fail "eslint-js failure should exit 5, got $CASE_EXIT:
$CASE_OUTPUT"
assert_contains "$CASE_OUTPUT" "typecheck: tsc -p tsconfig.eslint-js.json failed with exit 5" "eslint-js failure"
assert_contains "$CASE_OUTPUT" "typecheck: tsc -p tsconfig.eslint-js.json diagnostics: 1 TypeScript error line(s)" "eslint-js diagnostics"
assert_contains "$CASE_OUTPUT" "[tsc -p tsconfig.eslint-js.json] src/eslint-js.ts(1,1): error TS2322" "eslint-js excerpt"
assert_not_contains "$CASE_OUTPUT" "typecheck: tsc -b failed" "eslint-js-only failure"
assert_not_contains "$CASE_OUTPUT" "typecheck: tsc -p tsconfig.scripts.json failed" "eslint-js-only failure"
ok "eslint-js lane failure surfaces the eslint-js exit code"

run_typecheck_case all-fail-same 4 4 4
[ "$CASE_EXIT" -eq 4 ] || fail "matching failures should exit 4, got $CASE_EXIT:
$CASE_OUTPUT"
assert_contains "$CASE_OUTPUT" "typecheck: tsc -b failed with exit 4" "same-failure build"
assert_contains "$CASE_OUTPUT" "typecheck: tsc -p tsconfig.scripts.json failed with exit 4" "same-failure scripts"
assert_contains "$CASE_OUTPUT" "typecheck: tsc -p tsconfig.eslint-js.json failed with exit 4" "same-failure eslint-js"
ok "matching lane failures preserve the shared exit code"

run_typecheck_case two-fail-same 4 4 0
[ "$CASE_EXIT" -eq 4 ] || fail "two matching failures should exit 4, got $CASE_EXIT:
$CASE_OUTPUT"
assert_not_contains "$CASE_OUTPUT" "typecheck: tsc -p tsconfig.eslint-js.json failed" "two-failure eslint-js"
ok "two matching lane failures preserve the shared exit code"

run_typecheck_case fail-different 7 9 0
[ "$CASE_EXIT" -eq 1 ] || fail "different failures should fall back to exit 1, got $CASE_EXIT:
$CASE_OUTPUT"
assert_contains "$CASE_OUTPUT" "typecheck: tsc -b failed with exit 7" "different-failure build"
assert_contains "$CASE_OUTPUT" "typecheck: tsc -p tsconfig.scripts.json failed with exit 9" "different-failure scripts"
ok "different lane failures fall back to exit 1"

printf 'typecheck smoke tests passed (%d)\n' "$PASS"
