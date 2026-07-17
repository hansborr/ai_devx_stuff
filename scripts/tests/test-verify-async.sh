#!/usr/bin/env bash
# smoke-order: 020
# smoke-subjects: scripts/verify-async.sh
# smoke-subjects: scripts/tests/test-verify-async.sh
# smoke-subjects: scripts/process-tree.sh
# smoke-subjects: scripts/verify.sh
# smoke-subjects: scripts/lib/verify-engine.sh
# smoke-subjects: scripts/lib/verify-metadata.sh
# smoke-subjects: scripts/ai-hooks/cache.sh
# test-verify-async.sh — pure-shell smoke tests for scripts/verify-async.sh.
#
# Uses a fake short command through --command so the async lifecycle can be
# tested without running the real verify suite.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
ASYNC="$SCRIPT_DIR/../verify-async.sh"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

SANDBOX="$(mktemp -d /tmp/musi-verify-async-test.XXXXXX)"
CLEANUP_PIDS=()
cleanup() {
  local pid
  for pid in "${CLEANUP_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
    kill -KILL "$pid" 2>/dev/null || true
  done
  rm -rf "$SANDBOX"
}
trap cleanup EXIT

STATE_ROOT="$SANDBOX/state"
LOCK="$SANDBOX/verify.lock"
REPO_KEY="$(printf '%s' "$REPO_ROOT" | sha256sum | awk '{print $1}')"
REPO_STATE="$STATE_ROOT/$REPO_KEY"

STD_MARKER_DIR="$SANDBOX/std-markers"
mkdir -p "$STD_MARKER_DIR"
STD_CHANGED_MARKER="$STD_MARKER_DIR/verify-changed-last"
STD_FULL_MARKER="$STD_MARKER_DIR/verify-last"

run_async() {
  MUSI_VERIFY_ASYNC_STATE_ROOT="$STATE_ROOT" \
  MUSI_VERIFY_LOCK="$LOCK" \
  MUSI_ASYNC_VERIFY_TIMEOUT=20 \
  MUSI_STANDARD_VERIFY_MARKER_CHANGED="$STD_CHANGED_MARKER" \
  MUSI_STANDARD_VERIFY_MARKER_FULL="$STD_FULL_MARKER" \
    bash "$ASYNC" "$@"
}

run_async_with_timeout() {
  local timeout="$1"
  shift
  MUSI_VERIFY_ASYNC_STATE_ROOT="$STATE_ROOT" \
  MUSI_VERIFY_LOCK="$LOCK" \
  MUSI_ASYNC_VERIFY_TIMEOUT="$timeout" \
  MUSI_STANDARD_VERIFY_MARKER_CHANGED="$STD_CHANGED_MARKER" \
  MUSI_STANDARD_VERIFY_MARKER_FULL="$STD_FULL_MARKER" \
    bash "$ASYNC" "$@"
}

NO_SETSID_BIN="$SANDBOX/no-setsid-bin"
mkdir -p "$NO_SETSID_BIN"
link_no_setsid_tool() {
  local tool="$1" path
  path=$(command -v "$tool") || fail "missing tool needed for no-setsid fixture: $tool"
  ln -s "$path" "$NO_SETSID_BIN/$tool"
}
for tool in bash git sha256sum awk date dirname basename mkdir mktemp mv rm find sort \
  nohup flock tail ps env sleep cat grep sed wc xargs seq pgrep; do
  link_no_setsid_tool "$tool"
done

run_async_no_setsid() {
  PATH="$NO_SETSID_BIN" \
  MUSI_VERIFY_ASYNC_STATE_ROOT="$STATE_ROOT" \
  MUSI_VERIFY_LOCK="$LOCK" \
  MUSI_ASYNC_VERIFY_TIMEOUT=20 \
  MUSI_STANDARD_VERIFY_MARKER_CHANGED="$STD_CHANGED_MARKER" \
  MUSI_STANDARD_VERIFY_MARKER_FULL="$STD_FULL_MARKER" \
    bash "$ASYNC" "$@"
}

wait_for_status() {
  local expected="$1"
  local output=""
  for _ in $(seq 1 80); do
    output=$(run_async status)
    if grep -qF "status: $expected" <<< "$output"; then
      printf '%s' "$output"
      return 0
    fi
    sleep 0.1
  done
  printf '%s' "$output"
  return 1
}

is_integer() {
  [[ "${1:-}" =~ ^-?[0-9]+$ ]]
}

pid_running() {
  local pid="$1" stat
  stat=$(ps -o stat= -p "$pid" 2>/dev/null | awk '{print $1}')
  [ -n "$stat" ] && [[ "$stat" != Z* ]]
}

wait_for_pid_file() {
  local file="$1" pid
  for _ in $(seq 1 80); do
    if [ -s "$file" ]; then
      pid=$(cat "$file")
      if is_integer "$pid" && [ "$pid" -gt 0 ]; then
        printf '%s' "$pid"
        return 0
      fi
    fi
    sleep 0.1
  done
  return 1
}

wait_for_pid_not_running() {
  local pid="$1"
  for _ in $(seq 1 50); do
    if ! pid_running "$pid"; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

wait_for_lock_available() {
  for _ in $(seq 1 30); do
    if flock -n "$LOCK" true; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

wait_for_tail_text() {
  local text="$1" output=""
  for _ in $(seq 1 80); do
    output=$(run_async tail 2>/dev/null || true)
    if grep -qF "$text" <<< "$output"; then
      printf '%s' "$output"
      return 0
    fi
    sleep 0.1
  done
  printf '%s' "$output"
  return 1
}

bash -n "$ASYNC" || fail "verify-async.sh fails bash -n"
ok "verify-async.sh passes bash -n"

if run_async nonsense >/dev/null 2>&1; then
  fail "verify-async.sh accepted unknown verb"
fi
ok "verify-async.sh rejects unknown verbs"

if output=$(run_async start chagned 2>&1); then
  fail "verify-async.sh accepted unknown start mode: $output"
fi
grep -qF 'usage:' <<< "$output" || fail "unknown start mode did not print usage: $output"
grep -qF 'verify-async.sh start [verify|changed|slow]' <<< "$output" \
  || fail "unknown start mode usage missed mode list: $output"
grep -qF 'verify:async: started PID ' <<< "$output" \
  && fail "unknown start mode launched an async state: $output"
ok "start rejects unknown async modes"

# --- start fails before spawn when durable state cannot be created ----------
BAD_STATE_ROOT="$SANDBOX/bad-state-root"
printf 'not a directory\n' > "$BAD_STATE_ROOT"
set +e
output=$(
  MUSI_VERIFY_ASYNC_STATE_ROOT="$BAD_STATE_ROOT" \
  MUSI_VERIFY_LOCK="$LOCK" \
    bash "$ASYNC" start --command bash -c 'sleep 30' 2>&1
)
bad_state_rc=$?
set -e
[[ "$bad_state_rc" -ne 0 ]] || fail "start should fail for an unusable state root"
grep -qF 'verify:async: started PID ' <<< "$output" \
  && fail "unusable state root reported a successful start: $output"
ok "start requires durable initial state before spawning"

# Fail only the second atomic state-file move: the initial pid=0 state exists,
# then post-spawn PID persistence fails. The starter must terminate and reap
# the detached child without publishing latest or a success line.
PID_FAIL_BIN="$SANDBOX/pid-fail-bin"
PID_FAIL_ROOT="$SANDBOX/pid-fail-state"
PID_FAIL_COUNTER="$SANDBOX/pid-fail-mv-count"
PID_FAIL_CHILD="$SANDBOX/pid-fail-child"
mkdir -p "$PID_FAIL_BIN"
for tool in bash git sha256sum awk date dirname basename mkdir mktemp rm find sort \
  flock tail ps env sleep cat grep sed wc xargs seq pgrep; do
  path=$(command -v "$tool") || fail "missing tool needed for PID-state failure fixture: $tool"
  ln -s "$path" "$PID_FAIL_BIN/$tool"
done
REAL_MV=$(command -v mv)
REAL_NOHUP=$(command -v nohup)
cat > "$PID_FAIL_BIN/mv" <<'PID_FAIL_MV'
#!/usr/bin/env bash
count=0
if [[ -f "$PID_FAIL_COUNTER" ]]; then
  count=$(cat "$PID_FAIL_COUNTER")
fi
printf '%s\n' "$((count + 1))" > "$PID_FAIL_COUNTER"
if [[ "$count" == "1" ]]; then
  exit 73
fi
exec "$REAL_MV" "$@"
PID_FAIL_MV
cat > "$PID_FAIL_BIN/nohup" <<'PID_FAIL_NOHUP'
#!/usr/bin/env bash
printf '%s\n' "$$" > "$PID_FAIL_CHILD"
exec "$REAL_NOHUP" "$@"
PID_FAIL_NOHUP
chmod +x "$PID_FAIL_BIN/mv" "$PID_FAIL_BIN/nohup"

set +e
output=$(
  PATH="$PID_FAIL_BIN" \
  PID_FAIL_COUNTER="$PID_FAIL_COUNTER" \
  PID_FAIL_CHILD="$PID_FAIL_CHILD" \
  REAL_MV="$REAL_MV" \
  REAL_NOHUP="$REAL_NOHUP" \
  MUSI_VERIFY_ASYNC_STATE_ROOT="$PID_FAIL_ROOT" \
  MUSI_VERIFY_LOCK="$LOCK" \
    bash "$ASYNC" start --command bash -c 'sleep 30' 2>&1
)
pid_state_rc=$?
set -e
[[ "$pid_state_rc" -ne 0 ]] || fail "start should fail when PID state persistence fails"
grep -qF 'verify:async: started PID ' <<< "$output" \
  && fail "PID state failure reported a successful start: $output"
pid_fail_child=$(wait_for_pid_file "$PID_FAIL_CHILD") \
  || fail "PID state failure fixture did not observe the spawned child"
CLEANUP_PIDS+=("$pid_fail_child")
wait_for_pid_not_running "$pid_fail_child" \
  || fail "PID state failure left spawned child running: pid $pid_fail_child"
pid_fail_repo_state="$PID_FAIL_ROOT/$REPO_KEY"
[[ ! -e "$pid_fail_repo_state/latest" ]] \
  || fail "PID state failure published a latest pointer"
ok "post-spawn PID persistence failure reaps child without publishing success"

# --- start -> status -> tail -> pass --------------------------------------
output=$(run_async start --command bash -c 'echo begin; sleep 1; echo done')
grep -qF 'verify:async: started PID ' <<< "$output" || fail "start did not print PID: $output"
grep -qF 'status: bun run verify:async:status' <<< "$output" || fail "start did not print status command: $output"
[[ -f "$REPO_STATE/latest" ]] || fail "successful start did not publish latest pointer"
latest_state=$(cat "$REPO_STATE/latest")
[[ -f "$latest_state" ]] || fail "latest pointer does not name durable state: $latest_state"
ok "start returns immediately with status command"

output=$(wait_for_status running) || fail "short command never reached running state: $output"
grep -qE '^pid: [0-9]+$' <<< "$output" || fail "running status missing pid: $output"
grep -qF 'command: bash -c' <<< "$output" || fail "running status missing command: $output"
grep -qF 'worktree_fingerprint: ' <<< "$output" || fail "running status missing fingerprint: $output"
grep -qF "log_dir: $REPO_STATE/" <<< "$output" || fail "running status missing async log dir: $output"
ok "status reports a running async job"

for _ in $(seq 1 50); do
  output=$(run_async tail)
  grep -qF 'begin' <<< "$output" && break
  sleep 0.1
done
grep -qF 'begin' <<< "$output" || fail "tail did not show recent async log lines: $output"
ok "tail reads the latest async log"

output=$(wait_for_status passed) || fail "short command never reported passed: $output"
grep -qF 'exit_code: 0' <<< "$output" || fail "passed status missing exit_code 0: $output"
grep -qF 'finished_at: ' <<< "$output" || fail "passed status missing finished_at: $output"
output=$(run_async tail)
grep -qF 'done' <<< "$output" || fail "tail did not show completed command output: $output"
ok "status reports final exit after async job completes"

# --- stop terminates a still-running job ----------------------------------
output=$(run_async start --command bash -c 'echo long-started; sleep 30')
grep -qF 'verify:async: started PID ' <<< "$output" || fail "long start failed: $output"
output=$(wait_for_status running) || fail "long command never reached running state: $output"
grep -qF 'long-started' <<< "$(run_async tail)" || fail "long command did not write initial log line"

output=$(run_async stop)
grep -qF 'verify:async: stopped PID ' <<< "$output" || fail "stop did not report stopped PID: $output"
output=$(wait_for_status failed) || fail "stopped command never reported failed: $output"
grep -qE 'exit_code: (137|143)' <<< "$output" || fail "stopped status missing termination exit code: $output"
ok "stop terminates a running async job"

# --- stop terminates payload worker children -------------------------------
WORKER_PID_FILE="$SANDBOX/stop-worker.pid"
output=$(run_async start --command env WORKER_PID_FILE="$WORKER_PID_FILE" \
  bash -c 'sleep 30 & echo $! > "$WORKER_PID_FILE"; echo worker-started; wait')
grep -qF 'verify:async: started PID ' <<< "$output" || fail "worker start failed: $output"
output=$(wait_for_status running) || fail "worker command never reached running state: $output"
worker_pid=$(wait_for_pid_file "$WORKER_PID_FILE") || fail "worker command did not write child pid"
CLEANUP_PIDS+=("$worker_pid")
grep -qF 'worker-started' <<< "$(run_async tail)" || fail "worker command did not write initial log line"

output=$(run_async stop)
grep -qF 'verify:async: stopped PID ' <<< "$output" || fail "worker stop did not report stopped PID: $output"
output=$(wait_for_status failed) || fail "stopped worker command never reported failed: $output"
wait_for_pid_not_running "$worker_pid" \
  || fail "stop left payload worker child running: pid $worker_pid"
ok "stop terminates payload process-group children"

# --- stop terminates payload worker children without setsid ----------------
NO_SETSID_WORKER_PID_FILE="$SANDBOX/no-setsid-worker.pid"
output=$(run_async_no_setsid start --command env WORKER_PID_FILE="$NO_SETSID_WORKER_PID_FILE" \
  bash -c 'sleep 30 & echo $! > "$WORKER_PID_FILE"; echo no-setsid-worker-started; wait')
grep -qF 'verify:async: started PID ' <<< "$output" || fail "no-setsid worker start failed: $output"
output=$(wait_for_status running) || fail "no-setsid worker command never reached running state: $output"
no_setsid_worker_pid=$(wait_for_pid_file "$NO_SETSID_WORKER_PID_FILE") \
  || fail "no-setsid worker command did not write child pid"
CLEANUP_PIDS+=("$no_setsid_worker_pid")
grep -qF 'no-setsid-worker-started' <<< "$(run_async tail)" \
  || fail "no-setsid worker command did not write initial log line"

output=$(run_async stop)
grep -qF 'verify:async: stopped PID ' <<< "$output" \
  || fail "no-setsid worker stop did not report stopped PID: $output"
output=$(wait_for_status failed) || fail "stopped no-setsid worker command never reported failed: $output"
wait_for_pid_not_running "$no_setsid_worker_pid" \
  || fail "no-setsid stop left payload worker child running: pid $no_setsid_worker_pid"
ok "stop terminates payload worker children without setsid"

# --- timeout terminates payload worker children ----------------------------
TIMEOUT_WORKER_PID_FILE="$SANDBOX/timeout-worker.pid"
output=$(run_async_with_timeout 2 start --command env WORKER_PID_FILE="$TIMEOUT_WORKER_PID_FILE" \
  bash -c 'sleep 30 & echo $! > "$WORKER_PID_FILE"; echo timeout-worker-started; wait')
grep -qF 'verify:async: started PID ' <<< "$output" || fail "timeout worker start failed: $output"
timeout_worker_pid=$(wait_for_pid_file "$TIMEOUT_WORKER_PID_FILE") \
  || fail "timeout worker command did not write child pid"
CLEANUP_PIDS+=("$timeout_worker_pid")
output=$(wait_for_status failed) || fail "timeout worker command never reported failed: $output"
grep -qF 'exit_code: 124' <<< "$output" || fail "timeout status missing exit_code 124: $output"
wait_for_pid_not_running "$timeout_worker_pid" \
  || fail "timeout left payload worker child running: pid $timeout_worker_pid"
ok "timeout terminates payload process-group children"

# --- timeout keeps state running until payload cleanup completes ------------
TIMEOUT_IGNORE_PID_FILE="$SANDBOX/timeout-ignore.pid"
output=$(run_async_with_timeout 2 start --command env PAYLOAD_PID_FILE="$TIMEOUT_IGNORE_PID_FILE" \
  bash -c 'echo $$ > "$PAYLOAD_PID_FILE"; trap "" TERM; echo timeout-ignore-started; while :; do sleep 1; done')
grep -qF 'verify:async: started PID ' <<< "$output" || fail "timeout ignore start failed: $output"
timeout_ignore_pid=$(wait_for_pid_file "$TIMEOUT_IGNORE_PID_FILE") \
  || fail "timeout ignore command did not write payload pid"
CLEANUP_PIDS+=("$timeout_ignore_pid")
wait_for_tail_text 'verify:async: timed out after 2s' >/dev/null \
  || fail "timeout ignore command never logged timeout"
output=$(run_async status)
grep -qF 'status: running' <<< "$output" \
  || fail "timed-out payload reported final status before cleanup completed: $output"
output=$(wait_for_status failed) || fail "timeout ignore command never reported failed: $output"
grep -qF 'exit_code: 124' <<< "$output" || fail "timeout ignore status missing exit_code 124: $output"
wait_for_pid_not_running "$timeout_ignore_pid" \
  || fail "timeout cleanup left TERM-ignoring payload running: pid $timeout_ignore_pid"
ok "timeout reports running until payload cleanup completes"

# --- timeout kills a TERM-handler descendant after its parent exits ---------
TERM_FORK_SCRIPT="$SANDBOX/term-fork-exit.sh"
TERM_FORK_CHILD_PID_FILE="$SANDBOX/term-fork-child.pid"
cat > "$TERM_FORK_SCRIPT" <<'SCRIPT'
#!/usr/bin/env bash
trap 'bash -c '\''trap "" TERM; echo $$ > "$TERM_FORK_CHILD_PID_FILE"; while :; do sleep 1; done'\'' & exit 0' TERM
while :; do sleep 1; done
SCRIPT
chmod +x "$TERM_FORK_SCRIPT"
output=$(run_async_with_timeout 2 start --command env \
  TERM_FORK_CHILD_PID_FILE="$TERM_FORK_CHILD_PID_FILE" bash "$TERM_FORK_SCRIPT")
grep -qF 'verify:async: started PID ' <<< "$output" \
  || fail "TERM-fork timeout start failed: $output"
term_fork_child_pid=$(wait_for_pid_file "$TERM_FORK_CHILD_PID_FILE") \
  || fail "TERM-fork payload did not record its late child pid"
CLEANUP_PIDS+=("$term_fork_child_pid")
output=$(wait_for_status failed) || fail "TERM-fork timeout never reported failed: $output"
grep -qF 'exit_code: 124' <<< "$output" \
  || fail "TERM-fork timeout status missing exit_code 124: $output"
wait_for_pid_not_running "$term_fork_child_pid" \
  || fail "timeout left TERM-ignoring descendant running after its parent exited: pid $term_fork_child_pid"
ok "timeout kills TERM-handler descendants after the direct payload exits"

# --- payload descendants do not inherit the verify lock fd -----------------
ORPHAN_PID_FILE="$SANDBOX/fd-orphan.pid"
output=$(run_async start --command env ORPHAN_PID_FILE="$ORPHAN_PID_FILE" \
  bash -c 'setsid bash -c '\''echo $$ > "$ORPHAN_PID_FILE"; sleep 30'\'' & echo fd-orphan-started')
grep -qF 'verify:async: started PID ' <<< "$output" || fail "fd orphan start failed: $output"
output=$(wait_for_status passed) || fail "fd orphan command never reached passed state: $output"
orphan_pid=$(wait_for_pid_file "$ORPHAN_PID_FILE") || fail "fd orphan command did not write child pid"
CLEANUP_PIDS+=("$orphan_pid")
grep -qF 'fd-orphan-started' <<< "$(run_async tail)" || fail "fd orphan command did not write initial log line"

pid_running "$orphan_pid" || fail "fd orphan fixture exited before lock assertion"
wait_for_lock_available || fail "payload descendant inherited and held verify lock fd"
kill -KILL "$orphan_pid" 2>/dev/null || true
ok "payload descendants cannot inherit the verify lock fd"

# --- status detects crashed jobs and prunes old state ----------------------
OLD_FINISHED="$REPO_STATE/runs/old-finished"
OLD_DEAD="$REPO_STATE/runs/old-dead"
mkdir -p "$OLD_FINISHED/logs" "$OLD_DEAD/logs"
old_epoch=$(( $(date +%s) - 7200 ))
old_iso="$(date -Iseconds -d "@$old_epoch")"
cat > "$OLD_FINISHED/state" <<EOF_STATE
pid=999991
started_epoch=$old_epoch
started_at=$old_iso
command=old finished
head=none
worktree_fingerprint=$(printf 'a%.0s' {1..64})
log_dir=$OLD_FINISHED/logs
exit_code=0
finished_epoch=$old_epoch
finished_at=$old_iso
EOF_STATE
cat > "$OLD_DEAD/state" <<EOF_STATE
pid=999992
started_epoch=$old_epoch
started_at=$old_iso
command=old dead
head=none
worktree_fingerprint=$(printf 'b%.0s' {1..64})
log_dir=$OLD_DEAD/logs
exit_code=
finished_epoch=
finished_at=
EOF_STATE

output=$(
  MUSI_VERIFY_ASYNC_STATE_ROOT="$STATE_ROOT" \
  MUSI_VERIFY_LOCK="$LOCK" \
  MUSI_VERIFY_ASYNC_RETENTION_SECONDS=3600 \
    bash "$ASYNC" status
)
grep -qF 'verify:async: pruned 2 old run(s)' <<< "$output" \
  || fail "status did not report GC pruning: $output"
[ ! -e "$OLD_FINISHED" ] || fail "GC did not prune old finished run"
[ ! -e "$OLD_DEAD" ] || fail "GC did not prune old dead run"
ok "status marks dead state and prunes old runs"

# --- async success promotes private markers to standard paths ----------------
PROMO_MARKER_SCRIPT="$SANDBOX/write-changed-marker.sh"
PROMO_HASH=$(printf 'a%.0s' $(seq 1 64))
cat > "$PROMO_MARKER_SCRIPT" <<MARKER_SCRIPT
#!/usr/bin/env bash
marker="\$MUSI_VERIFY_MARKER_CHANGED"
mkdir -p "\$(dirname "\$marker")"
printf 'LAST_TS=%s\nLAST_HEAD=promo-head-abc\nLAST_HASH=%s\n' "\$(date +%s)" "$PROMO_HASH" > "\$marker"
MARKER_SCRIPT
chmod +x "$PROMO_MARKER_SCRIPT"

rm -f "$STD_CHANGED_MARKER" "$STD_FULL_MARKER"
output=$(run_async start --command bash "$PROMO_MARKER_SCRIPT")
grep -qF 'verify:async: started PID ' <<< "$output" || fail "promotion start failed: $output"
output=$(wait_for_status passed) || fail "promotion payload never passed: $output"
[ -f "$STD_CHANGED_MARKER" ] || fail "async success did not promote changed marker to standard path"
grep -qF "LAST_HEAD=promo-head-abc" "$STD_CHANGED_MARKER" \
  || fail "promoted changed marker has wrong HEAD: $(cat "$STD_CHANGED_MARKER")"
grep -qF "LAST_HASH=$PROMO_HASH" "$STD_CHANGED_MARKER" \
  || fail "promoted changed marker has wrong HASH: $(cat "$STD_CHANGED_MARKER")"
grep -qF "LAST_TS=" "$STD_CHANGED_MARKER" \
  || fail "promoted changed marker missing TS: $(cat "$STD_CHANGED_MARKER")"
[ ! -f "$STD_FULL_MARKER" ] \
  || fail "full marker should not be promoted when only changed was written"
ok "async success promotes changed marker to standard path"

# --- async success promotes full marker when payload writes it ---------------
PROMO_FULL_SCRIPT="$SANDBOX/write-full-marker.sh"
PROMO_FULL_HASH=$(printf 'b%.0s' $(seq 1 64))
cat > "$PROMO_FULL_SCRIPT" <<MARKER_SCRIPT
#!/usr/bin/env bash
marker="\$MUSI_VERIFY_MARKER_FULL"
mkdir -p "\$(dirname "\$marker")"
printf 'LAST_TS=%s\nLAST_HEAD=promo-full-head\nLAST_HASH=%s\n' "\$(date +%s)" "$PROMO_FULL_HASH" > "\$marker"
MARKER_SCRIPT
chmod +x "$PROMO_FULL_SCRIPT"

rm -f "$STD_CHANGED_MARKER" "$STD_FULL_MARKER"
output=$(run_async start --command bash "$PROMO_FULL_SCRIPT")
grep -qF 'verify:async: started PID ' <<< "$output" || fail "full promotion start failed: $output"
output=$(wait_for_status passed) || fail "full promotion payload never passed: $output"
[ -f "$STD_FULL_MARKER" ] || fail "async success did not promote full marker to standard path"
grep -qF "LAST_HEAD=promo-full-head" "$STD_FULL_MARKER" \
  || fail "promoted full marker has wrong HEAD: $(cat "$STD_FULL_MARKER")"
grep -qF "LAST_HASH=$PROMO_FULL_HASH" "$STD_FULL_MARKER" \
  || fail "promoted full marker has wrong HASH: $(cat "$STD_FULL_MARKER")"
ok "async success promotes full marker to standard path"

# --- async failure does not promote markers ----------------------------------
PROMO_FAIL_SCRIPT="$SANDBOX/write-marker-then-fail.sh"
cat > "$PROMO_FAIL_SCRIPT" <<MARKER_SCRIPT
#!/usr/bin/env bash
marker="\$MUSI_VERIFY_MARKER_CHANGED"
mkdir -p "\$(dirname "\$marker")"
printf 'LAST_TS=%s\nLAST_HEAD=should-not-promote\nLAST_HASH=%s\n' "\$(date +%s)" "$(printf 'c%.0s' $(seq 1 64))" > "\$marker"
exit 1
MARKER_SCRIPT
chmod +x "$PROMO_FAIL_SCRIPT"

rm -f "$STD_CHANGED_MARKER" "$STD_FULL_MARKER"
output=$(run_async start --command bash "$PROMO_FAIL_SCRIPT")
grep -qF 'verify:async: started PID ' <<< "$output" || fail "fail-promo start failed: $output"
output=$(wait_for_status failed) || fail "fail-promo payload never failed: $output"
[ ! -f "$STD_CHANGED_MARKER" ] \
  || fail "failed async run should not promote markers: $(cat "$STD_CHANGED_MARKER")"
ok "async failure does not promote markers to standard paths"

# --- no private marker means no promotion (custom commands) ------------------
rm -f "$STD_CHANGED_MARKER" "$STD_FULL_MARKER"
output=$(run_async start --command bash -c 'echo no-marker; exit 0')
grep -qF 'verify:async: started PID ' <<< "$output" || fail "no-marker start failed: $output"
output=$(wait_for_status passed) || fail "no-marker payload never passed: $output"
[ ! -f "$STD_CHANGED_MARKER" ] \
  || fail "success without private marker should not create standard changed marker"
[ ! -f "$STD_FULL_MARKER" ] \
  || fail "success without private marker should not create standard full marker"
ok "no private marker means no standard promotion"

printf 'verify-async tests passed (%d)\n' "$PASS"
