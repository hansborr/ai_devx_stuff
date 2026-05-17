#!/usr/bin/env bash
# test-verify.sh — pure-shell smoke tests for scripts/verify.sh.
#
# Stubs `bun` so the script never actually runs lint/typecheck/test. Verifies
# argument parsing, the cache short-circuit, FORCE_VERIFY=1 bypass, sequential
# fail-fast behavior, and the failure summary shape. Run via
# `bash scripts/test-verify.sh`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFY="$SCRIPT_DIR/verify.sh"

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
# used by the watchdog test below.
printf 'stub bun %s\n' "$*" >> "${STUB_LOG:-/dev/null}"
if [ "${1:-}" = run ] && [ -n "${2:-}" ]; then
  var_fail="STUB_FAIL_${2//:/_}"
  var_sleep="STUB_SLEEP_${2//:/_}"
  if [ -n "${!var_sleep:-}" ]; then
    sleep "${!var_sleep}"
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
MARKER_CHANGED="$SANDBOX/marker-changed"
MARKER_FULL="$SANDBOX/marker-full"
STUB_LOG_FILE="$SANDBOX/bun.log"
: > "$STUB_LOG_FILE"

run_verify() {
  STUB_LOG="$STUB_LOG_FILE" \
  PATH="$SANDBOX/bin:$PATH" \
  MUSI_VERIFY_LOCK="$LOCK" \
  MUSI_VERIFY_LOG_DIR="$LOG_DIR" \
  MUSI_VERIFY_MARKER_CHANGED="$MARKER_CHANGED" \
  MUSI_VERIFY_MARKER_FULL="$MARKER_FULL" \
    bash "$VERIFY" "$@"
}

# --- syntax / argument parsing --------------------------------------------
bash -n "$VERIFY" || fail "verify.sh fails bash -n"
ok "verify.sh passes bash -n"

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
grep -q '"mode":"serial-verify-changed"' "$LOG_DIR/run-meta.json" \
  || fail "verify --changed metadata should record serial-verify-changed mode"
grep -q '"name":"wrapper"' "$LOG_DIR/run-meta.json" \
  || fail "verify --changed metadata should record wrapper timing"
grep -q '"name":"test"' "$LOG_DIR/run-meta.json" \
  || fail "verify --changed metadata should record test step timing"
grep -q 'bun run test:changed --reporter=dot --reporter=json --outputFile.json='"$LOG_DIR"'/test-timings.json' "$LOG_DIR/run-meta.json" \
  || fail "verify --changed metadata should record test command"
ok "verify --changed writes changed serial run metadata"

# --- MR1: changed mode runs script smoke tests after Vitest --------------
# verify --changed must invoke `bun run test:scripts:changed` so script-only
# edits are exercised by the wrapper instead of slipping past as a "no
# Vitest-relevant changes" no-op.
grep -qF 'bun run test:scripts:changed' "$STUB_LOG_FILE" \
  || fail "verify --changed should invoke bun run test:scripts:changed"
ok "verify --changed runs script smoke tests"

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

# --- failure halts at first failing step (sequential fail-fast) -----------
rm -f "$MARKER_CHANGED"
: > "$STUB_LOG_FILE"
set +e
output=$(STUB_FAIL_typecheck=1 run_verify --changed 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "verify --changed did not propagate failure"
grep -qF 'Failed: typecheck' <<< "$output" || fail "summary missed Failed: typecheck"
grep -qF 'Passed: lint' <<< "$output" || fail "summary missed Passed: lint"
grep -qF 'verify:changed FAILED' <<< "$output" || fail "summary missed banner"
[ -f "$MARKER_CHANGED" ] && fail "marker should not be written on failure"
# test:changed must not run after typecheck failure.
if grep -q 'bun run test:changed' "$STUB_LOG_FILE"; then
  fail "test step ran after typecheck failure"
fi
# scripts step must not run after typecheck failure either.
if grep -q 'bun run test:scripts' "$STUB_LOG_FILE"; then
  fail "scripts step ran after typecheck failure"
fi
ok "verify --changed halts at first failing step"

# --- lint failure stops typecheck and test from running -------------------
rm -f "$MARKER_CHANGED"
: > "$STUB_LOG_FILE"
set +e
output=$(STUB_FAIL_lint_changed=1 run_verify --changed 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "verify --changed did not propagate lint failure"
grep -qF "bun run lint:fix" <<< "$output" || fail "lint failure missing lint:fix hint"
if grep -q 'bun run typecheck' "$STUB_LOG_FILE"; then
  fail "typecheck step ran after lint failure"
fi
if grep -q 'bun run test:changed' "$STUB_LOG_FILE"; then
  fail "test step ran after lint failure"
fi
if grep -q 'bun run test:scripts' "$STUB_LOG_FILE"; then
  fail "scripts step ran after lint failure"
fi
ok "verify --changed prints lint:fix hint and stops at lint failure"

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
[ -f "$LOG_DIR/run-meta.json" ] || fail "watchdog did not write run-meta.json"
grep -q '"mode":"serial-verify-changed"' "$LOG_DIR/run-meta.json" \
  || fail "watchdog metadata should record serial-verify-changed mode"
grep -q '"name":"wrapper"' "$LOG_DIR/run-meta.json" \
  || fail "watchdog metadata should record wrapper timing"
grep -q '"exit_code":124' "$LOG_DIR/run-meta.json" \
  || fail "watchdog metadata should record exit_code 124"
[ -f "$MARKER_CHANGED" ] && fail "marker should not be written when the watchdog fires"
ok "watchdog kills hung steps and records timeout metadata"

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

# --- MR1: full mode runs the full script smoke suite ---------------------
# Full verify always runs the smoke suite — even when nothing under
# scripts/ changed — so a release-shaped check exercises the wrappers.
grep -qF 'bun run test:scripts' "$STUB_LOG_FILE" \
  || fail "verify (full) should invoke bun run test:scripts"
if grep -q 'bun run test:scripts:changed' "$STUB_LOG_FILE"; then
  fail "verify (full) must not invoke the changed-mode script smoke suite"
fi
ok "verify (full) runs the full script smoke suite"

# --- marker format matches pre-commit (LAST_TS / LAST_HEAD / LAST_HASH) ---
grep -q '^LAST_TS=[0-9]\+$' "$MARKER_FULL" || fail "marker missing LAST_TS"
grep -q '^LAST_HEAD=' "$MARKER_FULL" || fail "marker missing LAST_HEAD"
grep -q '^LAST_HASH=[0-9a-f]\{64\}$' "$MARKER_FULL" || fail "marker missing or malformed LAST_HASH"
ok "marker uses pre-commit format"

printf 'verify tests passed (%d)\n' "$PASS"
