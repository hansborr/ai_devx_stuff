#!/usr/bin/env bash
# smoke-order: 010
# smoke-subjects: scripts/verify.sh
# smoke-subjects: scripts/verify/steps.generated.sh
# smoke-subjects: scripts/verify/steps-lib.sh
# smoke-subjects: scripts/verify/memory-budget.sh
# smoke-subjects: scripts/verify/memory-wait-timeout.sh
# smoke-subjects: scripts/verify/admitted-command.sh
# smoke-subjects: scripts/lib/verify-metadata.sh
# smoke-subjects: scripts/lib/verify-commit-queue.sh
# smoke-subjects: scripts/lib/verify-fast-commit.sh
# smoke-subjects: scripts/lib/verify-markers.sh
# smoke-subjects: scripts/lib/verify-path-policy.sh
# smoke-subjects: scripts/lib/verify-run-meta.sh
# smoke-subjects: scripts/lib/verify-state-paths.sh
# smoke-subjects: scripts/path-policy/path-policy-query.ts
# smoke-subjects: scripts/path-policy/path-policy-query-core.ts
# smoke-subjects: scripts/path-policy/segment-pattern.ts
# smoke-subjects: scripts/path-policy/path-policy.ts
# smoke-subjects: scripts/path-policy/smoke-test-files.ts
# smoke-subjects: scripts/process-tree.sh
# smoke-subjects: scripts/lib/parallel-step.sh
# smoke-subjects: scripts/lib/verify-engine.sh
# smoke-subjects: scripts/lib/verify-evidence-transaction.sh
# smoke-subjects: scripts/lib/verify-lifecycle.sh
# smoke-subjects: scripts/lib/verify-policy-validation.sh
# smoke-subjects: scripts/lib/test-worker-count.sh
# smoke-subjects: scripts/lib/changed-base.sh
# smoke-subjects: scripts/lib/gate-env.sh
# smoke-subjects: scripts/lib/lint-dist-preflight.sh
# smoke-subjects: scripts/lib/records.ts
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/test-verify.sh
# smoke-subjects: scripts/ai-hooks/cache.sh
# smoke-subjects: scripts/ai-hooks/common.sh
# smoke-subjects: scripts/ai-hooks/output-filter.sh
# smoke-subjects: scripts/lib/verify-metadata-core.ts
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
# The fixture shadows PATH with a stub bun; the run-meta codec must keep
# spawning the real bun (same seam pattern as MUSI_PATH_POLICY_BUN).
if [ -z "${MUSI_VERIFY_META_BUN:-}" ]; then
  MUSI_VERIFY_META_BUN="$(command -v bun)"
  export MUSI_VERIFY_META_BUN
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
    "$SCRIPT_DIR/../lib/verify-commit-queue.sh" \
    "$SCRIPT_DIR/../lib/verify-fast-commit.sh" \
    "$SCRIPT_DIR/../lib/verify-markers.sh" \
    "$SCRIPT_DIR/../lib/verify-path-policy.sh" \
    "$SCRIPT_DIR/../lib/verify-run-meta.sh" \
    "$SCRIPT_DIR/../lib/verify-state-paths.sh" \
    "$SCRIPT_DIR/../lib/verify-metadata-core.ts" \
    "$SCRIPT_DIR/../lib/lint-dist-preflight.sh" "$SCRIPT_DIR/../lib/gate-env.sh" \
    "$SCRIPT_DIR/../lib/changed-base.sh" \
    "$SCRIPT_DIR/../lib/verify-engine.sh" \
    "$SCRIPT_DIR/../lib/verify-evidence-transaction.sh" \
    "$SCRIPT_DIR/../lib/verify-lifecycle.sh" \
    "$SCRIPT_DIR/../lib/verify-policy-validation.sh" \
    "$SCRIPT_DIR/../lib/test-worker-count.sh" \
    "$FIXTURE_ROOT/scripts/lib/"
  cp "$SCRIPT_DIR/../ai-hooks/cache.sh" "$SCRIPT_DIR/../ai-hooks/common.sh" \
    "$SCRIPT_DIR/../ai-hooks/output-filter.sh" \
    "$FIXTURE_ROOT/scripts/ai-hooks/"
  cp "$SCRIPT_DIR/../verify/steps.generated.sh" "$SCRIPT_DIR/../verify/steps-lib.sh" \
    "$SCRIPT_DIR/../verify/memory-budget.sh" "$SCRIPT_DIR/../verify/memory-wait-timeout.sh" \
    "$SCRIPT_DIR/../verify/admitted-command.sh" \
    "$FIXTURE_ROOT/scripts/verify/"
  touch "$FIXTURE_ROOT/packages/shared/dist/constants.d.ts"
  touch "$FIXTURE_ROOT/packages/shared/dist/logging-policy.d.ts"
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

# Echo the slot names of one generated step array (e.g. MUSI_VERIFY_CHANGED_STEPS)
# without sourcing steps.generated.sh, whose guards demand wrapper runtime
# variables this scope does not own.
generated_step_names() {
  local array_name="$1" names
  names="$(sed -n "s/^declare -ga ${array_name}=(\(.*\))\$/\1/p" \
    "$SCRIPT_DIR/../verify/steps.generated.sh" | tr -d "'")"
  [ -n "$names" ] || fail "could not read $array_name from steps.generated.sh"
  printf '%s\n' "$names"
}

# Assert the failure summary's `Passed:` line reports every slot of the named
# generated step array except the ones listed after it (the slots this case
# forced to fail). Membership, not order: the summary prints in slot order, so
# a fixed-string grep breaks every time a slot is inserted mid-list, which is
# not what these cases exist to prove. Slot ORDER is covered separately by the
# dispatch-ordering cases that compare stub-log line numbers.
assert_summary_passed_all_but() {
  local output="$1" array_name="$2"
  shift 2
  local passed_line slot skipped
  passed_line="$(grep -m1 '^Passed:' <<< "$output")" \
    || fail "summary missed the Passed: line: $output"
  for slot in $(generated_step_names "$array_name"); do
    for skipped in "$@"; do
      if [ "$slot" = "$skipped" ]; then
        continue 2
      fi
    done
    case " ${passed_line#Passed:} " in
      *" $slot "*) ;;
      *) fail "$array_name slot '$slot' missing from summary line: $passed_line" ;;
    esac
  done
}

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
if [ -n "${STUB_FORCE_VERIFY_LOG:-}" ]; then
  printf '%s\n' "${FORCE_VERIFY-<unset>}" >> "$STUB_FORCE_VERIFY_LOG"
fi
if [ "${1:-}" = run ] && [ -n "${2:-}" ]; then
  safe_name="${2//:/_}"
  safe_name="${safe_name//-/_}"
  var_fail="STUB_FAIL_${safe_name}"
  var_exit="STUB_EXIT_${safe_name}"
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
  if [ -n "${!var_exit:-}" ]; then
    printf 'stub: forced exit %s for bun run %s\n' "${!var_exit}" "$2" >&2
    exit "${!var_exit}"
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
  touch packages/shared/dist/logging-policy.d.ts
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

# --- shared gate-lifecycle contract ---------------------------------------
# Run each exit path in a fresh shell so the process-global EXIT dispatcher is
# tested with the same one-owner lifetime it has in verify.sh and pre-commit.
run_exit_dispatch_case() {
  local scenario="$1" expected_status="$2" expected_event="$3"
  local sample_line footer_line
  local callback_file="$SANDBOX/gate-exit-${scenario}.callback"
  local event_file="$SANDBOX/gate-exit-${scenario}.events"
  local output_file="$SANDBOX/gate-exit-${scenario}.output"
  local stdout_file="$SANDBOX/gate-exit-${scenario}.stdout"
  local stderr_file="$SANDBOX/gate-exit-${scenario}.stderr"
  : > "$callback_file"
  : > "$event_file"

  set +e
  (
    # shellcheck source=../ai-hooks/output-filter.sh
    . "$SCRIPT_DIR/../ai-hooks/output-filter.sh"
    # shellcheck source=../lib/verify-engine.sh
    . "$SCRIPT_DIR/../lib/verify-engine.sh"

    MATRIX_SCENARIO="$scenario"
    MATRIX_CALLBACK_FILE="$callback_file"
    MATRIX_EVENT_FILE="$event_file"
    MATRIX_MARKER="$SANDBOX/gate-exit-${scenario}.marker"
    MATRIX_LOG_DIR="$SANDBOX/gate-exit-${scenario}.logs"
    MATRIX_LIVE_LOAD='37.25'
    MATRIX_LIVE_CORES='16'
    rm -f "$MATRIX_MARKER"

    # The gate is this subshell's only awk consumer; override it as the sampling seam.
    awk() {
      case "$MATRIX_SCENARIO" in
        sampling-malformed-red) printf 'malformed\n'; return 0 ;;
        sampling-unavailable-green) return 1 ;;
      esac
      printf '%s\n' "$MATRIX_LIVE_LOAD"
    }
    getconf() {
      case "$MATRIX_SCENARIO" in
        sampling-malformed-red) printf 'unknown\n'; return 0 ;;
        sampling-unavailable-green) return 1 ;;
      esac
      printf '%s\n' "$MATRIX_LIVE_CORES"
    }
    matrix_event() { printf '%s\n' "$1" >> "$MATRIX_EVENT_FILE"; }
    matrix_exit() { printf '%s\n' "$1" >> "$MATRIX_CALLBACK_FILE"; }
    matrix_cache_head() { printf 'cache-head\n'; }
    matrix_cache_fingerprint() { printf 'cache-fingerprint\n'; }
    matrix_run_head() {
      if [ "$MATRIX_SCENARIO" = stale-reentry-provider-failure ]; then
        matrix_event stale-reentry-provider-failure
        return 2
      fi
      printf 'run-head\n'
    }
    matrix_run_fingerprint() { printf 'run-fingerprint\n'; }
    matrix_final_fingerprint() { printf 'final-fingerprint\n'; }
    matrix_marker_head() { printf 'marker-head\n'; }
    matrix_marker_hit() { matrix_event marker-hit-hook; }
    matrix_admission() {
      if [ "$MATRIX_SCENARIO" = registration-failure ]; then
        matrix_event registration-failure
        return 1
      fi
    }
    matrix_bridge() {
      if [ "$MATRIX_SCENARIO" = bridge-hit ]; then
        matrix_event bridge-hit-predicate
        return 0
      fi
      return 1
    }
    matrix_prepare() {
      if [ "$MATRIX_SCENARIO" = operational-failure ]; then
        matrix_event operational-failure
        return 2
      fi
      # shellcheck disable=SC2034 # Read by name through policy[steps_array].
      MATRIX_STEPS=(contract)
    }
    matrix_success_mode() { printf 'matrix-success\n'; }

    musi_success_marker_matches() {
      if [ "$MATRIX_SCENARIO" = native-marker ]; then
        matrix_event native-marker-match
        return 0
      fi
      return 1
    }
    musi_verify_start_watchdog() {
      # shellcheck disable=SC2034 # Engine reads the watchdog PID global.
      MUSI_VERIFY_WATCHDOG_PID=""
      matrix_event "watchdog-budget:$2"
      case "$MATRIX_SCENARIO" in
        timeout|signal-cleanup-failure) kill -TERM "$BASHPID" ;;
        int-signal) kill -INT "$BASHPID" ;;
      esac
    }
    musi_run_parallel_verify_steps() {
      if [ "$MATRIX_SCENARIO" = runner-abort ]; then
        # The scheduler's pre-launch abort path (a generated artifact edge it
        # cannot honor): it returns non-zero having recorded no slot outcome at
        # all, so the engine must fail the gate on the status rather than
        # aggregating an empty outcome set into a success marker.
        matrix_event "runner:$MATRIX_SCENARIO"
        return 2
      fi
      local -n matrix_names_ref="$6" matrix_pids_ref="$7" \
        matrix_exits_ref="$8" matrix_parallel_ref="$9"
      # shellcheck disable=SC2034 # Output array is consumed by name in the engine.
      matrix_names_ref=(contract)
      # shellcheck disable=SC2034 # Output array is consumed by name in the engine.
      matrix_pids_ref=("")
      # shellcheck disable=SC2034 # Output array is consumed by name in the engine.
      matrix_parallel_ref=("")
      # shellcheck disable=SC2034 # Output array is consumed by name in the engine.
      matrix_exits_ref=(0)
      if [ "$MATRIX_SCENARIO" = slot-failure ] \
         || [ "$MATRIX_SCENARIO" = sampling-malformed-red ]; then
        # shellcheck disable=SC2034 # Output array is consumed by name in the engine.
        matrix_pids_ref=(456)
        # shellcheck disable=SC2034 # Output array is consumed by name in the engine.
        matrix_exits_ref=(300)
      fi
      if [ "$MATRIX_SCENARIO" = slot-not-run ]; then
        # shellcheck disable=SC2034 # Output array is consumed by name in the engine.
        matrix_exits_ref=(300)
      fi
      if [ "$MATRIX_SCENARIO" = slot-failure ]; then
        printf 'failure' > "$MATRIX_LOG_DIR/contract.log"
        MATRIX_LIVE_LOAD='2.00'
        MATRIX_LIVE_CORES='4'
      fi
      matrix_event "runner:$MATRIX_SCENARIO"
    }
    musi_verify_persist_run_meta() { matrix_event "persist:$7"; }
    musi_verify_finalize_success() { matrix_event "finalize-budget:$7"; }
    musi_verify_write_signal_meta() { matrix_event "signal-meta:$1"; }
    musi_verify_report_timeout_budget() { matrix_event timeout-report; }
    if [ "$MATRIX_SCENARIO" = signal-cleanup-failure ]; then
      musi_verify_cleanup_gate() { return 2; }
    fi

    if [ "$MATRIX_SCENARIO" = pre-engine ]; then
      musi_verify_install_exit_dispatcher matrix_exit || exit 2
      matrix_event pre-engine-failure
      exit 9
    fi

    if [ "$MATRIX_SCENARIO" = native-marker ]; then
      : > "$MATRIX_MARKER"
    fi

    # shellcheck disable=SC2034 # Passed by name to musi_verify_run_gate.
    declare -A matrix_policy=(
      [label]='verify:matrix'
      [banner_label]='VERIFY-MATRIX'
      [step_label]=''
      [wrapper_command]='verify.sh --matrix'
      [repo_root]="$PWD"
      [lock_mode]='blocking'
      [lock_path]="$SANDBOX/gate-exit-${scenario}.lock"
      [lock_already_held]='1'
      [commit_queue_mode]='none'
      [commit_queue_lock]=''
      [commit_queue_already_held]='0'
      [commit_queue_timeout]='30'
      [total_timeout]='45'
      [warn_after]='30'
      [marker_path]="$MATRIX_MARKER"
      [marker_freshness]='300'
      [cache_head_provider]='matrix_cache_head'
      [cache_fingerprint_provider]='matrix_cache_fingerprint'
      [run_head_provider]='matrix_run_head'
      [run_fingerprint_provider]='matrix_run_fingerprint'
      [final_fingerprint_provider]='matrix_final_fingerprint'
      [marker_head_provider]='matrix_marker_head'
      [execution_mode]='parallel'
      [consumer]='matrix_consumer'
      [steps_array]='MATRIX_STEPS'
      [signal_mode]='matrix-signal'
      [failure_mode]='matrix-failure'
      [success_mode_provider]='matrix_success_mode'
      [log_dir]="$MATRIX_LOG_DIR"
      [history_dir]="$SANDBOX/gate-exit-${scenario}.history"
      [marker_hit_hook]='matrix_marker_hit'
      [marker_miss_hook]=''
      [bridge_predicate]='matrix_bridge'
      [prepare_slots_hook]='matrix_prepare'
      [after_slots_hook]=''
      [exit_hook]='matrix_exit'
    )
    case "$MATRIX_SCENARIO" in
      native-marker|registration-failure)
        matrix_policy[pre_cache_admission_hook]='matrix_admission'
        ;;
    esac
    if [ "$MATRIX_SCENARIO" = stale-reentry-provider-failure ]; then
      MUSI_VERIFY_GATE_ACTIVE=1
      # shellcheck disable=SC2034 # Read by the sourced EXIT dispatcher.
      MUSI_VERIFY_GATE_STARTING_LOAD_SAMPLE='starting load was 99 on 1 cores'
      # shellcheck disable=SC2034 # Read by the sourced EXIT dispatcher.
      MUSI_VERIFY_GATE_STARTING_LOAD_PRINTED=0
    fi

    if [ "$MATRIX_SCENARIO" = lock-wait ]; then
      MATRIX_DATE_INDEX="$SANDBOX/gate-exit-lock-wait.date-index"
      MATRIX_DATE_VALUES="$SANDBOX/gate-exit-lock-wait.date-values"
      printf '1\n' > "$MATRIX_DATE_INDEX"
      printf '100\n103\n200\n201\n202\n' > "$MATRIX_DATE_VALUES"
      date() {
        if [ "${1:-}" = +%s ]; then
          local index value
          index=$(<"$MATRIX_DATE_INDEX")
          value=$(sed -n "${index}p" "$MATRIX_DATE_VALUES")
          printf '%s\n' "$value"
          printf '%s\n' "$((index + 1))" > "$MATRIX_DATE_INDEX"
        elif [ "${1:-}" = -Iseconds ]; then
          printf '2026-07-20T00:00:00+00:00\n'
        else
          command date "$@"
        fi
      }
      flock() { return 0; }
      # shellcheck disable=SC2034 # Policy is consumed by name in the engine.
      matrix_policy[lock_already_held]='0'
    fi

    matrix_rc=0
    musi_verify_run_gate matrix_policy || matrix_rc=$?
    exit "$matrix_rc"
  ) >"$stdout_file" 2>"$stderr_file"
  actual_status=$?
  set -e
  cat "$stdout_file" "$stderr_file" > "$output_file"

  [ "$actual_status" -eq "$expected_status" ] \
    || fail "$scenario should preserve exit $expected_status (got $actual_status)"
  [ "$(wc -l < "$callback_file")" -eq 1 ] \
    || fail "$scenario should dispatch the exit hook exactly once"
  [ "$(cat "$callback_file")" = "$expected_status" ] \
    || fail "$scenario exit hook should capture status $expected_status"
  grep -qF "$expected_event" "$event_file" \
    || fail "$scenario did not exercise expected behavior $expected_event"

  case "$scenario" in
    slot-failure|slot-not-run|registration-failure|timeout|int-signal|signal-cleanup-failure|operational-failure|runner-abort)
      [ "$(grep -c '^starting load was ' "$output_file")" -eq 1 ] \
        || fail "$scenario should print starting load exactly once: $(cat "$output_file")"
      grep -qxF 'starting load was 37.25 on 16 cores' "$output_file" \
        || fail "$scenario should retain the deterministic gate-start sample"
      ;;
    *)
      if grep -q '^starting load was ' "$output_file"; then
        fail "$scenario should not print starting load: $(cat "$output_file")"
      fi
      ;;
  esac

  case "$scenario" in
    slot-failure)
      sample_line=$(grep -n '^starting load was ' "$stdout_file" | cut -d: -f1)
      footer_line=$(grep -n '^verify: failure logs:' "$stdout_file" | cut -d: -f1)
      [ "$footer_line" -eq "$((sample_line + 1))" ] \
        || fail "authoritative starting load should be directly footer-adjacent"
      grep -qxF 'Failed: contract' "$output_file" \
        || fail "sentinel with a PID should remain in the failed summary"
      if grep -qF 'failurestarting load was' "$output_file"; then
        fail "starting load should begin on a new line after a newline-less excerpt"
      fi
      grep -qF 'not-run sentinel recorded for launched slot contract' "$output_file" \
        || fail "sentinel with a PID should emit the fail-closed diagnostic"
      ;;
    slot-not-run)
      grep -qxF 'Not run: contract' "$output_file" \
        || fail "sentinel without a PID should remain in the not-run summary"
      ;;
    runner-abort)
      [ ! -e "$SANDBOX/gate-exit-${scenario}.marker" ] \
        || fail "an aborted scheduler must not write a success marker"
      if grep -q '^finalize-budget:' "$event_file"; then
        fail "an aborted scheduler must not reach success finalization"
      fi
      grep -qF 'parallel slot scheduler aborted' "$output_file" \
        || fail "an aborted scheduler should name itself in the diagnostic: $(cat "$output_file")"
      ;;
    registration-failure)
      grep -qxF 'Failed: registration' "$output_file" \
        || fail "registration admission should use the shared failure summary"
      ;;
    native-marker|bridge-hit)
      if grep -q '^runner:' "$event_file"; then
        fail "$scenario should short-circuit before slot dispatch"
      fi
      ;;
    timeout)
      grep -qF 'timeout-report' "$event_file" \
        || fail "timeout should report the exhausted budget"
      grep -qxF 'starting load was 37.25 on 16 cores' "$stderr_file" \
        || fail "timeout starting load should stay with stderr budget evidence"
      if grep -q '^starting load was ' "$stdout_file"; then
        fail "timeout starting load should not leak to stdout"
      fi
      ;;
    int-signal)
      if grep -qF 'timeout-report' "$event_file"; then
        fail "INT should not report a watchdog timeout"
      fi
      grep -qxF 'starting load was 37.25 on 16 cores' "$stderr_file" \
        || fail "INT starting load should be emitted on stderr"
      if grep -q '^starting load was ' "$stdout_file"; then
        fail "INT starting load should not leak to stdout"
      fi
      ;;
    signal-cleanup-failure)
      grep -qxF 'starting load was 37.25 on 16 cores' "$stderr_file" \
        || fail "cleanup-failure starting load should be emitted on stderr"
      if grep -q '^starting load was ' "$stdout_file"; then
        fail "cleanup-failure starting load should not fall back to stdout"
      fi
      ;;
  esac
}

run_exit_dispatch_case pre-engine 9 pre-engine-failure
run_exit_dispatch_case slot-failure 1 runner:slot-failure
run_exit_dispatch_case slot-not-run 1 runner:slot-not-run
run_exit_dispatch_case registration-failure 1 registration-failure
run_exit_dispatch_case native-marker 0 native-marker-match
run_exit_dispatch_case bridge-hit 0 bridge-hit-predicate
run_exit_dispatch_case timeout 124 signal-meta:124
run_exit_dispatch_case int-signal 130 signal-meta:130
run_exit_dispatch_case signal-cleanup-failure 124 watchdog-budget:45
run_exit_dispatch_case operational-failure 2 operational-failure
run_exit_dispatch_case runner-abort 2 runner:runner-abort
run_exit_dispatch_case sampling-unavailable-green 0 finalize-budget:45
run_exit_dispatch_case sampling-malformed-red 1 runner:sampling-malformed-red
run_exit_dispatch_case stale-reentry-provider-failure 2 stale-reentry-provider-failure
run_exit_dispatch_case lock-wait 0 finalize-budget:42
grep -qF 'watchdog-budget:42' "$SANDBOX/gate-exit-lock-wait.events" \
  || fail "lock wait should pass its reduced budget to the watchdog"
ok "exit dispatcher preserves status and dispatches once across lifecycle paths"
ok "INT and timeout signals dispatch once with distinct status behavior"
ok "lock wait passes the reduced execution budget through finalization"

cleanup_trace="$SANDBOX/gate-cleanup-mixed.trace"
(
  # shellcheck source=../lib/verify-engine.sh
  . "$SCRIPT_DIR/../lib/verify-engine.sh"
  musi_terminate_process_tree() { printf 'terminate:%s\n' "$1" >> "$cleanup_trace"; }
  musi_wait_for_pid_exit_bounded() { printf 'wait:%s\n' "$1" >> "$cleanup_trace"; }
  musi_verify_gate_trace() { printf '%s\n' "$1" >> "$cleanup_trace"; }
  # shellcheck disable=SC2034 # Read by the sourced cleanup function.
  MUSI_VERIFY_GATE_CLEANED=0
  # shellcheck disable=SC2034 # Read by the sourced cleanup function.
  MUSI_VERIFY_GATE_CURRENT_PID=""
  # shellcheck disable=SC2034 # Read by the sourced cleanup function.
  MUSI_VERIFY_GATE_PARALLEL_PIDS=("" 111 "" 222)
  # shellcheck disable=SC2034 # Read by the sourced cleanup function.
  MUSI_VERIFY_GATE_WATCHDOG_PID=""
  musi_verify_cleanup_gate
  musi_verify_cleanup_gate
)
expected_cleanup_trace='terminate:111
terminate:222
wait:111
wait:222
cleanup'
[ "$(cat "$cleanup_trace")" = "$expected_cleanup_trace" ] \
  || fail "mixed PID cleanup should skip empty entries and run once: $(cat "$cleanup_trace")"
ok "shared cleanup handles mixed empty and populated PID arrays once"

run_admission_signal_evidence_case() {
  local signal_name="$1" expected_status="$2" signal_point="${3:-admission}"
  local case_name="${signal_point}-${signal_name}"
  local log_dir="$SANDBOX/gate-admission-${case_name}.logs"
  local ready="$SANDBOX/gate-admission-${case_name}.ready"
  local signal_meta="$SANDBOX/gate-admission-${case_name}.signal-meta"
  mkdir -p "$log_dir/meta"
  printf 'prior run meta\n' > "$log_dir/run-meta.json"
  printf 'prior wrapper meta\n' > "$log_dir/meta/wrapper.json"
  printf 'prior lint log\n' > "$log_dir/lint.log"
  printf 'prior timings\n' > "$log_dir/test-timings.json"
  printf 'prior diagnostics\n' > "$log_dir/ratchet-diagnostics.json"
  printf 'prior registration\n' > "$log_dir/registration.log"

  set +e
  (
    # shellcheck source=../lib/verify-engine.sh
    . "$SCRIPT_DIR/../lib/verify-engine.sh"
    admission_identity() { printf 'stable-identity\n'; }
    # shellcheck disable=SC2034 # Read by name through policy[steps_array].
    admission_prepare() { ADMISSION_STEPS=(contract); }
    admission_mode() { printf 'admission-signal\n'; }
    admission_condition() {
      [ "$signal_point" != ordinary-pre-removal ]
    }
    admission_block() {
      if [ "$signal_point" = admission ]; then
        : > "$ready"
        sleep 30
      fi
    }
    musi_verify_gate_remove_tree() {
      if { [ "$signal_point" = pre-admission ] \
           || [ "$signal_point" = ordinary-pre-removal ]; } \
         && [ "$1" = "$log_dir" ]; then
        kill -"$signal_name" "$BASHPID"
      fi
      command rm -rf -- "$1"
    }
    musi_verify_start_watchdog() {
      if [ "$signal_point" = admission ]; then
        local hook_pid="$BASHPID"
        (
          while [ ! -f "$ready" ]; do sleep 0.01; done
          kill -"$signal_name" "$hook_pid"
        ) &
        MUSI_VERIFY_WATCHDOG_PID=$!
      else
        MUSI_VERIFY_WATCHDOG_PID=""
      fi
    }
    musi_terminate_process_tree() { kill -TERM "$1" 2>/dev/null || true; }
    musi_wait_for_pid_exit_bounded() { wait "$1" 2>/dev/null || true; }
    musi_verify_write_signal_meta() { : > "$signal_meta"; }
    musi_verify_report_timeout_budget() { :; }

    # shellcheck disable=SC2034 # Passed by name to musi_verify_run_gate.
    declare -A admission_policy=(
      [label]='verify:admission-signal'
      [banner_label]='VERIFY-ADMISSION-SIGNAL'
      [step_label]=''
      [wrapper_command]='verify.sh --admission-signal'
      [repo_root]="$PWD"
      [lock_mode]='blocking'
      [lock_path]="$SANDBOX/gate-admission-${case_name}.lock"
      [lock_already_held]='1'
      [commit_queue_mode]='none'
      [commit_queue_lock]=''
      [commit_queue_already_held]='0'
      [commit_queue_timeout]='30'
      [total_timeout]='45'
      [warn_after]='30'
      [marker_path]="$SANDBOX/gate-admission-${case_name}.marker"
      [marker_freshness]='300'
      [cache_head_provider]='admission_identity'
      [cache_fingerprint_provider]='admission_identity'
      [run_head_provider]='admission_identity'
      [run_fingerprint_provider]='admission_identity'
      [final_fingerprint_provider]='admission_identity'
      [marker_head_provider]='admission_identity'
      [execution_mode]='parallel'
      [consumer]='admission_signal'
      [steps_array]='ADMISSION_STEPS'
      [signal_mode]='admission-signal'
      [failure_mode]='admission-signal'
      [success_mode_provider]='admission_mode'
      [log_dir]="$log_dir"
      [history_dir]="$SANDBOX/gate-admission-${case_name}.history"
      [marker_hit_hook]=''
      [marker_miss_hook]=''
      [pre_cache_admission_condition]='admission_condition'
      [pre_cache_admission_hook]='admission_block'
      [bridge_predicate]=''
      [prepare_slots_hook]='admission_prepare'
      [after_slots_hook]=''
      [exit_hook]=''
    )
    musi_verify_run_gate admission_policy >/dev/null 2>&1
  )
  actual_status=$?
  set -e

  [ "$actual_status" -eq "$expected_status" ] \
    || fail "$case_name should exit $expected_status, got $actual_status"
  [ "$(cat "$log_dir/run-meta.json")" = 'prior run meta' ] \
    || fail "$case_name replaced prior run metadata"
  [ "$(cat "$log_dir/meta/wrapper.json")" = 'prior wrapper meta' ] \
    || fail "$case_name replaced prior wrapper metadata"
  [ "$(cat "$log_dir/lint.log")" = 'prior lint log' ] \
    || fail "$case_name removed prior slot logs"
  [ "$(cat "$log_dir/test-timings.json")" = 'prior timings' ] \
    || fail "$case_name removed prior timings"
  [ "$(cat "$log_dir/ratchet-diagnostics.json")" = 'prior diagnostics' ] \
    || fail "$case_name removed prior diagnostics"
  if [ "$signal_point" = ordinary-pre-removal ]; then
    [ -e "$signal_meta" ] \
      || fail "$case_name did not record signal metadata"
  else
    [ ! -e "$signal_meta" ] \
      || fail "$case_name overwrote restored evidence with signal metadata"
  fi
  [ -f "$log_dir/registration.log" ] \
    || fail "$case_name did not retain registration.log"
  if [ "$signal_point" = pre-admission ]; then
    [ "$(cat "$log_dir/registration.log")" = 'prior registration' ] \
      || fail "$case_name replaced registration evidence before admission"
  fi
}

run_admission_signal_evidence_case TERM 124
run_admission_signal_evidence_case INT 130
run_admission_signal_evidence_case TERM 124 pre-admission
run_admission_signal_evidence_case INT 130 pre-admission
run_admission_signal_evidence_case TERM 124 ordinary-pre-removal
run_admission_signal_evidence_case INT 130 ordinary-pre-removal
ok "ordinary, pre-admission, and admission signals preserve prior evidence"

# Restoration must remain retryable after a failed atomic swap. In particular,
# the first attempt owns the current registration log: a retry must not replace
# that saved copy with whatever tree the failed attempt left live.
(
  # shellcheck source=../lib/verify-engine.sh
  . "$SCRIPT_DIR/../lib/verify-engine.sh"
  log_dir="$SANDBOX/gate-restore-retry.logs"
  mkdir -p "$log_dir/meta"
  printf 'prior run meta\n' > "$log_dir/run-meta.json"
  printf 'prior wrapper meta\n' > "$log_dir/meta/wrapper.json"
  # shellcheck disable=SC2034 # Passed by name to evidence helpers.
  declare -A restore_policy=([log_dir]="$log_dir")
  musi_verify_gate_backup_live_evidence restore_policy \
    || fail "restore retry fixture could not back up prior evidence"
  musi_verify_gate_setup_logs restore_policy \
    || fail "restore retry fixture could not initialize admission logs"
  printf 'current registration\n' > "$log_dir/registration.log"

  restore_swap_fail_once=1
  musi_verify_gate_move_tree() {
    if [ "$restore_swap_fail_once" -eq 1 ] \
       && [[ "$1" = "$log_dir.restore."* ]] && [ "$2" = "$log_dir" ]; then
      restore_swap_fail_once=0
      return 1
    fi
    command mv -- "$1" "$2"
  }

  set +e
  musi_verify_cleanup_gate >/dev/null 2>&1
  first_restore_rc=$?
  set -e
  [ "$first_restore_rc" -eq 2 ] \
    || fail "injected restore swap failure should return 2, got $first_restore_rc"
  [ "$MUSI_VERIFY_GATE_CLEANED" -eq 0 ] \
    || fail "failed restoration must leave cleanup retryable"
  [ "$(cat "$log_dir/registration.log")" = 'current registration' ] \
    || fail "failed restoration exposed a partial or stale live tree"

  printf 'stale retry registration\n' > "$log_dir/registration.log"
  musi_verify_cleanup_gate \
    || fail "cleanup did not retry a transient restore failure"
  [ "$MUSI_VERIFY_GATE_CLEANED" -eq 1 ] \
    || fail "successful restoration did not complete cleanup"
  [ "$(cat "$log_dir/run-meta.json")" = 'prior run meta' ] \
    || fail "restore retry did not recover prior run metadata"
  [ "$(cat "$log_dir/meta/wrapper.json")" = 'prior wrapper meta' ] \
    || fail "restore retry did not recover prior wrapper metadata"
  [ "$(cat "$log_dir/registration.log")" = 'current registration' ] \
    || fail "restore retry re-saved a stale registration log"
  if find "$(dirname "$log_dir")" -maxdepth 1 \
      \( -name "$(basename "$log_dir").restore.*" \
         -o -name "$(basename "$log_dir").restore.*.displaced" \) \
      -print -quit | grep -q .; then
    fail "restore retry left staging or displaced evidence directories"
  fi
) || exit 1
ok "evidence restoration is failure-atomic and retry-safe"

# A second signal can interrupt restoration after the staging tree has moved
# live but before the swap state is committed. Exercise real nested traps at
# that exact boundary so cleanup cannot start a second swap and lose track of
# the first displaced tree.
reentrant_log_dir="$SANDBOX/gate-restore-reentrant.logs"
mkdir -p "$reentrant_log_dir/meta"
printf 'prior run meta\n' > "$reentrant_log_dir/run-meta.json"
printf 'prior wrapper meta\n' > "$reentrant_log_dir/meta/wrapper.json"
set +e
(
  # shellcheck source=../lib/verify-engine.sh
  . "$SCRIPT_DIR/../lib/verify-engine.sh"
  # shellcheck disable=SC2034 # Passed by name to evidence helpers.
  declare -A reentrant_policy=([log_dir]="$reentrant_log_dir")
  musi_verify_gate_backup_live_evidence reentrant_policy \
    || fail "reentrant restore fixture could not back up prior evidence"
  musi_verify_gate_setup_logs reentrant_policy \
    || fail "reentrant restore fixture could not initialize admission logs"
  printf 'current registration\n' > "$reentrant_log_dir/registration.log"

  reentrant_signal_pending=1
  musi_verify_gate_move_tree() {
    command mv -- "$1" "$2" || return $?
    if [ "$reentrant_signal_pending" -eq 1 ] \
       && [[ "$1" = "$reentrant_log_dir.restore."* ]] \
       && [ "$2" = "$reentrant_log_dir" ]; then
      reentrant_signal_pending=0
      kill -INT "$BASHPID"
    fi
  }
  musi_verify_write_signal_meta() { return 0; }
  musi_verify_report_timeout_budget() { return 0; }
  # shellcheck disable=SC2034 # Read by the signal cleanup path.
  MUSI_VERIFY_GATE_ACTIVE=1
  # shellcheck disable=SC2034 # Read by the outer TERM handler after cleanup.
  MUSI_VERIFY_GATE_LOG_DIR="$reentrant_log_dir"
  trap 'musi_verify_gate_handle_signal 130' INT
  trap 'musi_verify_gate_handle_signal 124' TERM
  kill -TERM "$BASHPID"
  exit 99
)
reentrant_status=$?
set -e
[ "$reentrant_status" -eq 124 ] \
  || fail "nested cleanup signal replaced outer signal status: $reentrant_status"
[ "$(cat "$reentrant_log_dir/run-meta.json")" = 'prior run meta' ] \
  || fail "nested cleanup did not restore prior run metadata"
[ "$(cat "$reentrant_log_dir/meta/wrapper.json")" = 'prior wrapper meta' ] \
  || fail "nested cleanup did not restore prior wrapper metadata"
[ "$(cat "$reentrant_log_dir/registration.log")" = 'current registration' ] \
  || fail "nested cleanup did not retain current registration evidence"
if find "$(dirname "$reentrant_log_dir")" -maxdepth 1 \
    \( -name "$(basename "$reentrant_log_dir").restore.*" \
       -o -name "$(basename "$reentrant_log_dir").restore.*.displaced" \) \
    -print -quit | grep -q .; then
  fail "nested cleanup left staging or displaced evidence directories"
fi
ok "evidence restoration ignores reentrant signals during an active swap"

# Exercise the sourced engine directly so lifecycle ordering and identity
# policy stay observable without invoking the real verify slot commands.
(
  # shellcheck source=../lib/verify-engine.sh
  . "$SCRIPT_DIR/../lib/verify-engine.sh"
  expected_engine_functions=(
    musi_verify_start_watchdog
    musi_verify_report_timeout_budget
    musi_verify_persist_run_meta
    musi_verify_write_signal_meta
    musi_verify_print_failure_summary
    musi_verify_print_starting_load
    musi_verify_finalize_success
    musi_verify_gate_trace_event
    musi_verify_cleanup_gate
    musi_verify_dispatch_exit
    musi_verify_install_exit_dispatcher
    musi_verify_gate_policy_error
    musi_verify_gate_path_absolute
    musi_verify_gate_path_is_at_or_beneath
    musi_verify_validate_log_target
    musi_verify_validate_gate_policy
    musi_verify_gate_capture_provider
    musi_verify_gate_acquire_locks
    musi_verify_gate_handle_signal
    musi_verify_gate_setup_logs
    musi_verify_gate_remove_tree
    musi_verify_gate_move_tree
    musi_verify_gate_discard_live_evidence_backup
    musi_verify_gate_backup_live_evidence
    musi_verify_gate_restore_live_evidence_dir
    musi_verify_gate_restore_live_evidence
    musi_verify_gate_activate_runtime
    musi_verify_gate_run_pre_cache_admission
    musi_verify_gate_run_serial_step
    musi_verify_run_gate
  )
  for function_name in "${expected_engine_functions[@]}"; do
    declare -F "$function_name" >/dev/null 2>&1 \
      || fail "verify engine facade is missing function $function_name"
  done
  expected_engine_variables=(
    MUSI_VERIFY_SLOT_NOT_RUN_EXIT
    MUSI_VERIFY_EXIT_DISPATCHER_INSTALLED
    MUSI_VERIFY_EXIT_DISPATCHED
    MUSI_VERIFY_EXIT_HOOK
    MUSI_VERIFY_GATE_ACTIVE
    MUSI_VERIFY_GATE_CLEANED
    MUSI_VERIFY_GATE_CLEANUP_IN_PROGRESS
    MUSI_VERIFY_GATE_WATCHDOG_PID
    MUSI_VERIFY_GATE_CURRENT_PID
    MUSI_VERIFY_GATE_PARALLEL_PIDS
    MUSI_VERIFY_GATE_LIVE_EVIDENCE_BACKUP
    MUSI_VERIFY_GATE_LIVE_EVIDENCE_LOG_DIR
    MUSI_VERIFY_GATE_PRIOR_EVIDENCE_RESTORED
    MUSI_VERIFY_GATE_REGISTRATION_CAPTURED
    MUSI_VERIFY_GATE_EVIDENCE_SWAP_COMPLETE
    MUSI_VERIFY_GATE_EVIDENCE_STAGING_DIR
    MUSI_VERIFY_GATE_EVIDENCE_DISPLACED_DIR
    MUSI_VERIFY_GATE_STARTING_LOAD_SAMPLE
    MUSI_VERIFY_GATE_STARTING_LOAD_PRINTED
  )
  for variable_name in "${expected_engine_variables[@]}"; do
    declare -p "$variable_name" >/dev/null 2>&1 \
      || fail "verify engine facade is missing variable $variable_name"
  done
  trace="$SANDBOX/gate-contract.trace"
  exit_trace="$SANDBOX/gate-contract.exit"
  identity_dir="$SANDBOX/gate-contract-identity"
  log_dir="$SANDBOX/gate-contract-logs"
  mkdir -p "$identity_dir" "$log_dir"
  printf 'cache-head\n' > "$identity_dir/cache-head"
  printf 'cache-fingerprint\n' > "$identity_dir/cache-fingerprint"
  printf 'run-head\n' > "$identity_dir/run-head"
  printf 'run-fingerprint\n' > "$identity_dir/run-fingerprint"
  printf 'pre-slot-fingerprint\n' > "$identity_dir/final-fingerprint"
  printf 'pre-slot-head\n' > "$identity_dir/marker-head"

  musi_verify_gate_trace() { printf '%s\n' "$1" >> "$trace"; }
  contract_cache_head() { cat "$identity_dir/cache-head"; }
  contract_cache_fingerprint() { cat "$identity_dir/cache-fingerprint"; }
  contract_run_head() { cat "$identity_dir/run-head"; }
  contract_run_fingerprint() { cat "$identity_dir/run-fingerprint"; }
  contract_final_fingerprint() { cat "$identity_dir/final-fingerprint"; }
  contract_marker_head() { cat "$identity_dir/marker-head"; }
  contract_marker_hit() { printf 'marker-hit\n' >> "$trace"; }
  contract_marker_miss() { printf 'marker-miss-hook\n' >> "$trace"; }
  contract_bridge_miss() { printf 'bridge-predicate\n' >> "$trace"; return 1; }
  contract_admission() { printf 'registration-admission\n' >> "$trace"; }
  contract_prepare() {
    # shellcheck disable=SC2034 # Read by name through policy[steps_array].
    CONTRACT_STEPS=(contract)
    printf 'prepare-hook\n' >> "$trace"
  }
  contract_after() { printf 'after-hook\n' >> "$trace"; }
  contract_exit() { printf '%s\n' "$1" >> "$exit_trace"; }
  contract_success_mode() { printf 'contract-success\n'; }

  musi_success_marker_matches() { return 1; }
  musi_verify_start_watchdog() {
    printf 'watchdog-helper\n' >> "$trace"
    # shellcheck disable=SC2034 # Engine reads the watchdog PID global.
    MUSI_VERIFY_WATCHDOG_PID=""
  }
  musi_run_parallel_verify_steps() {
    local -n names_ref="$6" pids_ref="$7" exits_ref="$8" parallel_ref="$9"
    # shellcheck disable=SC2034 # Output array is consumed by name in the engine.
    names_ref=(contract)
    # shellcheck disable=SC2034 # Output array is consumed by name in the engine.
    pids_ref=("")
    # shellcheck disable=SC2034 # Output array is consumed by name in the engine.
    exits_ref=(0)
    # shellcheck disable=SC2034 # Output array is consumed by name in the engine.
    parallel_ref=("")
    printf 'parallel-runner:%s:%s\n' "$1" "$4" >> "$trace"
    # Controlled during-slot state change: success metadata must retain the
    # run-start HEAD while final fingerprint and marker HEAD refresh.
    printf 'final-fingerprint\n' > "$identity_dir/final-fingerprint"
    printf 'marker-head\n' > "$identity_dir/marker-head"
  }
  musi_verify_persist_run_meta() {
    printf 'persist:%s:%s:%s\n' "$2" "$9" "${10}" >> "$trace"
  }
  musi_verify_finalize_success() {
    printf 'finalize:%s:%s:%s\n' "$1" "$3" "$4" >> "$trace"
  }

  # shellcheck disable=SC2034 # Passed by name to musi_verify_run_gate.
  declare -A contract_policy=(
    [label]='verify:contract'
    [banner_label]='VERIFY-CONTRACT'
    [step_label]=''
    [wrapper_command]='verify.sh --contract'
    [repo_root]="$PWD"
    [lock_mode]='blocking'
    [lock_path]="$SANDBOX/gate-contract.lock"
    [lock_already_held]='1'
    [commit_queue_mode]='none'
    [commit_queue_lock]=''
    [commit_queue_already_held]='0'
    [commit_queue_timeout]='30'
    [total_timeout]='45'
    [warn_after]='30'
    [marker_path]="$SANDBOX/gate-contract.marker"
    [marker_freshness]='300'
    [cache_head_provider]='contract_cache_head'
    [cache_fingerprint_provider]='contract_cache_fingerprint'
    [run_head_provider]='contract_run_head'
    [run_fingerprint_provider]='contract_run_fingerprint'
    [final_fingerprint_provider]='contract_final_fingerprint'
    [marker_head_provider]='contract_marker_head'
    [execution_mode]='parallel'
    [consumer]='contract_consumer'
    [steps_array]='CONTRACT_STEPS'
    [signal_mode]='contract-signal'
    [failure_mode]='contract-failure'
    [success_mode_provider]='contract_success_mode'
    [log_dir]="$log_dir"
    [history_dir]="$SANDBOX/gate-contract-history"
    [marker_hit_hook]='contract_marker_hit'
    [marker_miss_hook]='contract_marker_miss'
    [pre_cache_admission_hook]='contract_admission'
    [bridge_predicate]='contract_bridge_miss'
    [prepare_slots_hook]='contract_prepare'
    [after_slots_hook]='contract_after'
    [exit_hook]='contract_exit'
  )

  git_dir=$(git rev-parse --absolute-git-dir)
  for unsafe_log_dir in '' / "$PWD" "$git_dir"; do
    contract_policy[log_dir]="$unsafe_log_dir"
    set +e
    musi_verify_run_gate contract_policy >/dev/null 2>&1
    unsafe_rc=$?
    set -e
    [ "$unsafe_rc" -eq 2 ] \
      || fail "unsafe log target should exit 2: ${unsafe_log_dir:-<empty>}"
  done
  set +e
  musi_verify_validate_log_target "$PWD" "$git_dir/objects" >/dev/null 2>&1
  nested_git_rc=$?
  set -e
  [ "$nested_git_rc" -eq 2 ] \
    || fail "log target nested beneath .git should exit 2"

  linked_worktree="$SANDBOX/gate-contract-linked-worktree"
  git worktree add -q --detach "$linked_worktree" HEAD \
    || fail "failed to create linked worktree for common-dir guard test"
  linked_common_dir=$(git -C "$linked_worktree" rev-parse --path-format=absolute --git-common-dir)
  linked_git_pointer="$linked_worktree/.git"
  [ -f "$linked_git_pointer" ] \
    || fail "linked worktree fixture should expose .git as a pointer file"
  set +e
  musi_verify_validate_log_target "$linked_worktree" "$linked_common_dir/refs" >/dev/null 2>&1
  nested_common_rc=$?
  musi_verify_validate_log_target "$linked_worktree" "$linked_git_pointer" >/dev/null 2>&1
  linked_pointer_rc=$?
  set -e
  [ "$nested_common_rc" -eq 2 ] \
    || fail "log target nested beneath the Git common dir should exit 2"

  relative_log_abs=$(
    cd "$SANDBOX"
    musi_verify_gate_path_absolute "$linked_worktree" relative-verify-logs
  )
  [ "$relative_log_abs" = "$linked_worktree/relative-verify-logs" ] \
    || fail "relative MUSI_VERIFY_LOG_DIR should resolve against repo_root: $relative_log_abs"
  [ "$linked_pointer_rc" -eq 2 ] \
    || fail "log target equal to a linked worktree .git pointer should exit 2"
  # shellcheck disable=SC2034 # Restored for the by-name engine call below.
  contract_policy[log_dir]="$log_dir"

  musi_verify_run_gate contract_policy \
    || fail "synthetic gate lifecycle should succeed"
  [ "${#MUSI_VERIFY_GATE_PARALLEL_PIDS[@]}" -eq 0 ] \
    || fail "successful parallel aggregation should clear reaped PID state"
) || exit 1
ok "verify engine facade exposes the complete established shell API"

[ "$(wc -l < "$SANDBOX/gate-contract.exit")" -eq 1 ] \
  || fail "gate exit hook should run exactly once"
[ "$(cat "$SANDBOX/gate-contract.exit")" = 0 ] \
  || fail "gate exit hook should preserve successful status"
grep -qF 'persist:contract-success:run-head:final-fingerprint' \
  "$SANDBOX/gate-contract.trace" \
  || fail "success metadata should combine run HEAD with final fingerprint"
grep -qF 'finalize:verify:contract:marker-head:final-fingerprint' \
  "$SANDBOX/gate-contract.trace" \
  || fail "success marker should combine refreshed marker HEAD with final fingerprint"
grep -qF 'parallel-runner:contract_consumer:' "$SANDBOX/gate-contract.trace" \
  || fail "parallel step label should preserve the quiet empty value"
expected_contract_order='validated
lock
timestamp
traps
watchdog-helper
watchdog
evidence-backup
log-setup
registration-admission
admission
marker-miss
marker-miss-hook
bridge-predicate
bridge-miss
prepare-hook
prepared
parallel-runner:contract_consumer:
slots
after-hook
after-slots
aggregation
persist:contract-success:run-head:final-fingerprint
metadata
finalize:verify:contract:marker-head:final-fingerprint
finalize
cleanup
exit'
[ "$(cat "$SANDBOX/gate-contract.trace")" = "$expected_contract_order" ] \
  || fail "gate lifecycle order drifted: $(cat "$SANDBOX/gate-contract.trace")"
ok "shared gate lifecycle orders callbacks and keeps success identities independent"
ok "shared gate lifecycle rejects empty root repository and Git log targets"

# Invalid policy must fail before lock acquisition or destructive log setup.
invalid_log_dir="$SANDBOX/gate-contract-invalid-logs"
mkdir -p "$invalid_log_dir"
printf 'keep\n' > "$invalid_log_dir/run-meta.json"
(
  # shellcheck source=../lib/verify-engine.sh
  . "$SCRIPT_DIR/../lib/verify-engine.sh"
  # shellcheck disable=SC2034 # Passed by name to musi_verify_run_gate.
  declare -A invalid_policy=([unknown_field]='value' [log_dir]="$invalid_log_dir")
  set +e
  musi_verify_run_gate invalid_policy >/dev/null 2>&1
  invalid_rc=$?
  set -e
  [ "$invalid_rc" -eq 2 ] || fail "invalid gate policy should exit 2, got $invalid_rc"
) || exit 1
[ "$(cat "$invalid_log_dir/run-meta.json")" = keep ] \
  || fail "invalid gate policy wiped logs before validation"
ok "shared gate lifecycle validates policy before locks and log deletion"

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

  assert_memory_wait_timeout_parses() {
    local input="$1" expected="$2" parsed
    parsed="$(musi_memory_wait_timeout_parse "$input" verify-test)" \
      || fail "memory wait timeout $input should parse"
    [ "$parsed" = "$expected" ] \
      || fail "memory wait timeout $input should normalize to $expected, got $parsed"
  }

  assert_memory_wait_timeout_rejected() {
    local input="$1" expected_reason="$2" output rc=0
    output="$(musi_memory_wait_timeout_parse "$input" verify-test 2>&1)" || rc=$?
    [ "$rc" -eq 2 ] \
      || fail "memory wait timeout $input should be rejected with rc=2, got $rc"
    grep -qF "verify-test: invalid MUSI_VERIFY_MEMORY_WAIT_TIMEOUT=$input; $expected_reason" <<< "$output" \
      || fail "memory wait timeout $input used the wrong diagnostic: $output"
  }

  assert_memory_wait_timeout_parses 00030 30
  assert_memory_wait_timeout_parses 0 0
  assert_memory_wait_timeout_parses 9223372036854775807 9223372036854775807
  assert_memory_wait_timeout_rejected '' 'expected whole seconds'
  assert_memory_wait_timeout_rejected typo 'expected whole seconds'
  assert_memory_wait_timeout_rejected 10000000000000000000 \
    'value exceeds the supported whole-second range'
  assert_memory_wait_timeout_rejected 9223372036854775808 \
    'value exceeds the supported whole-second range'

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
  [ "$(musi_verify_slot_expected_peak_mb adr)" -eq 256 ] \
    || fail "adr should use the documented accounting floor"
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
ok "memory budget and wait timeout parser enforce their supported boundaries"

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
output=$(run_verify --changed 2>&1) || fail "verify --changed unexpectedly failed"
[ -f "$MARKER_CHANGED" ] || fail "verify --changed did not write marker"
if grep -q '^starting load was ' <<< "$output"; then
  fail "successful verify --changed should not print starting load: $output"
fi
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

# A launched child exiting 3 must remain failed while a memory-blocked slot is
# not run. This is the real-process collision proof for parallel aggregation.
rm -f "$MARKER_CHANGED"
rm -rf "$LOG_DIR" "$SANDBOX/memory-state"
: > "$STUB_LOG_FILE"
set +e
output=$(STUB_EXIT_lint_suppressions_changed=3 \
  MUSI_VERIFY_MEMORY_AVAILABLE_MB=1500 \
  MUSI_VERIFY_MEMORY_SAFETY_MB=1000 \
  MUSI_VERIFY_MEMORY_WAIT_TIMEOUT=0 \
  FORCE_VERIFY=1 run_verify --changed 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "mixed parallel gate should exit 1: $output"
grep -qxF 'Failed: suppressions' <<< "$output" \
  || fail "launched exit 3 should remain failed: $output"
not_run_line="$(grep -m1 '^Not run:' <<< "$output")" \
  || fail "mixed parallel gate should print Not run: $output"
case " ${not_run_line#Not run:} " in
  *" lint "*) ;;
  *) fail "memory-blocked lint should be reported as not run: $output" ;;
esac
grep -qF 'stub bun run lint:suppressions:changed' "$STUB_LOG_FILE" \
  || fail "exit-3 suppressions stub did not launch"
if grep -qF 'stub bun run lint:changed' "$STUB_LOG_FILE"; then
  fail "memory-blocked lint stub unexpectedly launched"
fi
[ ! -f "$MARKER_CHANGED" ] \
  || fail "mixed parallel gate should not write a success marker"
ok "parallel gate keeps launched exit 3 failed beside not-run slots"

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
  # Both slots declare the artifact edge, but this consumer deliberately has no
  # producing slot — the arm the generator's closure validation now rejects, kept
  # as a runtime tripwire for hand-wired or stale generated data.
  # shellcheck disable=SC2034 # Read by the parallel runner's artifact scheduling pass.
  MUSI_VERIFY_SLOT_REQUIRES_ARTIFACT['test_no_typecheck:lint']='dist-outputs'
  # shellcheck disable=SC2034 # Read by the parallel runner's artifact scheduling pass.
  MUSI_VERIFY_SLOT_REQUIRES_ARTIFACT['test_no_typecheck:ratchet']='dist-outputs'
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

# The producing slot can be present in the consumer's list and still never
# launch: memory admission stops it before dispatch and records the not-run
# sentinel. The dist-deferred slots must propagate that same sentinel, so the
# gate reports them under "Not run" instead of blaming lint and ratchet for a
# failure they never got to have.
(
  LOG_DIR="$SANDBOX/producer-not-launched-logs"
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
  declare -ga MUSI_NOT_LAUNCHED_STEPS=(typecheck lint ratchet)
  producer_side_effect="$SANDBOX/producer-not-launched-side-effect"
  rm -f "$producer_side_effect"
  # shellcheck disable=SC2034 # Resolved by name through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_NOT_LAUNCHED_TYPECHECK_CMD=(bash -c 'touch "$1"' _ "$producer_side_effect")
  # shellcheck disable=SC2034 # Resolved by name through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_NOT_LAUNCHED_LINT_CMD=(bash -c 'touch "$1"' _ "$producer_side_effect")
  # shellcheck disable=SC2034 # Resolved by name through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_NOT_LAUNCHED_RATCHET_CMD=(bash -c 'touch "$1"' _ "$producer_side_effect")
  MUSI_VERIFY_SLOT_CMD_VAR['test_not_launched:typecheck']='MUSI_NOT_LAUNCHED_TYPECHECK_CMD'
  MUSI_VERIFY_SLOT_CMD_VAR['test_not_launched:lint']='MUSI_NOT_LAUNCHED_LINT_CMD'
  # shellcheck disable=SC2034 # Read by musi_resolve_slot_cmd after sourcing steps-lib.
  MUSI_VERIFY_SLOT_CMD_VAR['test_not_launched:ratchet']='MUSI_NOT_LAUNCHED_RATCHET_CMD'
  # shellcheck disable=SC2034 # Read by the parallel runner's artifact scheduling pass.
  MUSI_VERIFY_SLOT_PRODUCES['test_not_launched:typecheck']='dist-outputs'
  # shellcheck disable=SC2034 # Read by the parallel runner's artifact scheduling pass.
  MUSI_VERIFY_SLOT_REQUIRES_ARTIFACT['test_not_launched:lint']='dist-outputs'
  # shellcheck disable=SC2034 # Read by the parallel runner's artifact scheduling pass.
  MUSI_VERIFY_SLOT_REQUIRES_ARTIFACT['test_not_launched:ratchet']='dist-outputs'
  # Deny every memory reservation so the producer crosses the pre-launch
  # admission boundary without a PID, exactly as a real admission failure does.
  musi_memory_budget_try_reserve() { return 2; }
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  step_names=()
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  step_pids=()
  step_exits=()
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  parallel_pids=()

  remove_required_dist_outputs
  musi_run_parallel_verify_steps test_not_launched MUSI_NOT_LAUNCHED_STEPS parallel-test \
    verify:test "$PWD" step_names step_pids step_exits parallel_pids 2>/dev/null
  write_required_dist_outputs
  [ "${step_exits[0]}" = "$MUSI_VERIFY_SLOT_NOT_RUN_EXIT" ] \
    || fail "unlaunched typecheck should record the not-run sentinel: ${step_exits[0]}"
  [ "${step_exits[1]}" = "$MUSI_VERIFY_SLOT_NOT_RUN_EXIT" ] \
    || fail "lint should inherit the not-run sentinel: ${step_exits[1]}"
  [ "${step_exits[2]}" = "$MUSI_VERIFY_SLOT_NOT_RUN_EXIT" ] \
    || fail "ratchet should inherit the not-run sentinel: ${step_exits[2]}"
  [ -z "${step_pids[1]}" ] || fail "deferred lint should not record a slot PID"
  grep -qF "verify:test: cannot run lint because typecheck was not launched, so required dist outputs remain unavailable" "$LOG_DIR/lint.log" \
    || fail "lint missing not-launched assertion: $(cat "$LOG_DIR/lint.log")"
  grep -qF "verify:test: cannot run ratchet because typecheck was not launched, so required dist outputs remain unavailable" "$LOG_DIR/ratchet.log" \
    || fail "ratchet missing not-launched assertion: $(cat "$LOG_DIR/ratchet.log")"
  [ ! -e "$producer_side_effect" ] || fail "no slot command should launch when the producer is not run"
) || exit 1
ok "dist-deferred slots propagate the not-run sentinel when the producer never launches"

# When the producer does launch and fails, the deferred slots are skipped with
# an ordinary failure exit and a reason that names the producer, so the gate
# reports the real cause once instead of three unrelated lint failures.
(
  LOG_DIR="$SANDBOX/producer-failed-logs"
  META_DIR="$LOG_DIR/meta"
  # shellcheck disable=SC2034  # consumed by the sourced steps.generated.sh guard
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

  export MUSI_VERIFY_MEMORY_STATE_ROOT="$SANDBOX/producer-failed-memory-state"
  export MUSI_VERIFY_MEMORY_AVAILABLE_MB=16000
  export MUSI_VERIFY_MEMORY_SAFETY_MB=1000
  export MUSI_VERIFY_MEMORY_POLL_SECONDS=0.1
  rm -rf "$MUSI_VERIFY_MEMORY_STATE_ROOT"
  mkdir -p "$MUSI_VERIFY_MEMORY_STATE_ROOT"

  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  declare -ga MUSI_PRODUCER_FAILED_STEPS=(typecheck lint ratchet)
  consumer_side_effect="$SANDBOX/producer-failed-side-effect"
  rm -f "$consumer_side_effect"
  # shellcheck disable=SC2034 # Resolved by name through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_PRODUCER_FAILED_TYPECHECK_CMD=(bash -c 'exit 3')
  # shellcheck disable=SC2034 # Resolved by name through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_PRODUCER_FAILED_LINT_CMD=(bash -c 'touch "$1"' _ "$consumer_side_effect")
  # shellcheck disable=SC2034 # Resolved by name through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_PRODUCER_FAILED_RATCHET_CMD=(bash -c 'touch "$1"' _ "$consumer_side_effect")
  MUSI_VERIFY_SLOT_CMD_VAR['test_producer_failed:typecheck']='MUSI_PRODUCER_FAILED_TYPECHECK_CMD'
  MUSI_VERIFY_SLOT_CMD_VAR['test_producer_failed:lint']='MUSI_PRODUCER_FAILED_LINT_CMD'
  # shellcheck disable=SC2034 # Read by musi_resolve_slot_cmd after sourcing steps-lib.
  MUSI_VERIFY_SLOT_CMD_VAR['test_producer_failed:ratchet']='MUSI_PRODUCER_FAILED_RATCHET_CMD'
  # shellcheck disable=SC2034 # Read by the parallel runner's artifact scheduling pass.
  MUSI_VERIFY_SLOT_PRODUCES['test_producer_failed:typecheck']='dist-outputs'
  # shellcheck disable=SC2034 # Read by the parallel runner's artifact scheduling pass.
  MUSI_VERIFY_SLOT_REQUIRES_ARTIFACT['test_producer_failed:lint']='dist-outputs'
  # shellcheck disable=SC2034 # Read by the parallel runner's artifact scheduling pass.
  MUSI_VERIFY_SLOT_REQUIRES_ARTIFACT['test_producer_failed:ratchet']='dist-outputs'
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  step_names=()
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  step_pids=()
  step_exits=()
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  parallel_pids=()

  remove_required_dist_outputs
  musi_run_parallel_verify_steps test_producer_failed MUSI_PRODUCER_FAILED_STEPS parallel-test \
    verify:test "$PWD" step_names step_pids step_exits parallel_pids >/dev/null
  write_required_dist_outputs
  [ "${step_exits[0]}" = 3 ] || fail "failing producer should keep its own exit: ${step_exits[0]}"
  [ "${step_exits[1]}" = 1 ] || fail "lint should fail after the producer failed: ${step_exits[1]}"
  [ "${step_exits[2]}" = 1 ] || fail "ratchet should fail after the producer failed: ${step_exits[2]}"
  grep -qF "verify:test: skipped lint because typecheck failed before required dist outputs were available" "$LOG_DIR/lint.log" \
    || fail "lint missing producer-failed assertion: $(cat "$LOG_DIR/lint.log")"
  grep -qF "verify:test: skipped ratchet because typecheck failed before required dist outputs were available" "$LOG_DIR/ratchet.log" \
    || fail "ratchet missing producer-failed assertion: $(cat "$LOG_DIR/ratchet.log")"
  [ ! -e "$consumer_side_effect" ] \
    || fail "dist-deferred commands should never launch after the producer failed"
) || exit 1
ok "dist-deferred slots are skipped with the producer-failed reason when the producer fails"

# The edge is conditional, not an ordering constraint: `requiresArtifact` defers
# a slot only while its artifact is *missing*. With the artifact already in the
# tree the requiring slots must launch in the first dispatch wave alongside the
# producer, and the producer's own outcome must not reach them at all. Without
# this case an implementation that always waited for the producing slot would
# pass every other artifact test here while quietly serializing the parallel
# gate — so the producer both fails and observes the requiring slot running
# concurrently.
(
  LOG_DIR="$SANDBOX/artifact-present-logs"
  META_DIR="$LOG_DIR/meta"
  # shellcheck disable=SC2034  # consumed by the sourced steps.generated.sh guard
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

  export MUSI_VERIFY_MEMORY_STATE_ROOT="$SANDBOX/artifact-present-memory-state"
  export MUSI_VERIFY_MEMORY_AVAILABLE_MB=16000
  export MUSI_VERIFY_MEMORY_SAFETY_MB=1000
  export MUSI_VERIFY_MEMORY_POLL_SECONDS=0.1
  rm -rf "$MUSI_VERIFY_MEMORY_STATE_ROOT"
  mkdir -p "$MUSI_VERIFY_MEMORY_STATE_ROOT"

  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  declare -ga MUSI_ARTIFACT_PRESENT_STEPS=(typecheck lint ratchet)
  present_lint_effect="$SANDBOX/artifact-present-lint-effect"
  present_ratchet_effect="$SANDBOX/artifact-present-ratchet-effect"
  present_witness="$SANDBOX/artifact-present-concurrency-witness"
  rm -f "$present_lint_effect" "$present_ratchet_effect" "$present_witness"
  # The producer waits (bounded, so a serialized implementation cannot deadlock
  # the suite) for the requiring slot's side effect, records that it saw it, and
  # then fails. The witness file is therefore positive proof that lint was
  # already running while the producer had not yet exited.
  # shellcheck disable=SC2034 # Resolved by name through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_ARTIFACT_PRESENT_TYPECHECK_CMD=(bash -c '
    for _ in $(seq 1 100); do
      if [ -e "$1" ]; then
        : > "$2"
        break
      fi
      sleep 0.1
    done
    exit 3
  ' _ "$present_lint_effect" "$present_witness")
  # shellcheck disable=SC2034 # Resolved by name through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_ARTIFACT_PRESENT_LINT_CMD=(bash -c 'touch "$1"' _ "$present_lint_effect")
  # shellcheck disable=SC2034 # Resolved by name through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_ARTIFACT_PRESENT_RATCHET_CMD=(bash -c 'touch "$1"' _ "$present_ratchet_effect")
  MUSI_VERIFY_SLOT_CMD_VAR['test_artifact_present:typecheck']='MUSI_ARTIFACT_PRESENT_TYPECHECK_CMD'
  MUSI_VERIFY_SLOT_CMD_VAR['test_artifact_present:lint']='MUSI_ARTIFACT_PRESENT_LINT_CMD'
  # shellcheck disable=SC2034 # Read by musi_resolve_slot_cmd after sourcing steps-lib.
  MUSI_VERIFY_SLOT_CMD_VAR['test_artifact_present:ratchet']='MUSI_ARTIFACT_PRESENT_RATCHET_CMD'
  # shellcheck disable=SC2034 # Read by the parallel runner's artifact scheduling pass.
  MUSI_VERIFY_SLOT_PRODUCES['test_artifact_present:typecheck']='dist-outputs'
  # shellcheck disable=SC2034 # Read by the parallel runner's artifact scheduling pass.
  MUSI_VERIFY_SLOT_REQUIRES_ARTIFACT['test_artifact_present:lint']='dist-outputs'
  # shellcheck disable=SC2034 # Read by the parallel runner's artifact scheduling pass.
  MUSI_VERIFY_SLOT_REQUIRES_ARTIFACT['test_artifact_present:ratchet']='dist-outputs'
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  step_names=()
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  step_pids=()
  step_exits=()
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  parallel_pids=()

  write_required_dist_outputs
  musi_run_parallel_verify_steps test_artifact_present MUSI_ARTIFACT_PRESENT_STEPS parallel-test \
    verify:test "$PWD" step_names step_pids step_exits parallel_pids >/dev/null
  [ "${step_exits[0]}" = 3 ] || fail "present-artifact producer should keep its own exit: ${step_exits[0]}"
  [ "${step_exits[1]}" = 0 ] \
    || fail "lint must not inherit the producer's failure when the artifact is present: ${step_exits[1]}"
  [ "${step_exits[2]}" = 0 ] \
    || fail "ratchet must not inherit the producer's failure when the artifact is present: ${step_exits[2]}"
  [ -n "${step_pids[1]}" ] || fail "a slot whose artifact is present must record a slot PID"
  [ -e "$present_lint_effect" ] || fail "lint should have run while the artifact was present"
  [ -e "$present_ratchet_effect" ] || fail "ratchet should have run while the artifact was present"
  [ -e "$present_witness" ] \
    || fail "lint should launch alongside the producer, not after it: $(cat "$LOG_DIR/lint.log" 2>/dev/null)"
  if grep -qF "skipped lint because typecheck failed" "$LOG_DIR/lint.log" 2>/dev/null; then
    fail "lint should never be deferred when the artifact is already present"
  fi
) || exit 1
ok "requiring slots launch alongside the producer when the artifact is already present"

# Degrade-cleanly contract for copiers: a consumer whose slots declare no
# artifact edge is never probed and never deferred, so the whole dependency
# branch disappears for an adopter with no producing slot — even with the dist
# outputs this repo's lint needs absent from the tree.
(
  LOG_DIR="$SANDBOX/no-artifact-declaration-logs"
  META_DIR="$LOG_DIR/meta"
  # shellcheck disable=SC2034  # consumed by the sourced steps.generated.sh guard
  TIMINGS_FILE="$LOG_DIR/timings.json"
  mkdir -p "$META_DIR"
  # shellcheck source=../lib/verify-metadata.sh
  . "$SCRIPT_DIR/../lib/verify-metadata.sh"
  # shellcheck source=../lib/parallel-step.sh
  . "$SCRIPT_DIR/../lib/parallel-step.sh"
  # shellcheck source=../verify/steps.generated.sh
  . "$SCRIPT_DIR/../verify/steps.generated.sh"
  # shellcheck source=../verify/steps-lib.sh
  . "$SCRIPT_DIR/../verify/steps-lib.sh"

  export MUSI_VERIFY_MEMORY_STATE_ROOT="$SANDBOX/no-artifact-declaration-memory-state"
  export MUSI_VERIFY_MEMORY_AVAILABLE_MB=16000
  export MUSI_VERIFY_MEMORY_SAFETY_MB=1000
  export MUSI_VERIFY_MEMORY_POLL_SECONDS=0.1
  rm -rf "$MUSI_VERIFY_MEMORY_STATE_ROOT"
  mkdir -p "$MUSI_VERIFY_MEMORY_STATE_ROOT"

  # No probe function is defined in this scope either: an undeclared artifact
  # edge must not reach the probe map at all.
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  declare -ga MUSI_NO_ARTIFACT_STEPS=(lint)
  undeclared_side_effect="$SANDBOX/no-artifact-declaration-side-effect"
  rm -f "$undeclared_side_effect"
  # shellcheck disable=SC2034 # Resolved by name through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_NO_ARTIFACT_LINT_CMD=(bash -c 'touch "$1"' _ "$undeclared_side_effect")
  # shellcheck disable=SC2034 # Read by musi_resolve_slot_cmd after sourcing steps-lib.
  MUSI_VERIFY_SLOT_CMD_VAR['test_no_artifacts:lint']='MUSI_NO_ARTIFACT_LINT_CMD'
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  step_names=()
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  step_pids=()
  step_exits=()
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  parallel_pids=()

  remove_required_dist_outputs
  musi_run_parallel_verify_steps test_no_artifacts MUSI_NO_ARTIFACT_STEPS parallel-test \
    verify:test "$PWD" step_names step_pids step_exits parallel_pids >/dev/null
  write_required_dist_outputs
  [ "${step_exits[0]}" = 0 ] || fail "undeclared slot should run normally: ${step_exits[0]}"
  [ -e "$undeclared_side_effect" ] || fail "undeclared slot should not have been deferred"
) || exit 1
ok "slots without an artifact declaration are never probed or deferred"

# A required artifact with no probe binding is a regeneration problem, not a
# tree state: fail the whole dispatch loudly with the regeneration guidance
# rather than guessing that the artifact is present.
(
  LOG_DIR="$SANDBOX/unbound-artifact-logs"
  META_DIR="$LOG_DIR/meta"
  # shellcheck disable=SC2034  # consumed by the sourced steps.generated.sh guard
  TIMINGS_FILE="$LOG_DIR/timings.json"
  mkdir -p "$META_DIR"
  # shellcheck source=../verify/steps.generated.sh
  . "$SCRIPT_DIR/../verify/steps.generated.sh"
  # shellcheck source=../verify/steps-lib.sh
  . "$SCRIPT_DIR/../verify/steps-lib.sh"

  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  declare -ga MUSI_UNBOUND_STEPS=(lint)
  # shellcheck disable=SC2034 # Resolved by name through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_UNBOUND_LINT_CMD=(bash -c 'exit 0')
  MUSI_VERIFY_SLOT_CMD_VAR['test_unbound:lint']='MUSI_UNBOUND_LINT_CMD'
  # shellcheck disable=SC2034 # Read by the parallel runner's artifact probe pass.
  MUSI_VERIFY_SLOT_REQUIRES_ARTIFACT['test_unbound:lint']='ghost-artifact'
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  step_names=()
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  step_pids=()
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  step_exits=()
  # shellcheck disable=SC2034 # Passed by name to musi_run_parallel_verify_steps.
  parallel_pids=()

  unbound_rc=0
  unbound_stderr="$(musi_run_parallel_verify_steps test_unbound MUSI_UNBOUND_STEPS parallel-test \
    verify:test "$PWD" step_names step_pids step_exits parallel_pids 2>&1 >/dev/null)" || unbound_rc=$?
  [ "$unbound_rc" -eq 2 ] || fail "unbound artifact should abort the dispatch: rc=$unbound_rc"
  case "$unbound_stderr" in
    *'no probe function is bound to artifact ghost-artifact'*) ;;
    *) fail "unbound artifact diagnostic is missing: $unbound_stderr" ;;
  esac
  case "$unbound_stderr" in
    *'bun run verify:steps:check'*) ;;
    *) fail "unbound artifact diagnostic should point at regeneration: $unbound_stderr" ;;
  esac
) || exit 1
ok "a required artifact with no probe binding aborts dispatch with regeneration guidance"

# Empty artifact maps are a real adopter state, so the library cannot read an
# absent map as "no edges declared": a steps.generated.sh from before artifact
# edges existed would miss every lookup, drop the deferral branch, and put the
# consumers back in the race this unit removes. Declared-ness is the staleness
# signal, exactly as it is for the consumer list and the resolver map.
(
  LOG_DIR="$SANDBOX/stale-generated-logs"
  # shellcheck disable=SC2034  # consumed by the sourced steps.generated.sh guard
  TIMINGS_FILE="$LOG_DIR/timings.json"
  mkdir -p "$LOG_DIR"
  # shellcheck source=../verify/steps.generated.sh
  . "$SCRIPT_DIR/../verify/steps.generated.sh"
  unset MUSI_VERIFY_SLOT_REQUIRES_ARTIFACT
  stale_rc=0
  # shellcheck disable=SC1090 # Sourced under test; path is the library itself.
  stale_stderr="$(. "$SCRIPT_DIR/../verify/steps-lib.sh" 2>&1 >/dev/null)" || stale_rc=$?
  [ "$stale_rc" -eq 2 ] \
    || fail "a generated file without artifact maps should abort sourcing: rc=$stale_rc"
  case "$stale_stderr" in
    *'generated artifact edge maps are missing'*) ;;
    *) fail "stale generated file diagnostic is missing: $stale_stderr" ;;
  esac
) || exit 1
ok "steps-lib refuses a steps.generated.sh with no artifact edge maps"

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

  assert_parallel_memory_wait_timeout_rejected() {
    local timeout="$1" expected_reason="$2" output rc=0
    local -a pending=() names=() commands=() starts=() lengths=()
    local -a pids=() exits=() tokens=() parallel=()
    output="$(musi_drain_memory_pending_slots test verify:test verify:test \
      pending names commands starts lengths pids exits tokens parallel "$timeout" 2>&1)" || rc=$?
    [ "$rc" -eq 2 ] \
      || fail "parallel admission should reject timeout $timeout with rc=2, got $rc"
    grep -qF "verify:test: invalid MUSI_VERIFY_MEMORY_WAIT_TIMEOUT=$timeout; $expected_reason" <<< "$output" \
      || fail "parallel admission used the wrong timeout diagnostic: $output"
  }

  assert_parallel_memory_wait_timeout_rejected '' 'expected whole seconds'
  assert_parallel_memory_wait_timeout_rejected typo 'expected whole seconds'
  assert_parallel_memory_wait_timeout_rejected 10000000000000000000 \
    'value exceeds the supported whole-second range'
  assert_parallel_memory_wait_timeout_rejected 9223372036854775808 \
    'value exceeds the supported whole-second range'
  # shellcheck disable=SC2034 # Passed by name to the shared drain parser seam.
  declare -a pending=() names=() commands=() starts=() lengths=() \
    pids=() exits=() tokens=() parallel=()
  musi_drain_memory_pending_slots test verify:test verify:test \
    pending names commands starts lengths pids exits tokens parallel 9223372036854775807 \
    || fail "parallel admission should accept the maximum supported timeout"

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
  export MUSI_VERIFY_MEMORY_WAIT_TIMEOUT=0000
  external_token="$MUSI_VERIFY_MEMORY_STATE_ROOT/reservation.timeout"
  write_live_memory_reservation "$external_token" 5000 external
  # shellcheck disable=SC2034 # Resolved by name in the shared runner.
  MUSI_MEMORY_TIMEOUT_STEPS=(lint)
  timeout_side_effect="$SANDBOX/memory-timeout-side-effect"
  rm -f "$timeout_side_effect"
  # shellcheck disable=SC2034 # Resolved through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_MEMORY_TIMEOUT_CMD=(bash -c 'touch "$1"' _ "$timeout_side_effect")
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
  [ "${step_exits[0]}" -eq "$MUSI_VERIFY_SLOT_NOT_RUN_EXIT" ] \
    || fail "memory wait timeout should mark the pending slot not run"
  [ -z "${step_pids[0]}" ] || fail "memory wait timeout should not record a slot PID"
  [ "$elapsed_seconds" -lt 5 ] || fail "memory wait timeout took ${elapsed_seconds}s"
  grep -qF 'memory wait timed out after 0s for lint' "$LOG_DIR/lint.log" \
    || fail "memory timeout diagnostic is missing: $(cat "$LOG_DIR/lint.log")"
  [ ! -e "$timeout_side_effect" ] || fail "memory-timeout command should never launch"
  [ ! -e "$META_DIR/lint.json" ] || fail "memory-timeout slot should have no step metadata"
  rm -f "$external_token"

  # Non-timeout admission errors cross the same pre-launch boundary and use
  # the same sentinel; their per-slot log retains the distinct reason.
  rm -rf "$LOG_DIR"
  mkdir -p "$META_DIR"
  admission_error_side_effect="$SANDBOX/memory-admission-error-side-effect"
  rm -f "$admission_error_side_effect"
  # shellcheck disable=SC2034 # Passed by name to the shared runner.
  MUSI_MEMORY_ADMISSION_ERROR_STEPS=(suppressions)
  # shellcheck disable=SC2034 # Resolved through MUSI_VERIFY_SLOT_CMD_VAR.
  MUSI_MEMORY_ADMISSION_ERROR_CMD=(bash -c 'touch "$1"' _ "$admission_error_side_effect")
  # shellcheck disable=SC2034 # Read by musi_resolve_slot_cmd in the shared runner.
  MUSI_VERIFY_SLOT_CMD_VAR['memory_admission_error:suppressions']='MUSI_MEMORY_ADMISSION_ERROR_CMD'
  musi_memory_budget_try_reserve() { return 2; }
  # shellcheck disable=SC2034 # Passed by name to the shared runner.
  step_names=()
  # shellcheck disable=SC2034 # Passed by name to the shared runner.
  step_pids=()
  step_exits=()
  # shellcheck disable=SC2034 # Passed by name to the shared runner.
  parallel_pids=()
  musi_run_parallel_verify_steps memory_admission_error \
    MUSI_MEMORY_ADMISSION_ERROR_STEPS parallel-test verify:test "$PWD" \
    step_names step_pids step_exits parallel_pids 2>/dev/null
  [ "${step_exits[0]}" -eq "$MUSI_VERIFY_SLOT_NOT_RUN_EXIT" ] \
    || fail "memory admission error should mark the pending slot not run"
  [ -z "${step_pids[0]}" ] || fail "memory admission error should not record a slot PID"
  grep -qF 'memory admission failed for suppressions (rc=2)' \
    "$LOG_DIR/suppressions.log" \
    || fail "memory admission error diagnostic is missing: $(cat "$LOG_DIR/suppressions.log")"
  [ ! -e "$admission_error_side_effect" ] \
    || fail "memory-admission-error command should never launch"
  [ ! -e "$META_DIR/suppressions.json" ] \
    || fail "memory-admission-error slot should have no step metadata"
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

grep -qF 'bun run adr:check' "$STUB_LOG_FILE" \
  || fail "verify --changed should invoke bun run adr:check"
ok "verify --changed runs ADR cross-link validation"

grep -qF 'bun run docs:lint-coverage-map:check' "$STUB_LOG_FILE" \
  || fail "verify --changed should invoke the gate-default lint coverage map check"
ok "verify --changed runs the gate-default lint coverage map check"

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
  ".codex/skills/playwright-cli/agents/openai.yaml"
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
if grep -q '^starting load was ' <<< "$output"; then
  fail "cached verify --changed should not print starting load: $output"
fi
ok "verify --changed short-circuits on cached marker"

# --- FORCE_VERIFY=1 bypasses the cache ------------------------------------
LINES_BEFORE_FORCE=$(wc -l < "$STUB_LOG_FILE")
FORCE_VERIFY_ENV_LOG="$SANDBOX/force-verify-env.log"
: > "$FORCE_VERIFY_ENV_LOG"
FORCE_VERIFY=1 STUB_FORCE_VERIFY_LOG="$FORCE_VERIFY_ENV_LOG" \
  run_verify --changed >/dev/null || fail "FORCE_VERIFY run failed"
LINES_AFTER_FORCE=$(wc -l < "$STUB_LOG_FILE")
[ "$LINES_AFTER_FORCE" -gt "$LINES_BEFORE_FORCE" ] || fail "FORCE_VERIFY=1 did not bypass cache"
ok "FORCE_VERIFY=1 bypasses cache"
[ -s "$FORCE_VERIFY_ENV_LOG" ] || fail "forced verify did not launch any slot stubs"
[ "$(sort -u "$FORCE_VERIFY_ENV_LOG")" = "<unset>" ] \
  || fail "FORCE_VERIFY leaked into slot environment: $(sort -u "$FORCE_VERIFY_ENV_LOG")"
ok "FORCE_VERIFY is cleared before slots launch"

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
assert_summary_passed_all_but "$output" MUSI_VERIFY_CHANGED_STEPS typecheck
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

# --- ADR failure is reported in the parallel summary ----------------------
rm -f "$MARKER_CHANGED"
: > "$STUB_LOG_FILE"
set +e
output=$(STUB_FAIL_adr_check=1 run_verify --changed 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "verify --changed did not propagate ADR failure"
grep -qF 'Failed: adr' <<< "$output" || fail "summary missed Failed: adr"
assert_summary_passed_all_but "$output" MUSI_VERIFY_CHANGED_STEPS adr
grep -q 'bun run typecheck' "$STUB_LOG_FILE" \
  || fail "parallel changed verify should still start typecheck after ADR failure"
ok "verify --changed reports ADR failure"

# --- coverage-map failure is reported in the parallel summary -------------
rm -f "$MARKER_CHANGED"
: > "$STUB_LOG_FILE"
set +e
output=$(STUB_FAIL_docs_lint_coverage_map_check=1 run_verify --changed 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "verify --changed did not propagate coverage-map failure"
grep -qF 'Failed: coverage-map' <<< "$output" || fail "summary missed Failed: coverage-map"
assert_summary_passed_all_but "$output" MUSI_VERIFY_CHANGED_STEPS coverage-map
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

# --- failure summary ends with a tail-proof failure-logs footer ------------
# The footer must be the summary's LAST line — after every excerpt and hint —
# so `... 2>&1 | tail -n 1` still carries the log-dir breadcrumb after the
# per-slot `--- <task> (full log: ...) ---` headers scroll out of a truncated
# capture. test-timings.json is mentioned only when it exists (early failures
# may not write it).
(
  # shellcheck source=../ai-hooks/output-filter.sh
  . "$SCRIPT_DIR/../ai-hooks/output-filter.sh"
  # shellcheck source=../lib/verify-engine.sh
  . "$SCRIPT_DIR/../lib/verify-engine.sh"
  footer_log_dir="$SANDBOX/footer-logs"
  mkdir -p "$footer_log_dir"
  printf 'stub lint failure\n' > "$footer_log_dir/lint.log"
  printf 'stub test failure\n' > "$footer_log_dir/test.log"
  printf 'memory wait timed out; no slot was launched\n' > "$footer_log_dir/scripts.log"
  summary=$(musi_verify_print_failure_summary 'verify:changed' 7 "$footer_log_dir" \
    ' typecheck' ' lint test')
  footer_line="verify: failure logs: $footer_log_dir (per-slot <slot>.log; wiped by the next verify/pre-commit run — read or copy first)"
  [ "$(printf '%s\n' "$summary" | tail -n 1)" = "$footer_line" ] \
    || fail "failure-logs footer must be the summary's last line, after every hint: $summary"
  grep -qF "bun run lint:fix" <<< "$summary" \
    || fail "footer must not displace the lint repair hint: $summary"
  if grep -q '^Not run:' <<< "$summary"; then
    fail "failure summary should omit Not run when its optional list is empty: $summary"
  fi
  summary=$(musi_verify_print_failure_summary 'verify:changed' 7 "$footer_log_dir" \
    ' typecheck' ' lint test' ' scripts')
  [ "$(printf '%s\n' "$summary" | tail -n 1)" = "$footer_line" ] \
    || fail "not-run summary must preserve the exact final footer: $summary"
  grep -qF $'Failed: lint test\nNot run: scripts' <<< "$summary" \
    || fail "Not run should print immediately after Failed: $summary"
  touch "$footer_log_dir/test-timings.json"
  summary=$(musi_verify_print_failure_summary 'verify:changed' 7 "$footer_log_dir" \
    ' typecheck' ' lint test')
  timings_footer_line="verify: failure logs: $footer_log_dir (per-slot <slot>.log, test-timings.json; wiped by the next verify/pre-commit run — read or copy first)"
  [ "$(printf '%s\n' "$summary" | tail -n 1)" = "$timings_footer_line" ] \
    || fail "footer should mention test-timings.json only when it exists: $summary"
) || exit 1
ok "failure summary ends with the tail-proof failure-logs footer"

# --- the failure-logs footer survives `2>&1 | tail -n 1` -------------------
rm -f "$MARKER_CHANGED"
: > "$STUB_LOG_FILE"
set +e
tail_line=$(STUB_FAIL_typecheck=1 run_verify --changed 2>&1 | tail -n 1)
set -e
[ "$tail_line" = "verify: failure logs: $LOG_DIR (per-slot <slot>.log; wiped by the next verify/pre-commit run — read or copy first)" ] \
  || fail "failed verify output must end with the failure-logs footer: $tail_line"
ok "verify --changed failure footer survives 2>&1 | tail -n 1"

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
[ "$(printf '%s\n' "$output" | tail -n 1)" = 'inspect: bun run verify:logs budget' ] \
  || fail "watchdog budget inspection footer must remain last: $output"
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

# --- serial admission stops before launch without fabricating a failure ----
rm -f "$MARKER_FULL"
rm -rf "$LOG_DIR" "$SANDBOX/memory-state"
: > "$STUB_LOG_FILE"
mkdir -p "$SANDBOX/memory-state"
serial_blocker="$SANDBOX/memory-state/reservation.serial-timeout"
write_live_memory_reservation "$serial_blocker" 5000 external
set +e
output=$(MUSI_VERIFY_MEMORY_AVAILABLE_MB=6000 \
  MUSI_VERIFY_MEMORY_SAFETY_MB=1000 \
  MUSI_VERIFY_MEMORY_WAIT_TIMEOUT=1 \
  FORCE_VERIFY=1 run_verify 2>&1)
exit_code=$?
set -e
rm -f "$serial_blocker"
[ "$exit_code" -eq 1 ] || fail "serial admission timeout should exit 1: $output"
grep -qxF 'Failed:' <<< "$output" \
  || fail "serial admission timeout should leave Failed empty: $output"
not_run_line="$(grep -m1 '^Not run:' <<< "$output")" \
  || fail "serial admission timeout should report not-run slots: $output"
for slot in $(generated_step_names MUSI_VERIFY_STEPS); do
  case " ${not_run_line#Not run:} " in
    *" $slot "*) ;;
    *) fail "serial admission timeout omitted $slot from Not run: $output" ;;
  esac
done
[ ! -s "$STUB_LOG_FILE" ] \
  || fail "serial admission timeout launched a command: $(cat "$STUB_LOG_FILE")"
for slot in $(generated_step_names MUSI_VERIFY_STEPS); do
  [ ! -e "$LOG_DIR/meta/${slot}.json" ] \
    || fail "serial admission timeout should not write $slot step metadata"
done
grep -qF 'serial verification stopped after lint was not admitted' "$LOG_DIR/scripts.log" \
  || fail "serial remainder log should explain why scripts was not run"
[ ! -f "$MARKER_FULL" ] \
  || fail "serial admission timeout should not write a success marker"

# The same numeric value from a child is a genuine failure because launch
# occurred and ordinary serial step metadata records the exit.
rm -f "$MARKER_FULL"
rm -rf "$LOG_DIR" "$SANDBOX/memory-state"
: > "$STUB_LOG_FILE"
set +e
output=$(STUB_EXIT_lint=3 \
  MUSI_VERIFY_MEMORY_AVAILABLE_MB=16000 \
  FORCE_VERIFY=1 run_verify 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "serial launched exit 3 should exit 1: $output"
grep -qxF 'Failed: lint' <<< "$output" \
  || fail "serial launched exit 3 should report lint failed: $output"
if grep -q '^Not run:' <<< "$output"; then
  fail "serial launched exit 3 should not be reported as not run: $output"
fi
grep -qF 'stub bun run lint' "$STUB_LOG_FILE" \
  || fail "serial exit-3 lint stub did not launch"
grep -q '"exit_code":3' "$LOG_DIR/meta/lint.json" \
  || fail "serial launched exit 3 should write step metadata"
[ ! -f "$MARKER_FULL" ] \
  || fail "serial launched exit 3 should not write a success marker"
ok "serial gate separates pre-launch admission from real exit 3"

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

grep -qF 'bun run adr:check' "$STUB_LOG_FILE" \
  || fail "verify (full) should invoke ADR cross-link validation"
ok "verify (full) runs ADR cross-link validation"

grep -qF 'bun run docs:lint-coverage-map:audit' "$STUB_LOG_FILE" \
  || fail "verify (full) should invoke bun run docs:lint-coverage-map:audit (ESLint-reach enforced)"
if grep -qE 'bun run docs:lint-coverage-map:check($| )' "$STUB_LOG_FILE"; then
  fail "verify (full) must not invoke the reach-free lint coverage map check"
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

grep -qF 'bun run adr:check' "$STUB_LOG_FILE" \
  || fail "verify --parallel should invoke ADR cross-link validation"
ok "verify --parallel runs ADR cross-link validation"

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
assert_summary_passed_all_but "$output" MUSI_VERIFY_PARALLEL_STEPS typecheck
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
