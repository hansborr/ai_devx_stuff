#!/usr/bin/env bash
# Pure-shell smoke tests for verify/pre-commit run-meta history persistence.

set -euo pipefail

unset FORCE_VERIFY

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFY_HISTORY="$SCRIPT_DIR/verify-history.sh"
# shellcheck source=./verify-metadata.sh
. "$SCRIPT_DIR/verify-metadata.sh"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

SANDBOX="$(mktemp -d /tmp/musi-verify-history-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

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

  mkdir -p "$target/scripts/ai-hooks" "$target/.husky" "$target/bin" "$target/node_modules/.bin"
  cp "$SCRIPT_DIR/dependency-freshness.sh" "$target/scripts/dependency-freshness.sh"
  cp "$SCRIPT_DIR/prisma-client-freshness.sh" "$target/scripts/prisma-client-freshness.sh"
  cp "$SCRIPT_DIR/doc-length-policy.sh" "$target/scripts/doc-length-policy.sh"
  cp "$SCRIPT_DIR/verify-metadata.sh" "$target/scripts/verify-metadata.sh"
  cp "$SCRIPT_DIR/ai-hooks/output-filter.sh" "$target/scripts/ai-hooks/output-filter.sh"
  cp "$SCRIPT_DIR/../.husky/pre-commit" "$target/.husky/pre-commit"
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
