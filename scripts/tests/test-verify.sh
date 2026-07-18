#!/usr/bin/env bash
# smoke-order: 010
# smoke-subjects: scripts/verify.sh
# smoke-subjects: scripts/verify/steps.generated.sh
# smoke-subjects: scripts/verify/steps-lib.sh
# smoke-subjects: scripts/verify/memory-budget.sh
# smoke-subjects: scripts/verify/admitted-command.sh
# smoke-subjects: scripts/lib/verify-metadata.sh
# smoke-subjects: scripts/path-policy/path-policy-query.ts
# smoke-subjects: scripts/path-policy/path-policy-query-core.ts
# smoke-subjects: scripts/path-policy/path-policy.ts
# smoke-subjects: scripts/process-tree.sh
# smoke-subjects: scripts/lib/parallel-step.sh
# smoke-subjects: scripts/lib/verify-engine.sh
# smoke-subjects: scripts/lib/test-worker-count.sh
# smoke-subjects: scripts/lib/changed-base.sh
# smoke-subjects: scripts/lib/gate-env.sh
# smoke-subjects: scripts/lib/lint-dist-preflight.sh
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/test-verify.sh
# smoke-subjects: scripts/ai-hooks/cache.sh
# smoke-subjects: scripts/ai-hooks/common.sh
# smoke-subjects: scripts/ai-hooks/output-filter.sh
# test-verify.sh — pure-shell smoke tests for scripts/verify.sh.
#
# Stubs `bun` so the script never actually runs lint/typecheck/test. Verifies
# argument parsing, the cache short-circuit, FORCE_VERIFY=1 bypass, changed
# parallel failure aggregation, and the failure summary shape. Run via
# `bash scripts/tests/test-verify.sh`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
VERIFY="$SCRIPT_DIR/../verify.sh"

if [ -z "${MUSI_PATH_POLICY_QUERY:-}" ]; then
  export MUSI_PATH_POLICY_QUERY="$SCRIPT_DIR/../path-policy/path-policy-query.ts"
fi
if [ -z "${MUSI_PATH_POLICY_BUN:-}" ]; then
  MUSI_PATH_POLICY_BUN="$(command -v bun)"
  export MUSI_PATH_POLICY_BUN
fi

if [ "${MUSI_TEST_VERIFY_IN_FIXTURE:-}" != "1" ]; then
  FIXTURE_ROOT="$(mktemp -d /tmp/musi-verify-smoke-repo.XXXXXX)"
  mkdir -p \
    "$FIXTURE_ROOT/scripts/ai-hooks" \
    "$FIXTURE_ROOT/scripts/lib" \
    "$FIXTURE_ROOT/scripts/tests/lib" \
    "$FIXTURE_ROOT/scripts/verify" \
    "$FIXTURE_ROOT/packages/shared/dist/dice" \
    "$FIXTURE_ROOT/packages/shared/dist/map" \
    "$FIXTURE_ROOT/packages/shared/dist/rules" \
    "$FIXTURE_ROOT/packages/shared/dist/schemas" \
    "$FIXTURE_ROOT/packages/shared/dist/test" \
    "$FIXTURE_ROOT/packages/server/dist/routers"
  cp "$SCRIPT_DIR/../verify.sh" "$SCRIPT_DIR/../process-tree.sh" "$FIXTURE_ROOT/scripts/"
  cp "$SCRIPT_DIR/test-verify.sh" "$FIXTURE_ROOT/scripts/tests/test-verify.sh"
  cp "$SCRIPT_DIR/lib/test-git-env.sh" "$FIXTURE_ROOT/scripts/tests/lib/"
  cp "$SCRIPT_DIR/../lib/verify-metadata.sh" "$SCRIPT_DIR/../lib/parallel-step.sh" \
    "$SCRIPT_DIR/../lib/lint-dist-preflight.sh" "$SCRIPT_DIR/../lib/gate-env.sh" \
    "$SCRIPT_DIR/../lib/changed-base.sh" \
    "$SCRIPT_DIR/../lib/verify-engine.sh" \
    "$SCRIPT_DIR/../lib/test-worker-count.sh" \
    "$FIXTURE_ROOT/scripts/lib/"
  cp "$SCRIPT_DIR/../ai-hooks/cache.sh" "$SCRIPT_DIR/../ai-hooks/common.sh" \
    "$SCRIPT_DIR/../ai-hooks/output-filter.sh" \
    "$FIXTURE_ROOT/scripts/ai-hooks/"
  cp "$SCRIPT_DIR/../verify/steps.generated.sh" "$SCRIPT_DIR/../verify/steps-lib.sh" \
    "$SCRIPT_DIR/../verify/memory-budget.sh" "$SCRIPT_DIR/../verify/admitted-command.sh" \
    "$FIXTURE_ROOT/scripts/verify/"
  touch "$FIXTURE_ROOT/packages/shared/dist/constants.d.ts"
  touch "$FIXTURE_ROOT/packages/shared/dist/dice/dice-roller.d.ts"
  touch "$FIXTURE_ROOT/packages/shared/dist/map/drawing.d.ts"
  touch "$FIXTURE_ROOT/packages/shared/dist/rules/attack-damage.d.ts"
  touch "$FIXTURE_ROOT/packages/shared/dist/schemas/auth.d.ts"
  touch "$FIXTURE_ROOT/packages/shared/dist/test/parse-helpers.d.ts"
  touch "$FIXTURE_ROOT/packages/server/dist/routers/app-router.d.ts"
  printf 'packages/*/dist/\n' > "$FIXTURE_ROOT/.gitignore"
  (
    cd "$FIXTURE_ROOT"
    git init -q -b main
    git config user.email test@example.invalid
    git config user.name Test
    git add scripts .gitignore
    git commit -qm init
    MUSI_TEST_VERIFY_IN_FIXTURE=1 bash scripts/tests/test-verify.sh
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
write_live_memory_reservation() {
  local token="$1" mb="$2" slot="$3" owner_pid owner_start_time
  owner_pid="$BASHPID"
  owner_start_time="$(awk '{ print $22 }' "/proc/$owner_pid/stat")"
  printf 'pid=%s\npid_start_time=%s\nmb=%s\nslot=%s\n' \
    "$owner_pid" "$owner_start_time" "$mb" "$slot" > "$token"
}
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
  var_ignore_term="STUB_IGNORE_TERM_${safe_name}"
  var_late_fork="STUB_LATE_FORK_${safe_name}"
  if [ -n "${!var_sleep:-}" ]; then
    sleep_pid=""
    [ -n "${STUB_PID_LOG:-}" ] && printf '%s\n' "$$" >> "$STUB_PID_LOG"
    if [ "${!var_ignore_term:-0}" = "1" ]; then
      trap '' TERM
    fi
    sleep "${!var_sleep}" &
    sleep_pid=$!
    [ -n "${STUB_PID_LOG:-}" ] && printf '%s\n' "$sleep_pid" >> "$STUB_PID_LOG"
    if [ "${!var_late_fork:-0}" = "1" ]; then
      late_fork_on_term() {
        bash -c 'trap "" TERM; printf "%s\n" "$BASHPID" > "$STUB_LATE_PID_FILE"; while :; do sleep 1; done' &
        kill "$sleep_pid" 2>/dev/null || true
        wait "$sleep_pid" 2>/dev/null || true
        exit 143
      }
      trap late_fork_on_term TERM
    else
      trap 'kill "$sleep_pid" 2>/dev/null || true; wait "$sleep_pid" 2>/dev/null || true; exit 143' TERM
    fi
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
  MUSI_VERIFY_MEMORY_STATE_ROOT="$SANDBOX/memory-state" \
  MUSI_VERIFY_MARKER_CHANGED="$MARKER_CHANGED" \
  MUSI_VERIFY_MARKER_FULL="$MARKER_FULL" \
    bash "$VERIFY" "$@"
}

run_verify_state_root() {
  STUB_LOG="$STUB_LOG_FILE" \
  PATH="$SANDBOX/bin:$PATH" \
  MUSI_VERIFY_STATE_ROOT="$1" \
    bash "$VERIFY" "${@:2}"
}

write_required_dist_outputs() {
  mkdir -p \
    packages/shared/dist/dice \
    packages/shared/dist/map \
    packages/shared/dist/rules \
    packages/shared/dist/schemas \
    packages/shared/dist/test \
    packages/server/dist/routers
  touch packages/shared/dist/constants.d.ts
  touch packages/shared/dist/dice/dice-roller.d.ts
  touch packages/shared/dist/map/drawing.d.ts
  touch packages/shared/dist/rules/attack-damage.d.ts
  touch packages/shared/dist/schemas/auth.d.ts
  touch packages/shared/dist/test/parse-helpers.d.ts
  touch packages/server/dist/routers/app-router.d.ts
}

remove_required_dist_outputs() {
  rm -rf packages/shared/dist packages/server/dist
}

. "$SCRIPT_DIR/../lib/verify-metadata.sh"

# --- syntax / argument parsing --------------------------------------------
bash -n "$VERIFY" || fail "verify.sh fails bash -n"
ok "verify.sh passes bash -n"

(
  unset NODE_OPTIONS MUSI_GATE_NODE_OLD_SPACE_MB
  # shellcheck source=../lib/gate-env.sh
  . "$SCRIPT_DIR/../lib/gate-env.sh"
  [ "$NODE_OPTIONS" = "--max-old-space-size=$MUSI_GATE_DEFAULT_NODE_OLD_SPACE_MB" ] \
    || fail "gate-env should apply the default old-space size: $NODE_OPTIONS"
)

(
  export NODE_OPTIONS="--trace-warnings --max-old-space-size=8192"
  # shellcheck source=../lib/gate-env.sh
  . "$SCRIPT_DIR/../lib/gate-env.sh"
  [ "$NODE_OPTIONS" = "--trace-warnings --max-old-space-size=8192" ] \
    || fail "gate-env should preserve caller-provided old-space size: $NODE_OPTIONS"
)

(
  export NODE_OPTIONS="--trace-warnings"
  export MUSI_GATE_NODE_OLD_SPACE_MB=2048
  # shellcheck source=../lib/gate-env.sh
  . "$SCRIPT_DIR/../lib/gate-env.sh"
  [ "$NODE_OPTIONS" = "--trace-warnings --max-old-space-size=2048" ] \
    || fail "gate-env should honor the shared override size: $NODE_OPTIONS"
)
ok "gate-env applies managed NODE_OPTIONS defaults"

# --- memory-budget unit policy --------------------------------------------
(
  # shellcheck source=../verify/memory-budget.sh
  . "$SCRIPT_DIR/../verify/memory-budget.sh"
  export MUSI_VERIFY_MEMORY_STATE_ROOT="$SANDBOX/memory-unit-state"
  export MUSI_VERIFY_MEMORY_AVAILABLE_MB=7500
  export MUSI_VERIFY_MEMORY_SAFETY_MB=1000
  unset NON_SERVER_TEST_MAX_WORKERS VITEST_MAX_WORKERS

  [ "$(musi_verify_slot_expected_peak_mb lint)" -eq 3700 ] \
    || fail "lint expected peak must stay rounded up from leaf 76"
  [ "$(musi_verify_slot_expected_peak_mb test)" -eq 3200 ] \
    || fail "test expected peak must stay rounded up from leaf 77"
  [ "$(musi_verify_slot_expected_peak_mb scripts)" -eq 2470 ] \
    || fail "scripts expected peak must stay seeded from note 73"
  [ "$(musi_verify_slot_expected_peak_mb ratchet)" -eq 2210 ] \
    || fail "ratchet expected peak must stay seeded from note 73"
  [ "$(musi_verify_slot_expected_peak_mb unmeasured-slot)" -eq 256 ] \
    || fail "unmeasured slots should use the documented accounting floor"

  export NON_SERVER_TEST_MAX_WORKERS=4
  [ "$(musi_verify_slot_expected_peak_mb test)" -eq 3200 ] \
    || fail "a lower worker override should keep the measured reservation"
  export NON_SERVER_TEST_MAX_WORKERS=6
  [ "$(musi_verify_slot_expected_peak_mb test)" -eq 3200 ] \
    || fail "the measured worker cap should keep the measured reservation"
  export NON_SERVER_TEST_MAX_WORKERS=7
  [ "$(musi_verify_slot_expected_peak_mb test)" -eq 5580 ] \
    || fail "an elevated worker override must use the conservative reservation"
  [ "$(musi_verify_slot_expected_peak_mb lint)" -eq 3700 ] \
    || fail "the worker override must not alter another slot reservation"
  export NON_SERVER_TEST_MAX_WORKERS=""
  [ "$(musi_verify_slot_expected_peak_mb test)" -eq 5580 ] \
    || fail "an invalid worker override must fail closed for admission"
  export NON_SERVER_TEST_MAX_WORKERS=999999999999999999999
  [ "$(musi_verify_slot_expected_peak_mb test)" -eq 5580 ] \
    || fail "an unknown worker override must fail closed for admission"
  export NON_SERVER_TEST_MAX_WORKERS=60
  [ "$(musi_verify_slot_expected_peak_mb test)" -eq 5580 ] \
    || fail "a large parser-rejected worker override must fail closed for admission"
  unset NON_SERVER_TEST_MAX_WORKERS

  export VITEST_MAX_WORKERS=4
  [ "$(musi_verify_slot_expected_peak_mb test)" -eq 3200 ] \
    || fail "a lower native worker override should keep the measured reservation"
  export VITEST_MAX_WORKERS=8
  [ "$(musi_verify_slot_expected_peak_mb test)" -eq 5580 ] \
    || fail "an elevated native worker override must use the conservative reservation"
  export VITEST_MAX_WORKERS=60
  [ "$(musi_verify_slot_expected_peak_mb test)" -eq 5580 ] \
    || fail "a large native worker override must fail closed for admission"

  export NON_SERVER_TEST_MAX_WORKERS=8 VITEST_MAX_WORKERS=4
  [ "$(musi_verify_slot_expected_peak_mb test)" -eq 3200 ] \
    || fail "native worker precedence must use its lower effective reservation"
  export NON_SERVER_TEST_MAX_WORKERS=4 VITEST_MAX_WORKERS=8
  [ "$(musi_verify_slot_expected_peak_mb test)" -eq 5580 ] \
    || fail "native worker precedence must use its elevated effective reservation"
  unset NON_SERVER_TEST_MAX_WORKERS VITEST_MAX_WORKERS

  # shellcheck disable=SC2034 # Read by sourced memory-budget.sh.
  MUSI_TEST_CLI_MAX_WORKERS=4 VITEST_MAX_WORKERS=8
  [ "$(musi_verify_slot_expected_peak_mb test)" -eq 5580 ] \
    || fail "native worker env must outrank a lower CLI worker value"
  # shellcheck disable=SC2034 # Read by sourced memory-budget.sh.
  MUSI_TEST_CLI_MAX_WORKERS=8 VITEST_MAX_WORKERS=4
  [ "$(musi_verify_slot_expected_peak_mb test)" -eq 3200 ] \
    || fail "native worker env must outrank an elevated CLI worker value"
  unset MUSI_TEST_CLI_MAX_WORKERS VITEST_MAX_WORKERS

  export MUSI_CLIENT_FAST_LANE_MAX_WORKERS=4
  [ "$(musi_verify_slot_expected_peak_mb test)" -eq 3200 ] \
    || fail "the default fast-lane cap should keep the measured reservation"
  export MUSI_CLIENT_FAST_LANE_MAX_WORKERS=8
  [ "$(musi_verify_slot_expected_peak_mb test)" -eq 5580 ] \
    || fail "an inherited elevated fast-lane cap must use the conservative reservation"
  export MUSI_CLIENT_FAST_LANE_MAX_WORKERS=60
  [ "$(musi_verify_slot_expected_peak_mb test)" -eq 5580 ] \
    || fail "an invalid fast-lane cap must fail closed for admission"
  unset MUSI_CLIENT_FAST_LANE_MAX_WORKERS

  export NON_SERVER_TEST_MAX_WORKERS=8
  musi_memory_budget_try_reserve test \
    || fail "an elevated worker override should reserve on an idle host"
  elevated_test_token="$MUSI_VERIFY_MEMORY_RESERVATION_TOKEN"
  grep -qx 'mb=5580' "$elevated_test_token" \
    || fail "the elevated worker reservation token must charge 5580 MB"
  musi_memory_budget_release "$elevated_test_token"
  unset NON_SERVER_TEST_MAX_WORKERS

  musi_memory_budget_try_reserve test || fail "first heavy slot should reserve"
  test_token="$MUSI_VERIFY_MEMORY_RESERVATION_TOKEN"
  if musi_memory_budget_try_reserve lint; then
    fail "lint should defer when test plus lint exceeds available memory"
  fi
  musi_memory_budget_release "$test_token"
  musi_memory_budget_try_reserve lint || fail "lint should reserve after test releases"
  lint_token="$MUSI_VERIFY_MEMORY_RESERVATION_TOKEN"
  musi_memory_budget_release "$lint_token"

  export MUSI_VERIFY_MEMORY_AVAILABLE_MB=16000
  musi_memory_budget_try_reserve test || fail "test should reserve on an idle host"
  test_token="$MUSI_VERIFY_MEMORY_RESERVATION_TOKEN"
  musi_memory_budget_try_reserve lint \
    || fail "lint should launch alongside test when memory is plentiful"
  lint_token="$MUSI_VERIFY_MEMORY_RESERVATION_TOKEN"
  musi_memory_budget_release "$test_token"
  musi_memory_budget_release "$lint_token"

  # Rollout compatibility is conservative: reservations written before owner
  # start times were recorded, or whose live owner identity is temporarily
  # unreadable, must stay charged. Only a positive identity mismatch is stale.
  identity_owner_pid=""
  trap '[ -z "$identity_owner_pid" ] || { kill "$identity_owner_pid" 2>/dev/null || true; wait "$identity_owner_pid" 2>/dev/null || true; }' EXIT
  sleep 60 &
  identity_owner_pid=$!
  identity_owner_start_time="$(awk '{ print $22 }' "/proc/$identity_owner_pid/stat")"
  export MUSI_VERIFY_MEMORY_AVAILABLE_MB=6000
  legacy_token="$MUSI_VERIFY_MEMORY_STATE_ROOT/reservation.legacy-live"
  printf 'pid=%s\nmb=3000\nslot=legacy\n' "$identity_owner_pid" > "$legacy_token"
  if musi_memory_budget_try_reserve lint; then
    fail "live legacy reservation without start identity must stay accounted"
  fi
  [ -e "$legacy_token" ] || fail "live legacy reservation was reclaimed"
  rm -f "$legacy_token"

  unreadable_token="$MUSI_VERIFY_MEMORY_STATE_ROOT/reservation.unreadable-live"
  printf 'pid=%s\npid_start_time=%s\nmb=3000\nslot=unreadable\n' \
    "$identity_owner_pid" "$identity_owner_start_time" > "$unreadable_token"
  fake_proc_root="$SANDBOX/memory-unit-proc"
  reservation_caller_pid="$BASHPID"
  mkdir -p "$fake_proc_root/$reservation_caller_pid"
  cp "/proc/$reservation_caller_pid/stat" "$fake_proc_root/$reservation_caller_pid/stat"
  export MUSI_VERIFY_PROC_ROOT="$fake_proc_root"
  if musi_memory_budget_try_reserve lint; then
    fail "live reservation with unreadable start identity must stay accounted"
  fi
  [ -e "$unreadable_token" ] || fail "live unreadable reservation was reclaimed"
  rm -f "$unreadable_token"
  unset MUSI_VERIFY_PROC_ROOT

  mismatch_token="$MUSI_VERIFY_MEMORY_STATE_ROOT/reservation.identity-mismatch"
  printf 'pid=%s\npid_start_time=%s\nmb=3000\nslot=mismatch\n' \
    "$identity_owner_pid" "$((identity_owner_start_time + 1))" > "$mismatch_token"
  musi_memory_budget_try_reserve lint \
    || fail "start-time mismatch should be reclaimed as positive stale evidence"
  lint_token="$MUSI_VERIFY_MEMORY_RESERVATION_TOKEN"
  [ ! -e "$mismatch_token" ] || fail "start-time mismatch was not reclaimed"
  musi_memory_budget_release "$lint_token"
  kill "$identity_owner_pid" 2>/dev/null || true
  wait "$identity_owner_pid" 2>/dev/null || true
  identity_owner_pid=""
  trap - EXIT

  # Once a reserved process has ramped up, its RSS is already absent from
  # MemAvailable. Add that live RSS back before charging the peak reservation,
  # otherwise a plentiful 12 GB baseline incorrectly serializes test + lint.
  export MUSI_VERIFY_MEMORY_AVAILABLE_MB=12000
  unset MUSI_VERIFY_MEMORY_LIVE_RESERVED_RSS_MB
  musi_memory_budget_try_reserve test || fail "test should reserve before RSS ramp"
  test_token="$MUSI_VERIFY_MEMORY_RESERVATION_TOKEN"
  export MUSI_VERIFY_MEMORY_AVAILABLE_MB=8800
  export MUSI_VERIFY_MEMORY_LIVE_RESERVED_RSS_MB=3200
  musi_memory_budget_try_reserve lint \
    || fail "live reserved RSS must not be charged twice against MemAvailable"
  lint_token="$MUSI_VERIFY_MEMORY_RESERVATION_TOKEN"
  musi_memory_budget_release "$test_token"
  musi_memory_budget_release "$lint_token"

  # Unsupported memory discovery deliberately publishes only the accounting
  # floor. Zero Musi reservations do not prove the host is idle, so admission
  # must fail closed unless the caller explicitly opts into a solo launch.
  unset MUSI_VERIFY_MEMORY_AVAILABLE_MB MUSI_VERIFY_MEMORY_LIVE_RESERVED_RSS_MB
  export MUSI_VERIFY_MEMORY_FORCE_UNSUPPORTED=1
  if musi_memory_budget_try_reserve test; then
    fail "unsupported-host fallback must not admit an oversized slot by default"
  fi
  [ -z "$MUSI_VERIFY_MEMORY_RESERVATION_TOKEN" ] \
    || fail "failed low-memory admission must not publish a reservation token"

  export MUSI_VERIFY_MEMORY_WAIT_TIMEOUT=0
  set +e
  low_memory_output="$(musi_memory_budget_wait_and_reserve test verify:low-memory 2>&1)"
  low_memory_rc=$?
  set -e
  [ "$low_memory_rc" -eq 3 ] \
    || fail "low-memory admission should time out without launching: rc=$low_memory_rc"
  grep -qF 'needs 3200 MB' <<< "$low_memory_output" \
    || fail "low-memory diagnostic must state the required peak: $low_memory_output"
  grep -qF 'memory availability discovery is unsupported' <<< "$low_memory_output" \
    || fail "unsupported-memory diagnostic must identify discovery failure: $low_memory_output"
  grep -qF 'provide readable Linux MemAvailable or cgroup memory accounting' <<< "$low_memory_output" \
    || fail "unsupported-memory diagnostic must state required host support: $low_memory_output"
  grep -qF 'MUSI_VERIFY_MEMORY_ALLOW_SOLO_FALLBACK=1' <<< "$low_memory_output" \
    || fail "unsupported-memory diagnostic must name the explicit solo opt-in: $low_memory_output"
  if grep -qF 'measured available memory' <<< "$low_memory_output"; then
    fail "unsupported-memory diagnostic must not describe the synthetic floor as measured: $low_memory_output"
  fi
  unset MUSI_VERIFY_MEMORY_WAIT_TIMEOUT

  export MUSI_VERIFY_MEMORY_ALLOW_SOLO_FALLBACK=1
  musi_memory_budget_try_reserve test \
    || fail "explicit solo-fallback opt-in should admit an oversized slot"
  [ "${MUSI_VERIFY_MEMORY_SOLO_FALLBACK:-0}" = 1 ] \
    || fail "opted-in unsupported-host solo admission should be explicit"
  test_token="$MUSI_VERIFY_MEMORY_RESERVATION_TOKEN"
  musi_memory_budget_release "$test_token"
  unset MUSI_VERIFY_MEMORY_ALLOW_SOLO_FALLBACK MUSI_VERIFY_MEMORY_FORCE_UNSUPPORTED

  cgroup_dir="$SANDBOX/nested-cgroup"
  mkdir -p "$cgroup_dir"
  printf '10000000000\n' > "$cgroup_dir/memory.max"
  printf '4000000000\n' > "$cgroup_dir/memory.current"
  export MUSI_VERIFY_CGROUP_MAX_FILE="$cgroup_dir/memory.max"
  export MUSI_VERIFY_CGROUP_CURRENT_FILE="$cgroup_dir/memory.current"
  [ "$(musi_memory_cgroup_available_mb)" -eq 6000 ] \
    || fail "cgroup discovery should honor the current delegated group files"
  unset MUSI_VERIFY_CGROUP_MAX_FILE MUSI_VERIFY_CGROUP_CURRENT_FILE

  export MUSI_VERIFY_MEMORY_AVAILABLE_MB=6000
  export MUSI_VERIFY_MEMORY_WAIT_TIMEOUT=1
  export MUSI_VERIFY_MEMORY_POLL_SECONDS=0.1
  mkdir -p "$MUSI_VERIFY_MEMORY_STATE_ROOT"
  sequential_blocker="$MUSI_VERIFY_MEMORY_STATE_ROOT/reservation.sequential-timeout"
  write_live_memory_reservation "$sequential_blocker" 5000 external
  set +e
  musi_memory_budget_wait_and_reserve lint verify:test >/dev/null 2>&1
  sequential_wait_rc=$?
  set -e
  rm -f "$sequential_blocker"
  [ "$sequential_wait_rc" -eq 3 ] \
    || fail "sequential memory wait should time out instead of spinning: rc=$sequential_wait_rc"
  export MUSI_VERIFY_MEMORY_POLL_SECONDS=999999
  [ "$(musi_memory_budget_poll_seconds)" = 1 ] \
    || fail "memory polling must stay capped at one second"
  unset MUSI_VERIFY_MEMORY_WAIT_TIMEOUT MUSI_VERIFY_MEMORY_POLL_SECONDS

  mkdir -p "$MUSI_VERIFY_MEMORY_STATE_ROOT"
  printf 'pid=99999999\nmb=9000\n' > "$MUSI_VERIFY_MEMORY_STATE_ROOT/reservation.stale"
  export MUSI_VERIFY_MEMORY_AVAILABLE_MB=8000
  musi_memory_budget_try_reserve lint || fail "dead-owner reservation should be reclaimed"
  lint_token="$MUSI_VERIFY_MEMORY_RESERVATION_TOKEN"
  [ ! -e "$MUSI_VERIFY_MEMORY_STATE_ROOT/reservation.stale" ] \
    || fail "stale reservation was not removed"
  musi_memory_budget_release "$lint_token"

  unset MUSI_VERIFY_MEMORY_AVAILABLE_MB
  available_mb="$(musi_memory_available_mb)"
  case "$available_mb" in
    '' | *[!0-9]*) fail "detected available memory is not an integer: $available_mb" ;;
  esac
  [ "$available_mb" -gt 0 ] || fail "detected available memory must be positive"
) || exit 1
ok "memory budget reserves measured peaks against host and cgroup availability"

# A process that remains non-killable after KILL must not trap a verification
# controller in an unbounded builtin wait.
(
  # shellcheck source=../process-tree.sh
  . "$SCRIPT_DIR/../process-tree.sh"
  bounded_wait_sleeps=0
  musi_process_needs_signal() { return 0; }
  sleep() { bounded_wait_sleeps=$((bounded_wait_sleeps + 1)); }
  wait() { fail "bounded process wait should not reap a still-running process"; }
  export MUSI_PROCESS_TREE_KILL_WAIT_TENTHS=3
  set +e
  musi_wait_for_pid_exit_bounded 424242
  bounded_wait_rc=$?
  set -e
  [ "$bounded_wait_rc" -eq 1 ] \
    || fail "bounded process wait should report a still-running process"
  [ "$bounded_wait_sleeps" -eq 3 ] \
    || fail "bounded process wait should stop after three polls: $bounded_wait_sleeps"
)
ok "post-KILL process waits are bounded"

PARALLEL_STEP_LOG_DIR="$SANDBOX/parallel-step-logs"
mkdir -p "$PARALLEL_STEP_LOG_DIR/meta"
PARALLEL_STEP_OOM_SCORE_FILE="$SANDBOX/parallel-step-oom-score"
printf '0\n' > "$PARALLEL_STEP_OOM_SCORE_FILE"
PARALLEL_STEP_RESERVATION_TOKEN="$SANDBOX/parallel-step-reservation"
PARALLEL_STEP_OWNER_PID="$BASHPID"
PARALLEL_STEP_OWNER_START_TIME="$(awk '{ print $22 }' "/proc/$PARALLEL_STEP_OWNER_PID/stat")"
printf 'pid=%s\npid_start_time=%s\nmb=256\nslot=env-check\n' \
  "$PARALLEL_STEP_OWNER_PID" "$PARALLEL_STEP_OWNER_START_TIME" > "$PARALLEL_STEP_RESERVATION_TOKEN"
set +e
parallel_step_output=$(
  export LOG_DIR="$PARALLEL_STEP_LOG_DIR"
  export META_DIR="$PARALLEL_STEP_LOG_DIR/meta"
  export MUSI_VERIFY_OOM_SCORE_ADJ_FILE="$PARALLEL_STEP_OOM_SCORE_FILE"
  export PARALLEL_STEP_RESERVATION_TOKEN
  # shellcheck source=../verify/memory-budget.sh
  . "$SCRIPT_DIR/../verify/memory-budget.sh"
  MUSI_VERIFY_MEMORY_RESERVATION_TOKEN="$PARALLEL_STEP_RESERVATION_TOKEN"
  # shellcheck source=../lib/verify-metadata.sh
  . "$SCRIPT_DIR/../lib/verify-metadata.sh"
  # shellcheck source=../lib/parallel-step.sh
  . "$SCRIPT_DIR/../lib/parallel-step.sh"
  GIT_DIR=/outer/git \
    GIT_INDEX_FILE=/outer/index \
    GIT_WORK_TREE=/outer/worktree \
    GIT_PREFIX=outer \
    GIT_COMMON_DIR=/outer/common \
    musi_run_parallel_step test "" env-check bash -c '
      [ "${MUSI_VERIFY_MEMORY_ADMISSION_TOKEN:-}" = \
        "$PARALLEL_STEP_RESERVATION_TOKEN" ] || {
        printf "MUSI_VERIFY_MEMORY_ADMISSION_TOKEN=%s\n" \
          "${MUSI_VERIFY_MEMORY_ADMISSION_TOKEN:-unset}"
        exit 1
      }
      [ "$(cat "$MUSI_VERIFY_OOM_SCORE_ADJ_FILE")" -ge 500 ] || {
        printf "oom_score_adj=%s\n" "$(cat "$MUSI_VERIFY_OOM_SCORE_ADJ_FILE")"
        exit 1
      }
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

# --- fast-commit toggle: pre-commit skips only the slow test slots ----------
# When the fast-commit marker is present the pre_commit consumer skips the two
# slow test slots (test, scripts) with MUSI_VERIFY_SLOT_SKIP_RC; static slots
# (typecheck) and every other consumer (verify_changed) resolve normally. With
# the marker absent, pre_commit test resolves exactly as before.
(
  LOG_DIR="$SANDBOX/fast-commit-steps-logs"
  # shellcheck disable=SC2034  # consumed by the sourced steps.generated.sh guard
  TIMINGS_FILE="$LOG_DIR/timings.json"
  mkdir -p "$LOG_DIR"
  # shellcheck source=../verify/steps.generated.sh
  . "$SCRIPT_DIR/../verify/steps.generated.sh"
  # shellcheck source=../verify/steps-lib.sh
  . "$SCRIPT_DIR/../verify/steps-lib.sh"

  present_marker="$SANDBOX/fast-commit-on"
  : > "$present_marker"
  absent_marker="$SANDBOX/fast-commit-off"
  rm -f "$absent_marker"

  resolve_rc() {
    local rc=0
    ( export MUSI_FAST_COMMIT_MARKER="$1"; musi_resolve_slot_cmd "$2" "$3" ) \
      >/dev/null 2>&1 || rc=$?
    printf '%s' "$rc"
  }

  [ "$(resolve_rc "$present_marker" pre_commit test)" = "100" ] \
    || fail "fast-commit marker should skip the pre_commit test slot"
  [ "$(resolve_rc "$present_marker" pre_commit scripts)" = "100" ] \
    || fail "fast-commit marker should skip the pre_commit scripts slot"
  [ "$(resolve_rc "$present_marker" pre_commit typecheck)" = "0" ] \
    || fail "fast-commit marker must not skip the pre_commit typecheck slot"
  [ "$(resolve_rc "$present_marker" verify_changed test)" = "0" ] \
    || fail "fast-commit marker must not affect the verify_changed consumer"
  [ "$(resolve_rc "$absent_marker" pre_commit test)" = "0" ] \
    || fail "absent fast-commit marker should resolve the pre_commit test slot normally"

  # Adopter portability: a manifest with no fastCommitSkip slots generates
  # MUSI_FAST_COMMIT_SKIP_SLOTS=(). Resolution must degrade to "skip nothing"
  # — and the expansion in steps-lib.sh must use the ${arr[@]+...} guard,
  # because "${empty[@]}" under set -u aborts as unbound on bash < 4.4
  # (macOS system bash). This host's bash cannot reproduce the abort, so this
  # case pins the empty-set behavior the guard must preserve.
  # shellcheck disable=SC2034 # Read by musi_resolve_slot_cmd from the sourced steps-lib.
  MUSI_FAST_COMMIT_SKIP_SLOTS=()
  [ "$(resolve_rc "$present_marker" pre_commit test)" = "0" ] \
    || fail "empty fast-commit skip set should resolve the pre_commit test slot normally"
  [ "$(resolve_rc "$present_marker" pre_commit scripts)" = "$(resolve_rc "$absent_marker" pre_commit scripts)" ] \
    || fail "empty fast-commit skip set must make the marker a no-op for the dynamic scripts slot"
) || exit 1
ok "fast-commit marker skips only the slow pre-commit test slots"

# --- empty changed mode exits before launching any verification slots -----
: > "$STUB_LOG_FILE"
rm -f "$MARKER_CHANGED"
output=$(run_verify --changed) || fail "empty verify --changed should exit successfully: $output"
[ ! -s "$STUB_LOG_FILE" ] \
  || fail "empty verify --changed should not launch slots: $(cat "$STUB_LOG_FILE")"
[ ! -f "$MARKER_CHANGED" ] || fail "empty verify --changed should not mint a success marker"
grep -qF 'stage intended work and rerun' <<< "$output" \
  || fail "empty verify --changed should explain how to stage work: $output"
grep -qF 'bun run verify' <<< "$output" \
  || fail "empty verify --changed should point intentional full verification to bun run verify: $output"
ok "empty verify --changed skips every slot with precise guidance"

mkdir -p packages/server/src
printf 'export const verifyFixture = true;\n' > packages/server/src/verify-fixture.ts
git add packages/server/src/verify-fixture.ts

# --- happy path: changed mode writes a marker -----------------------------
: > "$STUB_LOG_FILE"
rm -f "$MARKER_CHANGED"
run_verify --changed >/dev/null || fail "verify --changed unexpectedly failed"
[ -f "$MARKER_CHANGED" ] || fail "verify --changed did not write marker"
ok "verify --changed writes marker on success"

# A constrained live budget defers the next heavy slot instead of skipping it.
# Keep an external reservation until the first admitted stub starts. Because
# lint is considered first, this deterministically exercises the deferred path
# without relying on two short-lived commands overlapping under runner load.
rm -f "$MARKER_CHANGED"
: > "$STUB_LOG_FILE"
rm -rf "$SANDBOX/memory-state"
mkdir -p "$SANDBOX/memory-state"
memory_blocker="$SANDBOX/memory-state/reservation.integration"
write_live_memory_reservation "$memory_blocker" 5000 external
(
  while [ ! -s "$STUB_LOG_FILE" ]; do sleep 0.05; done
  rm -f "$memory_blocker"
) &
memory_releaser_pid=$!
set +e
output=$(MUSI_VERIFY_MEMORY_AVAILABLE_MB=7000 \
  FORCE_VERIFY=1 run_verify --changed 2>&1)
exit_code=$?
set -e
wait "$memory_releaser_pid"
[ "$exit_code" -eq 0 ] || fail "memory-budgeted verify --changed should still succeed: $output"
grep -qE 'deferring (lint|ratchet|test|scripts) until memory budget is available' <<< "$output" \
  || fail "memory budget should report the deferred heavy slot: $output"
grep -qF 'stub bun run lint:ratchet' "$STUB_LOG_FILE" \
  || fail "memory budget must eventually run the deferred ratchet slot"
grep -qF 'stub bun run test:changed' "$STUB_LOG_FILE" \
  || fail "memory budget must not skip later test slots"
ok "verify --changed defers heavy slots without skipping work"

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

# A fresh worktree-scoped state root must not fail before verification starts.
FRESH_STATE_ROOT="$SANDBOX/fresh-state-root"
rm -rf "$FRESH_STATE_ROOT"
: > "$STUB_LOG_FILE"
run_verify_state_root "$FRESH_STATE_ROOT" --changed >/dev/null \
  || fail "verify --changed should create lock/log/marker parents under MUSI_VERIFY_STATE_ROOT"
[ -d "$FRESH_STATE_ROOT" ] || fail "verify --changed did not create MUSI_VERIFY_STATE_ROOT"
ok "verify --changed creates fresh MUSI_VERIFY_STATE_ROOT parents"

# When ignored package dist outputs are missing, changed-mode keeps the other
# parallel slots running but defers lint and ratchet until the existing
# typecheck slot has produced the package declarations ESLint resolves.
remove_required_dist_outputs
: > "$STUB_LOG_FILE"
FORCE_VERIFY=1 run_verify --changed >/dev/null || fail "verify --changed should pass when dist outputs are missing"
typecheck_line="$(grep -nFx 'stub bun run typecheck' "$STUB_LOG_FILE" | head -n1 | cut -d: -f1)"
lint_line="$(grep -nFx 'stub bun run lint:changed' "$STUB_LOG_FILE" | head -n1 | cut -d: -f1)"
ratchet_line="$(grep -nFx 'stub bun run lint:ratchet' "$STUB_LOG_FILE" | head -n1 | cut -d: -f1)"
[ -n "$typecheck_line" ] || fail "missing-dist verify should run typecheck"
[ -n "$lint_line" ] || fail "missing-dist verify should run lint:changed"
[ -n "$ratchet_line" ] || fail "missing-dist verify should run lint:ratchet"
[ "$typecheck_line" -lt "$lint_line" ] \
  || fail "missing-dist verify should run typecheck before lint: $(cat "$STUB_LOG_FILE")"
[ "$typecheck_line" -lt "$ratchet_line" ] \
  || fail "missing-dist verify should run typecheck before ratchet: $(cat "$STUB_LOG_FILE")"
write_required_dist_outputs
ok "verify --changed defers lint and ratchet until typecheck when dist outputs are missing"

(
  LOG_DIR="$SANDBOX/missing-typecheck-dispatch-logs"
  META_DIR="$LOG_DIR/meta"
  # shellcheck disable=SC2034  # consumed by the sourced steps.generated.sh guard
  TIMINGS_FILE="$LOG_DIR/timings.json"
  mkdir -p "$META_DIR"
  # shellcheck source=../lib/lint-dist-preflight.sh
  . "$SCRIPT_DIR/../lib/lint-dist-preflight.sh"
  # shellcheck source=../verify/steps.generated.sh
  . "$SCRIPT_DIR/../verify/steps.generated.sh"
  # shellcheck source=../verify/steps-lib.sh
  . "$SCRIPT_DIR/../verify/steps-lib.sh"

  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  declare -ga MUSI_NO_TYPECHECK_STEPS=(lint ratchet)
  # shellcheck disable=SC2034 # Resolved by name through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_NO_TYPECHECK_LINT_CMD=(bun run lint:changed)
  # shellcheck disable=SC2034 # Resolved by name through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_NO_TYPECHECK_RATCHET_CMD=(bun run lint:ratchet)
  MUSI_VERIFY_SLOT_CMD_VAR['test_no_typecheck:lint']='MUSI_NO_TYPECHECK_LINT_CMD'
  # shellcheck disable=SC2034 # Read by musi_resolve_slot_cmd after sourcing steps-lib.
  MUSI_VERIFY_SLOT_CMD_VAR['test_no_typecheck:ratchet']='MUSI_NO_TYPECHECK_RATCHET_CMD'
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  step_names=()
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  step_pids=()
  step_exits=()
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  parallel_pids=()

  remove_required_dist_outputs
  musi_run_parallel_verify_steps test_no_typecheck MUSI_NO_TYPECHECK_STEPS parallel-test \
    verify:test "$PWD" step_names step_pids step_exits parallel_pids
  [ "${step_exits[0]}" = 1 ] || fail "lint should fail without a typecheck defer target"
  [ "${step_exits[1]}" = 1 ] || fail "ratchet should fail without a typecheck defer target"
  grep -qF "verify:test: cannot run lint because required dist outputs are missing and test_no_typecheck has no typecheck slot to produce them" "$LOG_DIR/lint.log" \
    || fail "lint missing no-typecheck assertion: $(cat "$LOG_DIR/lint.log")"
  grep -qF "verify:test: cannot run ratchet because required dist outputs are missing and test_no_typecheck has no typecheck slot to produce them" "$LOG_DIR/ratchet.log" \
    || fail "ratchet missing no-typecheck assertion: $(cat "$LOG_DIR/ratchet.log")"
  write_required_dist_outputs
) || exit 1
ok "parallel dispatch fails loudly when dist-deferred slots have no typecheck slot"

# --- memory scheduler liveness / parent ownership -------------------------
(
  LOG_DIR="$SANDBOX/memory-runner-logs"
  META_DIR="$LOG_DIR/meta"
  # shellcheck disable=SC2034 # Consumed by sourced generated verify steps.
  TIMINGS_FILE="$LOG_DIR/timings.json"
  mkdir -p "$META_DIR"
  # shellcheck source=../lib/verify-metadata.sh
  . "$SCRIPT_DIR/../lib/verify-metadata.sh"
  # shellcheck source=../lib/parallel-step.sh
  . "$SCRIPT_DIR/../lib/parallel-step.sh"
  # shellcheck source=../lib/lint-dist-preflight.sh
  . "$SCRIPT_DIR/../lib/lint-dist-preflight.sh"
  # shellcheck source=../verify/steps.generated.sh
  . "$SCRIPT_DIR/../verify/steps.generated.sh"
  # shellcheck source=../verify/steps-lib.sh
  . "$SCRIPT_DIR/../verify/steps-lib.sh"

  export MUSI_VERIFY_MEMORY_STATE_ROOT="$SANDBOX/memory-runner-state"
  export MUSI_VERIFY_MEMORY_AVAILABLE_MB=6000
  export MUSI_VERIFY_MEMORY_SAFETY_MB=1000
  export MUSI_VERIFY_MEMORY_POLL_SECONDS=0.1

  # A denied lint at the head must not block a later 256 MB slot. Keep an
  # external reservation alive for one second and assert the smaller command
  # runs before that reservation is released and lint follows afterward.
  rm -rf "$MUSI_VERIFY_MEMORY_STATE_ROOT"
  mkdir -p "$MUSI_VERIFY_MEMORY_STATE_ROOT"
  order_log="$SANDBOX/memory-head-of-line.log"
  : > "$order_log"
  external_token="$MUSI_VERIFY_MEMORY_STATE_ROOT/reservation.external"
  write_live_memory_reservation "$external_token" 2000 external
  (
    sleep 1
    printf 'released\n' >> "$order_log"
    rm -f "$external_token"
  ) &
  releaser_pid=$!
  # shellcheck disable=SC2034 # Resolved by name in the shared runner.
  MUSI_MEMORY_HOL_STEPS=(lint suppressions)
  # shellcheck disable=SC2034 # Resolved through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_MEMORY_HOL_LINT_CMD=(bash -c 'printf "lint\n" >> "$1"' _ "$order_log")
  # shellcheck disable=SC2034 # Resolved through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_MEMORY_HOL_SMALL_CMD=(bash -c 'printf "small\n" >> "$1"' _ "$order_log")
  MUSI_VERIFY_SLOT_CMD_VAR['memory_hol:lint']='MUSI_MEMORY_HOL_LINT_CMD'
  MUSI_VERIFY_SLOT_CMD_VAR['memory_hol:suppressions']='MUSI_MEMORY_HOL_SMALL_CMD'
  step_names=(); step_pids=(); step_exits=(); parallel_pids=()
  musi_run_parallel_verify_steps memory_hol MUSI_MEMORY_HOL_STEPS parallel-test \
    verify:test "$PWD" step_names step_pids step_exits parallel_pids
  wait "$releaser_pid"
  [ "$(cat "$order_log")" = $'small\nreleased\nlint' ] \
    || fail "smaller slot should bypass deferred lint: $(cat "$order_log")"
  [ "${step_exits[0]}:${step_exits[1]}" = '0:0' ] \
    || fail "head-of-line fixture should pass both slots: ${step_exits[*]}"

  # Kill the parallel wrapper itself, bypassing its EXIT trap. The parent wait
  # must still remove the token while this gate shell remains alive.
  rm -rf "$MUSI_VERIFY_MEMORY_STATE_ROOT" "$LOG_DIR"
  mkdir -p "$MUSI_VERIFY_MEMORY_STATE_ROOT" "$META_DIR"
  export MUSI_VERIFY_MEMORY_AVAILABLE_MB=16000
  # shellcheck disable=SC2034 # Resolved by name in the shared runner.
  MUSI_MEMORY_KILL_STEPS=(lint)
  # shellcheck disable=SC2034 # Resolved through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_MEMORY_KILL_CMD=(bash -c 'kill -KILL "$PPID"; exit 0')
  MUSI_VERIFY_SLOT_CMD_VAR['memory_kill:lint']='MUSI_MEMORY_KILL_CMD'
  step_names=(); step_pids=(); step_exits=(); parallel_pids=()
  musi_run_parallel_verify_steps memory_kill MUSI_MEMORY_KILL_STEPS parallel-test \
    verify:test "$PWD" step_names step_pids step_exits parallel_pids 2>/dev/null
  [ "${step_exits[0]}" -ne 0 ] || fail "SIGKILL fixture should fail its slot"
  if find "$MUSI_VERIFY_MEMORY_STATE_ROOT" -maxdepth 1 -name 'reservation.*' -print -quit \
      | grep -q .; then
    fail "parent wait leaked a reservation after the child EXIT trap was SIGKILLed"
  fi

  # A live external reservation can defer safely, but only up to the explicit
  # deadline used by pre-commit while it owns the cross-worktree queue lock.
  rm -rf "$MUSI_VERIFY_MEMORY_STATE_ROOT" "$LOG_DIR"
  mkdir -p "$MUSI_VERIFY_MEMORY_STATE_ROOT" "$META_DIR"
  export MUSI_VERIFY_MEMORY_AVAILABLE_MB=6000
  export MUSI_VERIFY_MEMORY_WAIT_TIMEOUT=1
  external_token="$MUSI_VERIFY_MEMORY_STATE_ROOT/reservation.timeout"
  write_live_memory_reservation "$external_token" 5000 external
  # shellcheck disable=SC2034 # Resolved by name in the shared runner.
  MUSI_MEMORY_TIMEOUT_STEPS=(lint)
  # shellcheck disable=SC2034 # Resolved through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_MEMORY_TIMEOUT_CMD=(bash -c 'exit 0')
  # shellcheck disable=SC2034 # Read by musi_resolve_slot_cmd in the shared runner.
  MUSI_VERIFY_SLOT_CMD_VAR['memory_timeout:lint']='MUSI_MEMORY_TIMEOUT_CMD'
  # shellcheck disable=SC2034 # Passed by name to the shared runner.
  step_names=()
  # shellcheck disable=SC2034 # Passed by name to the shared runner.
  step_pids=()
  step_exits=()
  # shellcheck disable=SC2034 # Passed by name to the shared runner.
  parallel_pids=()
  start_seconds="$(date +%s)"
  musi_run_parallel_verify_steps memory_timeout MUSI_MEMORY_TIMEOUT_STEPS parallel-test \
    verify:test "$PWD" step_names step_pids step_exits parallel_pids 2>/dev/null
  elapsed_seconds=$(( $(date +%s) - start_seconds ))
  [ "${step_exits[0]}" -eq 1 ] || fail "memory wait timeout should fail the pending slot"
  [ "$elapsed_seconds" -lt 5 ] || fail "memory wait timeout took ${elapsed_seconds}s"
  grep -qF 'memory wait timed out after 1s for lint' "$LOG_DIR/lint.log" \
    || fail "memory timeout diagnostic is missing: $(cat "$LOG_DIR/lint.log")"
  rm -f "$external_token"
) || exit 1
ok "parallel memory scheduler avoids head-of-line stalls, leaks, and unbounded waits"

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
  "docs/generated/lint-coverage-map.md"
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
  "vitest.slow.config.ts"
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
grep -qF 'Passed: lint suppressions ratchet zero-baseline debt-accounting knip-unused-exports near-duplicates max-lines-exceptions coverage-map format-check test scripts' <<< "$output" \
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
grep -qF 'Passed: lint suppressions ratchet' <<< "$output" \
  || fail "summary missed Passed: lint suppressions ratchet"
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
output=$(MUSI_INTERACTIVE_TIMEOUT=2 STUB_SLEEP_lint_changed=10 run_verify --changed 2>&1)
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
output=$(MUSI_INTERACTIVE_TIMEOUT=2 STUB_SLEEP_lint_changed=30 STUB_PID_LOG="$TREE_PID_LOG" run_verify --changed 2>&1)
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

# --- watchdog KILL-escalates a TERM-ignoring process tree ----------------
rm -f "$MARKER_CHANGED"
: > "$STUB_LOG_FILE"
STUBBORN_PID_LOG="$SANDBOX/stubborn-tree-pids"
rm -f "$STUBBORN_PID_LOG"
start_seconds=$SECONDS
set +e
output=$(
  STUB_LOG="$STUB_LOG_FILE" \
    PATH="$SANDBOX/bin:$PATH" \
    MUSI_VERIFY_LOCK="$LOCK" \
    MUSI_VERIFY_LOG_DIR="$LOG_DIR" \
    MUSI_VERIFY_HISTORY_DIR="$HISTORY_DIR" \
    MUSI_VERIFY_MEMORY_STATE_ROOT="$SANDBOX/memory-state" \
    MUSI_VERIFY_MARKER_CHANGED="$MARKER_CHANGED" \
    MUSI_VERIFY_MARKER_FULL="$MARKER_FULL" \
    MUSI_INTERACTIVE_TIMEOUT=2 \
    MUSI_PROCESS_TREE_TERM_GRACE_TENTHS=5 \
    STUB_SLEEP_lint_changed=30 \
    STUB_IGNORE_TERM_lint_changed=1 \
    STUB_PID_LOG="$STUBBORN_PID_LOG" \
    timeout --preserve-status --kill-after=2s 8s bash "$VERIFY" --changed 2>&1
)
exit_code=$?
set -e
elapsed_seconds=$((SECONDS - start_seconds))
leaked_pid=""
if [ -f "$STUBBORN_PID_LOG" ]; then
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    if kill -0 "$pid" 2>/dev/null; then
      leaked_pid="$pid"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done < "$STUBBORN_PID_LOG"
fi
[ "$exit_code" -eq 124 ] || fail "TERM-ignoring watchdog should exit 124 (got $exit_code): $output"
[ "$elapsed_seconds" -lt 8 ] \
  || fail "TERM-ignoring watchdog exceeded its bounded cleanup (${elapsed_seconds}s)"
[ -f "$LOG_DIR/run-meta.json" ] || fail "TERM-ignoring watchdog did not write run-meta.json"
grep -q '"exit_code":124' "$LOG_DIR/run-meta.json" \
  || fail "TERM-ignoring watchdog metadata should record exit_code 124"
[ -z "$leaked_pid" ] \
  || fail "TERM-ignoring watchdog left process $leaked_pid alive after escalation"
if ! (exec 9> "$LOCK"; flock -n 9); then
  fail "TERM-ignoring watchdog retained the verify flock after exit"
fi
ok "watchdog KILL-escalates TERM-ignoring trees and releases timeout state"

# --- watchdog catches a descendant forked from a TERM handler -------------
rm -f "$MARKER_CHANGED"
: > "$STUB_LOG_FILE"
LATE_FORK_INITIAL_PIDS="$SANDBOX/late-fork-initial-pids"
LATE_FORK_PID_FILE="$SANDBOX/late-fork.pid"
rm -f "$LATE_FORK_INITIAL_PIDS" "$LATE_FORK_PID_FILE"
set +e
output=$(
  MUSI_INTERACTIVE_TIMEOUT=2 \
    MUSI_PROCESS_TREE_TERM_GRACE_TENTHS=5 \
    STUB_SLEEP_lint_changed=30 \
    STUB_LATE_FORK_lint_changed=1 \
    STUB_LATE_PID_FILE="$LATE_FORK_PID_FILE" \
    STUB_PID_LOG="$LATE_FORK_INITIAL_PIDS" \
    run_verify --changed 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 124 ] || fail "late-fork watchdog should exit 124 (got $exit_code): $output"
late_fork_wait=0
while [ ! -s "$LATE_FORK_PID_FILE" ] && [ "$late_fork_wait" -lt 20 ]; do
  sleep 0.1
  late_fork_wait=$((late_fork_wait + 1))
done
[ -s "$LATE_FORK_PID_FILE" ] || fail "TERM handler did not create the late descendant"
late_fork_pid=$(cat "$LATE_FORK_PID_FILE")
if grep -qxF "$late_fork_pid" "$LATE_FORK_INITIAL_PIDS"; then
  kill -KILL "$late_fork_pid" 2>/dev/null || true
  fail "late-fork fixture logged pid $late_fork_pid before timeout cleanup began"
fi
late_fork_survived=0
if kill -0 "$late_fork_pid" 2>/dev/null; then
  late_fork_survived=1
  kill -KILL "$late_fork_pid" 2>/dev/null || true
fi
[ "$late_fork_survived" -eq 0 ] \
  || fail "watchdog left TERM-handler descendant $late_fork_pid alive after exit 124"
grep -q '"exit_code":124' "$LOG_DIR/run-meta.json" \
  || fail "late-fork watchdog metadata should record exit_code 124"
ok "watchdog kills descendants forked during TERM grace"

# --- MUSI_INTERACTIVE_TIMEOUT is honored by the watchdog ------------------
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

grep -qF 'bun run docs:local-eslint-rule-starter:check' "$STUB_LOG_FILE" \
  || fail "verify (full) should invoke the standalone local-rule starter check"
ok "verify (full) runs standalone local-rule starter check"

grep -qF 'bun run docs:lint-coverage-map:audit' "$STUB_LOG_FILE" \
  || fail "verify (full) should invoke bun run docs:lint-coverage-map:audit (ESLint-reach enforced)"
if grep -qF 'bun run docs:lint-coverage-map:check -- --staged' "$STUB_LOG_FILE"; then
  fail "verify (full) must not invoke the staged lint coverage map check"
fi
ok "verify (full) runs lint coverage map audit"

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

grep -qF 'bun run docs:local-eslint-rule-starter:check' "$STUB_LOG_FILE" \
  || fail "verify --parallel should invoke the standalone local-rule starter check"
ok "verify --parallel runs standalone local-rule starter check"

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

remove_required_dist_outputs
: > "$STUB_LOG_FILE"
rm -f "$MARKER_FULL"
FORCE_VERIFY=1 run_verify --parallel >/dev/null || fail "verify --parallel should pass when dist outputs are missing"
typecheck_line="$(grep -nFx 'stub bun run typecheck' "$STUB_LOG_FILE" | head -n1 | cut -d: -f1)"
lint_line="$(grep -nFx 'stub bun run lint' "$STUB_LOG_FILE" | head -n1 | cut -d: -f1)"
ratchet_line="$(grep -nFx 'stub bun run lint:ratchet' "$STUB_LOG_FILE" | head -n1 | cut -d: -f1)"
[ -n "$typecheck_line" ] || fail "missing-dist parallel verify should run typecheck"
[ -n "$lint_line" ] || fail "missing-dist parallel verify should run lint"
[ -n "$ratchet_line" ] || fail "missing-dist parallel verify should run lint:ratchet"
[ "$typecheck_line" -lt "$lint_line" ] \
  || fail "missing-dist parallel verify should run typecheck before lint: $(cat "$STUB_LOG_FILE")"
[ "$typecheck_line" -lt "$ratchet_line" ] \
  || fail "missing-dist parallel verify should run typecheck before ratchet: $(cat "$STUB_LOG_FILE")"
write_required_dist_outputs
ok "verify --parallel defers lint and ratchet until typecheck when dist outputs are missing"

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
grep -qF 'Passed: lint suppressions ratchet zero-baseline debt-accounting local-rule-starter knip-unused-exports near-duplicates max-lines-exceptions coverage-map format-check test scripts' <<< "$output" \
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
