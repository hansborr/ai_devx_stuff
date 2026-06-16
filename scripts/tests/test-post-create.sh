#!/usr/bin/env bash
# Smoke tests for .devcontainer/post-create.sh — the devcontainer setup
# orchestrator.
#
# Focus: the completion gate. The old inline postCreateCommand ran every step
# under `2>/dev/null` and `touch`ed .setup-complete unconditionally, so a
# half-provisioned container reported success. These tests stub `bun`/`bunx`
# (no real install/build/DB work runs) and assert that the script:
#   * writes .setup-complete only when every critical step succeeds,
#   * writes .setup-failed and exits non-zero when a critical step fails,
#   * does NOT let an optional step (Playwright) block completion,
#   * actually wires the build-shared and seed steps (issues #2 / #3).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POST_CREATE="$SCRIPT_DIR/../../.devcontainer/post-create.sh"
[ -f "$POST_CREATE" ] || {
  printf 'FAIL: post-create.sh not found at %s\n' "$POST_CREATE" >&2
  exit 1
}

PASS=0
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

make_stub_bin() {
  # Stub bun/bunx into $1. They log invocations to $STUB_LOG and honor
  # STUB_FAIL_MATCH (a substring of bun's args → exit 1) and STUB_FAIL_BUNX.
  # A `bun .../pgexec.ts ...` call prints "1" so wait_for_db sees the DB as
  # reachable and ensure_test_databases sees the test DBs as already present.
  local dir="$1"
  mkdir -p "$dir"
  cat > "$dir/bun" <<'STUB'
#!/usr/bin/env sh
printf 'bun %s\n' "$*" >> "$STUB_LOG"
case "$1" in
  */pgexec.ts) printf '1\n'; exit 0 ;;
esac
if [ -n "${STUB_FAIL_MATCH:-}" ] && printf '%s' "$*" | grep -qF "$STUB_FAIL_MATCH"; then
  printf 'stub bun: forced failure: %s\n' "$*" >&2
  exit 1
fi
exit 0
STUB
  cat > "$dir/bunx" <<'STUB'
#!/usr/bin/env sh
printf 'bunx %s\n' "$*" >> "$STUB_LOG"
if [ "${STUB_FAIL_BUNX:-0}" = "1" ]; then
  printf 'stub bunx: forced failure\n' >&2
  exit 1
fi
exit 0
STUB
  chmod +x "$dir/bun" "$dir/bunx"
}

# --- Case 1: happy path — all steps succeed ---------------------------------
case1="$TMP_ROOT/happy"
mkdir -p "$case1/ws" "$case1/logs" "$case1/bin"
STUB_LOG="$case1/stub.log"; : > "$STUB_LOG"
make_stub_bin "$case1/bin"
set +e
PATH="$case1/bin:$PATH" STUB_LOG="$STUB_LOG" \
  DATABASE_URL="postgresql://u:p@db:5432/musi" \
  MUSI_POST_CREATE_WORKSPACE="$case1/ws" MUSI_POST_CREATE_LOG_DIR="$case1/logs" \
  bash "$POST_CREATE" > "$case1/out.log" 2>&1
rc=$?
set -e

[ "$rc" -eq 0 ] || fail "happy path should exit 0 (got $rc): $(cat "$case1/out.log")"
[ -f "$case1/ws/.setup-complete" ] || fail "happy path did not write .setup-complete"
[ ! -f "$case1/ws/.setup-failed" ] || fail "happy path should not write .setup-failed"
grep -qF "bun run --filter @musi/shared build" "$STUB_LOG" \
  || fail "happy path did not build @musi/shared"
grep -qF "bun run --filter @musi/server db:seed" "$STUB_LOG" \
  || fail "happy path did not seed the database"
grep -qF "bun run --filter @musi/server db:migrate:deploy" "$STUB_LOG" \
  || fail "happy path did not run migrations"
ok "happy path writes .setup-complete and runs build/seed/migrate"

# --- Case 2: a critical step fails ------------------------------------------
case2="$TMP_ROOT/critical-fail"
mkdir -p "$case2/ws" "$case2/logs" "$case2/bin"
STUB_LOG="$case2/stub.log"; : > "$STUB_LOG"
make_stub_bin "$case2/bin"
set +e
PATH="$case2/bin:$PATH" STUB_LOG="$STUB_LOG" \
  STUB_FAIL_MATCH="db:migrate:deploy" \
  DATABASE_URL="postgresql://u:p@db:5432/musi" \
  MUSI_POST_CREATE_WORKSPACE="$case2/ws" MUSI_POST_CREATE_LOG_DIR="$case2/logs" \
  bash "$POST_CREATE" > "$case2/out.log" 2>&1
rc=$?
set -e

[ "$rc" -ne 0 ] || fail "critical failure should exit non-zero"
[ ! -f "$case2/ws/.setup-complete" ] || fail "critical failure must NOT write .setup-complete"
[ -f "$case2/ws/.setup-failed" ] || fail "critical failure should write .setup-failed"
grep -qF "apply migrations (db:migrate:deploy)" "$case2/ws/.setup-failed" \
  || fail ".setup-failed should name the failed step"
grep -qF "setup INCOMPLETE" "$case2/out.log" \
  || fail "critical failure should report INCOMPLETE loudly"
# A critical failure must not abort the remaining steps — seed still runs so
# the operator sees every problem at once.
grep -qF "bun run --filter @musi/server db:seed" "$STUB_LOG" \
  || fail "remaining steps should still run after a critical failure"
ok "critical failure writes .setup-failed, withholds .setup-complete, exits non-zero"

# --- Case 3: only the optional Playwright step fails ------------------------
case3="$TMP_ROOT/optional-fail"
mkdir -p "$case3/ws" "$case3/logs" "$case3/bin"
STUB_LOG="$case3/stub.log"; : > "$STUB_LOG"
make_stub_bin "$case3/bin"
set +e
PATH="$case3/bin:$PATH" STUB_LOG="$STUB_LOG" \
  STUB_FAIL_BUNX=1 \
  DATABASE_URL="postgresql://u:p@db:5432/musi" \
  MUSI_POST_CREATE_WORKSPACE="$case3/ws" MUSI_POST_CREATE_LOG_DIR="$case3/logs" \
  bash "$POST_CREATE" > "$case3/out.log" 2>&1
rc=$?
set -e

[ "$rc" -eq 0 ] || fail "optional-only failure should still exit 0 (got $rc): $(cat "$case3/out.log")"
[ -f "$case3/ws/.setup-complete" ] || fail "optional-only failure should still write .setup-complete"
grep -qF "optional step failed" "$case3/out.log" \
  || fail "optional failure should be logged as a non-blocking warning"
ok "optional Playwright failure does not block .setup-complete"

# --- Case 4: stale markers are cleared at the start of a run ----------------
case4="$TMP_ROOT/stale-markers"
mkdir -p "$case4/ws" "$case4/logs" "$case4/bin"
STUB_LOG="$case4/stub.log"; : > "$STUB_LOG"
make_stub_bin "$case4/bin"
# A leftover .setup-failed from a prior broken run must not survive a now-green run.
touch "$case4/ws/.setup-failed"
set +e
PATH="$case4/bin:$PATH" STUB_LOG="$STUB_LOG" \
  DATABASE_URL="postgresql://u:p@db:5432/musi" \
  MUSI_POST_CREATE_WORKSPACE="$case4/ws" MUSI_POST_CREATE_LOG_DIR="$case4/logs" \
  bash "$POST_CREATE" > "$case4/out.log" 2>&1
rc=$?
set -e

[ "$rc" -eq 0 ] || fail "stale-marker run should exit 0 (got $rc): $(cat "$case4/out.log")"
[ -f "$case4/ws/.setup-complete" ] || fail "stale-marker run did not write .setup-complete"
[ ! -f "$case4/ws/.setup-failed" ] || fail "a now-green run must clear a stale .setup-failed"
ok "stale .setup-failed is cleared when a subsequent run succeeds"

# --- Case 5: test DB names are derived from the configured env URLs ----------
# post-create must provision exactly the databases the harness / db-status.ts
# resolve from TEST_DATABASE_URL / E2E_DATABASE_URL, not a hardcoded pair, so
# the three never carry divergent ideas of "which test DBs exist".
case5="$TMP_ROOT/derived-db-names"
mkdir -p "$case5/ws" "$case5/logs" "$case5/bin"
STUB_LOG="$case5/stub.log"; : > "$STUB_LOG"
make_stub_bin "$case5/bin"
set +e
PATH="$case5/bin:$PATH" STUB_LOG="$STUB_LOG" \
  DATABASE_URL="postgresql://u:p@db:5432/musi" \
  TEST_DATABASE_URL="postgresql://u:p@db:5432/custom_test" \
  E2E_DATABASE_URL="postgresql://u:p@db:5432/custom_e2e" \
  MUSI_POST_CREATE_WORKSPACE="$case5/ws" MUSI_POST_CREATE_LOG_DIR="$case5/logs" \
  bash "$POST_CREATE" > "$case5/out.log" 2>&1
rc=$?
set -e

[ "$rc" -eq 0 ] || fail "derived-names run should exit 0 (got $rc): $(cat "$case5/out.log")"
grep -qF "CREATE DATABASE custom_test" "$STUB_LOG" \
  || fail "did not provision the configured TEST_DATABASE_URL database"
grep -qF "CREATE DATABASE custom_e2e" "$STUB_LOG" \
  || fail "did not provision the configured E2E_DATABASE_URL database"
if grep -qF "CREATE DATABASE musi_test" "$STUB_LOG"; then
  fail "should not provision the hardcoded default name when env URLs are configured"
fi
ok "test database names are derived from TEST_DATABASE_URL / E2E_DATABASE_URL"

printf 'post-create tests passed (%d)\n' "$PASS"
