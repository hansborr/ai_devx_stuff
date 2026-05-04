#!/usr/bin/env bash
# test-verify-logs.sh — pure-shell smoke tests for scripts/verify-logs.sh.
#
# Stages fake logs and bun-run-quiet markers in a sandbox, then checks the
# summary, focused, and --full modes pick the newer log, surface marker
# state, and reject bad arguments. Run via `bash scripts/test-verify-logs.sh`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/verify-logs.sh"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

SANDBOX="$(mktemp -d /tmp/musi-verify-logs-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

PRECOMMIT_LOG_DIR="$SANDBOX/precommit-logs"
BUN_LOG_DIR="$SANDBOX/bun-logs"
VERIFY_MARKER_FULL="$SANDBOX/verify-full"
VERIFY_MARKER_CHANGED="$SANDBOX/verify-changed"
PRECOMMIT_MARKER="$SANDBOX/precommit-marker"
mkdir -p "$PRECOMMIT_LOG_DIR" "$BUN_LOG_DIR"

run_logs() {
  MUSI_VERIFY_LOG_DIR="$PRECOMMIT_LOG_DIR" \
  AI_BUN_LOG_DIR="$BUN_LOG_DIR" \
  MUSI_VERIFY_MARKER_FULL="$VERIFY_MARKER_FULL" \
  MUSI_VERIFY_MARKER_CHANGED="$VERIFY_MARKER_CHANGED" \
  MUSI_PRECOMMIT_MARKER="$PRECOMMIT_MARKER" \
    bash "$SCRIPT" "$@"
}

write_marker() {
  local file="$1" exit_code="$2" age_secs="$3"
  local fp; fp="$(printf 'a%.0s' {1..64})"
  local ts; ts=$(( $(date +%s) - age_secs ))
  {
    printf 'LAST_TS=%s\n' "$ts"
    printf 'LAST_FP=%s\n' "$fp"
    printf 'LAST_EXIT=%s\n' "$exit_code"
  } > "$file"
}

# --- syntax / argument parsing --------------------------------------------
bash -n "$SCRIPT" || fail "verify-logs.sh fails bash -n"
ok "verify-logs.sh passes bash -n"

if run_logs --bogus >/dev/null 2>&1; then
  fail "verify-logs.sh accepted unknown flag"
fi
ok "verify-logs.sh rejects unknown flags"

if run_logs --full >/dev/null 2>&1; then
  fail "verify-logs.sh accepted --full without a task"
fi
ok "verify-logs.sh requires a task with --full"

if run_logs slow-tests --full >/dev/null 2>&1; then
  fail "verify-logs.sh accepted --full for slow-tests"
fi
ok "verify-logs.sh rejects --full for slow-tests"

if run_logs budget --full >/dev/null 2>&1; then
  fail "verify-logs.sh accepted --full for budget"
fi
ok "verify-logs.sh rejects --full for budget"

if run_logs lint typecheck >/dev/null 2>&1; then
  fail "verify-logs.sh accepted two task arguments"
fi
ok "verify-logs.sh rejects multiple tasks"

# --- empty state --------------------------------------------------------
output=$(run_logs)
grep -q '(no log)' <<< "$output" || fail "summary missed (no log) for empty state"
grep -qF 'No task logs yet' <<< "$output" || fail "summary missed empty-state hint"
ok "summary handles empty state"

if run_logs lint >/dev/null 2>&1; then
  fail "focused view succeeded with no log"
fi
ok "focused view fails when no log exists"

if output=$(run_logs slow-tests 2>&1); then
  fail "slow-tests view succeeded without timing sidecar"
fi
grep -qF "$PRECOMMIT_LOG_DIR/test-timings.json" <<< "$output" \
  || fail "slow-tests missing-sidecar message should name the timing file"
grep -qF 'FORCE_VERIFY=1 bun run verify:changed' <<< "$output" \
  || fail "slow-tests missing-sidecar message should suggest a forced changed verify"
grep -qF 'FORCE_VERIFY=1 bun run verify' <<< "$output" \
  || fail "slow-tests missing-sidecar message should mention full verify fallback"
ok "slow-tests view gives actionable regeneration guidance when timings are missing"

printf 'test:changed: no Vitest-relevant changes vs main.\n' > "$PRECOMMIT_LOG_DIR/test.log"
if output=$(run_logs slow-tests 2>&1); then
  fail "slow-tests view succeeded when changed-mode skipped Vitest"
fi
grep -qF 'skipped Vitest' <<< "$output" \
  || fail "slow-tests skip message should explain that changed-mode skipped Vitest"
grep -qF 'FORCE_VERIFY=1 bun run verify' <<< "$output" \
  || fail "slow-tests skip message should suggest forced full verify"
ok "slow-tests view recognizes changed-mode skips without timings"
rm -f "$PRECOMMIT_LOG_DIR/test.log"

# --- pre-commit log only (no per-task marker, no wrapper marker) --------
printf 'lint output line 1\nlint output line 2\n' > "$PRECOMMIT_LOG_DIR/lint.log"
output=$(run_logs)
grep -qE 'lint .*verify/precommit .*lint\.log' <<< "$output" \
  || fail "summary did not list pre-commit lint log"
grep -q "EXIT" <<< "$output" || fail "summary missing header"
# Pre-commit log without a fresh wrapper marker: STATE column is "-".
grep -qE 'lint +- +\?' <<< "$output" \
  || fail "pre-commit log row should show STATE=- and EXIT=? without a wrapper marker"
ok "summary shows pre-commit log without per-task or wrapper marker"

# A wrapper marker written at-or-after the log mtime promotes the row to OK*.
write_wrapper_marker() {
  local file="$1" age_secs="$2"
  local ts; ts=$(( $(date +%s) - age_secs ))
  {
    printf 'LAST_TS=%s\n' "$ts"
    printf 'LAST_HEAD=%s\n' "deadbeef"
    printf 'LAST_HASH=%s\n' "$(printf 'a%.0s' {1..64})"
  } > "$file"
}
sleep 1
write_wrapper_marker "$VERIFY_MARKER_CHANGED" 0
output=$(run_logs)
grep -qE 'lint +OK\* +0' <<< "$output" \
  || fail "fresh verify --changed marker should promote pre-commit row to OK*"
grep -qF 'OK*' <<< "$output" || fail "summary should include OK* legend marker"
ok "summary derives OK* for pre-commit log when wrapper marker is fresher"

# An older wrapper marker (predates the log) does not promote the row.
write_wrapper_marker "$VERIFY_MARKER_CHANGED" 7200
output=$(run_logs)
grep -qE 'lint +- +\?' <<< "$output" \
  || fail "stale wrapper marker should leave STATE=- (log is from a later, possibly failed run)"
ok "stale wrapper marker does not falsely promote a pre-commit row"

# A wrapper marker with an unknown key is rejected by validation.
{
  printf 'LAST_TS=%s\n' "$(date +%s)"
  printf 'LAST_HEAD=x\n'
  printf 'LAST_HASH=%s\n' "$(printf 'a%.0s' {1..64})"
  printf 'BOGUS_KEY=oops\n'
} > "$VERIFY_MARKER_CHANGED"
output=$(run_logs)
grep -qE 'lint +- +\?' <<< "$output" \
  || fail "wrapper marker with unknown key should be ignored"
ok "wrapper marker validation rejects unknown keys"
rm -f "$VERIFY_MARKER_CHANGED"

# Incomplete wrapper markers must not promote rows to OK*.
{
  printf 'LAST_TS=%s\n' "$(date +%s)"
  printf 'LAST_HASH=%s\n' "$(printf 'a%.0s' {1..64})"
} > "$VERIFY_MARKER_CHANGED"
output=$(run_logs)
grep -qE 'lint +- +\?' <<< "$output" \
  || fail "wrapper marker missing LAST_HEAD should be ignored"
grep -q 'verify --changed.*(corrupt)' <<< "$output" \
  || fail "wrapper marker missing LAST_HEAD should be shown as corrupt"
ok "wrapper marker validation requires LAST_HEAD"

{
  printf 'LAST_TS=%s\n' "$(date +%s)"
  printf 'LAST_HEAD=deadbeef\n'
} > "$VERIFY_MARKER_CHANGED"
output=$(run_logs)
grep -qE 'lint +- +\?' <<< "$output" \
  || fail "wrapper marker missing LAST_HASH should be ignored"
grep -q 'verify --changed.*(corrupt)' <<< "$output" \
  || fail "wrapper marker missing LAST_HASH should be shown as corrupt"
ok "wrapper marker validation requires LAST_HASH"

{
  printf 'LAST_TS=%s\n' "$(date +%s)"
  printf 'LAST_HEAD=deadbeef\n'
  printf 'LAST_HASH=not-a-hash\n'
} > "$VERIFY_MARKER_CHANGED"
output=$(run_logs)
grep -qE 'lint +- +\?' <<< "$output" \
  || fail "wrapper marker with malformed LAST_HASH should be ignored"
grep -q 'verify --changed.*(corrupt)' <<< "$output" \
  || fail "wrapper marker with malformed LAST_HASH should be shown as corrupt"
ok "wrapper marker validation checks LAST_HASH format"
rm -f "$VERIFY_MARKER_CHANGED"

# Focused view announces the missing per-task marker.
output=$(run_logs lint)
grep -qF "$PRECOMMIT_LOG_DIR/lint.log" <<< "$output" || fail "focused view missed log path"
grep -q 'aggregate marker' <<< "$output" \
  || fail "focused view should explain absent per-task marker"
grep -qF 'lint output line 2' <<< "$output" \
  || fail "focused view missed tail content"
ok "focused view shows pre-commit log with aggregate-marker note"

# --- bun-logs file with marker takes over when newer -------------------
sleep 1
printf 'newer bun lint output\n' > "$BUN_LOG_DIR/lint_changed.log"
write_marker "$BUN_LOG_DIR/last.lint_changed" 0 5
output=$(run_logs)
grep -qE 'lint +OK +0' <<< "$output" \
  || fail "summary should mark lint OK from bun marker"
grep -qE 'lint .*ai-hook .*lint_changed\.log' <<< "$output" \
  || fail "summary should switch to newer bun-logs lint log"
ok "summary picks newer bun-logs log and surfaces OK marker"

# Switch to a failing marker and confirm STATE flips to FAIL.
write_marker "$BUN_LOG_DIR/last.lint_changed" 1 5
output=$(run_logs)
grep -qE 'lint +FAIL +1' <<< "$output" \
  || fail "summary should mark lint FAIL from non-zero exit marker"
ok "summary surfaces FAIL state from non-zero exit marker"

output=$(run_logs lint)
grep -qF "$BUN_LOG_DIR/lint_changed.log" <<< "$output" \
  || fail "focused view should pick the newer bun-logs lint log"
grep -qE 'marker: FAIL exit=1' <<< "$output" \
  || fail "focused view should report marker FAIL/exit"
grep -qF 'newer bun lint output' <<< "$output" \
  || fail "focused tail missed bun-logs content"
ok "focused view reports bun marker state and tail"

printf 'before warning\n(node:123) DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.\n(Use `node --trace-deprecation ...` to show where the warning was created)\nafter warning\n' > "$BUN_LOG_DIR/lint_changed.log"
output=$(run_logs lint)
grep -qF 'before warning' <<< "$output" || fail "filtered focused view dropped useful line before warning"
grep -qF 'after warning' <<< "$output" || fail "filtered focused view dropped useful line after warning"
if grep -qF 'client.query()' <<< "$output"; then
  fail "focused view should filter known pg warning from displayed tail"
fi
if grep -qF 'trace-deprecation' <<< "$output"; then
  fail "focused view should filter known trace-deprecation hint from displayed tail"
fi
ok "focused view filters known third-party warning noise"

output=$(run_logs lint --full)
grep -qF 'client.query()' <<< "$output" || fail "--full should keep raw known warning lines"
ok "--full keeps raw logs unchanged"

# --- corrupt marker is treated as missing -----------------------------
printf 'LAST_TS=not-a-number\n' > "$BUN_LOG_DIR/last.lint_changed"
output=$(run_logs)
grep -qE 'lint +- +\?' <<< "$output" \
  || fail "corrupt marker should yield STATE=-/EXIT=?"
ok "corrupt marker degrades gracefully"

# Validation parity with ai_read_bun_marker (scripts/ai-hooks/cache.sh):
# the canonical writer never produces these shapes, so the viewer must
# treat them as missing rather than reporting state the writer wouldn't
# have produced.
fp64="$(printf 'a%.0s' {1..64})"
now_ts=$(date +%s)

# Missing LAST_FP.
{ printf 'LAST_TS=%s\n' "$now_ts"; printf 'LAST_EXIT=0\n'; } > "$BUN_LOG_DIR/last.lint_changed"
output=$(run_logs)
grep -qE 'lint +- +\?' <<< "$output" \
  || fail "marker missing LAST_FP should be treated as missing"
ok "marker missing LAST_FP is rejected"

# LAST_FP that isn't a sha256 hex string.
{
  printf 'LAST_TS=%s\n' "$now_ts"
  printf 'LAST_FP=not-a-hash\n'
  printf 'LAST_EXIT=0\n'
} > "$BUN_LOG_DIR/last.lint_changed"
output=$(run_logs)
grep -qE 'lint +- +\?' <<< "$output" \
  || fail "marker with malformed LAST_FP should be treated as missing"
ok "marker with malformed LAST_FP is rejected"

# Out-of-range LAST_EXIT (signal exits >= 128 are never written by cache.sh).
{
  printf 'LAST_TS=%s\n' "$now_ts"
  printf 'LAST_FP=%s\n' "$fp64"
  printf 'LAST_EXIT=200\n'
} > "$BUN_LOG_DIR/last.lint_changed"
output=$(run_logs)
grep -qE 'lint +- +\?' <<< "$output" \
  || fail "marker with LAST_EXIT >= 128 should be treated as missing"
ok "marker with out-of-range LAST_EXIT is rejected"

# Unknown key in marker.
{
  printf 'LAST_TS=%s\n' "$now_ts"
  printf 'LAST_FP=%s\n' "$fp64"
  printf 'LAST_EXIT=0\n'
  printf 'BOGUS=oops\n'
} > "$BUN_LOG_DIR/last.lint_changed"
output=$(run_logs)
grep -qE 'lint +- +\?' <<< "$output" \
  || fail "marker with unknown key should be treated as missing"
ok "marker with unknown key is rejected"

# --- --full mode prints the entire log to stdout ----------------------
write_marker "$BUN_LOG_DIR/last.lint_changed" 0 5
printf 'line 1\nline 2\nline 3\n' > "$BUN_LOG_DIR/lint_changed.log"
output=$(run_logs lint --full)
[ "$output" = $'line 1\nline 2\nline 3' ] || fail "--full did not stream the full log verbatim"
ok "--full prints the full log unchanged"

# --- unknown task is rejected even when log exists ---------------------
if run_logs gibberish >/dev/null 2>&1; then
  fail "unknown task should fail"
fi
ok "unknown task argument is rejected"

# --- e2e log surfaces from bun-logs alone ------------------------------
printf 'e2e tail line\n' > "$BUN_LOG_DIR/e2e.log"
write_marker "$BUN_LOG_DIR/last.e2e" 0 5
output=$(run_logs)
grep -qE 'e2e +OK +0' <<< "$output" || fail "e2e summary row missing OK"
output=$(run_logs e2e)
grep -qF 'e2e tail line' <<< "$output" || fail "focused e2e view missed tail content"
ok "e2e log surfaces from bun-logs"

# --- slow-test timing sidecar ------------------------------------------
printf 'test log line\n' > "$PRECOMMIT_LOG_DIR/test.log"
cat > "$PRECOMMIT_LOG_DIR/test-timings.json" <<'JSON'
{
  "numTotalTests": 4,
  "testResults": [
    {
      "name": "/repo/packages/server/src/routers/fast.test.ts",
      "startTime": 1000,
      "endTime": 1120,
      "status": "passed",
      "assertionResults": [
        {
          "ancestorTitles": ["fast suite"],
          "title": "quick case",
          "duration": 15,
          "status": "passed"
        }
      ]
    },
    {
      "name": "/repo/packages/server/src/routers/slow-file.test.ts",
      "startTime": 2000,
      "endTime": 3800,
      "status": "passed",
      "assertionResults": [
        {
          "fullName": "slow suite slowest case",
          "duration": 900,
          "status": "passed"
        },
        {
          "ancestorTitles": ["slow suite", "nested"],
          "title": "second case",
          "duration": 450,
          "status": "passed"
        }
      ]
    }
  ]
}
JSON
output=$(run_logs slow-tests)
grep -qF '== slow-tests ==' <<< "$output" || fail "slow-tests view missed heading"
grep -qF 'Top slow test files' <<< "$output" || fail "slow-tests view missed file section"
grep -qE '1\. +1800ms +2 +passed +.*/slow-file\.test\.ts' <<< "$output" \
  || fail "slow-tests view should rank the slowest file first"
grep -qF 'Top slow test cases' <<< "$output" || fail "slow-tests view missed case section"
grep -qE '1\. +900ms +passed +slow suite slowest case - .*/slow-file\.test\.ts' <<< "$output" \
  || fail "slow-tests view should rank the slowest case first"
grep -qF 'Local signal only' <<< "$output" || fail "slow-tests view should state it is local-only"
ok "slow-tests view summarizes top file and case timings"

cat > "$PRECOMMIT_LOG_DIR/run-meta.json" <<'JSON'
{
  "version": 1,
  "mode": "parallel-precommit",
  "generated_at": "2026-05-03T00:00:00+00:00",
  "wrapper": {
    "name": "wrapper",
    "mode": "parallel-precommit",
    "start_time": "2026-05-03T00:00:00+00:00",
    "end_time": "2026-05-03T00:03:35+00:00",
    "elapsed_seconds": 215,
    "exit_code": 0,
    "command": ".husky/pre-commit"
  },
  "steps": [
    {
      "name": "lint",
      "mode": "parallel-precommit",
      "start_time": "2026-05-03T00:00:00+00:00",
      "end_time": "2026-05-03T00:00:08+00:00",
      "elapsed_seconds": 8,
      "exit_code": 0,
      "command": "bun run lint:changed"
    },
    {
      "name": "test",
      "mode": "parallel-precommit",
      "start_time": "2026-05-03T00:00:00+00:00",
      "end_time": "2026-05-03T00:03:20+00:00",
      "elapsed_seconds": 200,
      "exit_code": 0,
      "command": "bun run test:changed --reporter=dot --reporter=json"
    }
  ]
}
JSON
output=$(run_logs budget)
grep -qF '== budget ==' <<< "$output" || fail "budget view missed heading"
grep -qF 'state=WARN-BUDGET-EXCEEDED' <<< "$output" \
  || fail "budget view should warn when wrapper exceeds 210s"
grep -qE 'wrapper: 215s mode=parallel-precommit exit=0' <<< "$output" \
  || fail "budget view missed wrapper timing"
grep -qE 'parallel-precommit +test +200s +0 +bun run test:changed' <<< "$output" \
  || fail "budget view missed per-step timing"
grep -qF 'Top slow test files' <<< "$output" \
  || fail "budget view should include slow test file signal when timings exist"
ok "budget view summarizes wrapper, steps, and slow-test timings"

printf '{not json\n' > "$PRECOMMIT_LOG_DIR/test-timings.json"
if output=$(run_logs slow-tests 2>&1); then
  fail "slow-tests view succeeded with corrupt timing sidecar"
fi
grep -qF 'could not parse Vitest timings' <<< "$output" \
  || fail "slow-tests corrupt-sidecar message should explain the parse failure"
grep -qF 'FORCE_VERIFY=1 bun run verify:changed' <<< "$output" \
  || fail "slow-tests corrupt-sidecar message should suggest a forced changed verify"
ok "slow-tests view handles corrupt timing sidecar"

# --- wrapper marker block reports each marker -------------------------
write_wrapper_marker "$VERIFY_MARKER_CHANGED" 30
output=$(run_logs)
grep -qE 'verify --changed +[0-9]+s ago' <<< "$output" \
  || fail "summary should show fresh verify --changed wrapper marker age"
grep -qF "$VERIFY_MARKER_CHANGED" <<< "$output" \
  || fail "summary should print wrapper marker path"
grep -q 'verify (full).*(none)' <<< "$output" \
  || fail "summary should mark missing verify (full) marker"
ok "wrapper marker block surfaces present and missing markers"

# A wrapper marker with an unknown key must show as (corrupt) in the trailing
# block too — not just rejected for OK* derivation in the rows. Otherwise the
# same output contradicts itself: row says STATE=- but the wrapper block
# claims a fresh successful run.
{
  printf 'LAST_TS=%s\n' "$(date +%s)"
  printf 'LAST_HEAD=deadbeef\n'
  printf 'LAST_HASH=%s\n' "$(printf 'a%.0s' {1..64})"
  printf 'BOGUS=oops\n'
} > "$VERIFY_MARKER_CHANGED"
output=$(run_logs)
grep -q 'verify --changed.*(corrupt)' <<< "$output" \
  || fail "trailing block should show (corrupt) for wrapper marker with unknown key"
ok "trailing wrapper-marker block applies same strict validation as OK* derivation"
rm -f "$VERIFY_MARKER_CHANGED"

printf 'verify-logs tests passed (%d)\n' "$PASS"
