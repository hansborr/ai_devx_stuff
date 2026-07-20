#!/usr/bin/env bash
# smoke-order: 430
# smoke-subjects: scripts/test-scripts.sh
# smoke-subjects: scripts/lib/changed-base.sh
# smoke-subjects: scripts/lib/verify-metadata.sh
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/test-test-scripts.sh
# smoke-subjects: scripts/path-policy/path-policy-query.ts
# smoke-subjects: scripts/path-policy/path-policy-query-core.ts
# smoke-subjects: scripts/path-policy/path-policy.ts
# smoke-subjects: scripts/path-policy/path-policy-smoke-subjects.ts
# smoke-subjects: scripts/path-policy/path-policy-smoke-subjects-data.ts
# smoke-subjects: scripts/path-policy/generate-smoke-subjects.ts
# smoke-subjects: scripts/path-policy/smoke-subject-headers.ts
# smoke-subjects: scripts/path-policy/smoke-subject-headers.test.ts
# smoke-subjects: scripts/fixtures/test-scripts/all-smoke-tests.txt
# smoke-subjects: package.json
# test-test-scripts.sh — pure-shell smoke tests for scripts/test-scripts.sh.
#
# Stubs the smoke-test execution via MUSI_SCRIPTS_RUNNER so the inner smoke
# tests don't actually run, then injects MUSI_SCRIPTS_CHANGED_FILES to cover
# the --changed selection logic without a fixtured git history. Run via
# `bash scripts/tests/test-test-scripts.sh`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
RUNNER_SH="$SCRIPT_DIR/../test-scripts.sh"
unset MUSI_SCRIPTS_CHANGED_FILES
unset MUSI_SCRIPTS_DELETED_FILES

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
printf 'runner stdout %s\n' "$name"
if [ "${ASSERT_GIT_ENV_CLEARED:-0}" = "1" ]; then
  for var_name in GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX GIT_COMMON_DIR; do
    if [ -n "${!var_name:-}" ]; then
      printf 'inherited %s=%s\n' "$var_name" "${!var_name}" >&2
      exit 7
    fi
  done
fi
var_fail="STUB_FAIL_${name//-/_}"
var_sleep="STUB_SLEEP_${name//-/_}"
if [ -n "${!var_sleep:-}" ]; then
  sleep_pid=""
  if [ -n "${STUB_PID_LOG:-}" ]; then
    printf '%s\n' "$$" >> "$STUB_PID_LOG"
  fi
  sleep "${!var_sleep}" &
  sleep_pid=$!
  if [ -n "${STUB_PID_LOG:-}" ]; then
    printf '%s\n' "$sleep_pid" >> "$STUB_PID_LOG"
  fi
  trap 'kill "$sleep_pid" 2>/dev/null || true; wait "$sleep_pid" 2>/dev/null || true; exit 130' INT
  trap 'kill "$sleep_pid" 2>/dev/null || true; wait "$sleep_pid" 2>/dev/null || true; exit 143' TERM
  wait "$sleep_pid"
  trap - INT TERM
fi
if [ "${!var_fail:-0}" = "1" ]; then
  printf 'stub: forced failure for %s\n' "$name" >&2
  exit 1
fi
exit 0
STUB
chmod +x "$SANDBOX/bin/runner"
cat > "$SANDBOX/bin/nproc" <<'STUB'
#!/usr/bin/env bash
printf '8\n'
STUB
chmod +x "$SANDBOX/bin/nproc"

STUB_LOG_FILE="$SANDBOX/runner.log"
: > "$STUB_LOG_FILE"
ALL_SMOKE_TESTS="$(cat "$SCRIPT_DIR/../fixtures/test-scripts/all-smoke-tests.txt")"

run_runner() {
  STUB_LOG="$STUB_LOG_FILE" \
  MUSI_SCRIPTS_CONCURRENCY="${MUSI_SCRIPTS_CONCURRENCY:-1}" \
  MUSI_SCRIPTS_RUNNER="$SANDBOX/bin/runner" \
    bash "$RUNNER_SH" "$@"
}

wait_for_line_count() {
  local file="$1"
  local expected="$2"
  local count attempt

  attempt=0
  while [ "$attempt" -lt 100 ]; do
    count=0
    if [ -f "$file" ]; then
      count="$(wc -l < "$file" | tr -d ' ')"
    fi
    if [ "$count" -ge "$expected" ]; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 0.1
  done
  return 1
}

# --- syntax / argument parsing --------------------------------------------
bash -n "$SCRIPT_DIR/lib/test-git-env.sh" || fail "test-git-env.sh fails bash -n"
ok "test-git-env.sh passes bash -n"

bash -n "$RUNNER_SH" || fail "test-scripts.sh fails bash -n"
ok "test-scripts.sh passes bash -n"

# Coverage boundary (accepted-cheap for this repo's accidental-vs-adversarial
# calibration): this textual guard recognizes only a top-level `bun -e`
# followed by a literal single-quoted program opener. `bun --eval`, flag-separated
# forms, double-quoted/program-variable forms such as `bun -e "$code"`, and other
# indirection escape it. Once recognized, nested-function throws are caught.
vacuous_bun_eval_assertions="$({
  find "$SCRIPT_DIR" -type f -name '*.sh' -print0 \
    | sort -z \
    | while IFS= read -r -d '' test_script; do
      awk '
        BEGIN { opener = "bun -e " sprintf("%c", 39) }
        !in_eval && index($0, opener) {
          in_eval = 1
          start = FNR
          has_require = 0
          has_throw = 0
        }
        in_eval {
          if (index($0, "require(")) has_require = 1
          if ($0 ~ /throw([[:space:]]|;)/) has_throw = 1
          trimmed = $0
          sub(/^[[:space:]]*/, "", trimmed)
          if (FNR > start && substr(trimmed, 1, 1) == sprintf("%c", 39)) {
            if (has_require && has_throw) print FILENAME ":" start "-" FNR
            in_eval = 0
          }
        }
      ' "$test_script"
    done
} || true)"
[ -z "$vacuous_bun_eval_assertions" ] \
  || fail "bun -e blocks must not use throw after require(); use process.exit instead: $vacuous_bun_eval_assertions"
ok "inline Bun assertions use reliable failure signals after require()"

if run_runner --bogus >/dev/null 2>&1; then
  fail "test-scripts.sh accepted unknown flag"
fi
ok "test-scripts.sh rejects unknown flags"

# --- no-arg form selects all smoke tests; concurrency=1 keeps order -------
: > "$STUB_LOG_FILE"
run_runner >/dev/null || fail "test-scripts.sh unexpectedly failed in default mode"
[ "$(cat "$STUB_LOG_FILE")" = "$ALL_SMOKE_TESTS" ] \
  || fail "no-arg concurrency=1 did not run all smoke tests in order: $(cat "$STUB_LOG_FILE")"
ok "no-arg concurrency=1 runs all smoke tests in order"

# --- concurrency=1 preserves the old single-stream sequential shape -------
: > "$STUB_LOG_FILE"
output=$(MUSI_SCRIPTS_CONCURRENCY=1 \
  MUSI_SCRIPTS_CHANGED_FILES=$'scripts/verify.sh\nscripts/migration-safety-scan.sh' \
  run_runner --changed 2>&1)
expected=$'runner ran test-verify\nrunner ran test-verify-async\nrunner ran test-migration-safety-scan'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "concurrency=1 should run selected smokes in order: $(cat "$STUB_LOG_FILE")"
grep -qF 'runner stdout test-verify' <<< "$output" \
  || fail "concurrency=1 should stream smoke output directly: $output"
if grep -qF 'test:scripts: test-verify OK (' <<< "$output"; then
  fail "concurrency=1 should not print parallel per-smoke finish lines: $output"
fi
ok "concurrency=1 keeps the sequential output shape"

# --- default concurrency uses parallel mode when nproc reports headroom -----
: > "$STUB_LOG_FILE"
default_parallel_log_dir="$SANDBOX/default-parallel-logs"
output=$(PATH="$SANDBOX/bin:$PATH" \
  STUB_LOG="$STUB_LOG_FILE" \
  MUSI_SCRIPTS_LOG_DIR="$default_parallel_log_dir" \
  MUSI_SCRIPTS_CHANGED_FILES="scripts/ai-hooks/cache.sh" \
  MUSI_SCRIPTS_RUNNER="$SANDBOX/bin/runner" \
    bash "$RUNNER_SH" --changed 2>&1)
for name in test-verify test-verify-async test-verify-logs test-ai-hooks; do
  grep -qF "runner ran $name" "$STUB_LOG_FILE" \
    || fail "default concurrency did not run $name: $(cat "$STUB_LOG_FILE")"
  grep -qF "test:scripts: $name OK (" <<< "$output" \
    || fail "default concurrency did not use parallel finish lines for $name: $output"
  [ -f "$default_parallel_log_dir/$name.log" ] \
    || fail "default concurrency did not write $name log"
done
if grep -qF 'runner stdout test-verify' <<< "$output"; then
  fail "default concurrency should capture smoke stdout in per-smoke logs: $output"
fi
ok "default concurrency uses parallel mode when nproc reports headroom"

# --- default parallel log dir is scoped to the current worktree -----------
: > "$STUB_LOG_FILE"
default_state_root="$SANDBOX/default-state"
worktree_key="$(printf '%s' "$(pwd -P)" | sha256sum | awk '{print $1}')"
worktree_log_dir="$default_state_root/musi-test-scripts-logs.$worktree_key"
output=$(env -u MUSI_SCRIPTS_LOG_DIR \
  PATH="$SANDBOX/bin:$PATH" \
  STUB_LOG="$STUB_LOG_FILE" \
  MUSI_VERIFY_STATE_ROOT="$default_state_root" \
  MUSI_SCRIPTS_CONCURRENCY=2 \
  MUSI_SCRIPTS_CHANGED_FILES="scripts/ai-hooks/cache.sh" \
  MUSI_SCRIPTS_RUNNER="$SANDBOX/bin/runner" \
    bash "$RUNNER_SH" --changed 2>&1)
for name in test-verify test-verify-async test-verify-logs test-ai-hooks; do
  [ -f "$worktree_log_dir/$name.log" ] \
    || fail "default log dir did not scope $name to the current worktree: $output"
done
ok "default parallel log dir is scoped to the current worktree"

# --- smoke children do not inherit parent commit-hook git env ------------
: > "$STUB_LOG_FILE"
GIT_DIR=/outer/gitdir \
GIT_INDEX_FILE=/outer/index \
GIT_WORK_TREE=/outer/worktree \
GIT_PREFIX=outer/ \
GIT_COMMON_DIR=/outer/common \
ASSERT_GIT_ENV_CLEARED=1 \
  MUSI_SCRIPTS_CHANGED_FILES="scripts/verify.sh" run_runner --changed >/dev/null \
  || fail "sequential smoke runner should clear inherited GIT_* environment"
ok "sequential smoke children clear inherited git env"

: > "$STUB_LOG_FILE"
GIT_DIR=/outer/gitdir \
GIT_INDEX_FILE=/outer/index \
GIT_WORK_TREE=/outer/worktree \
GIT_PREFIX=outer/ \
GIT_COMMON_DIR=/outer/common \
ASSERT_GIT_ENV_CLEARED=1 \
MUSI_SCRIPTS_CONCURRENCY=2 \
  MUSI_SCRIPTS_CHANGED_FILES=$'scripts/verify.sh\nscripts/verify-logs.sh' run_runner --changed >/dev/null \
  || fail "parallel smoke runner should clear inherited GIT_* environment"
ok "parallel smoke children clear inherited git env"

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
output=$( (cd "$SANDBOX/no-git" && run_runner --changed) 2>&1 )
[ "$(cat "$STUB_LOG_FILE")" = "$ALL_SMOKE_TESTS" ] \
  || fail "missing base ref should run all smoke tests: $(cat "$STUB_LOG_FILE")"
grep -qF "neither 'main' nor 'origin/main' exists" <<< "$output" \
  || fail "missing base ref should announce full-suite fallback: $output"
ok "--changed falls back to full suite when base ref is unavailable"

# --- --changed falls back to full suite when base shares no history --------
: > "$STUB_LOG_FILE"
orphan_repo="$SANDBOX/orphan-repo"
mkdir -p "$orphan_repo"
git -C "$SANDBOX" init -q -b main "$orphan_repo"
git -C "$orphan_repo" config user.email test@example.com
git -C "$orphan_repo" config user.name Test
printf 'seed\n' > "$orphan_repo/seed.txt"
git -C "$orphan_repo" add seed.txt
git -C "$orphan_repo" commit -qm base
git -C "$orphan_repo" checkout -q --orphan orphan
git -C "$orphan_repo" commit -qm orphan-seed
output="$(
  cd "$orphan_repo"
  STUB_LOG="$STUB_LOG_FILE" \
  MUSI_SCRIPTS_CONCURRENCY=1 \
  MUSI_SCRIPTS_RUNNER="$SANDBOX/bin/runner" \
    bash "$RUNNER_SH" --changed 2>&1
)"
[ "$(cat "$STUB_LOG_FILE")" = "$ALL_SMOKE_TESTS" ] \
  || fail "disjoint base should run all smoke tests: $(cat "$STUB_LOG_FILE")"
grep -qF "'main' shares no history with HEAD" <<< "$output" \
  || fail "disjoint base should announce full-suite fallback: $output"
ok "--changed falls back to full suite when base shares no history"

# --- --changed with empty changed-files var is also a no-op ---------------
: > "$STUB_LOG_FILE"
output=$(MUSI_SCRIPTS_CHANGED_FILES=" " run_runner --changed)
[ ! -s "$STUB_LOG_FILE" ] \
  || fail "blank changed list should not invoke any smoke tests: $(cat "$STUB_LOG_FILE")"
grep -qF 'no script smoke tests selected' <<< "$output" \
  || fail "blank --changed should announce skip: $output"
ok "--changed is a no-op when changed list is blank"

# --- --changed falls back to full suite for staged script deletions --------
: > "$STUB_LOG_FILE"
script_delete_repo="$SANDBOX/script-delete-repo"
mkdir -p "$script_delete_repo/scripts"
git -C "$SANDBOX" init -q -b main "$script_delete_repo"
git -C "$script_delete_repo" config user.email test@example.com
git -C "$script_delete_repo" config user.name Test
printf 'echo delete me\n' > "$script_delete_repo/scripts/delete-me.sh"
git -C "$script_delete_repo" add scripts/delete-me.sh
git -C "$script_delete_repo" commit -qm base
git -C "$script_delete_repo" rm -q scripts/delete-me.sh
output="$(
  cd "$script_delete_repo"
  STUB_LOG="$STUB_LOG_FILE" \
  MUSI_SCRIPTS_CONCURRENCY=1 \
  MUSI_SCRIPTS_RUNNER="$SANDBOX/bin/runner" \
    bash "$RUNNER_SH" --changed 2>&1
)"
[ "$(cat "$STUB_LOG_FILE")" = "$ALL_SMOKE_TESTS" ] \
  || fail "staged script deletion should run all smoke tests: $(cat "$STUB_LOG_FILE")"
grep -qF 'test:scripts: unmapped script deletion detected' <<< "$output" \
  || fail "staged script deletion should announce full-suite fallback: $output"
ok "--changed falls back to full suite for staged script deletions"

# --- --changed selects test-verify on scripts/verify.sh change ------------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/verify.sh" run_runner --changed >/dev/null
expected=$'runner ran test-verify\nrunner ran test-verify-async'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "verify.sh change should select verify smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects verify smokes when scripts/verify.sh changed"

# --- --changed selects verify/harness smokes on generated step changes ----
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=$'scripts/verify/steps.generated.sh\nscripts/verify/steps-lib.sh' \
  run_runner --changed >/dev/null
expected=$'runner ran test-verify\nrunner ran test-verify-history\nrunner ran test-dependency-freshness\nrunner ran test-harness-check'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "verify step definition changes should select verify and harness smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects verify and harness smokes on generated step changes"

# --- --changed selects test-verify-logs on scripts/verify-logs.sh change --
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/verify-logs.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-verify-logs" ] \
  || fail "verify-logs.sh change should select only test-verify-logs: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-verify-logs when scripts/verify-logs.sh changed"

# --- --changed selects test-verify-history on verify history changes -----
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/verify-history.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-verify-history" ] \
  || fail "verify-history.sh change should select only test-verify-history: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-verify-history when scripts/verify-history.sh changed"

# --- --changed selects worktree-db smoke on worktree helper changes ------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/worktree-db.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-worktree-db" ] \
  || fail "worktree-db.sh change should select worktree smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-worktree-db on worktree helper change"

# --- --changed selects dependency freshness smoke on hook changes --------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=".husky/pre-commit" run_runner --changed >/dev/null
expected=$'runner ran test-verify-history\nrunner ran test-dependency-freshness'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "pre-commit change should select hook smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects hook smokes on pre-commit change"

# --- --changed selects pre-push smokes on pre-push hook changes ----------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=".husky/pre-push" run_runner --changed >/dev/null
expected=$'runner ran test-pre-push\nrunner ran test-harness-check'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "pre-push change should select pre-push and harness-check smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-pre-push and test-harness-check on pre-push hook change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=".husky/post-commit" run_runner --changed >/dev/null
expected=$'runner ran test-dependency-freshness\nrunner ran test-pre-push\nrunner ran test-lint-ratchet\nrunner ran test-merge-driver-dispatch'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "post-commit change should select dependency-freshness, pre-push, lint-ratchet, and merge-driver-dispatch smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects dependency-freshness, pre-push, lint-ratchet, and merge-driver-dispatch smokes on post-commit hook change"

# --- --changed selects eslint-disable diagnostics smoke ------------------
# test-suppression-register also executes the copied register through the
# lint-suppressions wrapper, so a register change selects both smokes.
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/eslint-disable-register.sh" run_runner --changed >/dev/null
expected=$'runner ran test-eslint-disable-register\nrunner ran test-suppression-register'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "eslint-disable register change should select its smoke test: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-eslint-disable-register on diagnostics change"

# --- --changed selects suppression register diagnostics smoke ------------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/suppression-register.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-suppression-register" ] \
  || fail "suppression register change should select its smoke test: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-suppression-register on diagnostics change"

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
expected=$'runner ran test-tool-memory-admission\nrunner ran test-verify-history\nrunner ran test-codemod-structured-logging-fix\nrunner ran test-codemod-trpc-shared-input\nrunner ran test-codemod-trpc-shared-output\nrunner ran test-codemod-expand-barrel\nrunner ran test-codemod-concurrency-guard\nrunner ran test-code-intel\nrunner ran test-lint-fix-dist-preflight\nrunner ran test-lint-shell\nrunner ran test-lint-config-sensors\nrunner ran test-generate-lint-guidance\nrunner ran test-generate-harness-controls\nrunner ran test-harness-check\nrunner ran test-lint-agent\nrunner ran test-lint-agent-changed\nrunner ran test-lint-ratchet\nrunner ran test-test-scripts\nrunner ran test-lint-probe-rule'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "package.json change should select codemod smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects package-script smokes on package script change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/codemods/lib/trpc-shared-schema.ts" run_runner --changed >/dev/null
expected=$'runner ran test-codemod-structured-logging-fix\nrunner ran test-codemod-trpc-shared-input\nrunner ran test-codemod-trpc-shared-output\nrunner ran test-codemod-expand-barrel\nrunner ran test-codemod-concurrency-guard'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "shared codemod helper change should select all dependent codemod smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects codemod smokes on shared codemod helper change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/codemods/lib/trpc-shared-schema-imports.ts" run_runner --changed >/dev/null
expected=$'runner ran test-codemod-structured-logging-fix\nrunner ran test-codemod-trpc-shared-input\nrunner ran test-codemod-trpc-shared-output\nrunner ran test-codemod-expand-barrel\nrunner ran test-codemod-concurrency-guard'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "shared codemod split helper change should select all dependent codemod smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects codemod smokes on shared codemod split helper change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/codemods/expand-barrel/import-replacement.ts" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-codemod-expand-barrel" ] \
  || fail "expand-barrel helper change should select expand-barrel smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects expand-barrel codemod smoke on split helper change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/codemods/concurrency-guard/scanner.ts" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-codemod-concurrency-guard" ] \
  || fail "concurrency-guard helper change should select concurrency-guard smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects concurrency-guard codemod smoke on split helper change"

# --- --changed selects code-intel smoke on code-intel changes ------------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/code-intel.ts" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-code-intel" ] \
  || fail "code-intel change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-code-intel on code-intel change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/code-intel-server.ts" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-code-intel" ] \
  || fail "code-intel server change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-code-intel on code-intel server change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/code-intel/format.ts" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-code-intel" ] \
  || fail "code-intel internal change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-code-intel on code-intel internal change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="packages/shared/package.json" run_runner --changed >/dev/null
expected=$'runner ran test-code-intel\nrunner ran test-lint-dist-preflight\nrunner ran test-lint-fix-dist-preflight\nrunner ran test-test-dist-preflight'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "package export change should select package-export smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects package-export smokes on package export change"

# --- --changed selects format-changed smoke on format wrapper changes -----
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/format-changed.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-format-changed" ] \
  || fail "format-changed.sh change should select format smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-format-changed on format wrapper change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/path-policy/path-policy-query.ts" run_runner --changed >/dev/null
expected=$'runner ran test-verify\nrunner ran test-verify-history\nrunner ran test-pre-push\nrunner ran test-format-changed\nrunner ran test-lint-changed\nrunner ran test-lint-shell\nrunner ran test-lint-config-sensors\nrunner ran test-lint-agent-changed\nrunner ran test-verify-metadata\nrunner ran test-test-scripts'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "path-policy query change should select all dependent smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects all path-policy query dependent smokes"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/path-policy/path-policy.ts" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "path-policy model change should select all dependent smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects all path-policy model dependent smokes"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/path-policy/path-policy-smoke-subjects.ts" run_runner --changed >/dev/null
expected=$'runner ran test-verify-history\nrunner ran test-format-changed\nrunner ran test-test-scripts'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "path-policy smoke subject change should select selection smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects smoke-subject policy dependent smokes"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/path-policy/path-policy-smoke-subjects-data.ts" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "path-policy smoke subject data change should select selection smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects smoke-subject data module dependent smokes"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="tsconfig.configs.json" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-harness-check" ] \
  || fail "generated config-surface tsconfig should select harness freshness smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects harness freshness smoke on config-surface tsconfig output"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/tests/test-new-smoke.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-harness-check" ] \
  || fail "new smoke test file should select harness freshness smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects harness freshness smoke on new smoke file"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/tests/lib/test-git-env.sh" run_runner --changed >/dev/null
expected=$'runner ran test-verify\nrunner ran test-verify-history\nrunner ran test-typecheck\nrunner ran test-dependency-freshness\nrunner ran test-pre-push\nrunner ran test-land\nrunner ran test-ai-hooks\nrunner ran test-eslint-disable-register\nrunner ran test-suppression-register\nrunner ran test-format-changed\nrunner ran test-lint-changed\nrunner ran test-lint-shell\nrunner ran test-lint-config-sensors\nrunner ran test-test-all\nrunner ran test-test-client\nrunner ran test-test-changed\nrunner ran test-test-slow\nrunner ran test-generate-module-index\nrunner ran test-lint-agent-changed\nrunner ran test-lint-ratchet\nrunner ran test-migration-safety-scan\nrunner ran test-doctor-json\nrunner ran test-verify-metadata\nrunner ran test-test-scripts'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "test-git-env helper change should select fixture git smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects fixture git smokes on test-git-env helper change"

# --- direct fixture-git smokes clear inherited hook env -------------------
direct_fixture_git_smokes=(
  "test-verify.sh"
  "test-verify-history.sh"
  "test-typecheck.sh"
  "test-dependency-freshness.sh"
  "test-pre-push.sh"
  "test-land.sh"
  "../ai-hooks/test.sh"
  "test-eslint-disable-register.sh"
  "test-suppression-register.sh"
  "test-format-changed.sh"
  "test-lint-changed.sh"
  "test-lint-shell.sh"
  "test-lint-config-sensors.sh"
  "test-test-all.sh"
  "test-test-client.sh"
  "test-test-changed.sh"
  "test-test-slow.sh"
  "test-generate-module-index.sh"
  "test-lint-agent-changed.sh"
  "test-lint-ratchet.sh"
  "test-migration-safety-scan.sh"
  "test-doctor-json.sh"
  "test-verify-metadata.sh"
  "test-test-scripts.sh"
)

for smoke in "${direct_fixture_git_smokes[@]}"; do
  GIT_DIR=/outer/gitdir \
  GIT_INDEX_FILE=/outer/index \
  GIT_WORK_TREE=/outer/worktree \
  GIT_PREFIX=outer/ \
  GIT_COMMON_DIR=/outer/common \
  MUSI_TEST_ASSERT_GIT_HOOK_ENV_CLEARED=1 \
    bash "$SCRIPT_DIR/$smoke" >/dev/null \
    || fail "$smoke should clear inherited GIT_* environment before fixture git commands"
done
ok "direct fixture-git smokes clear inherited git env"

# --- --changed selects lint-changed smoke on lint wrapper changes ---------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/lint-changed.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = $'runner ran test-lint-changed\nrunner ran test-lint-dist-preflight\nrunner ran test-lint-shell\nrunner ran test-lint-config-sensors' ] \
  || fail "lint-changed.sh change should select lint-changed smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-changed on lint wrapper change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/lint-fix.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-fix-dist-preflight" ] \
  || fail "lint-fix.sh change should select lint-fix preflight smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-fix-dist-preflight on lint-fix wrapper change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/lint-config-sensors.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-config-sensors" ] \
  || fail "config sensor wrapper change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-config-sensors on config sensor wrapper change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=".github/workflows/ci.yml" run_runner --changed >/dev/null
expected=$'runner ran test-lint-config-sensors\nrunner ran test-harness-check'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "workflow change should select config sensor and harness-check smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects config sensor and harness-check smokes on workflow change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=".yamllint.yml" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-config-sensors" ] \
  || fail ".yamllint.yml change should select config sensor smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-config-sensors on yamllint config change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="bun.lock" run_runner --changed >/dev/null
expected=$'runner ran test-lint-shell\nrunner ran test-lint-config-sensors'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "bun.lock change should select full-scan dependent smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects full-scan dependent smokes on bun.lock change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/lint-shell.sh" run_runner --changed >/dev/null
expected=$'runner ran test-lint-changed\nrunner ran test-lint-shell'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "lint-shell.sh change should select shell lint smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects ShellCheck smokes on shell lint wrapper change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/lib/parallel-runner.sh" run_runner --changed >/dev/null
expected=$'runner ran test-lint-changed\nrunner ran test-lint-dist-preflight\nrunner ran test-lint-shell\nrunner ran test-parallel-runner'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "parallel runner change should select lint wrapper and dedicated smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects lint and dedicated smokes on parallel runner change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/lib/parallel-step.sh" run_runner --changed >/dev/null
expected=$'runner ran test-verify\nrunner ran test-verify-history\nrunner ran test-dependency-freshness'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "parallel step change should select verify smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects verify smokes on parallel step helper change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/lib/verify-metadata.sh" run_runner --changed >/dev/null
expected=$'runner ran test-verify\nrunner ran test-verify-async\nrunner ran test-verify-history\nrunner ran test-dependency-freshness\nrunner ran test-pre-push\nrunner ran test-land\nrunner ran test-ai-hooks\nrunner ran test-eslint-disable-register\nrunner ran test-suppression-register\nrunner ran test-lint-changed\nrunner ran test-lint-dist-preflight\nrunner ran test-lint-shell\nrunner ran test-lint-config-sensors\nrunner ran test-verify-metadata\nrunner ran test-test-scripts\nrunner ran test-merge-driver-dispatch'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "verify-metadata.sh change should select dependent and dedicated smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects dependent and dedicated smokes on verify metadata change"

# --- --changed selects ai-hooks smoke on shared hook changes -------------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/ai-hooks/stop-policy.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-ai-hooks" ] \
  || fail "stop-policy.sh change should select ai-hooks smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-ai-hooks on hook policy change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/ai-hooks/lint-coverage-check.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-ai-hooks" ] \
  || fail "lint-coverage-check.sh change should select ai-hooks smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-ai-hooks on lint coverage hook change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/ai-hooks/ratchet-regression-check.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-ai-hooks" ] \
  || fail "ratchet-regression-check.sh change should select ai-hooks smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-ai-hooks on ratchet regression hook change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/ai-hooks/edited-paths.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-ai-hooks" ] \
  || fail "edited-paths.sh change should select ai-hooks smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-ai-hooks on edited-paths helper change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=".codex/hooks/post-tool-use.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-ai-hooks" ] \
  || fail "Codex post hook change should select ai-hooks smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-ai-hooks on Codex hook change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=".codex/hooks/tidy-edited-file.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-ai-hooks" ] \
  || fail "Codex tidy hook adapter change should select ai-hooks smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-ai-hooks on Codex tidy adapter change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=".codex/hooks/lint-coverage-check.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-ai-hooks" ] \
  || fail "Codex lint coverage hook adapter change should select ai-hooks smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-ai-hooks on Codex lint coverage adapter change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=".claude/hooks/tidy-edited-file.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-ai-hooks" ] \
  || fail "Claude tidy hook adapter change should select ai-hooks smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-ai-hooks on Claude tidy adapter change"

# --- --changed selects test-ai-hooks on .claude/settings.json change ------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=".claude/settings.json" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = $'runner ran test-ai-hooks\nrunner ran test-harness-check' ] \
  || fail ".claude/settings.json change should select ai-hooks and harness-check smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects hook config smokes on .claude/settings.json change"

# --- --changed selects hook config smokes on .codex/hooks.json change ----
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=".codex/hooks.json" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = $'runner ran test-ai-hooks\nrunner ran test-harness-check' ] \
  || fail ".codex/hooks.json change should select ai-hooks and harness-check smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects hook config smokes on .codex/hooks.json change"

# --- --changed selects config-sensor smoke on .codex/config.toml change ---
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=".codex/config.toml" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-config-sensors" ] \
  || fail ".codex/config.toml change should select config-sensor smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-config-sensors on .codex/config.toml change"

# --- --changed selects config-sensor smoke on .codex/skills agent change --
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=".codex/skills/ts-graph/agents/openai.yaml" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-config-sensors" ] \
  || fail "Codex skill agent change should select config-sensor smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-config-sensors on Codex skill agent change"

# --- non-script staged deletion does not force full script-smoke suite ----
# A deletion of a package source file should not suppress
# MUSI_SCRIPTS_CHANGED_FILES — only .husky/* or scripts/* deletions require
# the conservative full fallback.
: > "$STUB_LOG_FILE"
delete_non_script_repo="$SANDBOX/delete-non-script-repo"
mkdir -p "$delete_non_script_repo/packages/server/src" "$delete_non_script_repo/scripts"
git -C "$SANDBOX" init -q -b main "$delete_non_script_repo"
git -C "$delete_non_script_repo" config user.email test@example.com
git -C "$delete_non_script_repo" config user.name Test
printf 'export const x = 1;\n' > "$delete_non_script_repo/packages/server/src/example.ts"
printf 'echo hi\n' > "$delete_non_script_repo/scripts/verify.sh"
git -C "$delete_non_script_repo" add .
git -C "$delete_non_script_repo" commit -qm base
git -C "$delete_non_script_repo" rm -q packages/server/src/example.ts
printf 'echo changed\n' > "$delete_non_script_repo/scripts/verify.sh"
git -C "$delete_non_script_repo" add scripts/verify.sh
output="$(
  cd "$delete_non_script_repo"
  STUB_LOG="$STUB_LOG_FILE" \
  MUSI_SCRIPTS_CONCURRENCY=1 \
  MUSI_SCRIPTS_RUNNER="$SANDBOX/bin/runner" \
    bash "$RUNNER_SH" --changed 2>&1
)"
# Should select smokes based on changed files, not full suite
if [ "$(cat "$STUB_LOG_FILE")" = "$ALL_SMOKE_TESTS" ]; then
  fail "non-script deletion should not force full smoke suite: $(cat "$STUB_LOG_FILE")"
fi
grep -qF 'runner ran test-verify' "$STUB_LOG_FILE" \
  || fail "non-script deletion should still select test-verify from scripts/verify.sh change: $(cat "$STUB_LOG_FILE")"
ok "non-script staged deletion does not force full script-smoke suite"

# --- --changed selects test-test-all on test-all.sh change ----------------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/test-all.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = $'runner ran test-tool-memory-admission\nrunner ran test-test-all' ] \
  || fail "test-all.sh change should select test-test-all: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-test-all on test-all.sh change"

# --- --changed selects test-test-client on test-client.sh change ----------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/test-client.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-test-client" ] \
  || fail "test-client.sh change should select test-test-client: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-test-client on test-client.sh change"

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

# --- --changed selects lint-guidance smoke -------------------------------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/generate-lint-guidance.ts" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-generate-lint-guidance" ] \
  || fail "lint guidance generator change should select lint-guidance smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-generate-lint-guidance on generator change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="eslint-rules/structured-logging.js" run_runner --changed >/dev/null
expected=$'runner ran test-generate-lint-guidance\nrunner ran test-generate-harness-controls\nrunner ran test-harness-check\nrunner ran test-lint-agent\nrunner ran test-lint-ratchet\nrunner ran test-lint-probe-rule'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "principle source change should select rule-derived smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects rule-derived smokes on principle source change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/lib/lint-rule-docs.ts" run_runner --changed >/dev/null
expected=$'runner ran test-generate-lint-guidance\nrunner ran test-generate-harness-controls\nrunner ran test-lint-agent\nrunner ran test-lint-ratchet'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "shared rule-docs loader change should select both generator smokes and lint-agent: $(cat "$STUB_LOG_FILE")"
ok "--changed selects generator smokes and lint-agent on shared rule-docs loader change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/lint-agent.ts" run_runner --changed >/dev/null
expected=$'runner ran test-lint-agent\nrunner ran test-lint-agent-changed'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "lint-agent change should select lint-agent and lint-agent-changed smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-agent + test-lint-agent-changed on lint-agent script change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/lint-agent-envelope.ts" run_runner --changed >/dev/null
expected=$'runner ran test-lint-agent\nrunner ran test-lint-agent-changed'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "lint-agent envelope change should select lint-agent and lint-agent-changed smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-agent + test-lint-agent-changed on lint-agent envelope change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/lint-agent-changed.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-agent-changed" ] \
  || fail "lint-agent-changed wrapper change should select only its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-agent-changed on wrapper script change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/harness-emit-envelope.ts" run_runner --changed >/dev/null
expected=$'runner ran test-verify-logs\nrunner ran test-generate-module-index\nrunner ran test-lint-agent-changed\nrunner ran test-harness-emit-envelope\nrunner ran test-migration-safety-scan\nrunner ran test-doctor-json'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "harness-emit-envelope change should select all emitter-dependent smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects all emitter-dependent smokes on harness-emit-envelope change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/tests/test-harness-emit-envelope.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = $'runner ran test-harness-check\nrunner ran test-harness-emit-envelope' ] \
  || fail "harness emitter smoke change should select itself: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-harness-emit-envelope on its own file change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="packages/shared/src/schemas/harness-diagnostics.ts" run_runner --changed >/dev/null
expected=$'runner ran test-verify-logs\nrunner ran test-generate-module-index\nrunner ran test-lint-agent\nrunner ran test-lint-agent-changed\nrunner ran test-harness-emit-envelope\nrunner ran test-lint-ratchet\nrunner ran test-migration-safety-scan\nrunner ran test-doctor-json'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "harness-diagnostics schema change should select all envelope-emitting smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects all envelope-emitting smokes on harness-diagnostics schema change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/lint-ratchet.ts" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-ratchet" ] \
  || fail "lint-ratchet change should select only its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-ratchet on lint-ratchet script change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/lint-ratchet/cli.ts" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-ratchet" ] \
  || fail "lint-ratchet split helper change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-ratchet on lint-ratchet split helper change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/git/baseline-merge-driver.sh" run_runner --changed >/dev/null
expected=$'runner ran test-harness-check\nrunner ran test-lint-ratchet'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "generic baseline merge driver change should select its lint-ratchet and harness-check smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-ratchet and test-harness-check on the shared baseline merge driver change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/git/check-lint-ratchet-merge-driver.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-ratchet" ] \
  || fail "lint-ratchet merge-driver health check change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-ratchet on lint-ratchet merge-driver health check change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/git/check-knip-unused-exports-merge-driver.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-ratchet" ] \
  || fail "knip unused-exports merge-driver health check change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-ratchet on knip unused-exports merge-driver health check change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/git/check-max-lines-exceptions-merge-driver.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-ratchet" ] \
  || fail "max-lines exceptions merge-driver health check change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-ratchet on max-lines exceptions merge-driver health check change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/git/install-knip-unused-exports-merge-driver.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-ratchet" ] \
  || fail "knip unused-exports merge-driver installer change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-ratchet on knip unused-exports merge-driver installer change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/git/install-max-lines-exceptions-merge-driver.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-ratchet" ] \
  || fail "max-lines exceptions merge-driver installer change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-ratchet on max-lines exceptions merge-driver installer change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/git/lint-ratchet-merge-driver-lib.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-ratchet" ] \
  || fail "lint-ratchet merge-driver lib change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-ratchet on lint-ratchet merge-driver lib change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/git/baseline-merge-driver-lib.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-ratchet" ] \
  || fail "baseline merge-driver lib change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-ratchet on baseline merge-driver lib change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/git/knip-unused-exports-merge-driver-lib.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-ratchet" ] \
  || fail "knip unused-exports merge-driver lib change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-ratchet on knip unused-exports merge-driver lib change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/git/max-lines-exceptions-merge-driver-lib.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-ratchet" ] \
  || fail "max-lines exceptions merge-driver lib change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-ratchet on max-lines exceptions merge-driver lib change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-ratchet" ] \
  || fail "lint-ratchet post-merge truth-up change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-ratchet on lint-ratchet post-merge truth-up change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-ratchet" ] \
  || fail "knip post-merge truth-up change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-ratchet on knip post-merge truth-up change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/git/max-lines-exceptions-post-merge-baseline-truth-up.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-ratchet" ] \
  || fail "max-lines post-merge truth-up change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-ratchet on max-lines post-merge truth-up change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/tests/lib/test-lint-ratchet-edit-check-fixtures.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-ratchet" ] \
  || fail "lint-ratchet edit-check fixture helper change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-ratchet on lint-ratchet edit-check fixture helper change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="tools/lint-ratchet/src/governance/zero-baseline.ts" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-ratchet" ] \
  || fail "lint-ratchet zero-baseline helper change should select its smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-ratchet on lint-ratchet zero-baseline helper change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="lint-ratchet.baseline.json" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-ratchet" ] \
  || fail "ratchet baseline change should select lint-ratchet smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-lint-ratchet on ratchet baseline change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="harness.controls.json" run_runner --changed >/dev/null
expected=$'runner ran test-generate-harness-controls\nrunner ran test-harness-check\nrunner ran test-doctor-json'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "manifest change should select harness smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects harness smokes on manifest change"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/harness/control-field-validation.ts" run_runner --changed >/dev/null
expected=$'runner ran test-generate-harness-controls\nrunner ran test-harness-check'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "shared control validation change should select harness smokes: $(cat "$STUB_LOG_FILE")"
ok "--changed selects harness validator smokes on shared control validation change"

# --- --changed selects migration-safety smoke on its subject change -------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/migration-safety-scan.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-migration-safety-scan" ] \
  || fail "migration scanner change should select only its smoke test: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-migration-safety-scan on scanner change"

# --- --changed selects a smoke test when the smoke test file itself changes
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/tests/test-verify-logs.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = $'runner ran test-verify-logs\nrunner ran test-harness-check' ] \
  || fail "smoke test file change should select itself: $(cat "$STUB_LOG_FILE")"
ok "--changed selects a smoke test on its own file change"

# --- --changed selects test-test-scripts when the wrapper changes ---------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/test-scripts.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = $'runner ran test-tool-memory-admission\nrunner ran test-test-scripts' ] \
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

# --- --changed selects typecheck smoke on its wrapper change --------------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/typecheck.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-typecheck" ] \
  || fail "typecheck.sh change should select test-typecheck: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-typecheck on typecheck wrapper change"

# --- --changed picks every smoke test that depends on output filtering ----
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/ai-hooks/output-filter.sh" run_runner --changed >/dev/null
expected=$'runner ran test-verify\nrunner ran test-verify-logs\nrunner ran test-verify-history\nrunner ran test-dependency-freshness\nrunner ran test-ai-hooks\nrunner ran test-test-dist-preflight\nrunner ran test-test-all\nrunner ran test-test-client\nrunner ran test-test-changed\nrunner ran test-test-slow'
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
MUSI_SCRIPTS_CHANGED_FILES=$'scripts/verify.sh\nscripts/tests/test-verify.sh' \
  run_runner --changed >/dev/null
expected=$'runner ran test-verify\nrunner ran test-verify-async\nrunner ran test-harness-check'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "duplicate-subject changes should still run a smoke test only once: $(cat "$STUB_LOG_FILE")"
ok "--changed runs a smoke test once when multiple subjects map to it"

# --- concurrency>1 runs every selected smoke when none fail ---------------
: > "$STUB_LOG_FILE"
parallel_log_dir="$SANDBOX/parallel-logs"
output=$(MUSI_SCRIPTS_CONCURRENCY=3 \
  MUSI_SCRIPTS_LOG_DIR="$parallel_log_dir" \
  MUSI_SCRIPTS_CHANGED_FILES="scripts/ai-hooks/cache.sh" \
  run_runner --changed 2>&1)
for name in test-verify test-verify-async test-verify-logs test-ai-hooks; do
  grep -qF "runner ran $name" "$STUB_LOG_FILE" \
    || fail "parallel mode did not run $name: $(cat "$STUB_LOG_FILE")"
  grep -qF "test:scripts: running $name..." <<< "$output" \
    || fail "parallel mode did not announce $name start: $output"
  grep -qF "test:scripts: $name OK (" <<< "$output" \
    || fail "parallel mode did not announce $name success: $output"
  [ -f "$parallel_log_dir/$name.log" ] \
    || fail "parallel mode did not write $name log"
  grep -qF "runner stdout $name" "$parallel_log_dir/$name.log" \
    || fail "parallel mode did not capture $name stdout in its log"
done
[ "$(wc -l < "$STUB_LOG_FILE" | tr -d ' ')" = "4" ] \
  || fail "parallel mode should run exactly four selected smokes: $(cat "$STUB_LOG_FILE")"
grep -qF 'test:scripts: OK — test-verify test-verify-async test-verify-logs test-ai-hooks' <<< "$output" \
  || fail "parallel mode summary missing selected smokes: $output"
ok "concurrency>1 runs all selected smokes when none fail"

# --- concurrency>1 reports failures and dumps failed log tails ------------
: > "$STUB_LOG_FILE"
parallel_fail_log_dir="$SANDBOX/parallel-fail-logs"
set +e
output=$(STUB_FAIL_test_verify=1 \
  STUB_SLEEP_test_verify_async=1 \
  MUSI_SCRIPTS_CONCURRENCY=2 \
  MUSI_SCRIPTS_LOG_DIR="$parallel_fail_log_dir" \
  MUSI_SCRIPTS_CHANGED_FILES="scripts/ai-hooks/cache.sh" \
  run_runner --changed 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "parallel failure should propagate non-zero exit"
grep -qF 'test:scripts: test-verify FAILED (' <<< "$output" \
  || fail "parallel failure output missing failed finish line: $output"
grep -qF 'test:scripts: FAILED — passed: test-verify-async failed: test-verify' <<< "$output" \
  || fail "parallel failure summary missing passed/failed sets: $output"
grep -qF "test:scripts: last 30 log lines for test-verify ($parallel_fail_log_dir/test-verify.log):" <<< "$output" \
  || fail "parallel failure output missing failed log tail header: $output"
grep -qF 'stub: forced failure for test-verify' <<< "$output" \
  || fail "parallel failure output missing failed smoke log tail: $output"
if grep -qF 'runner ran test-verify-logs' "$STUB_LOG_FILE"; then
  fail "parallel mode started a new smoke after the first failure: $(cat "$STUB_LOG_FILE")"
fi
ok "concurrency>1 surfaces failures and failed log tails"

# --- SIGINT forwards to in-flight children and exits 130 ------------------
: > "$STUB_LOG_FILE"
signal_pid_log="$SANDBOX/signal-pids"
signal_output="$SANDBOX/signal-output"
: > "$signal_pid_log"
STUB_LOG="$STUB_LOG_FILE" \
STUB_PID_LOG="$signal_pid_log" \
STUB_SLEEP_test_verify=30 \
STUB_SLEEP_test_verify_async=30 \
MUSI_SCRIPTS_CHANGED_FILES="scripts/ai-hooks/cache.sh" \
MUSI_SCRIPTS_CONCURRENCY=2 \
MUSI_SCRIPTS_LOG_DIR="$SANDBOX/signal-logs" \
MUSI_SCRIPTS_RUNNER="$SANDBOX/bin/runner" \
  env --default-signal=INT bash "$RUNNER_SH" --changed \
  >"$signal_output" 2>&1 &
signal_runner_pid=$!
wait_for_line_count "$signal_pid_log" 4 || {
  kill "$signal_runner_pid" 2>/dev/null || true
  fail "SIGINT test did not observe two running stub smokes"
}
kill -INT "$signal_runner_pid"
set +e
wait "$signal_runner_pid"
exit_code=$?
set -e
[ "$exit_code" -eq 130 ] \
  || fail "SIGINT should exit 130, got $exit_code: $(cat "$signal_output")"
sleep 0.2
while IFS= read -r pid; do
  [ -n "$pid" ] || continue
  if kill -0 "$pid" 2>/dev/null; then
    fail "SIGINT left child process running: pid $pid"
  fi
done < "$signal_pid_log"
if grep -qF 'test:scripts: running test-verify-logs...' "$signal_output"; then
  fail "SIGINT should prevent new smoke startups: $(cat "$signal_output")"
fi
ok "SIGINT during parallel mode exits 130 without orphaned stubs"

# --- failing smoke test halts the sequential runner and reports failure ---
: > "$STUB_LOG_FILE"
set +e
output=$(STUB_FAIL_test_ai_hooks=1 run_runner 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "failing smoke test must propagate non-zero exit"
grep -qF 'test-ai-hooks FAILED' <<< "$output" \
  || fail "failure summary missing 'test-ai-hooks FAILED': $output"
grep -qF 'failed: test-ai-hooks' <<< "$output" \
  || fail "failure summary missing 'failed: test-ai-hooks': $output"
# Subsequent smoke tests must not run after a failure.
grep -qF 'runner ran test-check-eslint-react-peer-exception' "$STUB_LOG_FILE" \
  && fail "smoke test runner did not halt at first failure: $(cat "$STUB_LOG_FILE")"
ok "first failing smoke test halts the sequential runner"

# --- --changed selects test-parallel-runner on its own file change -----------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/tests/test-parallel-runner.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = $'runner ran test-harness-check\nrunner ran test-parallel-runner' ] \
  || fail "test-parallel-runner.sh change should select its own smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-parallel-runner on its own file change"

# --- --changed selects test-verify-metadata on its own file change -----------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES="scripts/tests/test-verify-metadata.sh" run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = $'runner ran test-harness-check\nrunner ran test-verify-metadata' ] \
  || fail "test-verify-metadata.sh change should select its own smoke: $(cat "$STUB_LOG_FILE")"
ok "--changed selects test-verify-metadata on its own file change"

# --- MUSI_SCRIPTS_DELETED_FILES carries config deletion to smoke selection ---
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=$'.codex/config.toml\npackages/server/src/app.ts' \
MUSI_SCRIPTS_DELETED_FILES='.codex/config.toml' \
  run_runner --changed >/dev/null
grep -qF 'runner ran test-lint-config-sensors' "$STUB_LOG_FILE" \
  || fail "deleted .codex/config.toml via MUSI_SCRIPTS_DELETED_FILES should select config-sensor smoke: $(cat "$STUB_LOG_FILE")"
ok "MUSI_SCRIPTS_DELETED_FILES carries .codex/config.toml deletion to smoke selection"

: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=$'.claude/settings.json\npackages/server/src/app.ts' \
MUSI_SCRIPTS_DELETED_FILES='.claude/settings.json' \
  run_runner --changed >/dev/null
grep -qF 'runner ran test-ai-hooks' "$STUB_LOG_FILE" \
  || fail "deleted .claude/settings.json via MUSI_SCRIPTS_DELETED_FILES should select ai-hooks smoke: $(cat "$STUB_LOG_FILE")"
ok "MUSI_SCRIPTS_DELETED_FILES carries .claude/settings.json deletion to smoke selection"

# --- MUSI_SCRIPTS_DELETED_FILES with script deletion forces full fallback ----
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=$'scripts/old.sh\npackages/server/src/app.ts' \
MUSI_SCRIPTS_DELETED_FILES='scripts/old.sh' \
  run_runner --changed >/dev/null 2>&1
[ "$(cat "$STUB_LOG_FILE")" = "$ALL_SMOKE_TESTS" ] \
  || fail "scripts/ deletion via MUSI_SCRIPTS_DELETED_FILES should force full suite: $(cat "$STUB_LOG_FILE")"
ok "MUSI_SCRIPTS_DELETED_FILES with scripts/ deletion forces full suite"

# --- mapped script fixture deletions stay scoped to their smoke owner --------
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES='scripts/fixtures/lint-ratchet/old.config.mjs' \
MUSI_SCRIPTS_DELETED_FILES='scripts/fixtures/lint-ratchet/old.config.mjs' \
  run_runner --changed >/dev/null
[ "$(cat "$STUB_LOG_FILE")" = "runner ran test-lint-ratchet" ] \
  || fail "mapped lint-ratchet fixture deletion should select only lint-ratchet smoke: $(cat "$STUB_LOG_FILE")"
ok "mapped script fixture deletions stay scoped to their smoke owner"

# --- non-script deletion in MUSI_SCRIPTS_DELETED_FILES does not force full ---
: > "$STUB_LOG_FILE"
MUSI_SCRIPTS_CHANGED_FILES=$'.codex/config.toml\nscripts/verify.sh' \
MUSI_SCRIPTS_DELETED_FILES='.codex/config.toml' \
  run_runner --changed >/dev/null
if [ "$(cat "$STUB_LOG_FILE")" = "$ALL_SMOKE_TESTS" ]; then
  fail "non-script deletion in MUSI_SCRIPTS_DELETED_FILES should not force full suite: $(cat "$STUB_LOG_FILE")"
fi
grep -qF 'runner ran test-verify' "$STUB_LOG_FILE" \
  || fail "non-script deletion should still select test-verify from scripts/verify.sh change: $(cat "$STUB_LOG_FILE")"
grep -qF 'runner ran test-lint-config-sensors' "$STUB_LOG_FILE" \
  || fail "non-script deletion should select config-sensor from .codex/config.toml: $(cat "$STUB_LOG_FILE")"
ok "non-script deletion in MUSI_SCRIPTS_DELETED_FILES does not force full suite"

# --- MUSI_SCRIPTS_CHANGED_FILES without MUSI_SCRIPTS_DELETED_FILES is backward-compatible ---
: > "$STUB_LOG_FILE"
unset MUSI_SCRIPTS_DELETED_FILES 2>/dev/null || true
MUSI_SCRIPTS_CHANGED_FILES="scripts/verify.sh" run_runner --changed >/dev/null
expected=$'runner ran test-verify\nrunner ran test-verify-async'
[ "$(cat "$STUB_LOG_FILE")" = "$expected" ] \
  || fail "MUSI_SCRIPTS_CHANGED_FILES without DELETED should keep old behavior: $(cat "$STUB_LOG_FILE")"
ok "MUSI_SCRIPTS_CHANGED_FILES without MUSI_SCRIPTS_DELETED_FILES is backward-compatible"

printf 'test-scripts tests passed (%d)\n' "$PASS"
