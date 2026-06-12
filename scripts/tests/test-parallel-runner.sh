#!/usr/bin/env bash
# test-parallel-runner.sh — pure-shell smoke tests for scripts/lib/parallel-runner.sh.
#
# Sources the utility directly in temp sandboxes and exercises init/cleanup,
# prefix streaming, multi-child wait, and exit-code aggregation. Run via
# `bash scripts/tests/test-parallel-runner.sh`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARALLEL_RUNNER="$SCRIPT_DIR/../lib/parallel-runner.sh"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

SANDBOX="$(mktemp -d /tmp/musi-test-parallel-runner.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

# --- syntax check ------------------------------------------------------------
bash -n "$PARALLEL_RUNNER" || fail "parallel-runner.sh fails bash -n"
ok "parallel-runner.sh passes bash -n"

# --- musi_parallel_init creates isolated state; cleanup removes temp files ----
(
  # shellcheck source=../lib/parallel-runner.sh
  source "$PARALLEL_RUNNER"
  musi_parallel_init "musi-pr-test"
  musi_parallel_install_traps
  [ -d "$MUSI_PARALLEL_TMP_DIR" ] || exit 1
  [ "$MUSI_PARALLEL_RUNNING" -eq 0 ] || exit 1
  [ "$MUSI_PARALLEL_EXIT" -eq 0 ] || exit 1
  [ "${#MUSI_PARALLEL_PIDS[@]}" -eq 0 ] || exit 1
  [ "${#MUSI_PARALLEL_LABELS[@]}" -eq 0 ] || exit 1
  saved_dir="$MUSI_PARALLEL_TMP_DIR"
  musi_parallel_cleanup_all
  [ ! -d "$saved_dir" ] || exit 1
) || fail "musi_parallel_init/cleanup_all lifecycle failed"
ok "musi_parallel_init creates isolated state and musi_parallel_cleanup_all removes temp files"

# --- musi_parallel_prefix_stream prefixes and preserves final no-newline line -
# shellcheck source=../lib/parallel-runner.sh
output=$(printf 'line1\nline2' | (source "$PARALLEL_RUNNER"; musi_parallel_prefix_stream "TAG"))
expected=$'[TAG] line1\n[TAG] line2'
[ "$output" = "$expected" ] \
  || fail "prefix_stream should prefix each line including a final line without trailing newline: got '$output'"
ok "musi_parallel_prefix_stream prefixes stdout and preserves final line without trailing newline"

# --- prefix_stream handles input with trailing newline -----------------------
# shellcheck source=../lib/parallel-runner.sh
output=$(printf 'line1\nline2\n' | (source "$PARALLEL_RUNNER"; musi_parallel_prefix_stream "TAG"))
[ "$output" = "$expected" ] \
  || fail "prefix_stream with trailing newline should match no-trailing-newline output: got '$output'"
ok "musi_parallel_prefix_stream handles trailing newline without extra empty line"

# --- child helper scripts ----------------------------------------------------
cat > "$SANDBOX/child-ok.sh" <<'SH'
#!/usr/bin/env bash
printf 'hello from %s\n' "$1"
exit 0
SH
chmod +x "$SANDBOX/child-ok.sh"

cat > "$SANDBOX/child-fail-42.sh" <<'SH'
#!/usr/bin/env bash
exit 42
SH
chmod +x "$SANDBOX/child-fail-42.sh"

cat > "$SANDBOX/child-fail-7.sh" <<'SH'
#!/usr/bin/env bash
exit 7
SH
chmod +x "$SANDBOX/child-fail-7.sh"

cat > "$SANDBOX/child-fail-13.sh" <<'SH'
#!/usr/bin/env bash
exit 13
SH
chmod +x "$SANDBOX/child-fail-13.sh"

cat > "$SANDBOX/child-slow-ok.sh" <<'SH'
#!/usr/bin/env bash
sleep 0.3
printf 'slow child completed\n'
exit 0
SH
chmod +x "$SANDBOX/child-slow-ok.sh"

# --- multiple successful children keep MUSI_PARALLEL_EXIT=0 ------------------
output=$(
  # shellcheck source=../lib/parallel-runner.sh
  source "$PARALLEL_RUNNER"
  musi_parallel_init "musi-pr-test"
  musi_parallel_install_traps
  musi_parallel_start "Child-A" "a" bash "$SANDBOX/child-ok.sh" "A"
  musi_parallel_start "Child-B" "b" bash "$SANDBOX/child-ok.sh" "B"
  musi_parallel_wait_all "test context"
  printf 'EXIT=%s\n' "$MUSI_PARALLEL_EXIT"
  musi_parallel_cleanup_all
)
grep -qF 'EXIT=0' <<< "$output" \
  || fail "successful children should leave MUSI_PARALLEL_EXIT=0: $output"
grep -qF '[Child-A] hello from A' <<< "$output" \
  || fail "Child-A prefixed output missing: $output"
grep -qF '[Child-B] hello from B' <<< "$output" \
  || fail "Child-B prefixed output missing: $output"
ok "musi_parallel_start + musi_parallel_wait_all handles multiple successful children"

# --- single failing child reports context and records exit --------------------
output=$(
  # shellcheck source=../lib/parallel-runner.sh
  source "$PARALLEL_RUNNER"
  musi_parallel_init "musi-pr-test"
  musi_parallel_install_traps
  musi_parallel_start "FailChild" "f" bash "$SANDBOX/child-fail-42.sh"
  musi_parallel_wait_all "my-context" 2>&1
  printf 'EXIT=%s\n' "$MUSI_PARALLEL_EXIT"
  musi_parallel_cleanup_all
)
grep -qF 'my-context: FailChild failed with exit 42' <<< "$output" \
  || fail "single failing child should report 'my-context: FailChild failed with exit 42': $output"
grep -qF 'EXIT=42' <<< "$output" \
  || fail "single failing child should record exit 42: $output"
ok "single failing child reports context label and records exit code"

# --- multiple failing children with differing codes collapse to 1 -------------
output=$(
  # shellcheck source=../lib/parallel-runner.sh
  source "$PARALLEL_RUNNER"
  musi_parallel_init "musi-pr-test"
  musi_parallel_install_traps
  musi_parallel_start "ChildX" "x" bash "$SANDBOX/child-fail-7.sh"
  musi_parallel_start "ChildY" "y" bash "$SANDBOX/child-fail-13.sh"
  musi_parallel_wait_all "multi-fail" 2>&1
  printf 'EXIT=%s\n' "$MUSI_PARALLEL_EXIT"
  musi_parallel_cleanup_all
)
grep -qF 'multi-fail: ChildX failed with exit 7' <<< "$output" \
  || fail "ChildX failure not reported: $output"
grep -qF 'multi-fail: ChildY failed with exit 13' <<< "$output" \
  || fail "ChildY failure not reported: $output"
grep -qF 'EXIT=1' <<< "$output" \
  || fail "differing exit codes should collapse aggregate exit to 1: $output"
ok "multiple failing children report all labels; differing exit codes collapse to 1"

# --- multiple failing children with same exit code preserve that code ---------
output=$(
  # shellcheck source=../lib/parallel-runner.sh
  source "$PARALLEL_RUNNER"
  musi_parallel_init "musi-pr-test"
  musi_parallel_install_traps
  musi_parallel_start "ChildP" "p" bash "$SANDBOX/child-fail-7.sh"
  musi_parallel_start "ChildQ" "q" bash "$SANDBOX/child-fail-7.sh"
  musi_parallel_wait_all "same-exit" 2>&1
  printf 'EXIT=%s\n' "$MUSI_PARALLEL_EXIT"
  musi_parallel_cleanup_all
)
grep -qF 'EXIT=7' <<< "$output" \
  || fail "identical failing exit codes should be preserved, not collapsed: $output"
ok "multiple failing children with identical exit codes preserve that code"

# --- shell-only failure does not prevent unrelated children from completing ---
output=$(
  # shellcheck source=../lib/parallel-runner.sh
  source "$PARALLEL_RUNNER"
  musi_parallel_init "musi-pr-test"
  musi_parallel_install_traps
  musi_parallel_start "FastFail" "ff" bash "$SANDBOX/child-fail-42.sh"
  musi_parallel_start "SlowOK" "so" bash "$SANDBOX/child-slow-ok.sh"
  musi_parallel_wait_all "isolation" 2>&1
  printf 'EXIT=%s\n' "$MUSI_PARALLEL_EXIT"
  musi_parallel_cleanup_all
)
grep -qF '[SlowOK] slow child completed' <<< "$output" \
  || fail "failing sibling should not prevent SlowOK from completing: $output"
grep -qF 'isolation: FastFail failed with exit 42' <<< "$output" \
  || fail "FastFail failure not reported: $output"
ok "shell-only failure does not prevent unrelated parallel children from completing"

printf 'parallel-runner tests passed (%d)\n' "$PASS"
