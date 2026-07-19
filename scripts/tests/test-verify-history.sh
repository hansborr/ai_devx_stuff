#!/usr/bin/env bash
# smoke-order: 040
# smoke-subjects: scripts/verify-history.sh
# smoke-subjects: scripts/tests/test-verify-history.sh
# smoke-subjects: scripts/lib/verify-metadata.sh
# smoke-subjects: scripts/path-policy/path-policy-query.ts
# smoke-subjects: scripts/path-policy/path-policy-query-core.ts
# smoke-subjects: scripts/path-policy/path-policy.ts
# smoke-subjects: scripts/path-policy/path-policy-smoke-subjects.ts
# smoke-subjects: scripts/path-policy/path-policy-smoke-subjects-data.ts
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/verify/steps.generated.sh
# smoke-subjects: scripts/verify/steps-lib.sh
# smoke-subjects: scripts/verify/memory-budget.sh
# smoke-subjects: scripts/verify/admitted-command.sh
# smoke-subjects: scripts/lib/verify-engine.sh
# smoke-subjects: scripts/lib/test-worker-count.sh
# smoke-subjects: scripts/lib/gate-env.sh
# smoke-subjects: scripts/dependency-freshness.sh
# smoke-subjects: scripts/prisma-client-freshness.sh
# smoke-subjects: scripts/doc-length-policy.sh
# smoke-subjects: scripts/process-tree.sh
# smoke-subjects: scripts/lib/parallel-step.sh
# smoke-subjects: scripts/lib/lint-dist-preflight.sh
# smoke-subjects: scripts/ai-hooks/output-filter.sh
# smoke-subjects: .husky/pre-commit
# smoke-subjects: package.json
# Pure-shell smoke tests for verify/pre-commit run-meta history persistence.

set -euo pipefail

unset FORCE_VERIFY

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
VERIFY_HISTORY="$SCRIPT_DIR/../verify-history.sh"
export MUSI_PATH_POLICY_QUERY="$SCRIPT_DIR/../path-policy/path-policy-query.ts"
MUSI_PATH_POLICY_BUN="$(command -v bun)"
export MUSI_PATH_POLICY_BUN
# Sandbox copies of verify-metadata.sh resolve the run-meta codec from the
# source tree (same seam pattern as MUSI_PATH_POLICY_QUERY above).
export MUSI_VERIFY_META_CORE="$SCRIPT_DIR/../lib/verify-metadata-core.ts"
MUSI_VERIFY_META_BUN="$(command -v bun)"
export MUSI_VERIFY_META_BUN
# shellcheck source=../lib/verify-metadata.sh
. "$SCRIPT_DIR/../lib/verify-metadata.sh"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

SANDBOX="$(mktemp -d /tmp/musi-verify-history-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT
# Nested pre-commit fixtures are independent gates and must not inherit an
# outer test:scripts reservation namespace.
export MUSI_VERIFY_MEMORY_STATE_ROOT="$SANDBOX/memory-state"

write_run_meta() {
  local file="$1"
  local mode="$2"
  local start_time="$3"
  local elapsed="$4"
  local exit_code="$5"
  local head="$6"

  mkdir -p "$(dirname "$file")"
  printf '{"version":1,"mode":"%s","generated_at":"2026-05-21T15:40:00Z","wrapper":{"name":"wrapper","mode":"%s","start_time":"%s","end_time":"2026-05-21T15:36:11Z","elapsed_seconds":%s,"exit_code":%s,"head":"%s","fingerprint":"abc","command":"bash scripts/verify.sh --changed"},"steps":[]}\n' \
    "$mode" "$mode" "$start_time" "$elapsed" "$exit_code" "$head" > "$file"
}

bash -n "$VERIFY_HISTORY" || fail "verify-history.sh fails bash -n"
ok "verify-history.sh passes bash -n"

if MUSI_VERIFY_HISTORY_DIR="$SANDBOX/missing" bash "$VERIFY_HISTORY" --bogus >/dev/null 2>&1; then
  fail "verify-history.sh accepted an unknown flag"
fi
ok "verify-history.sh rejects unknown flags"

LOG_DIR="$SANDBOX/logs"
HISTORY_DIR="$SANDBOX/history"
RUN_META="$LOG_DIR/run-meta.json"
START_TIME="2026-05-21T15:32:11Z"
START_EPOCH="$(date -d "$START_TIME" +%s)"
HEAD_SHA="a1146555bbed0000000000000000000000000000"

write_run_meta "$RUN_META" parallel-precommit "$START_TIME" 240 124 "$HEAD_SHA"
musi_persist_run_meta_history "$LOG_DIR" "$HISTORY_DIR"

EXPECTED_HISTORY="$HISTORY_DIR/$START_EPOCH-parallel-precommit-124.json"
[ -f "$EXPECTED_HISTORY" ] || fail "history file missing: $EXPECTED_HISTORY"
cmp -s "$RUN_META" "$EXPECTED_HISTORY" || fail "history file should copy run-meta.json exactly"
ok "helper writes timestamp-mode-exit history file"

output="$(MUSI_VERIFY_HISTORY_DIR="$HISTORY_DIR" bash "$VERIFY_HISTORY" --limit 1)"
grep -qF "TIMESTAMP" <<< "$output" || fail "history output missing header: $output"
grep -qE '2026-05-21T15:32:11Z +parallel-precommit +124 +240s +a1146555' <<< "$output" \
  || fail "history output missing persisted run row: $output"
ok "verify:history prints a newest-first table row"

# Display-only read path stays silent on degraded rows (legacy sed parity):
# wrapper:null and malformed-JSON entries fall back to filename-derived
# fields without leaking codec stderr to the terminal.
DEGRADED_HISTORY="$SANDBOX/degraded-history"
mkdir -p "$DEGRADED_HISTORY"
printf '{"version":1,"mode":"serial-verify","generated_at":"x","wrapper":null,"steps":[]}\n' \
  > "$DEGRADED_HISTORY/$START_EPOCH-serial-verify-0.json"
printf '{oops\n' > "$DEGRADED_HISTORY/$((START_EPOCH + 1))-serial-verify-1.json"
degraded_stderr="$SANDBOX/degraded-stderr"
degraded_output="$(MUSI_VERIFY_HISTORY_DIR="$DEGRADED_HISTORY" bash "$VERIFY_HISTORY" 2> "$degraded_stderr")" \
  || fail "verify:history must succeed on degraded history rows"
grep -qE 'serial-verify +0' <<< "$degraded_output" \
  || fail "degraded rows should fall back to filename-derived fields: $degraded_output"
[ ! -s "$degraded_stderr" ] \
  || fail "display read path must not leak codec stderr: $(cat "$degraded_stderr")"
ok "verify:history stays silent on wrapper:null and malformed rows"

RETENTION_LOG="$SANDBOX/retention-logs"
RETENTION_HISTORY="$SANDBOX/retention-history"
for offset in 0 1 2; do
  start_epoch=$((START_EPOCH + offset))
  start_time="$(date -u -d "@$start_epoch" '+%Y-%m-%dT%H:%M:%SZ')"
  write_run_meta "$RETENTION_LOG/run-meta.json" serial-verify-changed "$start_time" 10 "$offset" "$HEAD_SHA"
  MUSI_VERIFY_HISTORY_LIMIT=2 musi_persist_run_meta_history "$RETENTION_LOG" "$RETENTION_HISTORY"
done
count="$(find "$RETENTION_HISTORY" -maxdepth 1 -type f -name '*.json' | wc -l | tr -d ' ')"
[ "$count" = "2" ] || fail "history retention should keep 2 files, kept $count"
ok "helper prunes history to MUSI_VERIFY_HISTORY_LIMIT"

MALFORMED_LOG="$SANDBOX/malformed-logs"
MALFORMED_HISTORY="$SANDBOX/malformed-history"
mkdir -p "$MALFORMED_LOG"
printf '{"version":1,"wrapper":null,"steps":[]}\n' > "$MALFORMED_LOG/run-meta.json"
set +e
malformed_output="$(musi_persist_run_meta_history "$MALFORMED_LOG" "$MALFORMED_HISTORY" 2>&1)"
malformed_exit=$?
set -e
[ "$malformed_exit" -eq 0 ] || fail "malformed run-meta should be non-fatal"
grep -qF "verify history: WARN:" <<< "$malformed_output" \
  || fail "malformed run-meta should warn: $malformed_output"
[ ! -d "$MALFORMED_HISTORY" ] || fail "malformed run-meta should not create history"
ok "helper treats malformed run-meta as a warning"

BLOCKED_HISTORY="$SANDBOX/history-file"
: > "$BLOCKED_HISTORY"
set +e
blocked_output="$(musi_persist_run_meta_history "$LOG_DIR" "$BLOCKED_HISTORY" 2>&1)"
blocked_exit=$?
set -e
[ "$blocked_exit" -eq 0 ] || fail "blocked history path should be non-fatal"
grep -qF "verify history: WARN:" <<< "$blocked_output" \
  || fail "blocked history path should warn: $blocked_output"
ok "helper treats history write failures as warnings"

copy_precommit_fixture() {
  local target="$1"

  mkdir -p "$target/scripts/ai-hooks" "$target/scripts/lib" "$target/scripts/verify" "$target/.husky" "$target/bin" "$target/node_modules/.bin"
  cp "$SCRIPT_DIR/../dependency-freshness.sh" "$target/scripts/dependency-freshness.sh"
  cp "$SCRIPT_DIR/../prisma-client-freshness.sh" "$target/scripts/prisma-client-freshness.sh"
  cp "$SCRIPT_DIR/../doc-length-policy.sh" "$target/scripts/doc-length-policy.sh"
  cp "$SCRIPT_DIR/../lib/verify-metadata.sh" "$target/scripts/lib/verify-metadata.sh"
  cp "$SCRIPT_DIR/../lib/gate-env.sh" "$target/scripts/lib/gate-env.sh"
  cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$target/scripts/lib/test-worker-count.sh"
  cp "$SCRIPT_DIR/../process-tree.sh" "$target/scripts/process-tree.sh"
  cp "$SCRIPT_DIR/../lib/parallel-step.sh" "$target/scripts/lib/parallel-step.sh"
  cp "$SCRIPT_DIR/../lib/verify-engine.sh" "$target/scripts/lib/verify-engine.sh"
  cp "$SCRIPT_DIR/../lib/lint-dist-preflight.sh" "$target/scripts/lib/lint-dist-preflight.sh"
  cp "$SCRIPT_DIR/../ai-hooks/output-filter.sh" "$target/scripts/ai-hooks/output-filter.sh"
  cp "$SCRIPT_DIR/../verify/steps.generated.sh" "$SCRIPT_DIR/../verify/steps-lib.sh" \
    "$SCRIPT_DIR/../verify/memory-budget.sh" "$SCRIPT_DIR/../verify/admitted-command.sh" \
    "$target/scripts/verify/"
  cp "$SCRIPT_DIR/../../.husky/pre-commit" "$target/.husky/pre-commit"
  cat > "$target/bin/bun" <<'STUB'
#!/usr/bin/env sh
printf 'stub bun %s\n' "$*" >> "$STUB_LOG"
exit 0
STUB
  chmod +x "$target/bin/bun"
}

HOOK_REPO="$SANDBOX/hook-repo"
copy_precommit_fixture "$HOOK_REPO"
(
  cd "$HOOK_REPO"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add .husky scripts bin
  git commit -q -m init
  printf '{"name":"fixture"}\n' > package.json
  git add package.json

  history_file="$HOOK_REPO/history-file"
  log_dir="$HOOK_REPO/precommit-logs"
  marker="$HOOK_REPO/precommit-marker"
  stub_log="$HOOK_REPO/bun.log"
  : > "$history_file"
  : > "$stub_log"

  output="$(
    PATH="$HOOK_REPO/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$HOOK_REPO/precommit-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
    MUSI_VERIFY_HISTORY_DIR="$history_file" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should succeed when history write fails: $output"

  grep -qF "verify history: WARN:" <<< "$output" \
    || fail "pre-commit should warn when history write fails: $output"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit should still finish OK when history write fails: $output"
  [ -f "$log_dir/run-meta.json" ] || fail "pre-commit should still write run-meta.json"
  grep -qF "stub bun run lint:changed" "$stub_log" \
    || fail "pre-commit should still run checks when history write fails"
  grep -qF "stub bun run test:scripts:changed" "$stub_log" \
    || fail "pre-commit should run script smokes for package.json changes"
)
ok "pre-commit history write failures do not fail the hook"

printf 'verify history tests passed (%d)\n' "$PASS"
