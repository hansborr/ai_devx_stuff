#!/usr/bin/env bash
# smoke-order: 360
# smoke-subjects: scripts/slow-drift-audit.sh
# smoke-subjects: scripts/tests/test-slow-drift-audit.sh
# Smoke tests for scripts/slow-drift-audit.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLOW_DRIFT="$SCRIPT_DIR/../slow-drift-audit.sh"

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

write_message_eval() {
  local output="" json_output=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --output)
        output="$2"
        shift 2
        ;;
      --json-output)
        json_output="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done
  mkdir -p "$(dirname "$output")" "$(dirname "$json_output")"
  printf '# message eval\n' > "$output"
  printf '{"fixtures":[]}\n' > "$json_output"
}

case "$*" in
  "--version")
    printf '1.3.11\n'
    exit 0
    ;;
  "run lint:ratchet")
    if [ -n "${SLOW_DRIFT_LINT_IGNORE_TERM:-}" ]; then
      # Ignored dispositions are inherited, so the sleep child ignores TERM
      # too and only the timeout's follow-up KILL ends this step.
      trap '' TERM
    fi
    if [ -n "${SLOW_DRIFT_LINT_SLEEP:-}" ]; then
      sleep "$SLOW_DRIFT_LINT_SLEEP"
    fi
    if [ -n "${SLOW_DRIFT_BREAK_TIMINGS:-}" ]; then
      # Make the post-step timing append fail: swap the timings file for a
      # directory so `>>` errors, exercising the best-effort guard.
      rm -f "${MUSI_SLOW_DRIFT_OUTPUT_DIR:?}/fused/timings.txt"
      mkdir "${MUSI_SLOW_DRIFT_OUTPUT_DIR:?}/fused/timings.txt"
    fi
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
  run\ test:mutation*)
    if [ -n "${SLOW_DRIFT_MUTATION_IGNORE_TERM:-}" ]; then
      # The timeout's follow-up KILL must end a mutation stub that ignores TERM.
      trap '' TERM
    fi
    if [ -n "${SLOW_DRIFT_MUTATION_SLEEP:-}" ]; then
      sleep "$SLOW_DRIFT_MUTATION_SLEEP"
    fi
    if [ "${SLOW_DRIFT_MUTATION_EXIT:-0}" -ne 0 ]; then
      printf 'stryker crashed (stub)\n'
      exit "${SLOW_DRIFT_MUTATION_EXIT}"
    fi
    mkdir -p reports/mutation
    printf '{"files":{"packages/shared/src/rules/foo.ts":{"mutants":[{"mutatorName":"ConditionalExpression","status":"Survived","location":{"start":{"line":3,"column":1},"end":{"line":3,"column":9}}},{"mutatorName":"BooleanLiteral","status":"Killed"}]}}}\n' \
      > reports/mutation/mutation.json
    printf 'stryker run output\n'
    exit 0
    ;;
  run\ mutation:survivors*)
    shift 2
    if [ -n "${SLOW_DRIFT_SURVIVORS_EXIT:-}" ]; then
      printf 'survivors summarizer crashed (stub)\n' >&2
      exit "${SLOW_DRIFT_SURVIVORS_EXIT}"
    fi
    "${SLOW_DRIFT_REAL_BUN:-bun}" "${SLOW_DRIFT_REAL_REPO_ROOT:?}/scripts/mutation-survivors.ts" "$@"
    rc=$?
    if [ "$rc" -eq 0 ] && [ -n "${SLOW_DRIFT_SURVIVORS_DIR_SWAP:-}" ]; then
      # Swap the written artifact for a directory so prepend_metadata_header
      # hits its not-a-regular-file guard.
      out=""
      while [ "$#" -gt 0 ]; do
        case "$1" in
          --output)
            out="$2"
            shift 2
            ;;
          *)
            shift
            ;;
        esac
      done
      rm -f "$out"
      mkdir "$out"
      printf 'pad\n' > "$out/pad"
    fi
    exit "$rc"
    ;;
  run\ harness:audit*)
    shift 2
    if [ "${SLOW_DRIFT_REAL_HARNESS:-0}" = "1" ]; then
      "${SLOW_DRIFT_REAL_BUN:-bun}" "${SLOW_DRIFT_REAL_REPO_ROOT:?}/scripts/harness-audit.ts" "$@"
      exit $?
    fi
    write_report "$@"
    ;;
  run\ eval:lint-messages*)
    shift 2
    write_message_eval "$@"
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

slow_drift_output_dir() {
  printf '%s/reports/slow-drift' "$1"
}

assert_metadata_header() {
  local file="$1" expected_command="$2"

  grep -qF '# slow-drift generated-at: ' "$file" \
    || fail "metadata header missing generated-at in $file"
  grep -qF '# slow-drift head: ' "$file" \
    || fail "metadata header missing head in $file"
  grep -qF "# slow-drift command: $expected_command" "$file" \
    || fail "metadata header missing command [$expected_command] in $file"
  grep -qF '# slow-drift bun: 1.3.11' "$file" \
    || fail "metadata header missing bun version in $file"
  grep -qF 'if this recorded HEAD is not an ancestor of current HEAD' "$file" \
    || fail "metadata header missing staleness warning in $file"
}

run_slow_drift() {
  local repo="$1"
  (
    cd "$repo"
    SLOW_DRIFT_CALL_LOG="$repo/calls.log" \
      SLOW_DRIFT_REAL_BUN="${SLOW_DRIFT_REAL_BUN:-bun}" \
      SLOW_DRIFT_REAL_REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)" \
      MUSI_SLOW_DRIFT_BUN="$repo/bun-stub" \
      MUSI_SLOW_DRIFT_OUTPUT_DIR="$(slow_drift_output_dir "$repo")" \
      bash scripts/slow-drift-audit.sh
  )
}

run_slow_drift_with_output() {
  local repo="$1" output_dir="$2"
  (
    cd "$repo"
    SLOW_DRIFT_CALL_LOG="$repo/calls.log" \
      SLOW_DRIFT_REAL_BUN="${SLOW_DRIFT_REAL_BUN:-bun}" \
      SLOW_DRIFT_REAL_REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)" \
      MUSI_SLOW_DRIFT_BUN="$repo/bun-stub" \
      MUSI_SLOW_DRIFT_OUTPUT_DIR="$output_dir" \
      bash scripts/slow-drift-audit.sh
  )
}

bash -n "$SLOW_DRIFT" || fail "slow-drift-audit.sh fails bash -n"
ok "slow-drift-audit.sh passes bash -n"

repo="$(new_repo unsafe-output)"
unsafe_output="$SANDBOX/broad-output"
mkdir -p "$unsafe_output/envelopes" "$unsafe_output/producers" "$unsafe_output/fused"
printf 'keep\n' > "$unsafe_output/envelopes/sentinel.txt"
printf 'keep\n' > "$unsafe_output/producers/sentinel.txt"
printf 'keep\n' > "$unsafe_output/fused/sentinel.txt"
set +e
run_slow_drift_with_output "$repo" "$unsafe_output" >/dev/null 2>"$repo/error.log"
exit_code=$?
set -e
[ "$exit_code" -eq 2 ] || fail "unsafe output dir should exit 2, got $exit_code"
grep -qF 'refusing unsafe output directory outside' "$repo/error.log" \
  || fail "unsafe output dir should explain reports-root boundary"
[ -f "$unsafe_output/envelopes/sentinel.txt" ] \
  || fail "unsafe output guard deleted envelope sentinel"
[ -f "$unsafe_output/producers/sentinel.txt" ] \
  || fail "unsafe output guard deleted producer sentinel"
[ -f "$unsafe_output/fused/sentinel.txt" ] \
  || fail "unsafe output guard deleted fused sentinel"
ok "unsafe output root fails before deleting existing paths"

repo="$(new_repo reports-root-output)"
set +e
run_slow_drift_with_output "$repo" "$repo/reports" >/dev/null 2>"$repo/error.log"
exit_code=$?
set -e
[ "$exit_code" -eq 2 ] || fail "reports root output dir should exit 2, got $exit_code"
grep -qF 'resolves to reports root' "$repo/error.log" \
  || fail "reports root output dir should explain reports-root refusal"
ok "reports root output dir is refused"

repo="$(new_repo clean)"
out="$(slow_drift_output_dir "$repo")"
run_slow_drift "$repo" >/dev/null || fail "clean slow drift run should pass"
[ -s "$out/envelopes/lint-ratchet.json" ] || fail "lint:ratchet envelope missing"
[ -s "$out/envelopes/drift-ai.json" ] || fail "drift:ai envelope missing"
[ -s "$out/fused/harness-audit.txt" ] || fail "text fused report missing"
[ -s "$out/fused/harness-audit.json" ] || fail "json fused report missing"
[ -s "$out/message-eval/latest.md" ] || fail "lint message eval markdown missing"
[ -s "$out/message-eval/latest.json" ] || fail "lint message eval JSON missing"
assert_metadata_header "$out/producers/lint-ratchet.txt" "$repo/bun-stub run lint:ratchet"
assert_metadata_header "$out/producers/drift-ai.txt" "$repo/bun-stub run drift:ai --scope current --check all"
assert_metadata_header "$out/producers/logs-audit.txt" "logs:audit skipped: no MUSI_SLOW_DRIFT_LOG_FILES"
assert_metadata_header "$out/envelopes/lint-ratchet.json.meta.txt" "$repo/bun-stub run lint:ratchet"
assert_metadata_header "$out/fused/harness-audit.txt" "$repo/bun-stub run harness:audit --format text --output $out/fused/harness-audit.txt $out/envelopes/lint-ratchet.json $out/envelopes/drift-ai.json"
assert_metadata_header "$out/fused/harness-audit.json.meta.txt" "$repo/bun-stub run harness:audit --format json --output $out/fused/harness-audit.json $out/envelopes/lint-ratchet.json $out/envelopes/drift-ai.json"
grep -qF 'fused text' "$out/fused/harness-audit.txt" \
  || fail "text fused report should keep original body after metadata header"
grep -qF 'run harness:audit --format text --output' "$repo/calls.log" \
  || fail "harness:audit text call missing"
grep -qF 'run eval:lint-messages --output' "$repo/calls.log" \
  || fail "lint message eval call missing"
grep -qF 'no logs:audit inputs supplied' "$out/producers/logs-audit.txt" \
  || fail "logs:audit skip note missing"
ok "clean run writes producer envelopes and fused reports"

[ -s "$out/fused/timings.txt" ] || fail "timings artifact missing"
assert_metadata_header "$out/fused/timings.txt" \
  "slow-drift step timings (wall-clock seconds; trend evidence, report-only)"
grep -qE '^timing: lint:ratchet [0-9]+s exit=0$' "$out/fused/timings.txt" \
  || fail "lint:ratchet timing line missing"
grep -qE '^timing: drift:ai [0-9]+s exit=0$' "$out/fused/timings.txt" \
  || fail "drift:ai timing line missing"
grep -qE '^timing: lint-message-eval [0-9]+s exit=0$' "$out/fused/timings.txt" \
  || fail "lint-message-eval timing line missing"
ok "clean run records per-step wall-clock timings"

repo="$(new_repo broken-timings)"
out="$(slow_drift_output_dir "$repo")"
SLOW_DRIFT_BREAK_TIMINGS=1 run_slow_drift "$repo" >"$repo/stdout.log" 2>"$repo/error.log" \
  || fail "unwritable timings file must not abort the lane"
grep -qF 'slow-drift: lint:ratchet completed' "$repo/stdout.log" \
  || fail "step status should still be classified when the timing append fails"
[ -s "$out/fused/harness-audit.txt" ] \
  || fail "fused report should still be written when the timing append fails"
[ -s "$out/fused/harness-audit.json" ] \
  || fail "json fused report should still be written when the timing append fails"
[ -d "$out/fused/timings.txt" ] \
  || fail "broken-timings scenario should actually have replaced the timings file"
ok "timing append failure stays best-effort and never replaces the step status"

repo="$(new_repo skip-drift)"
out="$(slow_drift_output_dir "$repo")"
MUSI_SLOW_DRIFT_SKIP="drift:ai" run_slow_drift "$repo" >/dev/null \
  || fail "run with a skipped producer should still pass"
if grep -qF 'run drift:ai' "$repo/calls.log"; then
  fail "skipped drift:ai should not be invoked"
fi
[ ! -e "$out/envelopes/drift-ai.json" ] \
  || fail "skipped producer should not write an envelope"
grep -qF 'timing: drift:ai skipped' "$out/fused/timings.txt" \
  || fail "skipped producer timing line missing"
grep -qF 'drift:ai skipped via MUSI_SLOW_DRIFT_SKIP' "$out/producers/drift-ai.txt" \
  || fail "skip note missing from producer output"
grep -qE '^timing: lint:ratchet [0-9]+s exit=0$' "$out/fused/timings.txt" \
  || fail "non-skipped producer should still record timing"
ok "MUSI_SLOW_DRIFT_SKIP disables a producer without failing the lane"

repo="$(new_repo step-timeout)"
out="$(slow_drift_output_dir "$repo")"
set +e
SLOW_DRIFT_LINT_SLEEP=5 MUSI_SLOW_DRIFT_STEP_TIMEOUT_SECS=1 \
  run_slow_drift "$repo" >/dev/null 2>"$repo/error.log"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] \
  || fail "timed-out producer should fail the lane as an infrastructure error"
grep -qF 'lint:ratchet hit the 1s step timeout' "$repo/error.log" \
  || fail "step-timeout note missing"
grep -qE '^timing: lint:ratchet [0-9]+s exit=124$' "$out/fused/timings.txt" \
  || fail "timed-out producer should record exit=124 timing"
ok "MUSI_SLOW_DRIFT_STEP_TIMEOUT_SECS bounds a hung producer"

repo="$(new_repo mutation-disabled)"
out="$(slow_drift_output_dir "$repo")"
run_slow_drift "$repo" >/dev/null || fail "mutation-disabled run should pass"
if grep -qF 'run test:mutation' "$repo/calls.log"; then
  fail "mutation step should not run without MUSI_SLOW_DRIFT_MUTATION=1"
fi
grep -qF 'mutation step disabled' "$out/producers/mutation.txt" \
  || fail "mutation disabled note missing"
grep -qF 'timing: mutation skipped' "$out/fused/timings.txt" \
  || fail "disabled mutation timing line missing"
ok "mutation step stays off by default"

repo="$(new_repo mutation-enabled)"
out="$(slow_drift_output_dir "$repo")"
MUSI_SLOW_DRIFT_MUTATION=1 run_slow_drift "$repo" >/dev/null \
  || fail "mutation-enabled run should pass"
grep -qF 'run test:mutation --mutate' "$repo/calls.log" \
  || fail "scoped mutation invocation missing from call log"
[ -s "$out/fused/mutation-survivors.txt" ] \
  || fail "mutation survivors artifact missing"
grep -qF 'mutation-survivors: 2 mutants' "$out/fused/mutation-survivors.txt" \
  || fail "survivor summary body missing"
grep -qF 'packages/shared/src/rules/foo.ts: 1 survived' "$out/fused/mutation-survivors.txt" \
  || fail "survivor summary should rank the surviving file"
grep -qF '# slow-drift command: ' "$out/fused/mutation-survivors.txt" \
  || fail "survivor summary metadata header missing"
grep -qE '^timing: mutation [0-9]+s exit=0$' "$out/fused/timings.txt" \
  || fail "mutation timing line missing"
ok "enabled mutation step summarizes survivors into the fused artifacts"

repo="$(new_repo mutation-crash)"
out="$(slow_drift_output_dir "$repo")"
mkdir -p "$repo/reports/mutation"
printf '{"files":{}}\n' > "$repo/reports/mutation/mutation.json"
MUSI_SLOW_DRIFT_MUTATION=1 SLOW_DRIFT_MUTATION_EXIT=2 \
  run_slow_drift "$repo" >"$repo/stdout.log" \
  || fail "mutation crash must stay report-only and not fail the lane"
grep -qF 'mutation step exited 2 (report-only; lane continues)' "$repo/stdout.log" \
  || fail "mutation crash note missing"
[ ! -e "$out/fused/mutation-survivors.txt" ] \
  || fail "crashed mutation run should not produce a survivors artifact"
[ ! -e "$repo/reports/mutation/mutation.json" ] \
  || fail "stale mutation.json should be removed before the mutation run so a crash cannot resurface it"
grep -qE '^timing: mutation [0-9]+s exit=2$' "$out/fused/timings.txt" \
  || fail "crashed mutation timing line missing"
ok "mutation step failure leaves a note, removes stale reports, and the lane continues"

repo="$(new_repo mutation-skip-knob)"
out="$(slow_drift_output_dir "$repo")"
MUSI_SLOW_DRIFT_MUTATION=1 MUSI_SLOW_DRIFT_SKIP=mutation run_slow_drift "$repo" >/dev/null \
  || fail "enabled-but-skipped mutation run should pass"
if grep -qF 'run test:mutation' "$repo/calls.log"; then
  fail "mutation skipped via MUSI_SLOW_DRIFT_SKIP should not invoke stryker"
fi
grep -qF 'mutation skipped via MUSI_SLOW_DRIFT_SKIP' "$out/producers/mutation.txt" \
  || fail "skip-by-knob note missing from mutation producer output"
if grep -qF 'MUSI_SLOW_DRIFT_MUTATION not enabled' "$out/producers/mutation.txt"; then
  fail "skip-by-knob note must not claim mutation is not enabled"
fi
grep -qF 'timing: mutation skipped' "$out/fused/timings.txt" \
  || fail "skipped mutation timing line missing"
ok "enabled-but-skipped mutation notes the skip knob, not the enable flag"

repo="$(new_repo mutation-timeout)"
out="$(slow_drift_output_dir "$repo")"
MUSI_SLOW_DRIFT_MUTATION=1 SLOW_DRIFT_MUTATION_EXIT=124 \
  run_slow_drift "$repo" >"$repo/stdout.log" \
  || fail "mutation timeout must stay report-only and not fail the lane"
grep -qF 'mutation step hit the 1800s timeout (report-only; lane continues)' "$repo/stdout.log" \
  || fail "mutation timeout note missing"
[ ! -e "$out/fused/mutation-survivors.txt" ] \
  || fail "timed-out mutation run should not produce a survivors artifact"
ok "mutation timeout leaves a timeout-classified note and the lane continues"

repo="$(new_repo mutation-term-ignoring)"
out="$(slow_drift_output_dir "$repo")"
SLOW_DRIFT_MUTATION_SLEEP=10 SLOW_DRIFT_MUTATION_IGNORE_TERM=1 \
  MUSI_SLOW_DRIFT_MUTATION=1 MUSI_SLOW_DRIFT_MUTATION_TIMEOUT_SECS=1 \
  MUSI_SLOW_DRIFT_STEP_KILL_AFTER_SECS=1 \
  run_slow_drift "$repo" >"$repo/stdout.log" \
  || fail "SIGKILLed mutation timeout must stay report-only and not fail the lane"
grep -qF 'mutation step was SIGKILLed after the 1s kill-after (exit 137; report-only; lane continues)' \
  "$repo/stdout.log" \
  || fail "mutation exit-137 kill classification note missing"
grep -qE '^timing: mutation [0-9]+s exit=137$' "$out/fused/timings.txt" \
  || fail "SIGKILLed mutation should record exit=137 timing"
[ ! -e "$out/fused/mutation-survivors.txt" ] \
  || fail "SIGKILLed mutation run should not produce a survivors artifact"
ok "TERM-ignoring mutation is SIGKILLed after the kill-after bound and stays report-only"

repo="$(new_repo survivors-fail)"
out="$(slow_drift_output_dir "$repo")"
MUSI_SLOW_DRIFT_MUTATION=1 SLOW_DRIFT_SURVIVORS_EXIT=3 \
  run_slow_drift "$repo" >"$repo/stdout.log" \
  || fail "survivor summarizer failure must stay report-only when stryker succeeded"
grep -qF 'mutation survivor summary failed with exit 3 (report-only; lane continues)' "$repo/stdout.log" \
  || fail "summarizer failure note missing"
[ ! -s "$out/fused/mutation-survivors.txt" ] \
  || fail "failed summarizer should not leave a survivors artifact"
[ -s "$out/fused/harness-audit.txt" ] \
  || fail "fused report should still be written after a summarizer failure"
ok "summarizer failure after a successful mutation run stays report-only"

repo="$(new_repo prepend-fail)"
out="$(slow_drift_output_dir "$repo")"
MUSI_SLOW_DRIFT_MUTATION=1 SLOW_DRIFT_SURVIVORS_DIR_SWAP=1 \
  run_slow_drift "$repo" >"$repo/stdout.log" \
  || fail "survivors metadata prepend failure must not fail the lane"
grep -qF 'could not prepend metadata header' "$repo/stdout.log" \
  || fail "prepend best-effort note missing"
[ -s "$out/fused/harness-audit.txt" ] \
  || fail "fused report should still be written after a prepend failure"
ok "survivors metadata prepend failure is best-effort and the lane continues"

repo="$(new_repo skip-all)"
out="$(slow_drift_output_dir "$repo")"
MUSI_SLOW_DRIFT_SKIP="lint:ratchet,drift:ai,lint-message-eval" \
  run_slow_drift "$repo" >"$repo/stdout.log" \
  || fail "deliberate skip-all run should end green"
grep -qF 'all envelope producers were skipped via MUSI_SLOW_DRIFT_SKIP; nothing to fuse' "$repo/stdout.log" \
  || fail "skip-all note missing"
if grep -qF 'run harness:audit' "$repo/calls.log"; then
  fail "fusion should not run when every envelope producer is skipped"
fi
ok "deliberate skip-all degrades to a noted green lane without fusion"

repo="$(new_repo unknown-skip)"
MUSI_SLOW_DRIFT_SKIP="bogus-step drift:ai" run_slow_drift "$repo" >/dev/null 2>"$repo/error.log" \
  || fail "unknown skip name must warn and continue, not fail the lane"
grep -qF 'unknown MUSI_SLOW_DRIFT_SKIP step "bogus-step" ignored' "$repo/error.log" \
  || fail "unknown skip name warning missing"
grep -qF 'run lint:ratchet' "$repo/calls.log" \
  || fail "non-skipped steps should still run alongside an unknown skip name"
ok "unknown skip names warn and are otherwise ignored"

repo="$(new_repo invalid-timeout)"
MUSI_SLOW_DRIFT_STEP_TIMEOUT_SECS=abc run_slow_drift "$repo" >/dev/null 2>"$repo/error.log" \
  || fail "invalid step timeout must warn and use the default, not fail the lane"
grep -qF 'invalid MUSI_SLOW_DRIFT_STEP_TIMEOUT_SECS "abc"' "$repo/error.log" \
  || fail "invalid step timeout warning missing"
ok "invalid step timeout warns and falls back to the unlimited default"

repo="$(new_repo term-ignoring)"
out="$(slow_drift_output_dir "$repo")"
set +e
SLOW_DRIFT_LINT_SLEEP=10 SLOW_DRIFT_LINT_IGNORE_TERM=1 \
  MUSI_SLOW_DRIFT_STEP_TIMEOUT_SECS=1 MUSI_SLOW_DRIFT_STEP_KILL_AFTER_SECS=1 \
  run_slow_drift "$repo" >/dev/null 2>"$repo/error.log"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] \
  || fail "SIGKILLed producer should fail the lane as an infrastructure error"
grep -qF 'was killed (exit 137) after ignoring the 1s step timeout' "$repo/error.log" \
  || fail "exit-137 kill classification note missing"
grep -qE '^timing: lint:ratchet [0-9]+s exit=137$' "$out/fused/timings.txt" \
  || fail "SIGKILLed producer should record exit=137 timing"
ok "TERM-ignoring producer is SIGKILLed after the kill-after bound and classified as 137"

repo="$(new_repo skip-message-eval)"
out="$(slow_drift_output_dir "$repo")"
MUSI_SLOW_DRIFT_SKIP=lint-message-eval run_slow_drift "$repo" >/dev/null \
  || fail "skipping lint-message-eval should still pass"
if grep -qF 'run eval:lint-messages' "$repo/calls.log"; then
  fail "skipped lint-message-eval should not be invoked"
fi
grep -qF 'lint-message-eval skipped via MUSI_SLOW_DRIFT_SKIP' "$out/producers/lint-message-eval.txt" \
  || fail "lint-message-eval skip note missing"
grep -qF 'timing: lint-message-eval skipped' "$out/fused/timings.txt" \
  || fail "skipped lint-message-eval timing line missing"
ok "MUSI_SLOW_DRIFT_SKIP disables the lint message eval without failing the lane"

repo="$(new_repo report-only-findings)"
SLOW_DRIFT_LINT_EXIT=1 run_slow_drift "$repo" >/dev/null \
  || fail "producer exit 1 should not fail report-only lane"
grep -qF 'run harness:audit --format json --output' "$repo/calls.log" \
  || fail "report-only findings should still reach harness:audit"
ok "producer exit 1 continues to fused report"

repo="$(new_repo logs-configured)"
out="$(slow_drift_output_dir "$repo")"
MUSI_SLOW_DRIFT_LOG_FILES=$'logs/one.jsonl\nlogs/two.jsonl' run_slow_drift "$repo" >/dev/null \
  || fail "logs-configured slow drift run should pass"
grep -qF 'run logs:audit --file logs/one.jsonl --file logs/two.jsonl' "$repo/calls.log" \
  || fail "logs:audit did not receive configured log files"
[ -s "$out/envelopes/logs-audit.json" ] || fail "logs:audit envelope missing"
assert_metadata_header "$out/envelopes/logs-audit.json.meta.txt" "$repo/bun-stub run logs:audit --file logs/one.jsonl --file logs/two.jsonl"
ok "configured logs:audit inputs are included in fusion"

repo="$(new_repo real-harness-fusion)"
out="$(slow_drift_output_dir "$repo")"
SLOW_DRIFT_REAL_HARNESS=1 run_slow_drift "$repo" >/dev/null \
  || fail "real harness:audit slow drift fusion should pass"
grep -qF '"failures": []' "$out/fused/harness-audit.json" \
  || fail "real harness:audit JSON should have no envelope failures"
grep -qF '"envelopes": 2' "$out/fused/harness-audit.json" \
  || fail "real harness:audit JSON should count lint and drift envelopes"
if grep -qF '# slow-drift' "$out/fused/harness-audit.json"; then
  fail "JSON fused report should stay parseable JSON; metadata belongs in sidecar"
fi
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
