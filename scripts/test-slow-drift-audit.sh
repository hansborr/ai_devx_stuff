#!/usr/bin/env bash
# Smoke tests for scripts/slow-drift-audit.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLOW_DRIFT="$SCRIPT_DIR/slow-drift-audit.sh"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

SANDBOX="$(mktemp -d /tmp/musi-slow-drift-audit-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

write_bun_stub() {
  local path="$1"
  cat > "$path" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${SLOW_DRIFT_CALL_LOG:?}"

write_envelope() {
  mkdir -p "$(dirname "$HARNESS_DIAGNOSTICS_OUTPUT")"
  printf '{"version":"1","tool":"%s","findings":[],"summary":{"blocking":0,"warning":0,"info":0,"byControl":{}}}\n' "$1" \
    > "$HARNESS_DIAGNOSTICS_OUTPUT"
}

write_report() {
  local format="" output=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --format)
        format="$2"
        shift 2
        ;;
      --output)
        output="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done
  mkdir -p "$(dirname "$output")"
  printf 'fused %s\n' "$format" > "$output"
}

case "$*" in
  "run lint:ratchet")
    write_envelope "lint:ratchet"
    printf 'lint ratchet output\n'
    exit "${SLOW_DRIFT_LINT_EXIT:-0}"
    ;;
  "run drift:ai --scope current --check all")
    if [ "${SLOW_DRIFT_DRIFT_EXIT:-0}" -le 1 ]; then
      write_envelope "drift:ai"
    fi
    printf 'drift ai output\n'
    exit "${SLOW_DRIFT_DRIFT_EXIT:-0}"
    ;;
  run\ logs:audit*)
    write_envelope "logs:audit"
    printf 'logs audit output\n'
    exit "${SLOW_DRIFT_LOGS_EXIT:-0}"
    ;;
  run\ harness:audit*)
    shift 2
    if [ "${SLOW_DRIFT_REAL_HARNESS:-0}" = "1" ]; then
      "${SLOW_DRIFT_REAL_BUN:-bun}" "${SLOW_DRIFT_REAL_REPO_ROOT:?}/scripts/harness-audit.ts" "$@"
      exit $?
    fi
    write_report "$@"
    ;;
  *)
    printf 'unexpected bun stub call: %s\n' "$*" >&2
    exit 99
    ;;
esac
STUB
  chmod +x "$path"
}

new_repo() {
  local name="$1" repo
  repo="$SANDBOX/$name"
  mkdir -p "$repo/scripts"
  cp "$SLOW_DRIFT" "$repo/scripts/slow-drift-audit.sh"
  write_bun_stub "$repo/bun-stub"
  printf '%s\n' "$repo"
}

run_slow_drift() {
  local repo="$1"
  (
    cd "$repo"
    SLOW_DRIFT_CALL_LOG="$repo/calls.log" \
      SLOW_DRIFT_REAL_BUN="${SLOW_DRIFT_REAL_BUN:-bun}" \
      SLOW_DRIFT_REAL_REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)" \
      MUSI_SLOW_DRIFT_BUN="$repo/bun-stub" \
      MUSI_SLOW_DRIFT_OUTPUT_DIR="$repo/out" \
      bash scripts/slow-drift-audit.sh
  )
}

bash -n "$SLOW_DRIFT" || fail "slow-drift-audit.sh fails bash -n"
ok "slow-drift-audit.sh passes bash -n"

repo="$(new_repo clean)"
run_slow_drift "$repo" >/dev/null || fail "clean slow drift run should pass"
[ -s "$repo/out/envelopes/lint-ratchet.json" ] || fail "lint:ratchet envelope missing"
[ -s "$repo/out/envelopes/drift-ai.json" ] || fail "drift:ai envelope missing"
[ -s "$repo/out/fused/harness-audit.txt" ] || fail "text fused report missing"
[ -s "$repo/out/fused/harness-audit.json" ] || fail "json fused report missing"
grep -qF 'run harness:audit --format text --output' "$repo/calls.log" \
  || fail "harness:audit text call missing"
grep -qF 'no logs:audit inputs supplied' "$repo/out/producers/logs-audit.txt" \
  || fail "logs:audit skip note missing"
ok "clean run writes producer envelopes and fused reports"

repo="$(new_repo report-only-findings)"
SLOW_DRIFT_LINT_EXIT=1 run_slow_drift "$repo" >/dev/null \
  || fail "producer exit 1 should not fail report-only lane"
grep -qF 'run harness:audit --format json --output' "$repo/calls.log" \
  || fail "report-only findings should still reach harness:audit"
ok "producer exit 1 continues to fused report"

repo="$(new_repo logs-configured)"
MUSI_SLOW_DRIFT_LOG_FILES=$'logs/one.jsonl\nlogs/two.jsonl' run_slow_drift "$repo" >/dev/null \
  || fail "logs-configured slow drift run should pass"
grep -qF 'run logs:audit --file logs/one.jsonl --file logs/two.jsonl' "$repo/calls.log" \
  || fail "logs:audit did not receive configured log files"
[ -s "$repo/out/envelopes/logs-audit.json" ] || fail "logs:audit envelope missing"
ok "configured logs:audit inputs are included in fusion"

repo="$(new_repo real-harness-fusion)"
SLOW_DRIFT_REAL_HARNESS=1 run_slow_drift "$repo" >/dev/null \
  || fail "real harness:audit slow drift fusion should pass"
grep -qF '"failures": []' "$repo/out/fused/harness-audit.json" \
  || fail "real harness:audit JSON should have no envelope failures"
grep -qF '"envelopes": 2' "$repo/out/fused/harness-audit.json" \
  || fail "real harness:audit JSON should count lint and drift envelopes"
ok "valid producer envelopes pass real harness:audit fusion"

repo="$(new_repo tool-error)"
set +e
SLOW_DRIFT_DRIFT_EXIT=2 run_slow_drift "$repo" >/dev/null 2>"$repo/error.log"
exit_code=$?
set -e
[ "$exit_code" -eq 2 ] || fail "producer tool error should exit 2, got $exit_code"
grep -qF 'drift:ai did not write diagnostics envelope' "$repo/error.log" \
  || fail "tool error should explain missing envelope"
if grep -qF 'run harness:audit' "$repo/calls.log"; then
  fail "harness:audit should not run after producer tool error"
fi
ok "producer tool error stops before fusion"

printf 'slow-drift-audit tests passed (%d)\n' "$PASS"
