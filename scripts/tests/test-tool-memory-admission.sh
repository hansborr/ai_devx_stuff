#!/usr/bin/env bash
# smoke-order: 012
# smoke-subjects: package.json
# smoke-subjects: scripts/lib/tool-memory-admission.sh
# smoke-subjects: scripts/verify/admitted-command.sh
# smoke-subjects: scripts/verify/memory-budget.sh
# smoke-subjects: scripts/test-all.sh
# smoke-subjects: scripts/vitest.sh
# smoke-subjects: scripts/lint.sh
# smoke-subjects: scripts/test-scripts.sh
# smoke-subjects: scripts/lint-ratchet.sh
# smoke-subjects: scripts/tests/test-tool-memory-admission.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

SANDBOX="$(mktemp -d /tmp/musi-tool-memory-admission.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT
mkdir -p "$SANDBOX/bin"

# shellcheck source=../lib/tool-memory-admission.sh
. "$SCRIPT_DIR/../lib/tool-memory-admission.sh"

grep -q '"lint:ratchet": "bash scripts/lint-ratchet.sh"' "$REPO_ROOT/package.json" \
  || fail "bun run lint:ratchet must route through the admitted shell entry point"
grep -q '"test:coverage": "bash scripts/test-all.sh --coverage"' "$REPO_ROOT/package.json" \
  || fail "bun run test:coverage must route coverage through test-all admission"

unset MUSI_VERIFY_MEMORY_ADMITTED MUSI_VERIFY_MEMORY_ADMISSION_TOKEN \
  MUSI_TOOL_MEMORY_ADMISSION_BYPASS
musi_tool_memory_admission_needed full \
  || fail "an unmarked full run should require tool-entry admission"
if musi_tool_memory_admission_needed focused; then
  fail "focused runs must not reserve a full-suite expected peak"
fi

# A detached descendant may retain the legacy ambient boolean after the
# admitted child and its reservation are gone. That stale marker must not let a
# later heavy invocation escape admission.
# shellcheck disable=SC2034 # Must be ignored by the sourced admission policy.
MUSI_VERIFY_MEMORY_ADMITTED=1
if ! musi_tool_memory_admission_needed full; then
  fail "a stale ambient admission marker must not bypass admission"
fi
unset MUSI_VERIFY_MEMORY_ADMITTED

live_token="$SANDBOX/live-reservation"
reservation_owner_pid="$BASHPID"
printf 'pid=%s\nmb=3200\nslot=test\n' "$reservation_owner_pid" > "$live_token"
# shellcheck disable=SC2034 # Read by the sourced admission policy function.
MUSI_VERIFY_MEMORY_ADMISSION_TOKEN="$live_token"
if ! musi_tool_memory_admission_needed full; then
  fail "a token without process start identity must fail closed"
fi
owner_start_time="$(awk '{ print $22 }' "/proc/$reservation_owner_pid/stat")"
printf 'pid=%s\npid_start_time=%s\nmb=3200\nslot=test\n' \
  "$reservation_owner_pid" "$((owner_start_time + 1))" > "$live_token"
if ! musi_tool_memory_admission_needed full; then
  fail "a reused PID with a mismatched process start time must fail closed"
fi
printf 'pid=%s\npid_start_time=%s\nmb=3200\nslot=test\n' \
  "$reservation_owner_pid" "$owner_start_time" > "$live_token"
if musi_tool_memory_admission_needed full; then
  fail "a process tree backed by a live reservation must not admit twice"
fi
rm -f "$live_token"
if ! musi_tool_memory_admission_needed full; then
  fail "a detached descendant whose reservation ended must admit normally"
fi
unset MUSI_VERIFY_MEMORY_ADMISSION_TOKEN

# shellcheck disable=SC2034 # Read by the sourced admission policy function.
MUSI_TOOL_MEMORY_ADMISSION_BYPASS=1
if musi_tool_memory_admission_needed full; then
  fail "the documented tool-entry bypass must skip admission"
fi
unset MUSI_TOOL_MEMORY_ADMISSION_BYPASS
ok "admission policy requires a live reservation token for nested skips"

export MUSI_VERIFY_MEMORY_STATE_ROOT="$SANDBOX/direct-state"
export MUSI_VERIFY_MEMORY_AVAILABLE_MB=16000
export MUSI_VERIFY_MEMORY_SAFETY_MB=1000
export MUSI_VERIFY_OOM_SCORE_ADJ_FILE="$SANDBOX/oom_score_adj"
printf '0\n' > "$MUSI_VERIFY_OOM_SCORE_ADJ_FILE"

probe="$SANDBOX/probe.sh"
cat > "$probe" <<'PROBE'
#!/usr/bin/env bash
set -eu
. "$MUSI_TEST_REPO_ROOT/scripts/lib/tool-memory-admission.sh"
[ -n "${MUSI_VERIFY_MEMORY_ADMISSION_TOKEN:-}" ] || exit 10
[ -e "$MUSI_VERIFY_MEMORY_ADMISSION_TOKEN" ] || exit 15
if musi_tool_memory_admission_needed full; then
  exit 14
fi
set -- "$MUSI_VERIFY_MEMORY_STATE_ROOT"/reservation.*
[ "$#" -eq 1 ] && [ -e "$1" ] || exit 11
[ "$(sed -n 's/^slot=//p' "$1")" = test ] || exit 12
[ "$(cat "$MUSI_VERIFY_OOM_SCORE_ADJ_FILE")" -ge 500 ] || exit 13
PROBE
chmod +x "$probe"

export MUSI_TEST_REPO_ROOT="$REPO_ROOT"
musi_tool_memory_run_admitted test test:direct "$probe" \
  || fail "direct admission wrapper did not run its marked child"
if compgen -G "$MUSI_VERIFY_MEMORY_STATE_ROOT/reservation.*" >/dev/null; then
  fail "direct admission wrapper leaked its reservation"
fi
ok "direct wrapper owns one reservation and raises the child tree OOM score"

make_blocker() {
  local state_root="$1"
  local owner_pid owner_start_time
  rm -rf "$state_root"
  mkdir -p "$state_root"
  owner_pid="$BASHPID"
  owner_start_time="$(awk '{ print $22 }' "/proc/$owner_pid/stat")"
  printf 'pid=%s\npid_start_time=%s\nmb=3000\nslot=external\n' \
    "$owner_pid" "$owner_start_time" > "$state_root/reservation.blocker"
}

expect_full_entry_admission() {
  local label="$1" slot="$2"
  shift 2
  local state_root="$SANDBOX/full-$slot" output rc=0

  make_blocker "$state_root"
  output=$(
    MUSI_VERIFY_MEMORY_STATE_ROOT="$state_root" \
    MUSI_VERIFY_MEMORY_AVAILABLE_MB=6000 \
    MUSI_VERIFY_MEMORY_SAFETY_MB=1000 \
    MUSI_VERIFY_MEMORY_WAIT_TIMEOUT=0 \
      "$@" 2>&1
  ) || rc=$?
  [ "$rc" -eq 3 ] \
    || fail "$label should stop at memory admission (rc=$rc): $output"
  printf '%s' "$output" | grep -q "expected peak $(musi_verify_slot_expected_peak_mb "$slot") MB" \
    || fail "$label did not request the $slot expected peak: $output"
}

cat > "$SANDBOX/bin/vitest-scope-escape" <<'VITEST_ESCAPE'
#!/usr/bin/env bash
exit 97
VITEST_ESCAPE
chmod +x "$SANDBOX/bin/vitest-scope-escape"
export MUSI_VITEST_BIN="$SANDBOX/bin/vitest-scope-escape"

REAL_BUN="$(command -v bun)"
cat > "$SANDBOX/bin/bun" <<BUN_ESCAPE
#!/usr/bin/env bash
case "\${1:-}" in
  */scripts/client-test-isolation-runner.ts|scripts/client-test-isolation-runner.ts)
    exit 98
    ;;
esac
exec "$REAL_BUN" "\$@"
BUN_ESCAPE
chmod +x "$SANDBOX/bin/bun"
export PATH="$SANDBOX/bin:$PATH"

expect_full_entry_admission "bun run test" test bash "$REPO_ROOT/scripts/test-all.sh"
expect_full_entry_admission "bun run test -- --config <file>" test \
  bash "$REPO_ROOT/scripts/test-all.sh" --config vitest.config.ts
expect_full_entry_admission "bun run test -- --reporter <name> --outputFile <file>" test \
  bash "$REPO_ROOT/scripts/test-all.sh" --reporter json --outputFile results.json
expect_full_entry_admission "bun run test -- --root=." test \
  bash "$REPO_ROOT/scripts/test-all.sh" --root=.
expect_full_entry_admission "bun run test -- --exclude <glob>" test \
  bash "$REPO_ROOT/scripts/test-all.sh" --exclude one-file.test.ts
expect_full_entry_admission "bun run test -- --shard=1/1" test \
  bash "$REPO_ROOT/scripts/test-all.sh" --shard=1/1
expect_full_entry_admission "bun run test -- every project" test \
  bash "$REPO_ROOT/scripts/test-all.sh" \
    --project=shared --project=server --project=client \
    --project=eslint-rules --project=scripts
expect_full_entry_admission "bun run test -- four project subset" test \
  bash "$REPO_ROOT/scripts/test-all.sh" \
    --project=shared --project=server --project=client --project=eslint-rules
expect_full_entry_admission "bun run test -- custom config project" test \
  bash "$REPO_ROOT/scripts/test-all.sh" --config vitest.config.ts --project=scripts
expect_full_entry_admission "bun run test -- packages directory" test \
  bash "$REPO_ROOT/scripts/test-all.sh" packages
expect_full_entry_admission "bun run test -- scripts/.." test \
  bash "$REPO_ROOT/scripts/test-all.sh" scripts/..
expect_full_entry_admission "bun run test -- packages/server/../.." test \
  bash "$REPO_ROOT/scripts/test-all.sh" packages/server/../..
expect_full_entry_admission "bun run test -- nonexistent scripts root equivalent" test \
  bash "$REPO_ROOT/scripts/test-all.sh" scripts/does-not-exist/../..
expect_full_entry_admission "bun run test -- nonexistent package root equivalent" test \
  bash "$REPO_ROOT/scripts/test-all.sh" packages/server/does-not-exist/../../..
expect_full_entry_admission "bun run test -- .test.ts" test \
  bash "$REPO_ROOT/scripts/test-all.sh" .test.ts
expect_full_entry_admission "bun run test -- .spec.tsx" test \
  bash "$REPO_ROOT/scripts/test-all.sh" .spec.tsx
expect_full_entry_admission "bun run test -- bare test substring" test \
  bash "$REPO_ROOT/scripts/test-all.sh" test
expect_full_entry_admission "bun run lint" lint bash "$REPO_ROOT/scripts/lint.sh"
expect_full_entry_admission "bun run test:scripts" scripts bash "$REPO_ROOT/scripts/test-scripts.sh"
expect_full_entry_admission "bun run lint:ratchet" ratchet bash "$REPO_ROOT/scripts/lint-ratchet.sh"
ok "all four full direct entry points use their measured admission slots"

cat > "$SANDBOX/bin/vitest-probe" <<'VITEST'
#!/usr/bin/env bash
set -eu
for reservation in "$MUSI_VERIFY_MEMORY_STATE_ROOT"/reservation.*; do
  [ -e "$reservation" ] || continue
  [ "$(sed -n 's/^slot=//p' "$reservation")" != test ] || exit 20
done
printf '%s\n' "$*" >> "$MUSI_TEST_PROBE_LOG"
VITEST
chmod +x "$SANDBOX/bin/vitest-probe"

focused_state="$SANDBOX/focused-state"
make_blocker "$focused_state"
export MUSI_VERIFY_MEMORY_STATE_ROOT="$focused_state"
export MUSI_VERIFY_MEMORY_AVAILABLE_MB=6000
export MUSI_VERIFY_MEMORY_SAFETY_MB=1000
export MUSI_VERIFY_MEMORY_WAIT_TIMEOUT=0
export MUSI_VITEST_BIN="$SANDBOX/bin/vitest-probe"
export MUSI_TEST_PROBE_LOG="$SANDBOX/focused.log"

bash "$REPO_ROOT/scripts/test-all.sh" scripts/lint-coverage-map-check.test.ts \
  || fail "a positional focused test should bypass full-suite admission"
bash "$REPO_ROOT/scripts/test-all.sh" \
  --reporter json --outputFile results.json scripts/lint-coverage-map-check.test.ts \
  || fail "reporter values before a positional file must remain a focused run"
[ "$(wc -l < "$MUSI_TEST_PROBE_LOG")" -eq 2 ] \
  || fail "focused test probes did not all reach Vitest"
MUSI_SCRIPTS_CHANGED_FILES=README.md bash "$REPO_ROOT/scripts/test-scripts.sh" --changed \
  || fail "changed script smoke selection should bypass full-suite admission"
ok "focused test and changed-script runs do not reserve full-suite peaks"

printf 'tool memory admission smoke tests passed (%d assertions)\n' "$PASS"
