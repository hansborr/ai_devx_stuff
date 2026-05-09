#!/usr/bin/env bash
# test-test-scripts.sh — pure-shell smoke tests for scripts/test-scripts.sh.
#
# Stubs the smoke-test execution via MUSI_SCRIPTS_RUNNER so the inner smoke
# tests don't actually run, then injects MUSI_SCRIPTS_CHANGED_FILES to cover
# the --changed selection logic without a fixtured git history. Run via
# `bash scripts/test-test-scripts.sh`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_SH="$SCRIPT_DIR/test-scripts.sh"
unset MUSI_SCRIPTS_CHANGED_FILES

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

SANDBOX="$(mktemp -d /tmp/musi-test-scripts-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

mkdir -p "$SANDBOX/bin"
# Stub runner records the smoke-test path so tests can verify which smoke
# tests were selected. STUB_FAIL_<name>=1 forces a specific smoke test to
# fail (with hyphens converted to underscores).
cat > "$SANDBOX/bin/runner" <<'STUB'
#!/usr/bin/env bash
script_path="$1"
name="$(basename "$script_path" .sh)"
printf 'runner ran %s\n' "$name" >> "${STUB_LOG:-/dev/null}"
var_fail="STUB_FAIL_${name//-/_}"
if [ "${!var_fail:-0}" = "1" ]; then
  printf 'stub: forced failure for %s\n' "$name" >&2
  exit 1
fi
exit 0
STUB
chmod +x "$SANDBOX/bin/runner"

STUB_LOG_FILE="$SANDBOX/runner.log"
: > "$STUB_LOG_FILE"
ALL_SMOKE_TESTS=$'runner ran test-verify\nrunner ran test-verify-async\nrunner ran test-verify-logs\nrunner ran test-worktree-db\nrunner ran test-dependency-freshness\nrunner ran test-ai-hooks\nrunner ran test-eslint-disable-register\nrunner ran test-codemod-structured-logging-fix\nrunner ran test-codemod-trpc-shared-input\nrunner ran test-codemod-trpc-shared-output\nrunner ran test-code-intel\nrunner ran test-lint-changed\nrunner ran test-test-changed\nrunner ran test-test-slow\nrunner ran test-generate-module-index\nrunner ran test-migration-safety-scan\nrunner ran test-test-scripts'

run_runner() {
  STUB_LOG="$STUB_LOG_FILE" \
  MUSI_SCRIPTS_RUNNER="$SANDBOX/bin/runner" \
    bash "$RUNNER_SH" "$@"
}

# --- syntax / argument parsing --------------------------------------------
bash -n "$RUNNER_SH" || fail "test-scripts.sh fails bash -n"
ok "test-scripts.sh passes bash -n"

if run_runner --bogus >/dev/null 2>&1; then
  fail "test-scripts.sh accepted unknown flag"
fi
ok "test-scripts.sh rejects unknown flags"

# --- no-arg form runs all smoke tests in order ----------------------------
: > "$STUB_LOG_FILE"
run_runner >/dev/null || fail "test-scripts.sh unexpectedly failed in default mode"
[ "$(cat "$STUB_LOG_FILE")" = "$ALL_SMOKE_TESTS" ] \
  || fail "default mode did not run all smoke tests in order: $(cat "$STUB_LOG_FILE")"
ok "default mode runs all smoke tests in order"

# --- --changed with no relevant changes is a no-op ------------------------
: > "$STUB_LOG_FILE"
output=$(MUSI_SCRIPTS_CHANGED_FILES=$'packages/server/src/app.ts\nREADME.md' \
  run_runner --changed)
[ ! -s "$STUB_LOG_FILE" ] \
  || fail "no-op --changed should not invoke any smoke tests: $(cat "$STUB_LOG_FILE")"
grep -qF 'no script smoke tests selected' <<< "$output" \
  || fail "no-op --changed should announce skip: $output"
ok "--changed is a no-op when no script subjects changed"

# --- --changed falls back to full suite when the base ref is unavailable --
: > "$STUB_LOG_FILE"
mkdir -p "$SANDBOX/no-git"
output=$((cd "$SANDBOX/no-git" && run_runner --changed) 2>&1)
[ "$(cat "$STUB_LOG_FILE")" = "$ALL_SMOKE_TESTS" ] \
  || fail "missing base ref should run all smoke tests: $(cat "$STUB_LOG_FILE")"
grep -qF "neither 'main' nor 'origin/main' exists" <<< "$output" \
  || fail "missing base ref should announce full-suite fallback: $output"
ok "--changed falls back to full suite when base ref is unavailable"

# --- --changed with empty changed-files var is also a no-op ---------------
: > "$STUB_LOG_FILE"
output=$(MUSI_SCRIPTS_CHANGED_FILES=" " run_runner --changed)
[ ! -s "$STUB_LOG_FILE" ] \
  || fail "blank changed list should not invoke any smoke tests: $(cat "$STUB_LOG_FILE")"
grep -qF 'no script smoke tests selected' <<< "$output" \
  || fail "blank --changed should announce skip: $output"
ok "--changed is a no-op when changed list is blank"

# --- --changed selects test-verify on scripts/verify.sh change ------------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/verify.sh" run_runner --changed >/dev/null
expected=$'runner ran test-verify\nrunner ran test-verify-async'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "verify.sh change should select verify smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects verify smokes when scripts/verify.sh changed"

# --- --changed selects test-verify-logs on scripts/verify-logs.sh change --
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/verify-logs.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-verify-logs" ] \
  || fail "verify-logs.sh change should select only test-verify-logs: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-verify-logs when scripts/verify-logs.sh changed"

# --- --changed selects worktree-db smoke on worktree helper changes ------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/worktree-db.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-worktree-db" ] \
  || fail "worktree-db.sh change should select worktree smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-worktree-db on worktree helper change"

# --- --changed selects dependency freshness smoke on hook changes --------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=".husky/pre-commit" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-dependency-freshness" ] \
  || fail "pre-commit change should select dependency freshness smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-dependency-freshness on pre-commit change"

# --- --changed selects eslint-disable diagnostics smoke ------------------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/eslint-disable-register.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-eslint-disable-register" ] \
  || fail "eslint-disable register change should select its smoke test: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-eslint-disable-register on diagnostics change"

# --- --changed selects tRPC shared-schema codemod smokes -----------------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/codemods/structured-logging-fix.ts" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-codemod-structured-logging-fix" ] \
  || fail "structured logging codemod change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects structured logging codemod smoke on codemod change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/codemods/trpc-shared-input.ts" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-codemod-trpc-shared-input" ] \
  || fail "input codemod change should select input codemod smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects input codemod smoke on input codemod change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/codemods/trpc-shared-output.ts" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-codemod-trpc-shared-output" ] \
  || fail "output codemod change should select output codemod smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects output codemod smoke on output codemod change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="package.json" run_runner --changed >/dev/null
expected=$'runner ran test-codemod-structured-logging-fix\nrunner ran test-codemod-trpc-shared-input\nrunner ran test-codemod-trpc-shared-output\nrunner ran test-code-intel'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "package.json change should select codemod smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects package-script smokes on package script change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/codemods/lib/trpc-shared-schema.ts" run_runner --changed >/dev/null
expected=$'runner ran test-codemod-structured-logging-fix\nrunner ran test-codemod-trpc-shared-input\nrunner ran test-codemod-trpc-shared-output'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "shared codemod helper change should select all dependent codemod smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects codemod smokes on shared codemod helper change"

# --- --changed selects code-intel smoke on code-intel changes ------------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/code-intel.ts" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-code-intel" ] \
  || fail "code-intel change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-code-intel on code-intel change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="packages/shared/package.json" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-code-intel" ] \
  || fail "package export change should select code-intel smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-code-intel on package export change"

# --- --changed selects lint-changed smoke on lint wrapper changes ---------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/lint-changed.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-changed" ] \
  || fail "lint-changed.sh change should select lint-changed smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-changed on lint wrapper change"

# --- --changed selects ai-hooks smoke on shared hook changes -------------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/ai-hooks/stop-policy.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-ai-hooks" ] \
  || fail "stop-policy.sh change should select ai-hooks smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-ai-hooks on hook policy change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/ai-hooks/process-runner.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-ai-hooks" ] \
  || fail "process-runner.sh change should select ai-hooks smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-ai-hooks on hook runner change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=".codex/hooks/post-tool-use.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-ai-hooks" ] \
  || fail "Codex post hook change should select ai-hooks smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-ai-hooks on Codex hook change"

# --- --changed selects test-changed and test-slow smokes ------------------
# test-test-slow exercises the slow-test hint emitted by test-changed.sh, so
# the scripts/test-changed.sh subject is shared between both smoke tests.
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/test-changed.sh" run_runner --changed >/dev/null
expected=$'runner ran test-test-changed\nrunner ran test-test-slow'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "test-changed.sh change should select test-test-changed and test-test-slow: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-test-changed and test-test-slow on changed-test wrapper change"

# --- --changed selects test-test-slow on test-slow.sh change --------------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/test-slow.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-test-slow" ] \
  || fail "test-slow.sh change should select test-test-slow: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-test-slow on slow wrapper change"

# --- --changed selects test-test-slow on slow-tier vitest config change ---
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="vitest.slow.config.ts" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-test-slow" ] \
  || fail "vitest.slow.config.ts change should select test-test-slow: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-test-slow on vitest.slow.config.ts change"

# --- --changed selects module-index smoke --------------------------------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/generate-module-index.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-generate-module-index" ] \
  || fail "module index generator change should select module-index smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-generate-module-index on generator change"

# --- --changed selects migration-safety smoke on its subject change -------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/migration-safety-scan.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-migration-safety-scan" ] \
  || fail "migration scanner change should select only its smoke test: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-migration-safety-scan on scanner change"

# --- --changed selects a smoke test when the smoke test file itself changes
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/test-verify-logs.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-verify-logs" ] \
  || fail "smoke test file change should select itself: $(cat "$STUB_LOG_FILE")"
ok "--changed selects a smoke test on its own file change"

# --- --changed selects test-test-scripts when the wrapper changes ---------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/test-scripts.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-test-scripts" ] \
  || fail "test-scripts.sh change should select test-test-scripts: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-test-scripts when scripts/test-scripts.sh changed"

# --- --changed picks every smoke test that depends on ai-hooks/cache.sh ----
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/ai-hooks/cache.sh" run_runner --changed >/dev/null
expected=$'runner ran test-verify\nrunner ran test-verify-async\nrunner ran test-verify-logs\nrunner ran test-ai-hooks'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "cache.sh change should select tests that depend on it: $(cat "$STUB_LOG_FILE")"
ok "--changed selects tests that share a dependency on ai-hooks/cache.sh"

# --- --changed selects async verify smoke on its wrapper change -----------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/verify-async.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-verify-async" ] \
  || fail "verify-async.sh change should select test-verify-async: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-verify-async on async wrapper change"

# --- --changed picks every smoke test that depends on output filtering ----
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/ai-hooks/output-filter.sh" run_runner --changed >/dev/null
expected=$'runner ran test-verify\nrunner ran test-verify-logs\nrunner ran test-dependency-freshness\nrunner ran test-ai-hooks\nrunner ran test-test-changed\nrunner ran test-test-slow'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "output-filter.sh change should select every dependent smoke test: $(cat "$STUB_LOG_FILE")"
ok "--changed selects tests that share output-filter.sh"

# --- --changed selects multiple smoke tests when several subjects change --
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=$'scripts/verify.sh\nscripts/migration-safety-scan.sh' \
  run_runner --changed >/dev/null
expected=$'runner ran test-verify\nrunner ran test-verify-async\nrunner ran test-migration-safety-scan'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "multiple subject changes should select each matching smoke test: $(cat "$STUB_LOG_FILE")"
ok "--changed selects multiple smoke tests for matching subjects"

# --- --changed deduplicates when multiple subjects map to the same test ---
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=$'scripts/verify.sh\nscripts/test-verify.sh' \
  run_runner --changed >/dev/null
expected=$'runner ran test-verify\nrunner ran test-verify-async'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "duplicate-subject changes should still run a smoke test only once: $(cat "$STUB_LOG_FILE")"
ok "--changed runs a smoke test once when multiple subjects map to it"

# --- failing smoke test halts the runner and reports failure --------------
: > "$STUB_LOG_FILE"
set +e
output=$(STUB_FAIL_test_verify=1 run_runner 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "failing smoke test must propagate non-zero exit"
grep -qF 'test-verify FAILED' <<< "$output" \
  || fail "failure summary missing 'test-verify FAILED': $output"
grep -qF 'failed: test-verify' <<< "$output" \
  || fail "failure summary missing 'failed: test-verify': $output"
# Subsequent smoke tests must not run after a failure.
grep -qF 'runner ran test-verify-logs' "$STUB_LOG_FILE" \
  && fail "smoke test runner did not halt at first failure: $(cat "$STUB_LOG_FILE")"
ok "first failing smoke test halts the runner"

printf 'test-scripts tests passed (%d)\n' "$PASS"
