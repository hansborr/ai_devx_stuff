#!/usr/bin/env bash
# smoke-order: 070
# smoke-subjects: scripts/dependency-freshness.sh
# smoke-subjects: scripts/prisma-client-freshness.sh
# smoke-subjects: scripts/doc-length-policy.sh
# smoke-subjects: scripts/lib/verify-metadata.sh
# smoke-subjects: scripts/lib/gate-env.sh
# smoke-subjects: scripts/lib/parallel-step.sh
# smoke-subjects: scripts/lib/lint-dist-preflight.sh
# smoke-subjects: scripts/process-tree.sh
# smoke-subjects: scripts/ai-hooks/output-filter.sh
# smoke-subjects: scripts/verify/steps.generated.sh
# smoke-subjects: scripts/harness/generated-surface-freshness.generated.sh
# smoke-subjects: scripts/verify/steps-lib.sh
# smoke-subjects: scripts/verify/memory-budget.sh
# smoke-subjects: scripts/verify/admitted-command.sh
# smoke-subjects: scripts/lib/test-worker-count.sh
# smoke-subjects: scripts/lib/verify-engine.sh
# smoke-subjects: .husky/pre-commit
# smoke-subjects: .husky/post-commit
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/test-dependency-freshness.sh
# Pure-shell tests for dependency freshness diagnostics.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"

# When run inside a parent `git commit`, git exports Git hook environment
# variables. Inherited values would make every `git add` and `git diff --cached`
# below operate on the outer repo's index, leaking staged entries into the
# parent and tripping the pre-commit flock. Clear them so the sandbox repos this
# script creates stand alone.
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested

# Strip FORCE_VERIFY from the parent environment. The bridge / cache cases below
# probe markers and expect default freshness semantics; if a developer runs
# `FORCE_VERIFY=1 verify:changed` it would leak through into the sandbox
# pre-commit invocations and turn every bridge case into a forced re-run.
# The two cases that need it set it explicitly via inline env.
unset FORCE_VERIFY
unset MUSI_CAPTURE_TEST_TIMINGS

# shellcheck source=/dev/null
. "$SCRIPT_DIR/../dependency-freshness.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/../lib/verify-metadata.sh"

export MUSI_PATH_POLICY_QUERY="$SCRIPT_DIR/../path-policy/path-policy-query.ts"
MUSI_PATH_POLICY_BUN="$(command -v bun)"
export MUSI_PATH_POLICY_BUN
# Sandbox copies of verify-metadata.sh resolve the run-meta codec from the
# source tree (same seam pattern as MUSI_PATH_POLICY_QUERY above).
export MUSI_VERIFY_META_CORE="$SCRIPT_DIR/../lib/verify-metadata-core.ts"
MUSI_VERIFY_META_BUN="$(command -v bun)"
export MUSI_VERIFY_META_BUN

PASS=0
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT
# Nested pre-commit fixtures are independent gates. Keep their reservation
# namespace hermetic so an outer test:scripts gate cannot serialize or time out
# the sandbox gates it is exercising.
export MUSI_VERIFY_MEMORY_STATE_ROOT="$TMP_ROOT/memory-state"

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

write_live_memory_reservation() {
  local token="$1" mb="$2" slot="$3" owner_pid owner_start_time
  owner_pid="$BASHPID"
  owner_start_time="$(awk '{ print $22 }' "/proc/$owner_pid/stat")"
  printf 'pid=%s\npid_start_time=%s\nmb=%s\nslot=%s\n' \
    "$owner_pid" "$owner_start_time" "$mb" "$slot" > "$token"
}

assert_status() {
  local repo="$1"
  local expected="$2"
  local got
  got="$(musi_dependency_status "$repo")"
  [[ "$got" == "$expected" ]] || fail "expected status $expected, got $got"
}

copy_verify_steps_fixture() {
  local target="$1"

  mkdir -p "$target/scripts/verify" "$target/scripts/harness" "$target/scripts/lib"
  cp "$SCRIPT_DIR/../verify/steps.generated.sh" "$target/scripts/verify/steps.generated.sh"
  cp "$SCRIPT_DIR/../harness/generated-surface-freshness.generated.sh" \
    "$target/scripts/harness/generated-surface-freshness.generated.sh"
  cp "$SCRIPT_DIR/../verify/steps-lib.sh" "$target/scripts/verify/steps-lib.sh"
  cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$target/scripts/verify/memory-budget.sh"
  cp "$SCRIPT_DIR/../verify/admitted-command.sh" "$target/scripts/verify/admitted-command.sh"
  cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$target/scripts/lib/test-worker-count.sh"
}

copy_precommit_fixture() {
  local target="$1"

  mkdir -p "$target/scripts/ai-hooks" "$target/scripts/harness" "$target/scripts/lib" "$target/.husky" "$target/node_modules/.bin" "$target/bin"
  cp "$SCRIPT_DIR/../dependency-freshness.sh" "$target/scripts/dependency-freshness.sh"
  cp "$SCRIPT_DIR/../prisma-client-freshness.sh" "$target/scripts/prisma-client-freshness.sh"
  cp "$SCRIPT_DIR/../doc-length-policy.sh" "$target/scripts/doc-length-policy.sh"
  cp "$SCRIPT_DIR/../lib/verify-metadata.sh" "$target/scripts/lib/verify-metadata.sh"
  cp "$SCRIPT_DIR/../lib/gate-env.sh" "$target/scripts/lib/gate-env.sh"
  cp "$SCRIPT_DIR/../process-tree.sh" "$target/scripts/process-tree.sh"
  cp "$SCRIPT_DIR/../lib/parallel-step.sh" "$target/scripts/lib/parallel-step.sh"
  cp "$SCRIPT_DIR/../lib/verify-engine.sh" "$target/scripts/lib/verify-engine.sh"
  cp "$SCRIPT_DIR/../lib/lint-dist-preflight.sh" "$target/scripts/lib/lint-dist-preflight.sh"
  cp "$SCRIPT_DIR/../ai-hooks/output-filter.sh" "$target/scripts/ai-hooks/output-filter.sh"
  cp "$SCRIPT_DIR/../../.husky/pre-commit" "$target/.husky/pre-commit"
  cp "$SCRIPT_DIR/../../.husky/post-commit" "$target/.husky/post-commit"
  copy_verify_steps_fixture "$target"
cat > "$target/bin/bun" <<'STUB'
#!/usr/bin/env sh
printf 'stub bun %s\n' "$*" >> "$STUB_LOG"
[ -z "${STUB_NODE_OPTIONS_LOG:-}" ] || printf '%s\n' "${NODE_OPTIONS:-}" >> "$STUB_NODE_OPTIONS_LOG"
[ -z "${STUB_MUTATE_MATCH:-}" ] || ! printf '%s\n' "$*" | grep -qF "$STUB_MUTATE_MATCH" \
  || printf 'registration mutation\n' >> "$STUB_MUTATE_PATH"
[ -z "${STUB_REMOVE_PATH_MATCH:-}" ] || ! printf '%s\n' "$*" | grep -qF "$STUB_REMOVE_PATH_MATCH" \
  || rm -f -- "$STUB_REMOVE_PATH"
[ -z "${STUB_CREATE_PATH_MATCH:-}" ] || ! printf '%s\n' "$*" | grep -qF "$STUB_CREATE_PATH_MATCH" \
  || : > "$STUB_CREATE_PATH"
if [ -n "${STUB_TIMEOUT_MATCH:-}" ] && printf '%s\n' "$*" | grep -qF "$STUB_TIMEOUT_MATCH"; then
  exit 124
fi
if [ -n "${STUB_FAIL_MATCH:-}" ] && printf '%s\n' "$*" | grep -qF "$STUB_FAIL_MATCH"; then
  printf 'stub failure for %s\n' "$*" >&2
  exit 1
fi
exit 0
STUB
  chmod +x "$target/bin/bun"
}

init_bridge_repo() {
  local repo="$1"

  copy_precommit_fixture "$repo"
  (
    cd "$repo"
    git init -q
    git config user.name "Test User"
    git config user.email "test@example.invalid"
    git add .husky scripts bin
    git commit -q -m init
    mkdir -p packages
    printf 'initial\n' > packages/example.ts
    git add packages/example.ts
    git commit -q -m source
  )
}

write_marker_with_ts() {
  local marker="$1"
  local ts="$2"
  local head="$3"
  local hash="$4"

  mkdir -p "$(dirname "$marker")"
  {
    printf 'LAST_TS=%s\n' "$ts"
    printf 'LAST_HEAD=%s\n' "$head"
    printf 'LAST_HASH=%s\n' "$hash"
  } > "$marker"
}

seed_prior_verify_evidence() {
  local log_dir="$1"
  mkdir -p "$log_dir/meta"
  printf 'prior run meta\n' > "$log_dir/run-meta.json"
  printf 'prior wrapper meta\n' > "$log_dir/meta/wrapper.json"
  printf 'prior lint meta\n' > "$log_dir/meta/lint.json"
  printf 'prior lint log\n' > "$log_dir/lint.log"
  printf 'prior typecheck log\n' > "$log_dir/typecheck.log"
  printf 'prior test log\n' > "$log_dir/test.log"
  printf 'prior format log\n' > "$log_dir/format.log"
  printf 'prior test timings\n' > "$log_dir/test-timings.json"
  printf 'prior ratchet diagnostics\n' > "$log_dir/ratchet-diagnostics.json"
}

assert_prior_verify_evidence() {
  local log_dir="$1" context="$2" path expected
  while IFS='|' read -r path expected; do
    [ "$(cat "$log_dir/$path" 2>/dev/null)" = "$expected" ] \
      || fail "$context did not preserve $path"
  done <<'EOF'
run-meta.json|prior run meta
meta/wrapper.json|prior wrapper meta
meta/lint.json|prior lint meta
lint.log|prior lint log
typecheck.log|prior typecheck log
test.log|prior test log
format.log|prior format log
test-timings.json|prior test timings
ratchet-diagnostics.json|prior ratchet diagnostics
EOF
}

repo="$TMP_ROOT/repo"
mkdir -p "$repo"

assert_status "$repo" warn
musi_dependency_message "$repo" | grep -qF "no bun.lock" || fail "missing lock message"
ok "missing lockfile reports a warning"

printf 'lock\n' > "$repo/bun.lock"
assert_status "$repo" missing
musi_dependency_message "$repo" | grep -qF "node_modules missing" || fail "missing node_modules message"
ok "missing install reports missing state"

mkdir -p "$repo/node_modules"
assert_status "$repo" stale
musi_dependency_message "$repo" | grep -qF "node_modules/.bin missing" || fail "missing .bin message"
ok "missing install marker reports stale state"

mkdir -p "$repo/node_modules/.bin"
touch -t 202604260101 "$repo/bun.lock"
touch -t 202604260102 "$repo/node_modules/.bin"
assert_status "$repo" fresh
ok "install marker newer than lockfile reports fresh state"

touch -t 202604260103 "$repo/bun.lock"
touch -t 202604260102 "$repo/node_modules/.bin"
assert_status "$repo" stale
musi_dependency_message "$repo" | grep -qF "bun.lock newer" || fail "stale lockfile message"
ok "lockfile newer than install marker reports stale state"

# --- content-digest marker path (mtime-race-immune) -------------------------
# These cases need a digest tool; skip cleanly when none is available so the
# suite still passes on a host without sha256sum/shasum.
if [[ -n "$(musi_dependency_digest "$repo/bun.lock")" ]]; then
  # bun.lock mtime is still NEWER than .bin from the case above — the exact
  # state that tripped the phantom 'stale'. A matching digest marker must
  # override the mtime comparison and report fresh.
  musi_dependency_write_marker "$repo"
  [[ -f "$repo/node_modules/.musi-install-digest" ]] \
    || fail "write_marker did not create digest marker"
  assert_status "$repo" fresh
  ok "matching digest marker reports fresh despite newer lockfile mtime"

  # Mutating bun.lock content (a real dependency change) must flip to stale
  # even though the marker exists.
  printf 'lock changed\n' > "$repo/bun.lock"
  assert_status "$repo" stale
  musi_dependency_message "$repo" | grep -qF "changed since last install" \
    || fail "digest-mismatch stale message"
  ok "digest marker mismatch reports stale after lockfile content change"

  # Re-recording the marker after the change clears the stale signal.
  musi_dependency_write_marker "$repo"
  assert_status "$repo" fresh
  ok "rewriting digest marker after change reports fresh again"

  # A missing .bin still short-circuits to stale before the digest path,
  # even with a marker present.
  rm -rf "$repo/node_modules/.bin"
  assert_status "$repo" stale
  musi_dependency_message "$repo" | grep -qF "node_modules/.bin missing" \
    || fail "missing .bin should win over digest path"
  ok "missing .bin reports stale even when a digest marker exists"
  mkdir -p "$repo/node_modules/.bin"
else
  printf 'ok - digest tool unavailable; skipping content-digest cases\n'
fi

hook_repo="$TMP_ROOT/hook-repo"
mkdir -p "$hook_repo/scripts/ai-hooks" "$hook_repo/scripts/lib" "$hook_repo/.husky" "$hook_repo/node_modules/.bin"
cp "$SCRIPT_DIR/../dependency-freshness.sh" "$hook_repo/scripts/dependency-freshness.sh"
cp "$SCRIPT_DIR/../prisma-client-freshness.sh" "$hook_repo/scripts/prisma-client-freshness.sh"
cp "$SCRIPT_DIR/../doc-length-policy.sh" "$hook_repo/scripts/doc-length-policy.sh"
cp "$SCRIPT_DIR/../lib/verify-metadata.sh" "$hook_repo/scripts/lib/verify-metadata.sh"
cp "$SCRIPT_DIR/../lib/gate-env.sh" "$hook_repo/scripts/lib/gate-env.sh"
cp "$SCRIPT_DIR/../process-tree.sh" "$hook_repo/scripts/process-tree.sh"
cp "$SCRIPT_DIR/../lib/parallel-step.sh" "$hook_repo/scripts/lib/parallel-step.sh"
cp "$SCRIPT_DIR/../lib/verify-engine.sh" "$hook_repo/scripts/lib/verify-engine.sh"
cp "$SCRIPT_DIR/../lib/lint-dist-preflight.sh" "$hook_repo/scripts/lib/lint-dist-preflight.sh"
cp "$SCRIPT_DIR/../ai-hooks/output-filter.sh" "$hook_repo/scripts/ai-hooks/output-filter.sh"
cp "$SCRIPT_DIR/../../.husky/pre-commit" "$hook_repo/.husky/pre-commit"
copy_verify_steps_fixture "$hook_repo"
(
  cd "$hook_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add .husky scripts
  git commit -q -m init
  printf 'lock\n' > bun.lock
  touch -t 202604260102 node_modules/.bin
  touch -t 202604260103 bun.lock
  git add bun.lock
  output="$(sh .husky/pre-commit 2>&1)" || fail "sh pre-commit lockfile-only path failed: $output"
  printf '%s\n' "$output" | grep -qF "pre-commit: WARN: bun.lock is staged" || fail "sh pre-commit output missing freshness warning: $output"
  printf '%s\n' "$output" | grep -qF "no source changes staged" || fail "sh pre-commit output missing skip message: $output"
  if printf '%s\n' "$output" | grep -qF "[[: not found"; then
    fail "sh pre-commit output leaked bash [[ syntax error: $output"
  fi
)
ok "pre-commit lockfile warning works when invoked through sh"

doc_length_repo="$TMP_ROOT/doc-length-repo"
copy_precommit_fixture "$doc_length_repo"
(
  cd "$doc_length_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add .husky scripts bin
  git commit -q -m init
  mkdir -p docs/agent_notes/in_progress
  long_doc="docs/agent_notes/in_progress/long.md"
  for _ in $(seq 1 301); do
    printf 'line\n' >> "$long_doc"
  done
  git add "$long_doc"

  output="$(sh .husky/pre-commit 2>&1)" \
    || fail "doc-length warning should be non-blocking for commit-surface docs: $output"
  printf '%s\n' "$output" | grep -qF "pre-commit: WARN: doc-length advisory" \
    || fail "pre-commit output missing doc-length warning: $output"
  printf '%s\n' "$output" | grep -qF "long.md is 301 lines (budget: 300)" \
    || fail "pre-commit doc-length warning missing budget detail: $output"
  printf '%s\n' "$output" | grep -qF "no source changes staged" \
    || fail "pre-commit doc-length-only path should remain non-blocking: $output"
)
ok "pre-commit warns non-blockingly for commit-surface doc length"

(
  cd "$hook_repo"
  mkdir -p bin packages
cat > bin/bun <<'STUB'
#!/usr/bin/env sh
printf 'stub bun %s\n' "$*" >> "$STUB_LOG"
[ -z "${STUB_NODE_OPTIONS_LOG:-}" ] || printf '%s\n' "${NODE_OPTIONS:-}" >> "$STUB_NODE_OPTIONS_LOG"
if [ "${2:-}" = "lint:changed" ] && [ -n "${STUB_TERM_FORK_SCRIPT:-}" ]; then
  exec "$STUB_TERM_FORK_SCRIPT"
fi
if [ "${2:-}" = "lint:changed" ] && [ -n "${STUB_SLEEP_LINT_CHANGED:-}" ]; then
  sleep "$STUB_SLEEP_LINT_CHANGED"
fi
if [ "${2:-}" = "format:changed:check" ] && [ "${STUB_FAIL_FORMAT_CHANGED_CHECK:-0}" = "1" ]; then
  printf 'stub: forced failure for bun run %s\n' "$2" >&2
  exit 1
fi
exit 0
STUB
  chmod +x bin/bun

  printf 'source\n' > packages/example.ts
  git add packages/example.ts

  marker="$hook_repo/precommit-marker"
  log_dir="$hook_repo/precommit-logs"
  stub_log="$hook_repo/bun.log"
  node_options_log="$hook_repo/node-options.log"
  cat > "$marker" <<'BAD_MARKER'
LAST_TS=abc
LAST_HEAD=whatever
LAST_HASH=whatever
BAD_MARKER
  : > "$stub_log"
  : > "$node_options_log"

  output="$(
    PATH="$hook_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    STUB_NODE_OPTIONS_LOG="$node_options_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$hook_repo/precommit-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should ignore corrupt marker and run checks: $output"

  grep -qF "pre-commit: OK" <<< "$output" || fail "pre-commit missing OK output: $output"
  grep -qF "stub bun run lint:changed" "$stub_log" || fail "corrupt marker did not rerun lint"
  typecheck_line="$(grep -nFx 'stub bun run typecheck' "$stub_log" | head -n1 | cut -d: -f1)"
  lint_line="$(grep -nFx 'stub bun run lint:changed' "$stub_log" | head -n1 | cut -d: -f1)"
  ratchet_line="$(grep -nFx 'stub bun run lint:ratchet' "$stub_log" | head -n1 | cut -d: -f1)"
  [ -n "$typecheck_line" ] || fail "missing-dist pre-commit should run typecheck"
  [ -n "$lint_line" ] || fail "missing-dist pre-commit should run lint:changed"
  [ -n "$ratchet_line" ] || fail "missing-dist pre-commit should run lint:ratchet"
  [ "$typecheck_line" -lt "$lint_line" ] \
    || fail "missing-dist pre-commit should run typecheck before lint: $(cat "$stub_log")"
  [ "$typecheck_line" -lt "$ratchet_line" ] \
    || fail "missing-dist pre-commit should run typecheck before ratchet: $(cat "$stub_log")"
  grep -qF "stub bun run docs:lint-coverage-map:check -- --staged" "$stub_log" || fail "corrupt marker did not run staged coverage-map check"
  grep -qF "stub bun run format:changed:check" "$stub_log" || fail "corrupt marker did not run changed format check"
  grep -qF "stub bun run typecheck" "$stub_log" || fail "corrupt marker did not rerun typecheck"
  grep -qF "stub bun run test:changed --reporter=dot" "$stub_log" || fail "corrupt marker did not rerun test"
  if grep -qF -- "--reporter=json" "$stub_log"; then
    fail "pre-commit should not request json timing capture by default"
  fi
  grep -qF "stub bun run test:scripts:changed" "$stub_log" \
    || fail "pre-commit should always invoke test:scripts:changed (runner no-ops when no subjects match)"
  grep -q -- "--max-old-space-size=" "$node_options_log" \
    || fail "pre-commit did not pass managed NODE_OPTIONS to bun slots: $(cat "$node_options_log")"
  [ -f "$log_dir/run-meta.json" ] || fail "pre-commit did not write run-meta.json"
  grep -q '"mode":"parallel-precommit"' "$log_dir/run-meta.json" \
    || fail "pre-commit metadata should record parallel-precommit mode"
  grep -q '"name":"wrapper"' "$log_dir/run-meta.json" \
    || fail "pre-commit metadata should record wrapper timing"
  grep -qF '"command":"bun run test:changed --reporter=dot"' "$log_dir/run-meta.json" \
    || fail "pre-commit metadata should record default dot-only test command"
  if grep -qF -- "--reporter=json" "$log_dir/run-meta.json"; then
    fail "pre-commit metadata should not record json timing capture command by default"
  fi
  grep -q '^LAST_TS=[0-9]\+$' "$marker" || fail "pre-commit did not rewrite marker with numeric LAST_TS"

  timing_marker="$hook_repo/precommit-marker-with-timings"
  timing_log_dir="$hook_repo/precommit-logs-with-timings"
  timing_stub_log="$hook_repo/bun-with-timings.log"
  expected_timing_command="\"command\":\"bun run test:changed --reporter=dot --reporter=json --outputFile.json=$timing_log_dir/test-timings.json\""
  : > "$timing_stub_log"

  output="$(
    PATH="$hook_repo/bin:$PATH" \
    STUB_LOG="$timing_stub_log" \
    MUSI_CAPTURE_TEST_TIMINGS=1 \
    MUSI_PRECOMMIT_MARKER="$timing_marker" \
    MUSI_VERIFY_LOCK="$hook_repo/precommit-lock-with-timings" \
    MUSI_VERIFY_LOG_DIR="$timing_log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run checks with json timing capture enabled: $output"

  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit with timing capture missing OK output: $output"
  grep -qF "stub bun run test:changed --reporter=dot --reporter=json --outputFile.json=$timing_log_dir/test-timings.json" "$timing_stub_log" \
    || fail "pre-commit did not request json timing capture when MUSI_CAPTURE_TEST_TIMINGS=1"
  [ -f "$timing_log_dir/run-meta.json" ] || fail "pre-commit with timing capture did not write run-meta.json"
  grep -qF "$expected_timing_command" "$timing_log_dir/run-meta.json" \
    || fail "pre-commit metadata should record json timing capture command when enabled"
)
ok "pre-commit treats corrupt success marker as a cache miss"

(
  cd "$hook_repo"

  marker="$hook_repo/precommit-marker-format-fail"
  log_dir="$hook_repo/precommit-logs-format-fail"
  stub_log="$hook_repo/bun-format-fail.log"
  : > "$stub_log"

  set +e
  output="$(
    PATH="$hook_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    STUB_FAIL_FORMAT_CHANGED_CHECK=1 \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$hook_repo/precommit-lock-format-fail" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )"
  exit_code=$?
  set -e

  [ "$exit_code" -ne 0 ] || fail "pre-commit should fail when format-check fails"
  grep -qF "Failed: format-check" <<< "$output" \
    || fail "pre-commit format-check failure missing summary: $output"
  grep -qF "bun run format:changed" <<< "$output" \
    || fail "pre-commit format-check failure missing format hint: $output"
  grep -qF "stub bun run typecheck" "$stub_log" \
    || fail "pre-commit should still start typecheck after format-check failure"
)
ok "pre-commit prints format hint on format-check failure"

lock_repo="$TMP_ROOT/precommit-lock-repo"
copy_precommit_fixture "$lock_repo"
(
  cd "$lock_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add .husky scripts bin
  git commit -q -m init
  mkdir -p packages
  printf 'source\n' > packages/example.ts
  git add packages/example.ts

  stub_log="$lock_repo/bun-lock.log"
  verify_lock="$lock_repo/precommit-held.lock"
  : > "$stub_log"
  (
    exec 8<>"$verify_lock"
    flock -n 8 || exit 1
    printf 'PID=fixture STARTED=now\n' > "$verify_lock"
    sleep 2
  ) &
  holder=$!
  sleep 0.2

  set +e
  output="$(
    PATH="$lock_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_VERIFY_LOCK="$verify_lock" \
    MUSI_COMMIT_QUEUE_LOCK="$lock_repo/queue-unused.lock" \
      sh .husky/pre-commit 2>&1
  )"
  exit_code=$?
  set -e
  wait "$holder" 2>/dev/null || true

  [ "$exit_code" -eq 2 ] || fail "same-worktree pre-commit contention should exit 2, got $exit_code: $output"
  grep -qF "PRE-COMMIT ALREADY RUNNING" <<< "$output" \
    || fail "same-worktree contention missing fail-fast heading: $output"
  grep -qF "PID=fixture" <<< "$output" \
    || fail "same-worktree contention missing holder details: $output"
  [ ! -s "$stub_log" ] || fail "same-worktree contention should fail before invoking bun"
)
ok "pre-commit same-worktree contention still fails fast"

queue_repo="$TMP_ROOT/precommit-queue-repo"
copy_precommit_fixture "$queue_repo"
cat > "$queue_repo/bin/bun" <<'STUB'
#!/usr/bin/env sh
if [ -e "/proc/$$/fd/8" ]; then
  printf 'FD8_OPEN stub bun %s\n' "$*" >> "$STUB_LOG"
  exit 70
fi
printf 'stub bun %s\n' "$*" >> "$STUB_LOG"
exit 0
STUB
chmod +x "$queue_repo/bin/bun"
(
  cd "$queue_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add .husky scripts bin
  git commit -q -m init
  mkdir -p packages
  printf 'source\n' > packages/example.ts
  git add packages/example.ts

  stub_log="$queue_repo/bun-queue-success.log"
  queue_lock="$queue_repo/shared-commit-queue.lock"
  : > "$stub_log"
  (
    exec 8<>"$queue_lock"
    flock -n 8 || exit 1
    printf 'PID=queue-fixture WORKTREE=other STARTED=now\n' > "$queue_lock"
    sleep 1
  ) &
  holder=$!
  sleep 0.2

  output="$(
    PATH="$queue_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_VERIFY_LOCK="$queue_repo/precommit-queue-success.lock" \
    MUSI_COMMIT_QUEUE_LOCK="$queue_lock" \
    MUSI_PRECOMMIT_MARKER="$queue_repo/precommit-queue-success-marker" \
    MUSI_VERIFY_LOG_DIR="$queue_repo/precommit-queue-success-logs" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should wait for shared commit queue then succeed: $output"
  wait "$holder" 2>/dev/null || true

  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "queued pre-commit missing OK output: $output"
  grep -qF "stub bun run lint:changed" "$stub_log" \
    || fail "queued pre-commit did not run checks after queue released"
  ! grep -qF "FD8_OPEN" "$stub_log" \
    || fail "pre-commit leaked shared queue fd into bun child: $(cat "$stub_log")"
)
ok "pre-commit waits for shared commit queue and then runs"

queue_inherited_repo="$TMP_ROOT/precommit-queue-inherited-repo"
copy_precommit_fixture "$queue_inherited_repo"
cat > "$queue_inherited_repo/bin/bun" <<'STUB'
#!/usr/bin/env sh
if [ -e "/proc/$$/fd/8" ]; then
  printf 'FD8_OPEN stub bun %s\n' "$*" >> "$STUB_LOG"
  exit 70
fi
if [ "${MUSI_COMMIT_QUEUE_LOCK_ALREADY_HELD:-}" = "1" ]; then
  printf 'QUEUE_ENV_OPEN stub bun %s\n' "$*" >> "$STUB_LOG"
  exit 71
fi
printf 'stub bun %s\n' "$*" >> "$STUB_LOG"
exit 0
STUB
chmod +x "$queue_inherited_repo/bin/bun"
(
  cd "$queue_inherited_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add .husky scripts bin
  git commit -q -m init
  mkdir -p packages
  printf 'source\n' > packages/example.ts
  git add packages/example.ts

  stub_log="$queue_inherited_repo/bun-queue-inherited.log"
  queue_lock="$queue_inherited_repo/shared-commit-queue-inherited.lock"
  : > "$stub_log"
  exec 8<>"$queue_lock"
  flock -n 8 || fail "failed to acquire inherited queue lock fixture"
  printf 'PID=queue-parent WORKTREE=wrapper STARTED=now\n' > "$queue_lock"

  output="$(
    PATH="$queue_inherited_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_VERIFY_LOCK="$queue_inherited_repo/precommit-queue-inherited.lock" \
    MUSI_COMMIT_QUEUE_LOCK="$queue_lock" \
    MUSI_COMMIT_QUEUE_LOCK_ALREADY_HELD=1 \
    MUSI_COMMIT_QUEUE_TIMEOUT=1 \
    MUSI_PRECOMMIT_MARKER="$queue_inherited_repo/precommit-queue-inherited-marker" \
    MUSI_VERIFY_LOG_DIR="$queue_inherited_repo/precommit-queue-inherited-logs" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run when parent wrapper already holds queue: $output"

  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "inherited-queue pre-commit missing OK output: $output"
  grep -qF "stub bun run lint:changed" "$stub_log" \
    || fail "inherited-queue pre-commit did not run checks"
  ! grep -qF "FD8_OPEN" "$stub_log" \
    || fail "inherited-queue pre-commit leaked queue fd into bun child: $(cat "$stub_log")"
  ! grep -qF "QUEUE_ENV_OPEN" "$stub_log" \
    || fail "inherited-queue pre-commit leaked queue env into bun child: $(cat "$stub_log")"
)
ok "pre-commit honors inherited commit queue without leaking it to steps"

queue_timeout_repo="$TMP_ROOT/precommit-queue-timeout-repo"
copy_precommit_fixture "$queue_timeout_repo"
(
  cd "$queue_timeout_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add .husky scripts bin
  git commit -q -m init
  mkdir -p packages
  printf 'source\n' > packages/example.ts
  git add packages/example.ts

  stub_log="$queue_timeout_repo/bun-queue-timeout.log"
  queue_lock="$queue_timeout_repo/shared-commit-queue-timeout.lock"
  : > "$stub_log"
  (
    exec 8<>"$queue_lock"
    flock -n 8 || exit 1
    printf 'PID=queue-timeout-fixture WORKTREE=other STARTED=now\n' > "$queue_lock"
    sleep 3
  ) &
  holder=$!
  sleep 0.2

  set +e
  output="$(
    PATH="$queue_timeout_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_VERIFY_LOCK="$queue_timeout_repo/precommit-queue-timeout.lock" \
    MUSI_COMMIT_QUEUE_LOCK="$queue_lock" \
    MUSI_COMMIT_QUEUE_TIMEOUT=1 \
      sh .husky/pre-commit 2>&1
  )"
  exit_code=$?
  set -e
  wait "$holder" 2>/dev/null || true

  [ "$exit_code" -eq 2 ] || fail "commit queue timeout should exit 2, got $exit_code: $output"
  grep -qF "COMMIT QUEUE BUSY" <<< "$output" \
    || fail "commit queue timeout missing heading: $output"
  grep -qF "PID=queue-timeout-fixture" <<< "$output" \
    || fail "commit queue timeout missing holder details: $output"
  [ ! -s "$stub_log" ] || fail "commit queue timeout should fail before invoking bun"
)
ok "pre-commit reports shared commit queue timeout with holder details"

gate_repo="$TMP_ROOT/gate-repo"
mkdir -p "$gate_repo/scripts/ai-hooks" "$gate_repo/scripts/lib" "$gate_repo/.husky" "$gate_repo/node_modules/.bin" "$gate_repo/bin" "$gate_repo/eslint-rules"
cp "$SCRIPT_DIR/../dependency-freshness.sh" "$gate_repo/scripts/dependency-freshness.sh"
cp "$SCRIPT_DIR/../prisma-client-freshness.sh" "$gate_repo/scripts/prisma-client-freshness.sh"
cp "$SCRIPT_DIR/../doc-length-policy.sh" "$gate_repo/scripts/doc-length-policy.sh"
cp "$SCRIPT_DIR/../lib/verify-metadata.sh" "$gate_repo/scripts/lib/verify-metadata.sh"
cp "$SCRIPT_DIR/../lib/gate-env.sh" "$gate_repo/scripts/lib/gate-env.sh"
cp "$SCRIPT_DIR/../process-tree.sh" "$gate_repo/scripts/process-tree.sh"
cp "$SCRIPT_DIR/../lib/parallel-step.sh" "$gate_repo/scripts/lib/parallel-step.sh"
cp "$SCRIPT_DIR/../lib/verify-engine.sh" "$gate_repo/scripts/lib/verify-engine.sh"
cp "$SCRIPT_DIR/../lib/lint-dist-preflight.sh" "$gate_repo/scripts/lib/lint-dist-preflight.sh"
cp "$SCRIPT_DIR/../ai-hooks/output-filter.sh" "$gate_repo/scripts/ai-hooks/output-filter.sh"
cp "$SCRIPT_DIR/../../.husky/pre-commit" "$gate_repo/.husky/pre-commit"
copy_verify_steps_fixture "$gate_repo"
cat > "$gate_repo/bin/bun" <<'STUB'
#!/usr/bin/env sh
printf 'stub bun %s\n' "$*" >> "$STUB_LOG"
[ -z "${STUB_MEMORY_WAIT_LOG:-}" ] \
  || printf '%s\n' "${MUSI_VERIFY_MEMORY_WAIT_TIMEOUT:-unset}" >> "$STUB_MEMORY_WAIT_LOG"
exit 0
STUB
chmod +x "$gate_repo/bin/bun"
(
  cd "$gate_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add .husky scripts bin
  git commit -q -m init
  printf 'rule\n' > eslint-rules/example.js
  git add eslint-rules/example.js

  marker="$gate_repo/precommit-marker-eslint-rules"
  log_dir="$gate_repo/precommit-logs-eslint-rules"
  stub_log="$gate_repo/bun-eslint-rules.log"
  : > "$stub_log"

  output="$(
    PATH="$gate_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$gate_repo/precommit-lock-eslint-rules" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run checks for staged eslint-rules edits: $output"

  grep -qF "stub bun run lint:changed" "$stub_log" \
    || fail "eslint-rules staged change did not run lint"
  grep -qF "stub bun run docs:lint-guidance:check" "$stub_log" \
    || fail "eslint-rules staged change did not run lint guidance freshness advisory"
  grep -qF "stub bun run test:changed --reporter=dot" "$stub_log" \
    || fail "eslint-rules staged change did not run test:changed"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit with eslint-rules edit missing OK output: $output"
  if grep -qF 'pre-commit: running' <<< "$output"; then
    fail "pre-commit should preserve its quiet parallel step label: $output"
  fi

  memory_wait_log="$gate_repo/precommit-memory-wait.log"
  : > "$memory_wait_log"
  output="$({
    env -u MUSI_VERIFY_MEMORY_WAIT_TIMEOUT \
    PATH="$gate_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    STUB_MEMORY_WAIT_LOG="$memory_wait_log" \
    FORCE_VERIFY=1 \
    MUSI_VERIFY_LOCK="$gate_repo/precommit-lock-memory-default" \
    MUSI_VERIFY_LOG_DIR="$gate_repo/precommit-logs-memory-default" \
      sh .husky/pre-commit
  } 2>&1)" || fail "pre-commit default memory cap run failed: $output"
  [ "$(tail -n 1 "$memory_wait_log")" = 30 ] \
    || fail "pre-commit should default memory deferral to 30s: $(cat "$memory_wait_log")"

  : > "$memory_wait_log"
  output="$({
    PATH="$gate_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    STUB_MEMORY_WAIT_LOG="$memory_wait_log" \
    FORCE_VERIFY=1 \
    MUSI_VERIFY_MEMORY_WAIT_TIMEOUT=99 \
    MUSI_VERIFY_LOCK="$gate_repo/precommit-lock-memory-capped" \
    MUSI_VERIFY_LOG_DIR="$gate_repo/precommit-logs-memory-capped" \
      sh .husky/pre-commit
  } 2>&1)" || fail "pre-commit capped memory run failed: $output"
  [ "$(tail -n 1 "$memory_wait_log")" = 30 ] \
    || fail "pre-commit should cap memory deferral above 30s: $(cat "$memory_wait_log")"

  memory_state="$gate_repo/precommit-memory-state"
  memory_queue="$gate_repo/precommit-memory-queue"
  mkdir -p "$memory_state"
  write_live_memory_reservation "$memory_state/reservation.external" 5000 external
  start_seconds="$(date +%s)"
  set +e
  output="$({
    PATH="$gate_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    FORCE_VERIFY=1 \
    MUSI_VERIFY_MEMORY_AVAILABLE_MB=6000 \
    MUSI_VERIFY_MEMORY_STATE_ROOT="$memory_state" \
    MUSI_VERIFY_MEMORY_WAIT_TIMEOUT=1 \
    MUSI_VERIFY_MEMORY_POLL_SECONDS=0.1 \
    MUSI_COMMIT_QUEUE_LOCK="$memory_queue" \
    MUSI_VERIFY_LOCK="$gate_repo/precommit-lock-memory" \
    MUSI_VERIFY_LOG_DIR="$gate_repo/precommit-logs-memory" \
      sh .husky/pre-commit
  } 2>&1)"
  memory_exit=$?
  set -e
  elapsed_seconds=$(( $(date +%s) - start_seconds ))
  rm -f "$memory_state/reservation.external"
  [ "$memory_exit" -ne 0 ] || fail "pre-commit memory deadline should fail pending slots"
  [ "$elapsed_seconds" -lt 5 ] \
    || fail "pre-commit held the queue for ${elapsed_seconds}s after a 1s memory deadline"
  grep -qF 'memory wait timed out after 1s' <<< "$output" \
    || fail "pre-commit memory deadline diagnostic missing: $output"
  exec {queue_probe_fd}>"$memory_queue"
  flock -n "$queue_probe_fd" \
    || fail "pre-commit left the commit queue locked after memory timeout"
  flock -u "$queue_probe_fd"
  exec {queue_probe_fd}>&-
)
ok "pre-commit runs checks for staged eslint-rules changes"
ok "pre-commit preserves quiet slots and its explicit 30-second memory cap"
ok "pre-commit bounds memory deferral while holding the commit queue"

manifest_repo="$TMP_ROOT/manifest-repo"
mkdir -p "$manifest_repo/scripts/ai-hooks" "$manifest_repo/scripts/lib" "$manifest_repo/.husky" "$manifest_repo/node_modules/.bin" "$manifest_repo/bin"
cp "$SCRIPT_DIR/../dependency-freshness.sh" "$manifest_repo/scripts/dependency-freshness.sh"
cp "$SCRIPT_DIR/../prisma-client-freshness.sh" "$manifest_repo/scripts/prisma-client-freshness.sh"
cp "$SCRIPT_DIR/../doc-length-policy.sh" "$manifest_repo/scripts/doc-length-policy.sh"
cp "$SCRIPT_DIR/../lib/verify-metadata.sh" "$manifest_repo/scripts/lib/verify-metadata.sh"
cp "$SCRIPT_DIR/../lib/gate-env.sh" "$manifest_repo/scripts/lib/gate-env.sh"
cp "$SCRIPT_DIR/../process-tree.sh" "$manifest_repo/scripts/process-tree.sh"
cp "$SCRIPT_DIR/../lib/parallel-step.sh" "$manifest_repo/scripts/lib/parallel-step.sh"
cp "$SCRIPT_DIR/../lib/verify-engine.sh" "$manifest_repo/scripts/lib/verify-engine.sh"
cp "$SCRIPT_DIR/../lib/lint-dist-preflight.sh" "$manifest_repo/scripts/lib/lint-dist-preflight.sh"
cp "$SCRIPT_DIR/../ai-hooks/output-filter.sh" "$manifest_repo/scripts/ai-hooks/output-filter.sh"
cp "$SCRIPT_DIR/../../.husky/pre-commit" "$manifest_repo/.husky/pre-commit"
copy_verify_steps_fixture "$manifest_repo"
cat > "$manifest_repo/bin/bun" <<'STUB'
#!/usr/bin/env sh
printf 'stub bun %s\n' "$*" >> "$STUB_LOG"
exit 0
STUB
chmod +x "$manifest_repo/bin/bun"
(
  cd "$manifest_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add .husky scripts bin
  git commit -q -m init
  printf '{"controls":[]}\n' > harness.controls.json
  git add harness.controls.json

  marker="$manifest_repo/precommit-marker-manifest"
  log_dir="$manifest_repo/precommit-logs-manifest"
  stub_log="$manifest_repo/bun-manifest.log"
  : > "$stub_log"

  output="$(
    PATH="$manifest_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$manifest_repo/precommit-lock-manifest" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run checks for staged harness.controls.json: $output"

  if grep -qF "no source changes staged" <<< "$output"; then
    fail "manifest-only staged change should not be treated as source-irrelevant: $output"
  fi
  grep -qF "stub bun run lint:changed" "$stub_log" \
    || fail "manifest staged change did not run lint"
  grep -qF "stub bun run verify:steps:check" "$stub_log" \
    || fail "manifest staged change did not run verify steps freshness advisory"
  grep -qF "stub bun run harness:hook-timeouts:check" "$stub_log" \
    || fail "manifest staged change did not run hook timeout constants freshness advisory"
  grep -qF "stub bun run harness:wiring:check" "$stub_log" \
    || fail "manifest staged change did not run hook wiring freshness advisory"
  grep -qF "stub bun run docs:harness-controls:check" "$stub_log" \
    || fail "manifest staged change did not run harness controls freshness advisory"
  if grep -qF "stub bun run harness:config-surfaces:check" "$stub_log"; then
    fail "manifest staged change should not run unrelated config-surface freshness advisory"
  fi
  if grep -qF "stub bun run docs:lint-guidance:check" "$stub_log"; then
    fail "manifest staged change should not run lint guidance freshness advisory"
  fi
  grep -qF "stub bun run lint:ratchet" "$stub_log" \
    || fail "manifest staged change did not run lint:ratchet"
  grep -qF "stub bun run test:changed --reporter=dot" "$stub_log" \
    || fail "manifest staged change did not run test:changed"
  grep -qF "stub bun run test:scripts:changed" "$stub_log" \
    || fail "manifest staged change did not run script smokes (test-harness-check is the gate that actually invokes harness:check)"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit with manifest edit missing OK output: $output"
)
ok "pre-commit runs lint+ratchet+scripts smokes for staged harness.controls.json"

config_surface_repo="$TMP_ROOT/precommit-config-surface"
copy_precommit_fixture "$config_surface_repo"
(
  cd "$config_surface_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add .husky scripts bin
  git commit -q -m init
  printf '{"include":[]}\n' > tsconfig.configs.json
  git add tsconfig.configs.json

  marker="$config_surface_repo/precommit-marker-config-surface"
  log_dir="$config_surface_repo/precommit-logs-config-surface"
  stub_log="$config_surface_repo/bun-config-surface.log"
  : > "$stub_log"

  output="$(
    PATH="$config_surface_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$config_surface_repo/precommit-lock-config-surface" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run checks for staged tsconfig.configs.json: $output"

  grep -qF "stub bun run harness:config-surfaces:check" "$stub_log" \
    || fail "tsconfig.configs.json staged change did not run config-surface freshness advisory"
  grep -qF "stub bun run test:scripts:changed" "$stub_log" \
    || fail "tsconfig.configs.json staged change did not run script smokes"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit with tsconfig.configs.json edit missing OK output: $output"
)
ok "pre-commit runs config-surface freshness advisory for staged tsconfig.configs.json"

source_relevant_json_paths=(
  ".claude/settings.json"
  ".codex/hooks/custom.json"
  ".codex/hooks.json"
  ".devcontainer/devcontainer.json"
  ".playwright/cli.config.json"
  "drift-ai.config.json"
)
json_index=0
for json_path in "${source_relevant_json_paths[@]}"; do
  json_index=$((json_index + 1))
  json_repo="$TMP_ROOT/source-relevant-json-$json_index"
  copy_precommit_fixture "$json_repo"
  (
    cd "$json_repo"
    git init -q
    git config user.name "Test User"
    git config user.email "test@example.invalid"
    git add .husky scripts bin
    git commit -q -m init
    mkdir -p "$(dirname "$json_path")"
    printf '{"ok":true}\n' > "$json_path"
    git add "$json_path"

    marker="$json_repo/precommit-marker-json-$json_index"
    log_dir="$json_repo/precommit-logs-json-$json_index"
    stub_log="$json_repo/bun-json-$json_index.log"
    : > "$stub_log"

    output="$(
      PATH="$json_repo/bin:$PATH" \
      STUB_LOG="$stub_log" \
      MUSI_PRECOMMIT_MARKER="$marker" \
      MUSI_VERIFY_LOCK="$json_repo/precommit-lock-json-$json_index" \
      MUSI_VERIFY_LOG_DIR="$log_dir" \
        sh .husky/pre-commit 2>&1
    )" || fail "pre-commit should run checks for staged $json_path: $output"

    if grep -qF "no source changes staged" <<< "$output"; then
      fail "$json_path should not be treated as source-irrelevant: $output"
    fi
    grep -qF "stub bun run lint:changed" "$stub_log" \
      || fail "$json_path staged change did not run lint"
    grep -qF "pre-commit: OK" <<< "$output" \
      || fail "pre-commit with $json_path edit missing OK output: $output"
  )
  ok "pre-commit runs lint for staged $json_path"
done

deletion_repo="$TMP_ROOT/deletion-repo"
mkdir -p "$deletion_repo/scripts/ai-hooks" "$deletion_repo/scripts/lib" "$deletion_repo/.husky" "$deletion_repo/node_modules/.bin" "$deletion_repo/bin"
copy_precommit_fixture "$deletion_repo"
(
  cd "$deletion_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add .husky scripts bin
  git commit -q -m init

  mkdir -p packages
  printf 'delete me\n' > packages/delete-me.ts
  git add packages/delete-me.ts
  git commit -q -m source
  git rm -q packages/delete-me.ts

  marker="$deletion_repo/precommit-marker-deletion"
  log_dir="$deletion_repo/precommit-logs-deletion"
  stub_log="$deletion_repo/bun-deletion.log"
  : > "$stub_log"

  output="$(
    PATH="$deletion_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$deletion_repo/precommit-lock-deletion" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run checks for staged source deletions: $output"

  grep -qF "stub bun run lint:changed" "$stub_log" \
    || fail "staged source deletion did not run lint"
  grep -qF "stub bun run typecheck" "$stub_log" \
    || fail "staged source deletion did not run typecheck"
  grep -qF "stub bun run test:changed --reporter=dot" "$stub_log" \
    || fail "staged source deletion did not run test:changed"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit with source deletion missing OK output: $output"
)
ok "pre-commit runs checks for staged source deletions"

cache_repo="$TMP_ROOT/cache-repo"
mkdir -p "$cache_repo/scripts/ai-hooks" "$cache_repo/scripts/lib" "$cache_repo/.husky" "$cache_repo/node_modules/.bin" "$cache_repo/bin"
cp "$SCRIPT_DIR/../dependency-freshness.sh" "$cache_repo/scripts/dependency-freshness.sh"
cp "$SCRIPT_DIR/../prisma-client-freshness.sh" "$cache_repo/scripts/prisma-client-freshness.sh"
cp "$SCRIPT_DIR/../doc-length-policy.sh" "$cache_repo/scripts/doc-length-policy.sh"
cp "$SCRIPT_DIR/../lib/verify-metadata.sh" "$cache_repo/scripts/lib/verify-metadata.sh"
cp "$SCRIPT_DIR/../lib/gate-env.sh" "$cache_repo/scripts/lib/gate-env.sh"
cp "$SCRIPT_DIR/../process-tree.sh" "$cache_repo/scripts/process-tree.sh"
cp "$SCRIPT_DIR/../lib/parallel-step.sh" "$cache_repo/scripts/lib/parallel-step.sh"
cp "$SCRIPT_DIR/../lib/verify-engine.sh" "$cache_repo/scripts/lib/verify-engine.sh"
cp "$SCRIPT_DIR/../lib/lint-dist-preflight.sh" "$cache_repo/scripts/lib/lint-dist-preflight.sh"
cp "$SCRIPT_DIR/../ai-hooks/output-filter.sh" "$cache_repo/scripts/ai-hooks/output-filter.sh"
cp "$SCRIPT_DIR/../../.husky/pre-commit" "$cache_repo/.husky/pre-commit"
copy_verify_steps_fixture "$cache_repo"
cat > "$cache_repo/bin/bun" <<'STUB'
#!/usr/bin/env sh
printf 'stub bun %s\n' "$*" >> "$STUB_LOG"
exit 0
STUB
chmod +x "$cache_repo/bin/bun"
(
  cd "$cache_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add .husky scripts
  git commit -q -m init

  mkdir -p packages
  printf 'staged\n' > packages/example.ts
  git add packages/example.ts

  marker="$cache_repo/precommit-marker-cache"
  log_dir="$cache_repo/precommit-logs-cache"
  stub_log="$cache_repo/bun-cache.log"
  : > "$stub_log"

  output="$(
    PATH="$cache_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$cache_repo/precommit-lock-cache" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "initial pre-commit should run checks: $output"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "initial pre-commit missing OK output: $output"

  printf 'staged\nunstaged\n' > packages/example.ts
  identity="$(musi_git_common_identity_path "$PWD")"
  : > "$identity/musi-fast-commit"
  set +e
  output="$(
    PATH="$cache_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$cache_repo/precommit-lock-cache" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )"
  exit_code=$?
  set -e

  [ "$exit_code" -ne 0 ] || fail "pre-commit should fail after unstaged source changes"
  grep -qF "source-relevant unstaged or untracked changes" <<< "$output" \
    || fail "pre-commit unstaged source diagnostic missing reason: $output"
  grep -qF "packages/example.ts" <<< "$output" \
    || fail "pre-commit unstaged source diagnostic missing file: $output"
  grep -qF "stage" <<< "$output" \
    || fail "pre-commit unstaged source diagnostic should mention staging: $output"
  grep -qF "git diff or git show HEAD:<path>" <<< "$output" \
    || fail "pre-commit unstaged source diagnostic should mention inspection: $output"
  if grep -qiF stash <<< "$output"; then
    fail "pre-commit unstaged source diagnostic must not mention stashing: $output"
  fi
  lint_runs=$(grep -cF "stub bun run lint:changed" "$stub_log")
  [ "$lint_runs" -eq 1 ] || fail "pre-commit should fail before rerunning lint after unstaged source change; lint runs=$lint_runs"
  [ "$(grep -cF 'stub bun run harness:registration:check' "$stub_log" || true)" -eq 0 ] \
    || fail "unstaged rejection must happen before fast registration admission"
  if grep -qF "already verified" <<< "$output"; then
    fail "pre-commit should not short-circuit after unstaged source change: $output"
  fi
)
ok "pre-commit fails fast on unstaged source changes before cache reuse"

bridge_changed_repo="$TMP_ROOT/bridge-changed-repo"
init_bridge_repo "$bridge_changed_repo"
(
  cd "$bridge_changed_repo"
  printf 'tracked edit\n' > packages/example.ts
  git add packages/example.ts
  staged_hash="$(ai_staged_fingerprint "$PWD")"

  precommit_marker="$TMP_ROOT/bridge-changed-precommit-marker"
  changed_marker="$TMP_ROOT/bridge-changed-verify-marker"
  full_marker="$TMP_ROOT/bridge-changed-full-marker"
  log_dir="$TMP_ROOT/bridge-changed-logs"
  stub_log="$TMP_ROOT/bridge-changed-bun.log"
  mkdir -p "$log_dir/meta"
  printf 'verify run meta\n' > "$log_dir/run-meta.json"
  printf 'verify wrapper\n' > "$log_dir/meta/wrapper.json"
  : > "$stub_log"
  musi_write_success_marker "$changed_marker" "$(git rev-parse HEAD)" "$staged_hash" \
    || fail "test setup failed to write changed verify marker"

  output="$(
    PATH="$bridge_changed_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$precommit_marker" \
    MUSI_VERIFY_MARKER_CHANGED="$changed_marker" \
    MUSI_VERIFY_MARKER_FULL="$full_marker" \
    MUSI_VERIFY_LOCK="$TMP_ROOT/bridge-changed-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should bridge from verify:changed marker: $output"

  grep -qF "pre-commit: verify:changed passed" <<< "$output" \
    || fail "bridge skip should name verify:changed source: $output"
  [ ! -s "$stub_log" ] || fail "bridge skip should not invoke bun commands"
  [ -f "$precommit_marker" ] || fail "bridge skip did not write pre-commit marker"
  grep -qxF "verify run meta" "$log_dir/run-meta.json" \
    || fail "bridge skip should not replace run-meta.json"
  grep -qxF "verify wrapper" "$log_dir/meta/wrapper.json" \
    || fail "bridge skip should not replace wrapper metadata"

  output="$(
    PATH="$bridge_changed_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$precommit_marker" \
    MUSI_VERIFY_MARKER_CHANGED="$changed_marker" \
    MUSI_VERIFY_MARKER_FULL="$full_marker" \
    MUSI_VERIFY_LOCK="$TMP_ROOT/bridge-changed-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "second pre-commit should use native pre-commit marker: $output"
  grep -qF "pre-commit: already verified" <<< "$output" \
    || fail "second pre-commit did not use native marker: $output"
  if grep -qF "verify:changed passed" <<< "$output"; then
    fail "second pre-commit should not re-use the bridge path: $output"
  fi
)
ok "pre-commit bridges from staged verify:changed marker and writes native marker"

bridge_changed_stale_repo="$TMP_ROOT/bridge-changed-stale-repo"
init_bridge_repo "$bridge_changed_stale_repo"
(
  cd "$bridge_changed_stale_repo"
  printf 'first staged edit\n' > packages/example.ts
  git add packages/example.ts
  staged_hash="$(ai_staged_fingerprint "$PWD")"
  printf 'second staged file\n' > packages/second.ts
  git add packages/second.ts

  precommit_marker="$TMP_ROOT/bridge-changed-stale-precommit-marker"
  changed_marker="$TMP_ROOT/bridge-changed-stale-verify-marker"
  full_marker="$TMP_ROOT/bridge-changed-stale-full-marker"
  log_dir="$TMP_ROOT/bridge-changed-stale-logs"
  stub_log="$TMP_ROOT/bridge-changed-stale-bun.log"
  : > "$stub_log"
  musi_write_success_marker "$changed_marker" "$(git rev-parse HEAD)" "$staged_hash" \
    || fail "test setup failed to write stale staged verify marker"

  output="$(
    PATH="$bridge_changed_stale_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$precommit_marker" \
    MUSI_VERIFY_MARKER_CHANGED="$changed_marker" \
    MUSI_VERIFY_MARKER_FULL="$full_marker" \
    MUSI_VERIFY_LOCK="$TMP_ROOT/bridge-changed-stale-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run when staged diff changes after verify:changed: $output"

  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "staged-diff bridge miss should run checks successfully: $output"
  grep -qF "stub bun run lint:changed" "$stub_log" \
    || fail "staged-diff bridge miss did not run lint"
  if grep -qF "passed" <<< "$output"; then
    fail "staged-diff bridge miss should not print a bridge skip: $output"
  fi
)
ok "pre-commit does not bridge when staged diff changes after verify:changed"

bridge_full_repo="$TMP_ROOT/bridge-full-repo"
init_bridge_repo "$bridge_full_repo"
(
  cd "$bridge_full_repo"
  printf 'tracked full edit\n' > packages/example.ts
  git add packages/example.ts
  worktree_hash="$(ai_worktree_fingerprint "$PWD")"
  head="$(git rev-parse HEAD)"

  precommit_marker="$TMP_ROOT/bridge-full-precommit-marker"
  changed_marker="$TMP_ROOT/bridge-full-changed-marker"
  full_marker="$TMP_ROOT/bridge-full-verify-marker"
  log_dir="$TMP_ROOT/bridge-full-logs"
  stub_log="$TMP_ROOT/bridge-full-bun.log"
  stale_ts=$(( $(date +%s) - 500 ))
  write_marker_with_ts "$changed_marker" "$stale_ts" "$head" "$worktree_hash"
  musi_write_success_marker "$full_marker" "$head" "$worktree_hash" \
    || fail "test setup failed to write full verify marker"
  : > "$stub_log"

  output="$(
    PATH="$bridge_full_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$precommit_marker" \
    MUSI_VERIFY_MARKER_CHANGED="$changed_marker" \
    MUSI_VERIFY_MARKER_FULL="$full_marker" \
    MUSI_VERIFY_LOCK="$TMP_ROOT/bridge-full-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should fall through to matching full verify marker: $output"

  grep -qF "pre-commit: verify passed" <<< "$output" \
    || fail "full verify bridge skip should name verify source: $output"
  if grep -qF "verify:changed passed" <<< "$output"; then
    fail "stale changed marker should not be accepted before full marker: $output"
  fi
  [ ! -s "$stub_log" ] || fail "full verify bridge skip should not invoke bun commands"
)
ok "pre-commit falls through from stale changed marker to full verify marker"

bridge_negative_repo="$TMP_ROOT/bridge-negative-repo"
init_bridge_repo "$bridge_negative_repo"
(
  cd "$bridge_negative_repo"
  printf 'tracked negative edit\n' > packages/example.ts
  git add packages/example.ts
  staged_hash="$(ai_staged_fingerprint "$PWD")"
  head="$(git rev-parse HEAD)"

  run_bridge_miss_case() {
    local name="$1"
    local force="${2:-}"
    local precommit_marker="$TMP_ROOT/${name}-precommit-marker"
    local changed_marker="$TMP_ROOT/${name}-changed-marker"
    local full_marker="$TMP_ROOT/${name}-full-marker"
    local log_dir="$TMP_ROOT/${name}-logs"
    local stub_log="$TMP_ROOT/${name}-bun.log"
    local output

    : > "$stub_log"
    output="$(
      PATH="$bridge_negative_repo/bin:$PATH" \
      STUB_LOG="$stub_log" \
      FORCE_VERIFY="$force" \
      MUSI_PRECOMMIT_MARKER="$precommit_marker" \
      MUSI_VERIFY_MARKER_CHANGED="$changed_marker" \
      MUSI_VERIFY_MARKER_FULL="$full_marker" \
      MUSI_VERIFY_LOCK="$TMP_ROOT/${name}-lock" \
      MUSI_VERIFY_LOG_DIR="$log_dir" \
        sh .husky/pre-commit 2>&1
    )" || fail "$name should run checks after bridge miss: $output"

    grep -qF "pre-commit: OK" <<< "$output" \
      || fail "$name bridge miss should finish with OK output: $output"
    grep -qF "stub bun run lint:changed" "$stub_log" \
      || fail "$name bridge miss did not run lint"
    if grep -qF "for this staged/worktree state" <<< "$output"; then
      fail "$name should not print a bridge skip: $output"
    fi
  }

  stale_ts=$(( $(date +%s) - 500 ))
  write_marker_with_ts "$TMP_ROOT/stale-manual-changed-marker" "$stale_ts" "$head" "$staged_hash"
  run_bridge_miss_case stale-manual

  {
    printf 'LAST_TS=%s\n' "$(date +%s)"
    printf 'LAST_HEAD=%s\n' "$head"
  } > "$TMP_ROOT/missing-fields-changed-marker"
  run_bridge_miss_case missing-fields

  {
    printf 'LAST_TS=%s\n' "$(date +%s)"
    printf 'LAST_HEAD=%s\n' "$head"
    printf 'LAST_HASH=%s\n' "$staged_hash"
    printf 'EXTRA=unexpected\n'
  } > "$TMP_ROOT/unknown-key-changed-marker"
  run_bridge_miss_case unknown-key

  musi_write_success_marker "$TMP_ROOT/wrong-head-changed-marker" "wrong-head" "$staged_hash" \
    || fail "test setup failed to write wrong-head marker"
  run_bridge_miss_case wrong-head

  bad_hash="$(printf '0%.0s' {1..64})"
  [ "$bad_hash" = "$staged_hash" ] && bad_hash="$(printf '1%.0s' {1..64})"
  musi_write_success_marker "$TMP_ROOT/hash-mismatch-changed-marker" "$head" "$bad_hash" \
    || fail "test setup failed to write hash-mismatch marker"
  run_bridge_miss_case hash-mismatch

  musi_write_success_marker "$TMP_ROOT/force-verify-changed-marker" "$head" "$staged_hash" \
    || fail "test setup failed to write force marker"
  run_bridge_miss_case force-verify 1
)
ok "pre-commit bridge fails closed for stale malformed mismatched and FORCE markers"

(
  cd "$bridge_negative_repo"
  ai_staged_fingerprint() { return 1; }
  set +e
  musi_try_verify_marker_bridge "$PWD" "$TMP_ROOT/operational-precommit-marker" \
    "$MUSI_GATE_MARKER_FRESHNESS_SECONDS" >/dev/null 2>&1
  bridge_operational_rc=$?
  set -e
  [ "$bridge_operational_rc" -eq 2 ] \
    || fail "bridge fingerprint failure should be operational rc=2, got $bridge_operational_rc"
)
ok "verify-marker bridge distinguishes operational failure from an ordinary miss"

(
  cd "$hook_repo"
  printf 'timeout source\n' > packages/timeout.ts
  git add packages/timeout.ts

  marker="$hook_repo/precommit-marker-timeout"
  log_dir="$hook_repo/precommit-logs-timeout"
  stub_log="$hook_repo/bun-timeout.log"
  : > "$stub_log"

  set +e
  output="$(
    PATH="$hook_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    STUB_SLEEP_LINT_CHANGED=10 \
    MUSI_INTERACTIVE_TIMEOUT=2 \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$hook_repo/precommit-lock-timeout" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )"
  exit_code=$?
  set -e

  [ "$exit_code" -eq 124 ] || fail "pre-commit timeout should exit 124 (got $exit_code): $output"
  grep -qF "PRE-COMMIT TIMED OUT" <<< "$output" \
    || fail "pre-commit timeout missing banner: $output"
  grep -qF "logs: $log_dir" <<< "$output" \
    || fail "pre-commit timeout missing log breadcrumb: $output"
  [ -f "$log_dir/run-meta.json" ] || fail "pre-commit timeout did not write run-meta.json"
  grep -q '"mode":"parallel-precommit"' "$log_dir/run-meta.json" \
    || fail "pre-commit timeout metadata should record parallel-precommit mode"
  grep -q '"name":"wrapper"' "$log_dir/run-meta.json" \
    || fail "pre-commit timeout metadata should record wrapper timing"
  grep -q '"exit_code":124' "$log_dir/run-meta.json" \
    || fail "pre-commit timeout metadata should record exit_code 124"
  if [ -f "$marker" ]; then
    fail "pre-commit timeout should not write success marker"
  fi
)
ok "pre-commit timeout records wrapper metadata"

(
  cd "$hook_repo"
  printf 'timeout descendant source\n' > packages/timeout-descendant.ts
  git add packages/timeout-descendant.ts

  term_fork_script="$hook_repo/precommit-term-fork.sh"
  term_fork_pid_file="$hook_repo/precommit-term-fork-child.pid"
  cat > "$term_fork_script" <<'SCRIPT'
#!/usr/bin/env bash
trap 'bash -c '\''trap "" TERM; echo $$ > "$TERM_FORK_CHILD_PID_FILE"; while :; do sleep 1; done'\'' & exit 0' TERM
while :; do sleep 1; done
SCRIPT
  chmod +x "$term_fork_script"

  # Give the parallel smoke runner enough startup headroom to launch the
  # TERM-fork stub before the watchdog fires; this case tests descendant
  # cleanup, not a two-second scheduling deadline.
  set +e
  output="$(
    PATH="$hook_repo/bin:$PATH" \
    STUB_LOG="$hook_repo/bun-timeout-descendant.log" \
    STUB_TERM_FORK_SCRIPT="$term_fork_script" \
    TERM_FORK_CHILD_PID_FILE="$term_fork_pid_file" \
    MUSI_INTERACTIVE_TIMEOUT=5 \
    MUSI_PROCESS_TREE_TERM_GRACE_TENTHS=2 \
    MUSI_PRECOMMIT_MARKER="$hook_repo/precommit-marker-timeout-descendant" \
    MUSI_VERIFY_LOCK="$hook_repo/precommit-lock-timeout-descendant" \
    MUSI_VERIFY_LOG_DIR="$hook_repo/precommit-logs-timeout-descendant" \
      sh .husky/pre-commit 2>&1
  )"
  exit_code=$?
  set -e

  [ "$exit_code" -eq 124 ] \
    || fail "pre-commit descendant timeout should exit 124 (got $exit_code): $output"
  for _ in $(seq 1 50); do
    [ -s "$term_fork_pid_file" ] && break
    sleep 0.1
  done
  [ -s "$term_fork_pid_file" ] \
    || fail "pre-commit TERM handler did not record its descendant pid"
  term_fork_pid=$(cat "$term_fork_pid_file")
  for _ in $(seq 1 50); do
    if ! kill -0 "$term_fork_pid" 2>/dev/null; then
      term_fork_pid=""
      break
    fi
    sleep 0.1
  done
  if [ -n "$term_fork_pid" ]; then
    kill -KILL "$term_fork_pid" 2>/dev/null || true
    fail "pre-commit timeout left TERM-handler descendant $term_fork_pid running"
  fi
)
ok "pre-commit timeout escalates cleanup for TERM-handler descendants"

(
  cd "$hook_repo"
  printf 'script source\n' > scripts/example.sh
  git add scripts/example.sh

  marker="$hook_repo/precommit-marker-scripts"
  log_dir="$hook_repo/precommit-logs-scripts"
  stub_log="$hook_repo/bun-scripts.log"
  : > "$stub_log"

  output="$(
    PATH="$hook_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$hook_repo/precommit-lock-scripts" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run script smoke tests for staged script edits: $output"

  grep -qF "stub bun run test:scripts:changed" "$stub_log" \
    || fail "script staged change did not run test:scripts:changed"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit with scripts missing OK output: $output"
)
ok "pre-commit runs script smoke tests for staged script changes"

script_deletion_repo="$TMP_ROOT/script-deletion-repo"
mkdir -p "$script_deletion_repo"
copy_precommit_fixture "$script_deletion_repo"
(
  cd "$script_deletion_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add .husky scripts bin
  git commit -q -m init
  printf 'script source\n' > scripts/example.sh
  git add scripts/example.sh
  git commit -q -m script
  git rm -q scripts/example.sh

  marker="$script_deletion_repo/precommit-marker-script-deletion"
  log_dir="$script_deletion_repo/precommit-logs-script-deletion"
  stub_log="$script_deletion_repo/bun-script-deletion.log"
  : > "$stub_log"

  output="$(
    PATH="$script_deletion_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$script_deletion_repo/precommit-lock-script-deletion" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run script smoke tests for staged script deletions: $output"

  grep -qF "stub bun run test:scripts:changed" "$stub_log" \
    || fail "staged script deletion did not run test:scripts:changed"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit with script deletion missing OK output: $output"
)
ok "pre-commit runs script smoke tests for staged script deletions"

hook_only_repo="$TMP_ROOT/hook-only-repo"
mkdir -p "$hook_only_repo/scripts/ai-hooks" "$hook_only_repo/scripts/lib" "$hook_only_repo/.husky" "$hook_only_repo/node_modules/.bin" "$hook_only_repo/bin"
cp "$SCRIPT_DIR/../dependency-freshness.sh" "$hook_only_repo/scripts/dependency-freshness.sh"
cp "$SCRIPT_DIR/../prisma-client-freshness.sh" "$hook_only_repo/scripts/prisma-client-freshness.sh"
cp "$SCRIPT_DIR/../doc-length-policy.sh" "$hook_only_repo/scripts/doc-length-policy.sh"
cp "$SCRIPT_DIR/../lib/verify-metadata.sh" "$hook_only_repo/scripts/lib/verify-metadata.sh"
cp "$SCRIPT_DIR/../lib/gate-env.sh" "$hook_only_repo/scripts/lib/gate-env.sh"
cp "$SCRIPT_DIR/../process-tree.sh" "$hook_only_repo/scripts/process-tree.sh"
cp "$SCRIPT_DIR/../lib/parallel-step.sh" "$hook_only_repo/scripts/lib/parallel-step.sh"
cp "$SCRIPT_DIR/../lib/verify-engine.sh" "$hook_only_repo/scripts/lib/verify-engine.sh"
cp "$SCRIPT_DIR/../lib/lint-dist-preflight.sh" "$hook_only_repo/scripts/lib/lint-dist-preflight.sh"
cp "$SCRIPT_DIR/../ai-hooks/output-filter.sh" "$hook_only_repo/scripts/ai-hooks/output-filter.sh"
cp "$SCRIPT_DIR/../../.husky/pre-commit" "$hook_only_repo/.husky/pre-commit"
copy_verify_steps_fixture "$hook_only_repo"
cat > "$hook_only_repo/bin/bun" <<'STUB'
#!/usr/bin/env sh
printf 'stub bun %s\n' "$*" >> "$STUB_LOG"
exit 0
STUB
chmod +x "$hook_only_repo/bin/bun"
(
  cd "$hook_only_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add scripts bin
  git commit -q -m init
  git add .husky/pre-commit

  marker="$hook_only_repo/precommit-marker"
  log_dir="$hook_only_repo/precommit-logs"
  stub_log="$hook_only_repo/bun.log"
  : > "$stub_log"

  output="$(
    PATH="$hook_only_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$hook_only_repo/precommit-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run checks for staged hook edits: $output"

  grep -qF "stub bun run test:scripts:changed" "$stub_log" \
    || fail "hook staged change did not run test:scripts:changed"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit with hook edit missing OK output: $output"
)
ok "pre-commit runs script smoke tests for staged hook changes"

# --- pre-commit with staged .claude/settings.json invokes test:scripts:changed
config_json_repo="$TMP_ROOT/config-json-repo"
copy_precommit_fixture "$config_json_repo"
(
  cd "$config_json_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  mkdir -p .claude
  printf '{"permissions":{}}\n' > .claude/settings.json
  git add scripts bin .husky .claude/settings.json
  git commit -q -m init
  printf '{"permissions":{"allow":["Bash(bun)"]}}\n' > .claude/settings.json
  git add .claude/settings.json

  marker="$config_json_repo/precommit-marker"
  log_dir="$config_json_repo/precommit-logs"
  stub_log="$config_json_repo/bun.log"
  : > "$stub_log"

  output="$(
    PATH="$config_json_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$config_json_repo/precommit-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run for staged .claude/settings.json: $output"

  grep -qF "stub bun run test:scripts:changed" "$stub_log" \
    || fail "staged .claude/settings.json did not run test:scripts:changed"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit with .claude/settings.json missing OK output: $output"
)
ok "pre-commit runs test:scripts:changed for staged .claude/settings.json"

# --- pre-commit with staged .codex/hooks.json invokes test:scripts:changed
codex_hooks_repo="$TMP_ROOT/codex-hooks-repo"
copy_precommit_fixture "$codex_hooks_repo"
(
  cd "$codex_hooks_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  mkdir -p .codex
  printf '{"hooks":[]}\n' > .codex/hooks.json
  git add scripts bin .husky .codex/hooks.json
  git commit -q -m init
  printf '{"hooks":[{"type":"pre-tool-use"}]}\n' > .codex/hooks.json
  git add .codex/hooks.json

  marker="$codex_hooks_repo/precommit-marker"
  log_dir="$codex_hooks_repo/precommit-logs"
  stub_log="$codex_hooks_repo/bun.log"
  : > "$stub_log"

  output="$(
    PATH="$codex_hooks_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$codex_hooks_repo/precommit-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run for staged .codex/hooks.json: $output"

  grep -qF "stub bun run test:scripts:changed" "$stub_log" \
    || fail "staged .codex/hooks.json did not run test:scripts:changed"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit with .codex/hooks.json missing OK output: $output"
)
ok "pre-commit runs test:scripts:changed for staged .codex/hooks.json"

# --- pre-commit with staged .github/hooks/copilot.json checks hook wiring ---
copilot_hooks_repo="$TMP_ROOT/copilot-hooks-repo"
copy_precommit_fixture "$copilot_hooks_repo"
(
  cd "$copilot_hooks_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  mkdir -p .github/hooks
  printf '{"hooks":[]}\n' > .github/hooks/copilot.json
  git add scripts bin .husky .github/hooks/copilot.json
  git commit -q -m init
  printf '{"hooks":[{"type":"pre-tool-use"}]}\n' > .github/hooks/copilot.json
  git add .github/hooks/copilot.json

  marker="$copilot_hooks_repo/precommit-marker"
  log_dir="$copilot_hooks_repo/precommit-logs"
  stub_log="$copilot_hooks_repo/bun.log"
  : > "$stub_log"

  output="$(
    PATH="$copilot_hooks_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$copilot_hooks_repo/precommit-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should run for staged .github/hooks/copilot.json: $output"

  grep -qF "stub bun run harness:wiring:check" "$stub_log" \
    || fail "staged .github/hooks/copilot.json did not run hook wiring freshness advisory"
  grep -qF "stub bun run test:scripts:changed" "$stub_log" \
    || fail "staged .github/hooks/copilot.json did not run test:scripts:changed"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit with .github/hooks/copilot.json missing OK output: $output"
)
ok "pre-commit checks hook wiring freshness for staged .github/hooks/copilot.json"

# --- pre-commit with staged docs/generated/harness-controls.md checks docs ---
harness_controls_doc_repo="$TMP_ROOT/harness-controls-doc-repo"
copy_precommit_fixture "$harness_controls_doc_repo"
(
  cd "$harness_controls_doc_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  mkdir -p docs/generated
  printf 'old\n' > docs/generated/harness-controls.md
  git add scripts bin .husky docs/generated/harness-controls.md
  git commit -q -m init
  printf 'new\n' > docs/generated/harness-controls.md
  git add docs/generated/harness-controls.md

  marker="$harness_controls_doc_repo/precommit-marker"
  log_dir="$harness_controls_doc_repo/precommit-logs"
  stub_log="$harness_controls_doc_repo/bun.log"
  : > "$stub_log"

  output="$(
    PATH="$harness_controls_doc_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$harness_controls_doc_repo/precommit-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should stay advisory for staged docs/generated/harness-controls.md: $output"

  grep -qF "stub bun run docs:harness-controls:check" "$stub_log" \
    || fail "staged docs/generated/harness-controls.md did not run harness controls freshness advisory"
  if grep -qF "stub bun run docs:lint-guidance:check" "$stub_log"; then
    fail "staged docs/generated/harness-controls.md should not run lint guidance freshness advisory"
  fi
  grep -qF "pre-commit: no source changes staged" <<< "$output" \
    || fail "generated harness controls doc should remain source-irrelevant after advisory: $output"
)
ok "pre-commit checks harness controls freshness for staged generated doc"

# --- restricted-disable generator now triggers its generated warning --------
restricted_disable_repo="$TMP_ROOT/restricted-disable-repo"
copy_precommit_fixture "$restricted_disable_repo"
(
  cd "$restricted_disable_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  mkdir -p scripts/harness
  printf 'export {};\n' > scripts/harness/generate-restricted-disable-rules.ts
  git add scripts bin .husky
  git commit -q -m init
  printf '\n' >> scripts/harness/generate-restricted-disable-rules.ts
  git add scripts/harness/generate-restricted-disable-rules.ts

  marker="$restricted_disable_repo/precommit-marker"
  log_dir="$restricted_disable_repo/precommit-logs"
  stub_log="$restricted_disable_repo/bun.log"
  : > "$stub_log"

  output="$(
    PATH="$restricted_disable_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    STUB_FAIL_MATCH="run lint:restricted-disable-rules:check" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$restricted_disable_repo/precommit-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      bash .husky/pre-commit 2>&1
  )" || fail "pre-commit should keep generated freshness advisory-only: $output"

  grep -qF "stub bun run lint:restricted-disable-rules:check" "$stub_log" \
    || fail "restricted-disable generator did not invoke its freshness check"
  grep -qF "pre-commit: WARN: restricted-disable rule metadata appears stale" <<< "$output" \
    || fail "restricted-disable generator did not emit the expected stale warning: $output"
)
ok "pre-commit warns when restricted-disable generator output is stale"

# Fast registration admission blocks on the skill/verify registration fragments
# only. The other generated-surface checks remain advisory in fast mode.
fast_generated_advisory_repo="$TMP_ROOT/fast-generated-advisory-repo"
copy_precommit_fixture "$fast_generated_advisory_repo"
(
  cd "$fast_generated_advisory_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  mkdir -p scripts/harness
  mkdir -p scripts/path-policy
  printf '{"controls":[]}\n' > harness.controls.json
  printf '{"include":[]}\n' > tsconfig.configs.json
  printf 'export {};\n' > scripts/harness/generate-restricted-disable-rules.ts
  printf 'export {};\n' > scripts/path-policy/generate-smoke-subjects.ts
  git add scripts bin .husky harness.controls.json tsconfig.configs.json
  git add scripts/harness/generate-restricted-disable-rules.ts scripts/path-policy/generate-smoke-subjects.ts
  git commit -q -m init

  printf '\n' >> harness.controls.json
  printf '\n' >> tsconfig.configs.json
  printf '\n' >> scripts/harness/generate-restricted-disable-rules.ts
  printf '\n' >> scripts/path-policy/generate-smoke-subjects.ts
  git add harness.controls.json tsconfig.configs.json
  git add scripts/harness/generate-restricted-disable-rules.ts scripts/path-policy/generate-smoke-subjects.ts
  identity="$(musi_git_common_identity_path "$PWD")"
  : > "$identity/musi-fast-commit"

  marker="$fast_generated_advisory_repo/precommit-marker"
  log_dir="$fast_generated_advisory_repo/precommit-logs"
  stub_log="$fast_generated_advisory_repo/bun.log"
  : > "$stub_log"

  output="$(
    PATH="$fast_generated_advisory_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$fast_generated_advisory_repo/precommit-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "fast pre-commit should retain non-overlapping advisories: $output"

  [ "$(grep -cF 'stub bun run harness:registration:check' "$stub_log")" -eq 1 ] \
    || fail "fast pre-commit should run registration admission exactly once"
  for advisory in \
    'harness:config-surfaces:check' \
    'harness:wiring:check' \
    'harness:hook-timeouts:check' \
    'lint:restricted-disable-rules:check' \
    'docs:harness-controls:check'; do
    grep -qF "stub bun run $advisory" "$stub_log" \
      || fail "fast pre-commit suppressed non-overlapping advisory $advisory"
  done
  if grep -qF 'stub bun run harness:skills:check' "$stub_log"; then
    fail "fast pre-commit should suppress the overlapping skill advisory"
  fi
  if grep -qF 'stub bun run test:scripts:subjects:check' "$stub_log"; then
    fail "fast pre-commit should suppress the overlapping smoke-subject advisory"
  fi
  if grep -qF 'stub bun run verify:steps:check' "$stub_log"; then
    fail "fast pre-commit should suppress the overlapping verify-registration advisory"
  fi
)
ok "fast pre-commit suppresses only admission-overlapping generated advisories"

# A docs-only commit never reaches fast registration admission, so the marker
# must not suppress even a normally-overlapping generated-surface advisory.
docs_only_fast_advisory_repo="$TMP_ROOT/docs-only-fast-advisory-repo"
copy_precommit_fixture "$docs_only_fast_advisory_repo"
(
  cd "$docs_only_fast_advisory_repo"
  cat > scripts/harness/generated-surface-freshness.generated.sh <<'SH'
musi_warn_generated_surfaces_stale() {
  warn_if_generated_surface_stale 'verify step and generated-surface metadata' 'verify:steps:check'
}
SH
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  git add scripts bin .husky
  git commit -q -m init
  mkdir -p docs
  printf 'docs-only advisory\n' > docs/advisory.md
  git add docs/advisory.md
  identity="$(musi_git_common_identity_path "$PWD")"
  : > "$identity/musi-fast-commit"
  stub_log="$docs_only_fast_advisory_repo/bun.log"
  : > "$stub_log"

  output="$(
    PATH="$docs_only_fast_advisory_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    STUB_FAIL_MATCH='verify:steps:check' \
      sh .husky/pre-commit 2>&1
  )" || fail "docs-only fast pre-commit should remain advisory-only: $output"

  grep -qF 'stub bun run verify:steps:check' "$stub_log" \
    || fail "docs-only fast commit incorrectly suppressed an unreachable admission advisory"
  grep -qF 'pre-commit: WARN: verify step and generated-surface metadata appears stale' <<< "$output" \
    || fail "docs-only fast commit did not print the stale advisory: $output"
  if grep -qF 'stub bun run harness:registration:check' "$stub_log"; then
    fail "docs-only fast commit must not run registration admission"
  fi
)
ok "docs-only fast commit retains advisories when admission is unreachable"

# --- pre-commit with non-script deletion passes staged files through --------
non_script_del_repo="$TMP_ROOT/non-script-del-repo"
copy_precommit_fixture "$non_script_del_repo"
(
  cd "$non_script_del_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  mkdir -p packages/server/src
  printf 'export const x = 1;\n' > packages/server/src/example.ts
  printf 'echo verify\n' > scripts/verify.sh
  git add scripts bin .husky packages
  git commit -q -m init

  git rm -q packages/server/src/example.ts
  printf 'echo changed\n' > scripts/verify.sh
  git add scripts/verify.sh

  marker="$non_script_del_repo/precommit-marker"
  log_dir="$non_script_del_repo/precommit-logs"
  stub_log="$non_script_del_repo/bun.log"
  : > "$stub_log"

  output="$(
    PATH="$non_script_del_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$non_script_del_repo/precommit-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should succeed with non-script deletion + script edit: $output"

  grep -qF "stub bun run test:scripts:changed" "$stub_log" \
    || fail "non-script deletion with script edit did not run test:scripts:changed"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit with non-script deletion missing OK output: $output"
)
ok "pre-commit passes staged files through when non-script deletion is staged"

# --- pre-commit with script deletion does NOT pass staged files through -----
script_del_fallback_repo="$TMP_ROOT/script-del-fallback-repo"
copy_precommit_fixture "$script_del_fallback_repo"
(
  cd "$script_del_fallback_repo"
  git init -q
  git config user.name "Test User"
  git config user.email "test@example.invalid"
  printf 'echo old\n' > scripts/old-helper.sh
  git add scripts bin .husky
  git commit -q -m init

  git rm -q scripts/old-helper.sh

  marker="$script_del_fallback_repo/precommit-marker"
  log_dir="$script_del_fallback_repo/precommit-logs"
  stub_log="$script_del_fallback_repo/bun.log"
  : > "$stub_log"

  output="$(
    PATH="$script_del_fallback_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$marker" \
    MUSI_VERIFY_LOCK="$script_del_fallback_repo/precommit-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "pre-commit should succeed with script deletion: $output"

  grep -qF "stub bun run test:scripts:changed" "$stub_log" \
    || fail "script deletion did not run test:scripts:changed"
  grep -qF "pre-commit: OK" <<< "$output" \
    || fail "pre-commit with script deletion missing OK output: $output"
)
ok "pre-commit uses full fallback when script deletion is staged"

# --- fast-commit provenance is keyed on actual slot skips -------------------
# End-to-end through pre-commit's EXIT trap and post-commit's finalizer: only
# a commit that really fast-skipped slots may reach the provenance log.

# Positive control first, so the two negatives below cannot pass vacuously on
# a miswired fixture: a source commit under the fast-commit marker skips the
# test/scripts slots, leaves a pending marker, and post-commit logs HEAD.
fast_skip_repo="$TMP_ROOT/fast-skip-provenance-repo"
init_bridge_repo "$fast_skip_repo"
(
  cd "$fast_skip_repo"
  printf 'fast tracked edit\n' > packages/example.ts
  git add packages/example.ts
  identity="$(musi_git_common_identity_path "$PWD")"
  : > "$identity/musi-fast-commit"

  stub_log="$TMP_ROOT/fast-skip-provenance-bun.log"
  : > "$stub_log"
  output="$(
    PATH="$fast_skip_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$TMP_ROOT/fast-skip-provenance-precommit-marker" \
    MUSI_VERIFY_LOCK="$TMP_ROOT/fast-skip-provenance-lock" \
    MUSI_VERIFY_LOG_DIR="$TMP_ROOT/fast-skip-provenance-logs" \
      sh .husky/pre-commit 2>&1
  )" || fail "fast-commit pre-commit should pass with stubbed slots: $output"
  grep -qF "fast-commit mode — skipping test slot" <<< "$output" \
    || fail "fast-commit run should report the skipped test slot: $output"
  [ "$(grep -cF 'stub bun run harness:registration:check' "$stub_log")" -eq 1 ] \
    || fail "fast-commit run should execute registration admission exactly once"
  [ -f "$TMP_ROOT/fast-skip-provenance-logs/registration.log" ] \
    || fail "fast-commit run should retain exactly one registration.log"
  if grep -qF 'registration' <<< "$(grep -F 'pre-commit: OK' <<< "$output")"; then
    fail "registration admission must not be presented as behavioral slot evidence: $output"
  fi
  [ -f "$(musi_fast_commit_pending_marker "$PWD")" ] \
    || fail "slot-skipping run should leave a pending provenance marker"

  sh .husky/post-commit \
    || fail "post-commit should finalize the fast-skip pending marker"
  grep -qxF "$(git rev-parse HEAD)" "$identity/musi-fast-commit-log" \
    || fail "fast-skipping commit should be appended to the provenance log"
  [ ! -e "$(musi_fast_commit_pending_marker "$PWD")" ] \
    || fail "post-commit should consume the pending marker after logging"
)
ok "fast-commit slot skip records provenance end-to-end"

# A structural admission failure blocks before cache/bridge/slot dispatch,
# writes one registration log and one summary, and creates no success debt.
fast_registration_failure_repo="$TMP_ROOT/fast-registration-failure-repo"
init_bridge_repo "$fast_registration_failure_repo"
(
  cd "$fast_registration_failure_repo"
  printf 'registration failure edit\n' > packages/example.ts
  git add packages/example.ts
  identity="$(musi_git_common_identity_path "$PWD")"
  : > "$identity/musi-fast-commit"
  stub_log="$TMP_ROOT/fast-registration-failure-bun.log"
  log_dir="$TMP_ROOT/fast-registration-failure-logs"
  : > "$stub_log"
  seed_prior_verify_evidence "$log_dir"

  set +e
  output="$(
    PATH="$fast_registration_failure_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    STUB_FAIL_MATCH='harness:registration:check' \
    MUSI_PRECOMMIT_MARKER="$TMP_ROOT/fast-registration-failure-marker" \
    MUSI_VERIFY_LOCK="$TMP_ROOT/fast-registration-failure-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )"
  exit_code=$?
  set -e
  [ "$exit_code" -ne 0 ] || fail "registration admission failure must block pre-commit"
  [ "$(grep -cF 'stub bun run harness:registration:check' "$stub_log")" -eq 1 ] \
    || fail "failing registration admission should run exactly once"
  [ "$(find "$log_dir" -maxdepth 1 -name registration.log | wc -l)" -eq 1 ] \
    || fail "failing registration admission should write one registration.log"
  grep -qF 'stub failure for run harness:registration:check' "$log_dir/registration.log" \
    || fail "registration.log should retain the checker diagnostic"
  assert_prior_verify_evidence "$log_dir" "registration admission failure"
  [ "$(grep -cF 'Failed: registration' <<< "$output")" -eq 1 ] \
    || fail "registration admission should print one failure summary: $output"
  if grep -qF 'stub bun run lint:changed' "$stub_log"; then
    fail "registration failure must block before behavioral slots"
  fi
  [ ! -e "$(musi_fast_commit_pending_marker "$PWD")" ] \
    || fail "registration failure must not leave pending fast provenance"
)
ok "fast registration failure blocks once before behavioral slots"

# A 124 from the bounded admission command gets a retry-oriented diagnostic
# and restores the complete prior evidence set just like an ordinary failure.
fast_registration_timeout_repo="$TMP_ROOT/fast-registration-timeout-repo"
init_bridge_repo "$fast_registration_timeout_repo"
(
  cd "$fast_registration_timeout_repo"
  printf 'registration timeout edit\n' > packages/example.ts
  git add packages/example.ts
  identity="$(musi_git_common_identity_path "$PWD")"
  : > "$identity/musi-fast-commit"
  stub_log="$TMP_ROOT/fast-registration-timeout-bun.log"
  log_dir="$TMP_ROOT/fast-registration-timeout-logs"
  : > "$stub_log"
  seed_prior_verify_evidence "$log_dir"

  set +e
  output="$(
    PATH="$fast_registration_timeout_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    STUB_TIMEOUT_MATCH='harness:registration:check' \
    MUSI_PRECOMMIT_MARKER="$TMP_ROOT/fast-registration-timeout-marker" \
    MUSI_VERIFY_LOCK="$TMP_ROOT/fast-registration-timeout-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )"
  exit_code=$?
  set -e
  [ "$exit_code" -ne 0 ] || fail "registration admission timeout must block pre-commit"
  grep -qF 'registration admission timed out; retry the commit' "$log_dir/registration.log" \
    || fail "registration timeout should print concise retry guidance"
  assert_prior_verify_evidence "$log_dir" "registration admission timeout"
  [ "$(grep -cF 'Failed: registration' <<< "$output")" -eq 1 ] \
    || fail "registration timeout should print one failure summary: $output"
  if grep -qF 'stub bun run lint:changed' "$stub_log"; then
    fail "registration timeout must block before behavioral slots"
  fi
)
ok "fast registration timeout restores evidence and prints retry guidance"

# The engine fingerprints the admitted state on both sides of the command.
fast_registration_mutation_repo="$TMP_ROOT/fast-registration-mutation-repo"
init_bridge_repo "$fast_registration_mutation_repo"
(
  cd "$fast_registration_mutation_repo"
  printf 'stable staged registration edit\n' > packages/example.ts
  git add packages/example.ts
  identity="$(musi_git_common_identity_path "$PWD")"
  : > "$identity/musi-fast-commit"
  stub_log="$TMP_ROOT/fast-registration-mutation-bun.log"
  log_dir="$TMP_ROOT/fast-registration-mutation-logs"
  : > "$stub_log"

  set +e
  output="$(
    PATH="$fast_registration_mutation_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    STUB_MUTATE_MATCH='harness:registration:check' \
    STUB_MUTATE_PATH="$fast_registration_mutation_repo/packages/example.ts" \
    MUSI_PRECOMMIT_MARKER="$TMP_ROOT/fast-registration-mutation-marker" \
    MUSI_VERIFY_LOCK="$TMP_ROOT/fast-registration-mutation-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )"
  exit_code=$?
  set -e
  [ "$exit_code" -ne 0 ] || fail "registration input mutation must fail closed"
  grep -qF 'registration inputs changed during admission' "$log_dir/registration.log" \
    || fail "registration mutation should explain the fingerprint failure"
  [ "$(grep -cF 'stub bun run harness:registration:check' "$stub_log")" -eq 1 ] \
    || fail "registration mutation case should run admission exactly once"
  if grep -qF 'stub bun run lint:changed' "$stub_log"; then
    fail "registration mutation must stop before behavioral slots"
  fi
)
ok "fast registration admission fails closed when its fingerprint changes"

# The under-lock fast-mode snapshot remains authoritative if another worktree
# removes the shared marker while admission is running. Admission, slot skips,
# fingerprinting, and pending provenance must all retain the same mode.
fast_snapshot_repo="$TMP_ROOT/fast-snapshot-repo"
init_bridge_repo "$fast_snapshot_repo"
(
  cd "$fast_snapshot_repo"
  printf 'fast snapshot edit\n' > packages/example.ts
  git add packages/example.ts
  identity="$(musi_git_common_identity_path "$PWD")"
  fast_marker="$identity/musi-fast-commit"
  : > "$fast_marker"
  stub_log="$TMP_ROOT/fast-snapshot-bun.log"
  : > "$stub_log"

  output="$(
    PATH="$fast_snapshot_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    STUB_REMOVE_PATH_MATCH='harness:registration:check' \
    STUB_REMOVE_PATH="$fast_marker" \
    MUSI_PRECOMMIT_MARKER="$TMP_ROOT/fast-snapshot-precommit-marker" \
    MUSI_VERIFY_LOCK="$TMP_ROOT/fast-snapshot-lock" \
    MUSI_VERIFY_LOG_DIR="$TMP_ROOT/fast-snapshot-logs" \
      sh .husky/pre-commit 2>&1
  )" || fail "fast snapshot should survive a mid-admission marker removal: $output"
  [ ! -e "$fast_marker" ] || fail "snapshot fixture did not remove the shared marker"
  grep -qF 'fast-commit mode — skipping test slot' <<< "$output" \
    || fail "mid-admission marker removal changed snapshotted slot resolution: $output"
  [ -f "$(musi_fast_commit_pending_marker "$PWD")" ] \
    || fail "mid-admission marker removal lost snapshotted provenance"
)
ok "fast-mode snapshot binds admission slots fingerprint and provenance"

# Generated-surface advisory suppression must use the same under-lock snapshot
# as registration admission and slot resolution. Removing the live marker from
# a later non-overlapping advisory cannot retroactively turn a fast snapshot
# into a non-fast gate or unsuppress the overlapping checks.
fast_advisory_snapshot_repo="$TMP_ROOT/fast-advisory-snapshot-repo"
init_bridge_repo "$fast_advisory_snapshot_repo"
(
  cd "$fast_advisory_snapshot_repo"
  printf '{"controls":[]}\n' > harness.controls.json
  git add harness.controls.json
  identity="$(musi_git_common_identity_path "$PWD")"
  fast_marker="$identity/musi-fast-commit"
  : > "$fast_marker"
  stub_log="$TMP_ROOT/fast-advisory-snapshot-bun.log"
  : > "$stub_log"

  output="$(
    PATH="$fast_advisory_snapshot_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    STUB_REMOVE_PATH_MATCH='docs:harness-controls:check' \
    STUB_REMOVE_PATH="$fast_marker" \
    MUSI_PRECOMMIT_MARKER="$TMP_ROOT/fast-advisory-snapshot-precommit-marker" \
    MUSI_VERIFY_LOCK="$TMP_ROOT/fast-advisory-snapshot-lock" \
    MUSI_VERIFY_LOG_DIR="$TMP_ROOT/fast-advisory-snapshot-logs" \
      sh .husky/pre-commit 2>&1
  )" || fail "fast advisory snapshot should survive marker removal: $output"
  [ ! -e "$fast_marker" ] || fail "fast advisory snapshot fixture did not remove the marker"
  [ "$(grep -cF 'stub bun run harness:registration:check' "$stub_log")" -eq 1 ] \
    || fail "fast advisory snapshot did not retain registration admission"
  if grep -qF 'stub bun run verify:steps:check' "$stub_log"; then
    fail "fast advisory snapshot did not suppress the overlapping verify advisory"
  fi
  grep -qF 'fast-commit mode — skipping test slot' <<< "$output" \
    || fail "fast advisory snapshot did not bind slot resolution: $output"
) || exit 1
ok "fast advisory suppression consumes the authoritative under-lock snapshot"

# Conversely, creating the marker while a non-fast snapshot is already running
# an overlapping advisory must not enable admission or fast slot skips midway.
nonfast_advisory_snapshot_repo="$TMP_ROOT/nonfast-advisory-snapshot-repo"
init_bridge_repo "$nonfast_advisory_snapshot_repo"
(
  cd "$nonfast_advisory_snapshot_repo"
  printf '{"controls":[]}\n' > harness.controls.json
  git add harness.controls.json
  identity="$(musi_git_common_identity_path "$PWD")"
  fast_marker="$identity/musi-fast-commit"
  rm -f "$fast_marker"
  stub_log="$TMP_ROOT/nonfast-advisory-snapshot-bun.log"
  : > "$stub_log"

  output="$(
    PATH="$nonfast_advisory_snapshot_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    STUB_CREATE_PATH_MATCH='verify:steps:check' \
    STUB_CREATE_PATH="$fast_marker" \
    MUSI_PRECOMMIT_MARKER="$TMP_ROOT/nonfast-advisory-snapshot-precommit-marker" \
    MUSI_VERIFY_LOCK="$TMP_ROOT/nonfast-advisory-snapshot-lock" \
    MUSI_VERIFY_LOG_DIR="$TMP_ROOT/nonfast-advisory-snapshot-logs" \
      sh .husky/pre-commit 2>&1
  )" || fail "non-fast advisory snapshot should remain stable: $output"
  [ -e "$fast_marker" ] || fail "non-fast advisory snapshot fixture did not create the marker"
  [ "$(grep -cF 'stub bun run verify:steps:check' "$stub_log")" -eq 1 ] \
    || fail "non-fast advisory snapshot should run the overlapping advisory once"
  if grep -qF 'stub bun run harness:registration:check' "$stub_log"; then
    fail "non-fast advisory snapshot unexpectedly enabled registration admission"
  fi
  if grep -qF 'fast-commit mode — skipping test slot' <<< "$output"; then
    fail "non-fast advisory snapshot unexpectedly enabled fast slot skips"
  fi
) || exit 1
ok "non-fast advisory suppression ignores a later live-marker creation"

# Regression: if post-commit cannot append after a real fast-skipping commit,
# the next pre-commit must recover that commit before it initializes provenance
# for the new commit. Previously prepare unconditionally deleted the pending
# marker, so even a docs-only follow-up silently erased the skipped-slot debt.
fast_retry_repo="$TMP_ROOT/fast-retry-next-commit-repo"
init_bridge_repo "$fast_retry_repo"
(
  cd "$fast_retry_repo"
  printf 'fast tracked edit before append failure\n' > packages/example.ts
  git add packages/example.ts
  identity="$(musi_git_common_identity_path "$PWD")"
  : > "$identity/musi-fast-commit"

  stub_log="$TMP_ROOT/fast-retry-next-commit-bun.log"
  : > "$stub_log"
  output="$(
    PATH="$fast_retry_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$TMP_ROOT/fast-retry-next-commit-precommit-marker" \
    MUSI_VERIFY_LOCK="$TMP_ROOT/fast-retry-next-commit-lock" \
    MUSI_VERIFY_LOG_DIR="$TMP_ROOT/fast-retry-next-commit-logs" \
      sh .husky/pre-commit 2>&1
  )" || fail "fast-commit pre-commit should pass before append failure: $output"
  git commit -q -m "fast commit whose append fails"
  skipped_head="$(git rev-parse HEAD)"

  mkdir "$identity/musi-fast-commit-log"
  output="$(sh .husky/post-commit 2>&1)" \
    || fail "post-commit append failure must not fail the existing commit: $output"
  grep -qF "post-commit: WARNING: failed to append" <<< "$output" \
    || fail "post-commit append failure should warn before next-commit recovery: $output"
  [ -f "$(musi_fast_commit_pending_marker "$PWD")" ] \
    || fail "post-commit append failure must retain pending provenance"

  mkdir -p docs
  printf 'docs-only follow-up\n' > docs/follow-up.md
  git add docs/follow-up.md
  set +e
  output="$(sh .husky/pre-commit 2>&1)"
  exit_code=$?
  set -e
  [ "$exit_code" -ne 0 ] \
    || fail "follow-up pre-commit must fail while provenance recovery is unwritable: $output"
  [ -f "$(musi_fast_commit_pending_marker "$PWD")" ] \
    || fail "failed next-commit recovery must retain pending provenance"

  rmdir "$identity/musi-fast-commit-log"
  output="$(sh .husky/pre-commit 2>&1)" \
    || fail "follow-up pre-commit should recover pending fast provenance: $output"
  grep -qxF "$skipped_head" "$identity/musi-fast-commit-log" \
    || fail "follow-up pre-commit silently lost fast-skipped SHA $skipped_head"
  [ ! -e "$(musi_fast_commit_pending_marker "$PWD")" ] \
    || fail "docs-only follow-up should leave no pending marker after recovery"
)
ok "next pre-commit recovers a failed post-commit provenance append"

# A marker can accumulate multiple failed HEADs when another post-commit runs
# before the shared log becomes writable. Recovery must replay every line, not
# just the most recently appended HEAD.
multi_head_repo="$TMP_ROOT/fast-retry-multiple-heads-repo"
init_bridge_repo "$multi_head_repo"
(
  cd "$multi_head_repo"
  identity="$(musi_git_common_identity_path "$PWD")"
  pending="$(musi_fast_commit_pending_marker "$PWD")"
  older_head="$(git rev-parse HEAD^)"
  newer_head="$(git rev-parse HEAD)"
  {
    printf 'head=%s\n' "$older_head"
    printf 'head=%s\n' "$newer_head"
  } > "$pending"
  mkdir -p docs
  printf 'multi-head recovery follow-up\n' > docs/multi-head.md
  git add docs/multi-head.md

  output="$(sh .husky/pre-commit 2>&1)" \
    || fail "pre-commit should replay every pending HEAD: $output"
  grep -qxF "$older_head" "$identity/musi-fast-commit-log" \
    || fail "multi-head recovery lost older pending SHA $older_head"
  grep -qxF "$newer_head" "$identity/musi-fast-commit-log" \
    || fail "multi-head recovery lost newer pending SHA $newer_head"
  [ ! -e "$pending" ] \
    || fail "multi-head recovery should consume marker after all appends succeed"
)
ok "next pre-commit recovers every pending fast-commit HEAD"

# An old parent-only marker may no longer identify the skipped commit after HEAD
# advances. Fail closed, but give the operator the exact append/remove recipe
# and concrete shared-log and pending-marker paths needed to unblock safely.
unresolved_repo="$TMP_ROOT/fast-retry-unresolved-marker-repo"
init_bridge_repo "$unresolved_repo"
(
  cd "$unresolved_repo"
  identity="$(musi_git_common_identity_path "$PWD")"
  log="$identity/musi-fast-commit-log"
  pending="$(musi_fast_commit_pending_marker "$PWD")"
  printf 'parent=unresolvable-parent\n' > "$pending"
  mkdir -p docs
  printf 'unresolved recovery follow-up\n' > docs/unresolved.md
  git add docs/unresolved.md

  set +e
  output="$(sh .husky/pre-commit 2>&1)"
  exit_code=$?
  set -e
  [ "$exit_code" -ne 0 ] \
    || fail "unresolved pending provenance must fail closed: $output"
  grep -qF "Append the skipped SHA(s) to $log, then remove $pending" <<< "$output" \
    || fail "unresolved marker error must print concrete recovery paths: $output"
  [ -f "$pending" ] \
    || fail "unresolved marker failure must preserve pending provenance"
)
ok "unresolved fast provenance prints an actionable recovery recipe"

# Negative: a docs-only commit skips no slots even with the marker present, so
# nothing may reach the provenance log — re-logging it would force a redundant
# full verify at push time.
docs_only_fast_repo="$TMP_ROOT/docs-only-fast-repo"
init_bridge_repo "$docs_only_fast_repo"
(
  cd "$docs_only_fast_repo"
  mkdir -p docs
  printf 'notes only\n' > docs/notes.md
  git add docs/notes.md
  identity="$(musi_git_common_identity_path "$PWD")"
  : > "$identity/musi-fast-commit"

  output="$(sh .husky/pre-commit 2>&1)" \
    || fail "docs-only pre-commit should pass under the fast-commit marker: $output"
  grep -qF "no source changes staged" <<< "$output" \
    || fail "docs-only run should take the source-skip path: $output"
  [ ! -e "$(musi_fast_commit_pending_marker "$PWD")" ] \
    || fail "docs-only commit must not leave a pending provenance marker"

  sh .husky/post-commit \
    || fail "post-commit should be a no-op for a docs-only commit"
  [ ! -s "$identity/musi-fast-commit-log" ] \
    || fail "docs-only commit must not be appended to the provenance log"
)
ok "docs-only commit under fast-commit marker records no provenance"

# A fast-mode retry admitted by the native marker may reuse a prior run that
# skipped slots. Its exactly-once EXIT callback must therefore preserve pending
# provenance for post-commit instead of treating the marker hit like docs/bridge.
native_fast_repo="$TMP_ROOT/native-fast-provenance-repo"
init_bridge_repo "$native_fast_repo"
(
  cd "$native_fast_repo"
  printf 'native marker retry edit\n' > packages/example.ts
  git add packages/example.ts
  identity="$(musi_git_common_identity_path "$PWD")"
  : > "$identity/musi-fast-commit"
  native_marker="$TMP_ROOT/native-fast-precommit-marker"
  log_dir="$TMP_ROOT/native-fast-logs"
  seed_prior_verify_evidence "$log_dir"
  musi_write_success_marker "$native_marker" "$(git rev-parse HEAD)" \
    "$(ai_precommit_fingerprint "$PWD")" \
    || fail "test setup failed to write native pre-commit marker"

  output="$({
    PATH="$native_fast_repo/bin:$PATH" \
    STUB_LOG="$TMP_ROOT/native-fast-bun.log" \
    MUSI_PRECOMMIT_MARKER="$native_marker" \
    MUSI_VERIFY_LOCK="$TMP_ROOT/native-fast-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit
  } 2>&1)" || fail "native marker retry should pass under fast mode: $output"
  grep -qF 'pre-commit: already verified' <<< "$output" \
    || fail "native fast retry should use the native marker: $output"
  [ "$(grep -cF 'stub bun run harness:registration:check' "$TMP_ROOT/native-fast-bun.log")" -eq 1 ] \
    || fail "native marker hit must run registration admission exactly once first"
  [ -f "$(musi_fast_commit_pending_marker "$PWD")" ] \
    || fail "native marker hit under fast mode must leave pending provenance"
  assert_prior_verify_evidence "$log_dir" "fast native marker hit"
  [ -f "$log_dir/registration.log" ] \
    || fail "fast native marker hit must retain the current registration.log"
)
ok "native pre-commit marker hit under fast mode preserves retry provenance"

# Negative: a marker-bridged commit skipped no slots either — bridge markers
# come from manual verify / verify:changed, which never fast-skip.
bridge_fast_repo="$TMP_ROOT/bridge-fast-provenance-repo"
init_bridge_repo "$bridge_fast_repo"
(
  cd "$bridge_fast_repo"
  printf 'bridged tracked edit\n' > packages/example.ts
  git add packages/example.ts
  identity="$(musi_git_common_identity_path "$PWD")"
  : > "$identity/musi-fast-commit"
  changed_marker="$TMP_ROOT/bridge-fast-changed-marker"
  musi_write_success_marker "$changed_marker" "$(git rev-parse HEAD)" \
    "$(ai_staged_fingerprint "$PWD")" \
    || fail "test setup failed to write changed verify marker"

  stub_log="$TMP_ROOT/bridge-fast-bun.log"
  log_dir="$TMP_ROOT/bridge-fast-logs"
  seed_prior_verify_evidence "$log_dir"
  : > "$stub_log"
  output="$(
    PATH="$bridge_fast_repo/bin:$PATH" \
    STUB_LOG="$stub_log" \
    MUSI_PRECOMMIT_MARKER="$TMP_ROOT/bridge-fast-precommit-marker" \
    MUSI_VERIFY_MARKER_CHANGED="$changed_marker" \
    MUSI_VERIFY_MARKER_FULL="$TMP_ROOT/bridge-fast-full-marker" \
    MUSI_VERIFY_LOCK="$TMP_ROOT/bridge-fast-lock" \
    MUSI_VERIFY_LOG_DIR="$log_dir" \
      sh .husky/pre-commit 2>&1
  )" || fail "bridged pre-commit should pass under the fast-commit marker: $output"
  grep -qF "verify:changed passed" <<< "$output" \
    || fail "bridged run should take the verify-marker bridge path: $output"
  [ "$(grep -cF 'stub bun run harness:registration:check' "$stub_log")" -eq 1 ] \
    || fail "verify bridge hit must run registration admission exactly once first"
  [ ! -e "$(musi_fast_commit_pending_marker "$PWD")" ] \
    || fail "marker-bridged commit must not leave a pending provenance marker"
  assert_prior_verify_evidence "$log_dir" "fast verify bridge hit"
  [ -f "$log_dir/registration.log" ] \
    || fail "fast verify bridge hit must retain the current registration.log"

  sh .husky/post-commit \
    || fail "post-commit should be a no-op for a marker-bridged commit"
  [ ! -s "$identity/musi-fast-commit-log" ] \
    || fail "marker-bridged commit must not be appended to the provenance log"
)
ok "marker-bridged commit under fast-commit marker records no provenance"

printf 'dependency freshness tests passed\n'
