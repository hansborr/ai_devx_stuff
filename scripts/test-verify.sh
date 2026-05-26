#!/usr/bin/env bash
# test-verify.sh — pure-shell smoke tests for scripts/verify.sh.
#
# Stubs `bun` so the script never actually runs lint/typecheck/test. Verifies
# argument parsing, the cache short-circuit, FORCE_VERIFY=1 bypass, changed
# parallel failure aggregation, and the failure summary shape. Run via
# `bash scripts/test-verify.sh`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./test-git-env.sh
. "$SCRIPT_DIR/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
VERIFY="$SCRIPT_DIR/verify.sh"

if [ -z "${MUSI_PATH_POLICY_QUERY:-}" ]; then
  export MUSI_PATH_POLICY_QUERY="$SCRIPT_DIR/path-policy-query.ts"
fi
if [ -z "${MUSI_PATH_POLICY_BUN:-}" ]; then
  MUSI_PATH_POLICY_BUN="$(command -v bun)"
  export MUSI_PATH_POLICY_BUN
fi

if [ "${MUSI_TEST_VERIFY_IN_FIXTURE:-}" != "1" ]; then
  FIXTURE_ROOT="$(mktemp -d /tmp/musi-verify-smoke-repo.XXXXXX)"
  mkdir -p "$FIXTURE_ROOT/scripts/ai-hooks"
  cp "$SCRIPT_DIR/verify.sh" "$SCRIPT_DIR/test-verify.sh" "$SCRIPT_DIR/test-git-env.sh" \
    "$SCRIPT_DIR/verify-metadata.sh" "$SCRIPT_DIR/process-tree.sh" "$SCRIPT_DIR/parallel-step.sh" \
    "$FIXTURE_ROOT/scripts/"
  cp "$SCRIPT_DIR/ai-hooks/cache.sh" "$SCRIPT_DIR/ai-hooks/output-filter.sh" \
    "$FIXTURE_ROOT/scripts/ai-hooks/"
  (
    cd "$FIXTURE_ROOT"
    git init -q -b main
    git config user.email test@example.invalid
    git config user.name Test
    git add scripts
    git commit -qm init
    MUSI_TEST_VERIFY_IN_FIXTURE=1 bash scripts/test-verify.sh
  )
  status=$?
  rm -rf "$FIXTURE_ROOT"
  exit "$status"
fi

# Hermetic env: the cache short-circuit test below requires FORCE_VERIFY to
# be unset so the second sandbox run is a cache hit. The outer caller can
# legitimately set FORCE_VERIFY=1 (e.g. when this smoke test runs under
# `FORCE_VERIFY=1 bun run verify:changed --> bun run test:scripts:changed`),
# which would otherwise propagate and bypass the cache mid-test. Per-test
# FORCE_VERIFY=1 calls below set it explicitly for that single invocation.
unset FORCE_VERIFY

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

# Sandbox so the script never touches real /tmp markers, locks, or logs.
SANDBOX="$(mktemp -d /tmp/musi-verify-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

mkdir -p "$SANDBOX/bin"
cat > "$SANDBOX/bin/bun" <<'STUB'
#!/usr/bin/env bash
# Stub: succeeds for every `bun run <script>` invocation by default. Force a
# specific subcommand to fail by setting STUB_FAIL_<sub-with-colon-as-_>=1.
# Force a specific subcommand to sleep by setting STUB_SLEEP_<sub>=<seconds>;
# used by the watchdog test below. STUB_PID_LOG logs PIDs for process-tree
# survival checks.
printf 'stub bun %s\n' "$*" >> "${STUB_LOG:-/dev/null}"
if [ "${1:-}" = run ] && [ -n "${2:-}" ]; then
  safe_name="${2//:/_}"
  safe_name="${safe_name//-/_}"
  var_fail="STUB_FAIL_${safe_name}"
  var_sleep="STUB_SLEEP_${safe_name}"
  if [ -n "${!var_sleep:-}" ]; then
    sleep_pid=""
    [ -n "${STUB_PID_LOG:-}" ] && printf '%s\n' "$$" >> "$STUB_PID_LOG"
    sleep "${!var_sleep}" &
    sleep_pid=$!
    [ -n "${STUB_PID_LOG:-}" ] && printf '%s\n' "$sleep_pid" >> "$STUB_PID_LOG"
    trap 'kill "$sleep_pid" 2>/dev/null || true; wait "$sleep_pid" 2>/dev/null || true; exit 143' TERM
    wait "$sleep_pid"
    trap - TERM
  fi
  if [ "${!var_fail:-0}" = "1" ]; then
    printf 'stub: forced failure for bun run %s\n' "$2" >&2
    exit 1
  fi
fi
exit 0
STUB
chmod +x "$SANDBOX/bin/bun"

LOCK="$SANDBOX/lock"
LOG_DIR="$SANDBOX/logs"
HISTORY_DIR="$SANDBOX/history"
MARKER_CHANGED="$SANDBOX/marker-changed"
MARKER_FULL="$SANDBOX/marker-full"
STUB_LOG_FILE="$SANDBOX/bun.log"
: > "$STUB_LOG_FILE"

run_verify() {
  STUB_LOG="$STUB_LOG_FILE" \
  PATH="$SANDBOX/bin:$PATH" \
  MUSI_VERIFY_LOCK="$LOCK" \
  MUSI_VERIFY_LOG_DIR="$LOG_DIR" \
  MUSI_VERIFY_HISTORY_DIR="$HISTORY_DIR" \
  MUSI_VERIFY_MARKER_CHANGED="$MARKER_CHANGED" \
  MUSI_VERIFY_MARKER_FULL="$MARKER_FULL" \
    bash "$VERIFY" "$@"
}

. "$SCRIPT_DIR/verify-metadata.sh"

# --- syntax / argument parsing --------------------------------------------
bash -n "$VERIFY" || fail "verify.sh fails bash -n"
ok "verify.sh passes bash -n"

PARALLEL_STEP_LOG_DIR="$SANDBOX/parallel-step-logs"
mkdir -p "$PARALLEL_STEP_LOG_DIR/meta"
set +e
parallel_step_output=$(
  export LOG_DIR="$PARALLEL_STEP_LOG_DIR"
  export META_DIR="$PARALLEL_STEP_LOG_DIR/meta"
  # shellcheck source=./verify-metadata.sh
  . "$SCRIPT_DIR/verify-metadata.sh"
  # shellcheck source=./parallel-step.sh
  . "$SCRIPT_DIR/parallel-step.sh"
  GIT_DIR=/outer/git \
    GIT_INDEX_FILE=/outer/index \
    GIT_WORK_TREE=/outer/worktree \
    GIT_PREFIX=outer \
    GIT_COMMON_DIR=/outer/common \
    musi_run_parallel_step test "" env-check bash -c '
      for name in GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX GIT_COMMON_DIR; do
        value="${!name-}"
        [ -z "$value" ] || {
          printf "%s=%s\n" "$name" "$value"
          exit 1
        }
      done
    '
  wait "$STEP_PID"
)
parallel_step_exit=$?
set -e
[ "$parallel_step_exit" -eq 0 ] \
  || fail "parallel-step should clear inherited Git env for child commands: $parallel_step_output"
ok "parallel-step clears inherited Git hook env for child commands"

if run_verify --bogus >/dev/null 2>&1; then
  fail "verify.sh accepted unknown flag"
fi
ok "verify.sh rejects unknown flags"

# --- happy path: changed mode writes a marker -----------------------------
: > "$STUB_LOG_FILE"
rm -f "$MARKER_CHANGED"
run_verify --changed >/dev/null || fail "verify --changed unexpectedly failed"
[ -f "$MARKER_CHANGED" ] || fail "verify --changed did not write marker"
ok "verify --changed writes marker on success"

# --- DX7.0a: test command requests Vitest timing capture into LOG_DIR -----
# The wrapper pairs --reporter=dot (visible test progress) with --reporter=json
# + --outputFile.json so a later DX7.0b viewer can consume the timings file
# alongside test.log without changing the default `bun run test` script.
grep -qE 'bun run test:changed --reporter=dot --reporter=json --outputFile\.json='"$LOG_DIR"'/test-timings\.json' "$STUB_LOG_FILE" \
  || fail "verify --changed should request Vitest json timings into \$LOG_DIR/test-timings.json"
ok "verify --changed pairs dot reporter with json timings file"

[ -f "$LOG_DIR/run-meta.json" ] || fail "verify --changed did not write run-meta.json"
grep -q '"mode":"parallel-verify-changed"' "$LOG_DIR/run-meta.json" \
  || fail "verify --changed metadata should record parallel-verify-changed mode"
grep -q '"name":"wrapper"' "$LOG_DIR/run-meta.json" \
  || fail "verify --changed metadata should record wrapper timing"
grep -q '"name":"test"' "$LOG_DIR/run-meta.json" \
  || fail "verify --changed metadata should record test step timing"
grep -q 'bun run test:changed --reporter=dot --reporter=json --outputFile.json='"$LOG_DIR"'/test-timings.json' "$LOG_DIR/run-meta.json" \
  || fail "verify --changed metadata should record test command"
ok "verify --changed writes changed parallel run metadata"

history_match="$(find "$HISTORY_DIR" -maxdepth 1 -type f -name '*-parallel-verify-changed-0.json' -print -quit)"
[ -n "$history_match" ] || fail "verify --changed did not persist successful run metadata history"
ok "verify --changed persists successful run metadata history"

# --- MR1: changed mode runs script smoke tests after Vitest --------------
# verify --changed must invoke `bun run test:scripts:changed` so script-only
# edits are exercised by the wrapper instead of slipping past as a "no
# Vitest-relevant changes" no-op.
grep -qF 'bun run test:scripts:changed' "$STUB_LOG_FILE" \
  || fail "verify --changed should invoke bun run test:scripts:changed"
ok "verify --changed runs script smoke tests"

grep -qF 'bun run lint:ratchet' "$STUB_LOG_FILE" \
  || fail "verify --changed should invoke bun run lint:ratchet"
ok "verify --changed runs lint ratchet"

grep -qF 'bun run lint:ratchet:zero-baseline' "$STUB_LOG_FILE" \
  || fail "verify --changed should invoke bun run lint:ratchet:zero-baseline"
ok "verify --changed runs zero-baseline lifecycle check"

grep -qF 'bun run docs:lint-coverage-map:check -- --staged' "$STUB_LOG_FILE" \
  || fail "verify --changed should invoke staged lint coverage map check"
ok "verify --changed runs staged lint coverage map check"

grep -qF 'bun run format:changed:check' "$STUB_LOG_FILE" \
  || fail "verify --changed should invoke bun run format:changed:check"
ok "verify --changed runs changed format check"

# --- changed gate rejects unstaged source-relevant worktree drift -----------
GATE_REPO="$SANDBOX/changed-gate-repo"
SOURCE_RELEVANT_DRIFT_PATHS=(
  "docs/agent_notes/backlog/lint-followups/lint-coverage-map.md"
  ".claude/settings.json"
  ".codex/hooks.json"
  ".github/workflows/ci.yml"
  ".devcontainer/devcontainer.json"
  ".playwright/cli.config.json"
  ".yamllint.yml"
  "bunfig.toml"
  "drift-ai.config.json"
  "docker-compose.yml"
  "commitlint.config.js"
  "stryker.config.mjs"
  "knip.config.ts"
  "playwright.config.ts"
  "prisma.config.ts"
  ".claude/hooks/stop-reminder.sh"
  ".codex/hooks/pre-tool-use.sh"
  ".codex/config.toml"
  ".codex/skills/ts-graph/agents/openai.yaml"
  ".devcontainer/Dockerfile"
  ".devcontainer/docker-compose.yml"
  ".devcontainer/start-servers.sh"
  "packages/server/prisma.config.ts"
)
for source_relevant_path in "${SOURCE_RELEVANT_DRIFT_PATHS[@]}"; do
  rm -rf "$GATE_REPO"
  mkdir -p "$GATE_REPO/$(dirname "$source_relevant_path")"
  git -C "$GATE_REPO" init -q -b main
  git -C "$GATE_REPO" config user.email test@example.invalid
  git -C "$GATE_REPO" config user.name Test
  printf 'committed\n' > "$GATE_REPO/$source_relevant_path"
  git -C "$GATE_REPO" add "$source_relevant_path"
  git -C "$GATE_REPO" commit -qm init
  printf 'staged\n' > "$GATE_REPO/$source_relevant_path"
  git -C "$GATE_REPO" add "$source_relevant_path"
  printf 'unstaged\n' > "$GATE_REPO/$source_relevant_path"
  set +e
  output=$(musi_changed_gate_fail_if_unstaged "$GATE_REPO" "test changed gate" 2>&1)
  exit_code=$?
  set -e
  [ "$exit_code" -ne 0 ] || fail "changed gate accepted unstaged drift for $source_relevant_path"
  grep -qF "test changed gate:   - $source_relevant_path" <<< "$output" \
    || fail "changed gate did not report $source_relevant_path"
  ok "changed gate treats $source_relevant_path as source-relevant"
done

# --- cache short-circuit: second run skips entirely -----------------------
LINES_BEFORE=$(wc -l < "$STUB_LOG_FILE")
output=$(run_verify --changed) || fail "second verify --changed unexpectedly failed"
LINES_AFTER=$(wc -l < "$STUB_LOG_FILE")
[ "$LINES_BEFORE" = "$LINES_AFTER" ] || fail "cached verify --changed re-ran underlying commands"
grep -q "skipping" <<< "$output" || fail "cached run did not announce skip"
ok "verify --changed short-circuits on cached marker"

# --- FORCE_VERIFY=1 bypasses the cache ------------------------------------
LINES_BEFORE_FORCE=$(wc -l < "$STUB_LOG_FILE")
FORCE_VERIFY=1 run_verify --changed >/dev/null || fail "FORCE_VERIFY run failed"
LINES_AFTER_FORCE=$(wc -l < "$STUB_LOG_FILE")
[ "$LINES_AFTER_FORCE" -gt "$LINES_BEFORE_FORCE" ] || fail "FORCE_VERIFY=1 did not bypass cache"
ok "FORCE_VERIFY=1 bypasses cache"

# --- corrupt marker fails closed and reruns checks ------------------------
: > "$STUB_LOG_FILE"
cat > "$MARKER_CHANGED" <<'BAD_MARKER'
LAST_TS=abc
LAST_HEAD=whatever
LAST_HASH=whatever
BAD_MARKER
run_verify --changed >/dev/null || fail "verify --changed should ignore corrupt marker"
if ! grep -q 'bun run lint:changed' "$STUB_LOG_FILE"; then
  fail "corrupt marker should rerun underlying commands"
fi
ok "verify --changed treats corrupt marker as a cache miss"

# --- changed-mode failure aggregates parallel task results ----------------
rm -f "$MARKER_CHANGED"
: > "$STUB_LOG_FILE"
set +e
output=$(STUB_FAIL_typecheck=1 run_verify --changed 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "verify --changed did not propagate failure"
grep -qF 'Failed: typecheck' <<< "$output" || fail "summary missed Failed: typecheck"
grep -qF 'Passed: lint ratchet zero-baseline coverage-map format-check test scripts' <<< "$output" \
  || fail "summary missed other passed parallel tasks"
grep -qF 'verify:changed FAILED' <<< "$output" || fail "summary missed banner"
[ -f "$MARKER_CHANGED" ] && fail "marker should not be written on failure"
history_match="$(find "$HISTORY_DIR" -maxdepth 1 -type f -name '*-parallel-verify-changed-1.json' -print -quit)"
[ -n "$history_match" ] || fail "verify --changed did not persist failed run metadata history"
grep -q 'bun run test:changed' "$STUB_LOG_FILE" \
  || fail "parallel changed verify should still run test after typecheck failure"
grep -q 'bun run test:scripts:changed' "$STUB_LOG_FILE" \
  || fail "parallel changed verify should still run scripts after typecheck failure"
ok "verify --changed aggregates parallel failures"

# --- lint failure still prints lint guidance ------------------------------
rm -f "$MARKER_CHANGED"
: > "$STUB_LOG_FILE"
set +e
output=$(STUB_FAIL_lint_changed=1 run_verify --changed 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "verify --changed did not propagate lint failure"
grep -qF "bun run lint:fix" <<< "$output" || fail "lint failure missing lint:fix hint"
grep -q 'bun run typecheck' "$STUB_LOG_FILE" \
  || fail "parallel changed verify should still start typecheck after lint failure"
grep -q 'bun run lint:ratchet' "$STUB_LOG_FILE" \
  || fail "parallel changed verify should still start ratchet after lint failure"
grep -q 'bun run test:changed' "$STUB_LOG_FILE" \
  || fail "parallel changed verify should still start test after lint failure"
grep -q 'bun run test:scripts:changed' "$STUB_LOG_FILE" \
  || fail "parallel changed verify should still start scripts after lint failure"
ok "verify --changed prints lint:fix hint on parallel lint failure"

# --- ratchet failure is reported in the parallel summary ------------------
rm -f "$MARKER_CHANGED"
: > "$STUB_LOG_FILE"
set +e
output=$(STUB_FAIL_lint_ratchet=1 run_verify --changed 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "verify --changed did not propagate ratchet failure"
grep -qF 'Failed: ratchet' <<< "$output" || fail "summary missed Failed: ratchet"
grep -qF 'Passed: lint' <<< "$output" || fail "summary missed Passed: lint"
grep -q 'bun run typecheck' "$STUB_LOG_FILE" \
  || fail "parallel changed verify should still start typecheck after ratchet failure"
grep -q 'bun run docs:lint-coverage-map:check' "$STUB_LOG_FILE" \
  || fail "parallel changed verify should still start coverage-map after ratchet failure"
grep -q 'bun run test:changed' "$STUB_LOG_FILE" \
  || fail "parallel changed verify should still start test after ratchet failure"
ok "verify --changed reports ratchet failure"

# --- coverage-map failure is reported in the parallel summary -------------
rm -f "$MARKER_CHANGED"
: > "$STUB_LOG_FILE"
set +e
output=$(STUB_FAIL_docs_lint_coverage_map_check=1 run_verify --changed 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "verify --changed did not propagate coverage-map failure"
grep -qF 'Failed: coverage-map' <<< "$output" || fail "summary missed Failed: coverage-map"
grep -qF 'Passed: lint ratchet' <<< "$output" || fail "summary missed Passed: lint ratchet"
grep -q 'bun run typecheck' "$STUB_LOG_FILE" \
  || fail "parallel changed verify should still start typecheck after coverage-map failure"
grep -q 'bun run test:changed' "$STUB_LOG_FILE" \
  || fail "parallel changed verify should still start test after coverage-map failure"
ok "verify --changed reports coverage-map failure"

# --- format-check failure is reported with a repair hint ------------------
rm -f "$MARKER_CHANGED"
: > "$STUB_LOG_FILE"
set +e
output=$(STUB_FAIL_format_changed_check=1 run_verify --changed 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "verify --changed did not propagate format-check failure"
grep -qF 'Failed: format-check' <<< "$output" || fail "summary missed Failed: format-check"
grep -qF "bun run format:changed" <<< "$output" || fail "format-check failure missing format hint"
grep -q 'bun run typecheck' "$STUB_LOG_FILE" \
  || fail "parallel changed verify should still start typecheck after format-check failure"
grep -q 'bun run test:changed' "$STUB_LOG_FILE" \
  || fail "parallel changed verify should still start test after format-check failure"
ok "verify --changed reports format-check failure with hint"

# --- watchdog kills a hung step and reports a timeout banner --------------
rm -f "$MARKER_CHANGED"
: > "$STUB_LOG_FILE"
set +e
# Tiny timeout + a sleep stub on lint guarantees the watchdog fires before
# the lint stub returns. Capture stderr too — the timeout banner goes there.
output=$(MUSI_VERIFY_TIMEOUT=2 STUB_SLEEP_lint_changed=10 run_verify --changed 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 124 ] || fail "watchdog should exit 124 (got $exit_code)"
grep -qF 'TIMED OUT' <<< "$output" || fail "watchdog did not print TIMED OUT banner"
grep -qF "logs: $LOG_DIR" <<< "$output" || fail "watchdog did not print log dir breadcrumb"
grep -qF 'verify:logs budget' <<< "$output" || fail "watchdog did not print verify:logs budget hint"
grep -qF 'stopped the verification process tree' <<< "$output" \
  || fail "watchdog did not print process-tree cleanup message"
grep -qF 'verify:async' <<< "$output" \
  || fail "watchdog did not mention async alternative"
[ -f "$LOG_DIR/run-meta.json" ] || fail "watchdog did not write run-meta.json"
grep -q '"mode":"parallel-verify-changed"' "$LOG_DIR/run-meta.json" \
  || fail "watchdog metadata should record parallel-verify-changed mode"
grep -q '"name":"wrapper"' "$LOG_DIR/run-meta.json" \
  || fail "watchdog metadata should record wrapper timing"
grep -q '"exit_code":124' "$LOG_DIR/run-meta.json" \
  || fail "watchdog metadata should record exit_code 124"
[ -f "$MARKER_CHANGED" ] && fail "marker should not be written when the watchdog fires"
ok "watchdog kills hung steps and records timeout metadata"

# --- watchdog kills child process tree, not just the wrapper PID ----------
# The bun stub sleeps in the foreground, creating a child process tree:
#   verify.sh -> subshell -> env -> stub -> sleep
# After the watchdog fires, ALL descendants must be gone.
rm -f "$MARKER_CHANGED"
: > "$STUB_LOG_FILE"
TREE_PID_LOG="$SANDBOX/tree-pids"
rm -f "$TREE_PID_LOG"
set +e
output=$(MUSI_VERIFY_TIMEOUT=2 STUB_SLEEP_lint_changed=30 STUB_PID_LOG="$TREE_PID_LOG" run_verify --changed 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 124 ] || fail "tree-cleanup watchdog should exit 124 (got $exit_code)"
sleep 0.3
if [ -f "$TREE_PID_LOG" ]; then
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      fail "watchdog left child process $pid alive after timeout"
    fi
  done < "$TREE_PID_LOG"
fi
ok "watchdog kills child process tree on timeout"

# --- MUSI_INTERACTIVE_TIMEOUT is honored when MUSI_VERIFY_TIMEOUT is unset --
rm -f "$MARKER_CHANGED"
: > "$STUB_LOG_FILE"
set +e
output=$(MUSI_INTERACTIVE_TIMEOUT=2 STUB_SLEEP_lint_changed=10 run_verify --changed 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 124 ] || fail "MUSI_INTERACTIVE_TIMEOUT should also trigger 124 (got $exit_code)"
[ -f "$LOG_DIR/run-meta.json" ] || fail "MUSI_INTERACTIVE_TIMEOUT did not write run-meta.json"
grep -q '"exit_code":124' "$LOG_DIR/run-meta.json" \
  || fail "MUSI_INTERACTIVE_TIMEOUT metadata should record exit_code 124"
ok "MUSI_INTERACTIVE_TIMEOUT triggers the watchdog"

# --- lock wait and execution watchdog share one interactive budget --------
# Hold the verify lock for ~2s, then run with a 3s total budget and a hung
# lint step. The post-lock watchdog should shrink to the remaining budget
# instead of granting a fresh 3s execution window after the wait.
rm -f "$MARKER_CHANGED"
: > "$STUB_LOG_FILE"
LOCK_HELD="$SANDBOX/lock-held"
rm -f "$LOCK_HELD"
(
  exec 8<>"$LOCK"
  flock -n 8 || exit 1
  : > "$LOCK_HELD"
  sleep 2
) &
LOCK_HOLDER=$!
for _ in $(seq 1 30); do
  [ -f "$LOCK_HELD" ] && break
  sleep 0.1
done
[ -f "$LOCK_HELD" ] || fail "test setup failed to acquire verify lock"
set +e
output=$(MUSI_INTERACTIVE_TIMEOUT=3 STUB_SLEEP_lint_changed=10 run_verify --changed 2>&1)
exit_code=$?
set -e
wait "$LOCK_HOLDER" 2>/dev/null || true
[ "$exit_code" -eq 124 ] || fail "lock-coupled watchdog should exit 124 (got $exit_code)"
grep -qF 'execution watchdog budget' <<< "$output" \
  || fail "lock-coupled watchdog did not report reduced execution budget"
grep -qF 'TIMED OUT' <<< "$output" || fail "lock-coupled watchdog did not time out hung step"
[ -f "$LOG_DIR/run-meta.json" ] || fail "lock-coupled watchdog did not write run-meta.json"
grep -q '"exit_code":124' "$LOG_DIR/run-meta.json" \
  || fail "lock-coupled watchdog metadata should record exit_code 124"
[ -f "$MARKER_CHANGED" ] && fail "marker should not be written when lock-coupled watchdog fires"
ok "lock wait and execution watchdog share MUSI_INTERACTIVE_TIMEOUT"

# --- soft-budget warn line fires when ELAPSED > MUSI_INTERACTIVE_WARN_AFTER -
# A 2s stub-sleep on lint guarantees ELAPSED >= 2s, so a warn threshold of 1s
# fires reliably without flirting with the watchdog. Stub overhead alone can
# produce ELAPSED=0 with a default 0s threshold and silently miss the warn.
rm -f "$MARKER_CHANGED"
: > "$STUB_LOG_FILE"
set +e
output=$(MUSI_INTERACTIVE_WARN_AFTER=1 STUB_SLEEP_lint_changed=2 run_verify --changed 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 0 ] || fail "warn-only run should still succeed (got $exit_code)"
grep -qE 'verify:changed: WARN: elapsed=[0-9]+s exceeds soft budget' <<< "$output" \
  || fail "warn line missing on slow but successful run"
grep -qF 'verify:logs budget' <<< "$output" || fail "warn line missing budget pointer"
ok "verify --changed emits soft-budget warn when elapsed exceeds MUSI_INTERACTIVE_WARN_AFTER"

# --- full mode writes its own marker --------------------------------------
: > "$STUB_LOG_FILE"
rm -f "$MARKER_FULL" "$MARKER_CHANGED"
run_verify >/dev/null || fail "verify (full) unexpectedly failed"
[ -f "$MARKER_FULL" ] || fail "verify (full) did not write marker"
[ -f "$MARKER_CHANGED" ] && fail "verify (full) wrote the changed marker"
ok "verify (full) writes its own marker"

grep -qE 'bun run test --reporter=dot --reporter=json --outputFile\.json='"$LOG_DIR"'/test-timings\.json' "$STUB_LOG_FILE" \
  || fail "verify (full) should request Vitest json timings into \$LOG_DIR/test-timings.json"
ok "verify (full) pairs dot reporter with json timings file"

grep -qF 'bun run lint:ratchet' "$STUB_LOG_FILE" \
  || fail "verify (full) should invoke bun run lint:ratchet"
ok "verify (full) runs lint ratchet"

grep -qF 'bun run docs:lint-coverage-map:check' "$STUB_LOG_FILE" \
  || fail "verify (full) should invoke bun run docs:lint-coverage-map:check"
if grep -qF 'bun run docs:lint-coverage-map:check -- --staged' "$STUB_LOG_FILE"; then
  fail "verify (full) must not invoke the staged lint coverage map check"
fi
ok "verify (full) runs lint coverage map check"

grep -qF 'bun run format:check' "$STUB_LOG_FILE" \
  || fail "verify (full) should invoke bun run format:check"
if grep -qF 'bun run format:changed:check' "$STUB_LOG_FILE"; then
  fail "verify (full) must not invoke the changed format check"
fi
ok "verify (full) runs full format check"

# --- MR1: full mode runs the full script smoke suite ---------------------
# Full verify always runs the smoke suite — even when nothing under
# scripts/ changed — so a release-shaped check exercises the wrappers.
grep -qF 'bun run test:scripts' "$STUB_LOG_FILE" \
  || fail "verify (full) should invoke bun run test:scripts"
if grep -q 'bun run test:scripts:changed' "$STUB_LOG_FILE"; then
  fail "verify (full) must not invoke the changed-mode script smoke suite"
fi
ok "verify (full) runs the full script smoke suite"

# --- parallel mode writes the full marker and runs full commands -----------
: > "$STUB_LOG_FILE"
rm -f "$MARKER_FULL" "$MARKER_CHANGED"
run_verify --parallel >/dev/null || fail "verify --parallel unexpectedly failed"
[ -f "$MARKER_FULL" ] || fail "verify --parallel did not write full marker"
[ -f "$MARKER_CHANGED" ] && fail "verify --parallel wrote the changed marker"
ok "verify --parallel writes full marker"

grep -qE 'bun run test --reporter=dot --reporter=json --outputFile\.json='"$LOG_DIR"'/test-timings\.json' "$STUB_LOG_FILE" \
  || fail "verify --parallel should request full Vitest test"
ok "verify --parallel runs full test suite"

grep -qF 'bun run lint' "$STUB_LOG_FILE" \
  || fail "verify --parallel should invoke bun run lint"
if grep -q 'bun run lint:changed' "$STUB_LOG_FILE"; then
  fail "verify --parallel must not invoke lint:changed"
fi
ok "verify --parallel runs full lint"

grep -qF 'bun run lint:ratchet' "$STUB_LOG_FILE" \
  || fail "verify --parallel should invoke bun run lint:ratchet"
ok "verify --parallel runs lint ratchet"

grep -qF 'bun run format:check' "$STUB_LOG_FILE" \
  || fail "verify --parallel should invoke bun run format:check"
if grep -qF 'bun run format:changed:check' "$STUB_LOG_FILE"; then
  fail "verify --parallel must not invoke the changed format check"
fi
ok "verify --parallel runs full format check"

grep -qF 'bun run test:scripts' "$STUB_LOG_FILE" \
  || fail "verify --parallel should invoke bun run test:scripts"
if grep -q 'bun run test:scripts:changed' "$STUB_LOG_FILE"; then
  fail "verify --parallel must not invoke the changed-mode script smoke suite"
fi
ok "verify --parallel runs full script smoke suite"

[ -f "$LOG_DIR/run-meta.json" ] || fail "verify --parallel did not write run-meta.json"
grep -q '"mode":"parallel-verify"' "$LOG_DIR/run-meta.json" \
  || fail "verify --parallel metadata should record parallel-verify mode"
ok "verify --parallel writes parallel-verify metadata"

# --- parallel mode aggregates failures ------------------------------------
rm -f "$MARKER_FULL"
: > "$STUB_LOG_FILE"
set +e
output=$(STUB_FAIL_typecheck=1 run_verify --parallel 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "verify --parallel did not propagate failure"
grep -qF 'Failed: typecheck' <<< "$output" || fail "parallel summary missed Failed: typecheck"
grep -qF 'Passed: lint ratchet zero-baseline coverage-map format-check test scripts' <<< "$output" \
  || fail "parallel summary missed other passed tasks"
grep -q 'bun run test ' "$STUB_LOG_FILE" \
  || fail "parallel verify should still run test after typecheck failure"
ok "verify --parallel aggregates parallel failures"

# --- marker format matches pre-commit (LAST_TS / LAST_HEAD / LAST_HASH) ---
# Re-run a successful verify to produce a fresh marker for format checking.
rm -f "$MARKER_FULL"
: > "$STUB_LOG_FILE"
FORCE_VERIFY=1 run_verify >/dev/null || fail "verify (full) unexpectedly failed before marker check"
grep -q '^LAST_TS=[0-9]\+$' "$MARKER_FULL" || fail "marker missing LAST_TS"
grep -q '^LAST_HEAD=' "$MARKER_FULL" || fail "marker missing LAST_HEAD"
grep -q '^LAST_HASH=[0-9a-f]\{64\}$' "$MARKER_FULL" || fail "marker missing or malformed LAST_HASH"
ok "marker uses pre-commit format"

printf 'verify tests passed (%d)\n' "$PASS"
