#!/usr/bin/env bash
# Devcontainer post-create setup.
#
# Replaces the old inline `postCreateCommand`, which ran every step under
# `2>/dev/null` and `touch`ed .setup-complete unconditionally — so a container
# that failed to migrate, never built @musi/shared, and never seeded still
# reported "complete". This script provisions a freshly (re)created container
# so it is actually usable, and fails LOUDLY when a critical step does not:
#
#   * every step's output is tee'd to a log (never silenced),
#   * critical failures are tallied,
#   * the .setup-complete marker (which container-entrypoint.sh waits on before
#     starting the dev servers) is written ONLY when every critical step
#     succeeded; otherwise a .setup-failed marker is written and we exit 1.
#
# Out of scope (handled separately): the .devcontainer/.env password /
# *_DATABASE_URL reconciliation.
set -uo pipefail

# WORKSPACE / LOG_DIR are overridable only so the smoke test
# (scripts/tests/test-post-create.sh) can run the orchestration against a
# sandbox with stubbed `bun`/`bunx`. In the devcontainer both default to the
# real paths.
WORKSPACE="${MUSI_POST_CREATE_WORKSPACE:-/workspace}"
LOG_DIR="${MUSI_POST_CREATE_LOG_DIR:-/tmp/musi_logs}"
LOG_FILE="$LOG_DIR/post-create.log"
COMPLETE_MARKER="$WORKSPACE/.setup-complete"
FAILED_MARKER="$WORKSPACE/.setup-failed"

mkdir -p "$LOG_DIR"
# Stale markers from a previous create must never survive into this run.
rm -f "$COMPLETE_MARKER" "$FAILED_MARKER"

# Mirror all output to the log while keeping it on the console. The log is the
# durable breadcrumb a developer (or `bun run doctor`) can read after the fact.
exec > >(tee -a "$LOG_FILE") 2>&1
# Bash sets $! to the process-substitution child (the tee above). Reap it on
# exit: without this the shell can exit before tee drains the pipe, truncating
# the final summary — the most important lines — from the persisted log.
TEE_PID=$!
flush_log() {
  # Repoint our stdout/stderr away from the pipe so tee sees EOF, then wait for
  # it to drain and flush the final lines to the log before we exit.
  exec >/dev/null 2>&1
  if [[ -n "${TEE_PID:-}" ]]; then
    wait "$TEE_PID" 2>/dev/null || true
  fi
}
trap flush_log EXIT

cd "$WORKSPACE" || exit 1

# Test databases the vitest / Playwright harnesses assume exist. They are
# created on first postgres-volume init by .devcontainer/init-test-db.sql, but
# that hook only fires on an empty data dir and has been observed to leave them
# absent on a fresh volume — so we (re)provision them here, idempotently.
# Populated by resolve_test_db_names() from the same env the harness reads; the
# default below is the canonical fallback (also used if resolution is skipped).
TEST_DB_NAMES=("musi_test" "musi_test_e2e")

FAILED_STEPS=()

ts() { date -Iseconds 2>/dev/null || date; }
log() { printf '\n[post-create %s] %s\n' "$(ts)" "$*"; }

# run_step <label> <cmd...> — run a step, echoing start/result. Returns the
# command's exit code so callers can classify it.
run_step() {
  local label="$1" rc
  shift
  log "START: $label"
  # Capture the command's status directly — reading $? after an `if "$@"; fi`
  # would yield the if-compound's status (0), masking the failure.
  "$@"
  rc=$?
  if [[ $rc -eq 0 ]]; then
    log "OK: $label"
    return 0
  fi
  log "FAIL (exit $rc): $label"
  return "$rc"
}

# A critical step whose failure must block .setup-complete.
critical() {
  local label="$1"
  shift
  run_step "$label" "$@" || FAILED_STEPS+=("$label")
}

# A best-effort step; a failure is logged but never blocks completion.
optional() {
  local label="$1"
  shift
  run_step "$label" "$@" || log "WARN: optional step failed, continuing: $label"
}

# --- DB helpers (no psql; the devcontainer ships no postgres-client) ---------
# Mirrors scripts/worktree-db.sh: route admin SQL through pgexec.ts (bun + pg),
# which runs in autocommit so CREATE DATABASE — illegal inside a transaction —
# works.

# Admin connection URL: the env's DATABASE_URL with its database component
# swapped to `postgres` (always present, can't be dropped).
admin_url() {
  local url="${DATABASE_URL:-}"
  if [[ -z "$url" && -f "$WORKSPACE/.devcontainer/.env" ]]; then
    url="$(
      set -a
      # shellcheck disable=SC1091
      . "$WORKSPACE/.devcontainer/.env"
      set +a
      printf '%s' "${DATABASE_URL:-}"
    )"
  fi
  [[ -n "$url" ]] || return 1
  printf '%s' "$url" | sed -E 's|/[^/]+$|/postgres|'
}

pg_admin_exec() {
  local sql="$1" url
  url="$(admin_url)" || return 1
  bun "$WORKSPACE/packages/server/scripts/pgexec.ts" "$url" "$sql"
}

# Database name from a connection URL: drop any query string / fragment, then
# take the final path component. Mirrors db-status.ts' dbName().
db_name_from_url() {
  local url="$1" path
  path="${url%%[#?]*}"
  printf '%s' "${path##*/}"
}

# Resolve which test/e2e databases to provision from the same env the vitest /
# Playwright harness (packages/server/src/test/test-database-url.ts) and
# db-status.ts read, so all three agree instead of carrying a second hardcoded
# source of truth:
#   test DB = TEST_DATABASE_URL ?? DATABASE_URL→musi_test
#   e2e  DB = E2E_DATABASE_URL  ?? TEST_DATABASE_URL ?? DATABASE_URL→musi_test_e2e
# The e2e fallback can collapse onto the test DB, so dedupe.
resolve_test_db_names() {
  local test e2e test_name e2e_name
  test="${TEST_DATABASE_URL:-}"
  e2e="${E2E_DATABASE_URL:-}"

  if [[ -n "$test" ]]; then test_name="$(db_name_from_url "$test")"; else test_name="musi_test"; fi
  if [[ -n "$e2e" ]]; then
    e2e_name="$(db_name_from_url "$e2e")"
  elif [[ -n "$test" ]]; then
    e2e_name="$(db_name_from_url "$test")"
  else
    e2e_name="musi_test_e2e"
  fi
  # Fall back to the canonical defaults if a configured URL had no DB name.
  [[ -n "$test_name" ]] || test_name="musi_test"
  [[ -n "$e2e_name" ]] || e2e_name="musi_test_e2e"

  TEST_DB_NAMES=("$test_name")
  [[ "$e2e_name" != "$test_name" ]] && TEST_DB_NAMES+=("$e2e_name")
}

# Block until the admin DB answers a trivial query, or fail after ~60s. The db
# service is gated `service_healthy` in compose, but this guards the rare race
# where the socket is up before it accepts queries.
wait_for_db() {
  local attempt
  for attempt in $(seq 1 30); do
    if pg_admin_exec "SELECT 1" >/dev/null 2>&1; then
      return 0
    fi
    log "waiting for database (attempt $attempt/30)..."
    sleep 2
  done
  log "database did not become reachable"
  return 1
}

# Idempotently ensure each test database exists. Self-healing replacement for
# the initdb hook that does not depend on an empty postgres volume.
#
# Issues an unconditional CREATE and tolerates the idempotent / race "already
# exists" case, mirroring scripts/worktree-db.sh's ensure_meta_db. The previous
# check-then-create probed under `2>/dev/null`, which (a) masked a transient
# probe error as "absent" and then failed the whole step on the follow-up
# CREATE of an existing DB, and (b) spawned two bun+pg processes per DB. Any
# error other than "already exists" is surfaced loudly rather than swallowed.
ensure_test_databases() {
  local name err
  for name in "${TEST_DB_NAMES[@]}"; do
    if err="$(pg_admin_exec "CREATE DATABASE $name" 2>&1 >/dev/null)"; then
      log "created test database '$name'"
      continue
    fi
    if [[ "$err" == *"already exists"* ]]; then
      log "test database '$name' already present"
      continue
    fi
    log "failed to create test database '$name': $err"
    return 1
  done
}

provision_databases() {
  wait_for_db || return 1
  resolve_test_db_names
  ensure_test_databases || return 1
}

# --- Steps -------------------------------------------------------------------
log "starting devcontainer setup (log: $LOG_FILE)"

critical "install dependencies (bun install)" \
  bun install

critical "build @musi/shared" \
  bun run --filter @musi/shared build

critical "generate Prisma client" \
  bun run --filter @musi/server prisma:generate

critical "provision test databases" \
  provision_databases

critical "apply migrations (db:migrate:deploy)" \
  bun run --filter @musi/server db:migrate:deploy

critical "seed reference data (db:seed)" \
  bun run --filter @musi/server db:seed

optional "install Playwright Chromium" \
  bunx playwright install chromium

# --- Completion gate ---------------------------------------------------------
if (( ${#FAILED_STEPS[@]} == 0 )); then
  log "setup complete — all critical steps succeeded"
  touch "$COMPLETE_MARKER"
  exit 0
fi

log "setup INCOMPLETE — ${#FAILED_STEPS[@]} critical step(s) failed:"
for step in "${FAILED_STEPS[@]}"; do
  log "  - $step"
done
log "see $LOG_FILE for details; dev servers will NOT start until this is fixed"
printf 'failed: %s\n' "${FAILED_STEPS[*]}" > "$FAILED_MARKER"
exit 1
