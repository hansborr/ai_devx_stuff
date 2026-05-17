#!/usr/bin/env bash
# doctor: aggregated developer diagnostic. Streams `worktree:status` and
# `db:status` output as-is (do not reimplement their checks; DX1.3),
# then layers cross-cutting checks those commands cannot answer:
# env-file sanity, port binding, dependency freshness, lint-suppression drift.
# Read-only —
# never mutates state. Emits PASS/WARN/FAIL lines with exact follow-up
# commands and a final summary; exits 1 only when at least one FAIL
# was tallied.
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  printf 'FAIL: not inside a git repository\n' >&2
  exit 1
}
PRIMARY_ROOT="$(cd "$(git rev-parse --git-common-dir)/.." && pwd -P)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=/dev/null
. "$SCRIPT_DIR/dependency-freshness.sh"

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

note_pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'PASS: %s\n'  "$*"; }
note_warn() { WARN_COUNT=$((WARN_COUNT + 1)); printf 'WARN: %s\n'  "$*" >&2; }
note_fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'FAIL: %s\n'  "$*" >&2; }

# Stream a subcommand's output live (via tee), then tally any
# PASS/OK/WARN/FAIL lines it emitted so the final summary reflects
# them. If the subcommand exits non-zero without printing FAIL, add
# one so a silent failure doesn't slip through.
run_subcommand() {
  local title="$1" hint="$2"
  shift 2
  printf '\n=== %s ===\n' "$title"
  local tmp
  tmp="$(mktemp)"
  "$@" 2>&1 | tee "$tmp"
  local rc=${PIPESTATUS[0]}
  local pa wa fa
  pa=$(grep -cE '^(PASS:|OK[[:space:]]*:)' "$tmp" 2>/dev/null) || true
  wa=$(grep -cE '^WARN:'                    "$tmp" 2>/dev/null) || true
  fa=$(grep -cE '^FAIL:'                    "$tmp" 2>/dev/null) || true
  rm -f "$tmp"
  PASS_COUNT=$((PASS_COUNT + ${pa:-0}))
  WARN_COUNT=$((WARN_COUNT + ${wa:-0}))
  FAIL_COUNT=$((FAIL_COUNT + ${fa:-0}))
  if [[ $rc -ne 0 && ${fa:-0} -eq 0 ]]; then
    note_fail "$title exited $rc — $hint"
  fi
}

run_report_subcommand() {
  local title="$1" hint="$2"
  shift 2
  printf '\n=== %s ===\n' "$title"
  (cd "$REPO_ROOT" && "$@") 2>&1
  local rc=$?
  if [[ $rc -eq 0 ]]; then
    note_pass "$title completed without reported findings"
  else
    note_warn "$title exited $rc (report-only) — $hint"
  fi
}

# --- Aggregated existing diagnostics (DX1.1, DX1.2) ---------------------------

run_subcommand "worktree:status" \
  "review output above; common fixes: 'bun run worktree:init' (provision per-worktree DBs/ports/env) or check Postgres connectivity" \
  bash "$REPO_ROOT/scripts/worktree-db.sh" status

run_subcommand "db:status" \
  "review output above; common fixes: 'bun run --filter @musi/server db:migrate' (apply migrations) or check Postgres connectivity" \
  bash "$REPO_ROOT/scripts/db-status.sh"

# --- env-file sanity ----------------------------------------------------------
# `.devcontainer/.env` lives in the primary worktree only. Per-worktree
# `.env` and `packages/client/.env` are written by `worktree:init` for
# secondaries; primaries normally rely on devcontainer creds.

env_get() {
  # Read KEY=VALUE from a file without sourcing it (avoids running shell
  # in env files we don't control). Picks the first match; trims wrapping
  # quotes. Empty stdout = key absent.
  local key="$1" file="$2"
  [[ -f "$file" ]] || return 0
  awk -v k="$key" '
    BEGIN { FS = "=" }
    $1 == k {
      sub("^" k "=", "")
      gsub(/^"|"$/, "")
      gsub(/^'\''|'\''$/, "")
      print
      exit
    }
  ' "$file"
}

check_env_files() {
  printf '\n=== env-file sanity ===\n'
  local primary_env="$PRIMARY_ROOT/.devcontainer/.env"
  if [[ -f "$primary_env" ]]; then
    note_pass "found $primary_env (admin DB credentials)"
  else
    note_warn "missing $primary_env — admin DB ops (worktree provisioning) will fail"
  fi

  local is_secondary=0
  [[ "$REPO_ROOT" != "$PRIMARY_ROOT" ]] && is_secondary=1

  local root_env="$REPO_ROOT/.env"
  # Secondaries require a populated .env (worktree:init writes it). Primary
  # may legitimately have no .env or a partial one — DB/port keys fall back
  # to .devcontainer/.env and code defaults — so we only validate keys when
  # the secondary is supposed to own them.
  if (( is_secondary )); then
    if [[ -f "$root_env" ]]; then
      note_pass "found $root_env"
      local missing=() key
      for key in DATABASE_URL REDIS_URL SERVER_PORT CORS_ORIGIN; do
        if [[ -z "$(env_get "$key" "$root_env")" ]]; then
          missing+=("$key")
        fi
      done
      if (( ${#missing[@]} > 0 )); then
        note_warn "$root_env missing keys: ${missing[*]} — run 'bun run worktree:init' to regenerate"
      fi
    else
      note_fail "missing $root_env — run 'bun run worktree:init' to provision this worktree"
    fi
  else
    if [[ -f "$root_env" ]]; then
      note_pass "found $root_env (primary worktree)"
    else
      note_pass "no $root_env (primary worktree falls back to .devcontainer/.env)"
    fi
  fi

  # Live env (set by docker-compose `env_file` in the devcontainer) is the
  # authoritative source for the running server. `worktree:init` does not
  # propagate JWT_SECRET into the per-worktree `.env`, so on a secondary the
  # only places it can come from are the live env or the primary devcontainer
  # `.env`.
  if [[ -n "${JWT_SECRET:-}" ]]; then
    note_pass "JWT_SECRET configured (live env)"
  elif [[ -n "$(env_get JWT_SECRET "$root_env")" \
       || -n "$(env_get JWT_SECRET "$primary_env")" ]]; then
    note_pass "JWT_SECRET configured (env file)"
  else
    note_warn "JWT_SECRET not set in env or $root_env or $primary_env — generate with 'openssl rand -base64 48' and add to .devcontainer/.env (then restart the devcontainer)"
  fi

  local client_env="$REPO_ROOT/packages/client/.env"
  if [[ -f "$client_env" ]]; then
    note_pass "found $client_env"
  elif (( is_secondary )); then
    note_warn "missing $client_env — run 'bun run worktree:init' to regenerate"
  fi
}

# --- port binding -------------------------------------------------------------
# Best-effort check: parse SERVER_PORT and the client port (from
# CORS_ORIGIN) out of the worktree's .env, then ask `ss` whether they
# are bound. A port being bound is most often the contributor's own
# `bun run dev` already running — that's the common workflow when
# someone runs doctor — so a bound port is reported as PASS with a
# disambiguation hint, not a WARN that pollutes the summary.

port_in_use() {
  local port="$1"
  ss -tlnH "sport = :$port" 2>/dev/null | grep -q LISTEN
}

check_port_binding() {
  printf '\n=== port binding ===\n'
  if ! command -v ss >/dev/null 2>&1; then
    note_warn "ss not available — skipping port-binding check"
    return 0
  fi
  local root_env="$REPO_ROOT/.env"
  local server_port="" cors_origin="" client_port=""
  if [[ -f "$root_env" ]]; then
    server_port="$(env_get SERVER_PORT "$root_env")"
    cors_origin="$(env_get CORS_ORIGIN "$root_env")"
    if [[ -n "$cors_origin" ]]; then
      # Pull the trailing :PORT out of the URL; tolerate no port present.
      client_port="$(printf '%s' "$cors_origin" | sed -nE 's|.*://[^/]*:([0-9]+).*|\1|p')"
    fi
  fi

  if [[ -z "$server_port" && -z "$client_port" ]]; then
    # No worktree-specific port assignment: primary worktrees rely on code
    # defaults (server 8001, client 8000) and binding behavior is
    # uninteresting until they're explicitly configured.
    note_pass "no worktree-specific ports configured (primary defaults apply)"
    return 0
  fi

  local entry label port
  for entry in "server:$server_port" "client:$client_port"; do
    label="${entry%%:*}"
    port="${entry#*:}"
    if [[ -z "$port" || ! "$port" =~ ^[0-9]+$ ]]; then
      continue
    fi
    if port_in_use "$port"; then
      note_pass "$label port $port is bound — most likely your own dev server; if not, run 'ss -tlnp sport = :$port' to investigate"
    else
      note_pass "$label port $port is free"
    fi
  done
}

# --- dependency freshness -----------------------------------------------------
# `bun install` rewrites symlinks under node_modules/.bin. Compare that
# install marker's mtime to bun.lock as a cheap "do I need to reinstall?"
# signal.

check_dependency_freshness() {
  printf '\n=== dependency freshness ===\n'
  local result status message
  result="$(musi_dependency_freshness "$REPO_ROOT")"
  status="${result%%$'\t'*}"
  message="${result#*$'\t'}"

  case "$status" in
    fresh) note_pass "$message" ;;
    missing) note_fail "$message" ;;
    stale|warn) note_warn "$message" ;;
    *) note_warn "unknown dependency freshness state: $message" ;;
  esac
}

check_env_files
check_port_binding
check_dependency_freshness

run_subcommand "eslint-disable register" \
  "add '-- reason', prefer eslint-disable-next-line, or add a targeted broad-disable allowlist entry when the suppression is intentionally scoped" \
  bash "$REPO_ROOT/scripts/eslint-disable-register.sh" "$REPO_ROOT"

run_subcommand "suppression register" \
  "add '-- reason' to each suppression, migrate @ts-ignore to @ts-expect-error, restrict @ts-nocheck to scripts/drift-ai/suppressions.{ts,test.ts}, or prefer Stryker disable next-line over broad disable" \
  bash "$REPO_ROOT/scripts/suppression-register.sh" "$REPO_ROOT"

run_subcommand "migration safety" \
  "review the WARN findings above; for an intentional destructive migration, confirm backfill/dependent reads are handled and add an entry to packages/server/prisma/migrations/.safety-acknowledged" \
  bash "$REPO_ROOT/scripts/migration-safety-scan.sh"

run_report_subcommand "knip unused-code sensor" \
  "review inventory above; run 'bun run sensor:knip' for the raw report" \
  bun run sensor:knip

printf '\n=== summary ===\n'
printf 'PASS=%d  WARN=%d  FAIL=%d\n' "$PASS_COUNT" "$WARN_COUNT" "$FAIL_COUNT"

if (( FAIL_COUNT > 0 )); then
  exit 1
fi
exit 0
