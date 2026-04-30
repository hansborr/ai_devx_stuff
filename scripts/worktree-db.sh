#!/usr/bin/env bash
# worktree-db.sh — per-worktree DB / port / env provisioning for Musi.
#
# Subcommands:
#   slug                Print the DB slug for the current worktree.
#   init                Idempotent provisioning: copy .claude, allocate ports+Redis DB,
#                       ensure template DB, clone per-worktree DBs, write .env files.
#   drop                Drop the current worktree's DBs (allowlisted).
#   gc [--force]        Sweep orphan musi_wt_<slug>* DBs whose worktrees no longer
#                       exist and whose grace period has elapsed.
#   status              Print current worktree DB/port/template diagnostics.
#   template-refresh [--from-musi]
#                       (Re)build the fingerprinted musi_template_<hash> DB via
#                       prisma migrate deploy + seedSrd; fingerprint stored in
#                       sibling musi_wt_meta DB.
#   refresh-data [--destructive]
#                       Recover from SRD seed drift. Default mode rebuilds the
#                       template, then applies migrations + SRD seed in-place
#                       on dev/test/e2e DBs (preserves user-created rows; the
#                       SRD seed is idempotent via upserts but does not delete
#                       removed reference rows, so seed drift metadata remains
#                       stale). `--destructive` drops and reclones dev/test/e2e
#                       DBs from the template — discards local dev data, but
#                       guarantees the per-worktree DBs match the checked-out
#                       branch's seed exactly and clears the drift warning.
#                       Allocations (ports, Redis index) are preserved in both
#                       modes.
#
# The script is authoritative for all per-worktree DB state. Claude Code agents
# must invoke it via `bun run worktree:<sub>` because the no-direct-db hook
# blocks raw psql/createdb/dropdb.
#
# Reads:
#   .devcontainer/.env       — admin DATABASE_URL (host/user/pass)
#   .worktreeinclude         — newline list of paths to copy from primary
#   packages/server/prisma/schema.prisma
#   packages/server/prisma/migrations/
#   packages/server/prisma/seed-template.ts
#   packages/server/src/seed/
#
# Writes (to current worktree, not primary):
#   .env                     — DATABASE_URL, TEST_DATABASE_URL, E2E_DATABASE_URL,
#                              SERVER_PORT, REDIS_URL, CORS_ORIGIN
#   packages/client/.env     — VITE_DEV_PORT, VITE_API_URL
#
# Writes (to primary worktree):
#   .worktree-state/tombstones.json
#   .worktree-state/template-tombstones.json
#   .worktree-state/allocations.json
#   .worktree-state/allocation.lock
#   .worktree-state/gc.lock
#
# Databases it may CREATE:
#   musi_template_<hash>     — golden copy (migrated + SRD seed)
#   musi_wt_meta             — single-row fingerprint store
#   musi_wt_<slug>           — per-worktree dev DB
#   musi_wt_<slug>_test      — per-worktree vitest DB
#   musi_wt_<slug>_wN        — transient per-worker vitest DBs
#   musi_wt_<slug>_e2e       — per-worktree playwright DB
#
# Never touches: musi, musi_test, musi_test_e2e, legacy musi_template.

set -euo pipefail

# ============================================================================
# Constants
# ============================================================================

readonly TEMPLATE_DB_PREFIX="musi_template"
readonly META_DB="musi_wt_meta"
readonly PRIMARY_DB_NAMES=("musi" "musi_test" "musi_test_e2e" "postgres")

# Postgres identifier limit is 63 bytes. The longest worktree DB name is
# `musi_wt_<49-byte slug>_test`; worker DBs use `musi_wt_<slug>_w<key>` so they
# do not shrink the slug budget.
readonly SLUG_MAX_LEN=49
readonly WORKER_KEY_MAX_LEN=2

# Hash-suffix length. 6 hex chars = 24 bits — enough to make path collisions
# astronomically unlikely at our scale. The suffix is appended *after* base
# truncation, so every slug deterministically ends in `_<6-hex>`. That
# invariant is load-bearing: slug_from_dbname relies on it to disambiguate
# `_test` / `_e2e` suffixes from a slug whose basename happened to end in
# those tokens.
readonly SLUG_HASH_LEN=6

# Fingerprinted template DBs use the first N hex chars of the content
# fingerprint. 12 hex chars is short enough for Postgres identifiers and gives
# enough space that accidental collisions are not a practical concern here.
readonly TEMPLATE_HASH_LEN=12
readonly PRESERVE_REFRESH_SEED_FP="preserve-refresh-unknown"

# Port bands (documented in the plan).
readonly SERVER_PORT_MIN=8100
readonly SERVER_PORT_MAX=8199
readonly CLIENT_PORT_MIN=8010
readonly CLIENT_PORT_MAX=8099

# Redis logical DBs: 1..15 (reserve 0 for primary).
readonly REDIS_DB_MIN=1
readonly REDIS_DB_MAX=15

# Default GC grace period: 24 hours. Override via MUSI_WT_GRACE.
readonly DEFAULT_GRACE_SECONDS=86400

# ============================================================================
# Helpers: logging, path, admin connection
# ============================================================================

log()  { printf '[worktree-db] %s\n' "$*" >&2; }
die()  { log "ERROR: $*"; exit 1; }

require_cmd() {
  local c missing=()
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || missing+=("$c")
  done
  (( ${#missing[@]} == 0 )) || die "missing required commands: ${missing[*]}"
}

primary_root() {
  # git rev-parse --git-common-dir returns e.g. /workspace/.git or
  # /workspace/.git/worktrees/<name>/.. flavor — take its parent.
  local common
  common="$(git rev-parse --git-common-dir 2>/dev/null)" \
    || die "not inside a git repository"
  # Normalize to absolute so `${common}/..` is stable regardless of cwd.
  (cd "$common/.." && pwd -P)
}

current_root() {
  git rev-parse --show-toplevel 2>/dev/null \
    || die "not inside a git repository"
}

is_primary_worktree() {
  local common dir
  common="$(git rev-parse --git-common-dir)"
  dir="$(git rev-parse --git-dir)"
  [[ "$(cd "$common" && pwd -P)" == "$(cd "$dir" && pwd -P)" ]]
}

# Admin connection URL: derive from .devcontainer/.env's DATABASE_URL, then
# swap the database name to `postgres` (always present, can't be dropped).
admin_url() {
  local pr env_file url
  pr="$(primary_root)"
  env_file="$pr/.devcontainer/.env"
  [[ -f "$env_file" ]] || die "missing $env_file — can't resolve admin DB credentials"
  # shellcheck disable=SC1090
  url="$(
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
    printf '%s' "${DATABASE_URL:-}"
  )"
  [[ -n "$url" ]] || die "DATABASE_URL not set in $env_file"
  # Swap database component: strip trailing /<name> and append /postgres.
  printf '%s' "$url" | sed -E 's|/[^/]+$|/postgres|'
}

# URL for a named DB, preserving host/user/pass from admin_url.
db_url() {
  local name="$1" base
  base="$(admin_url)"
  printf '%s' "$base" | sed -E "s|/postgres\$|/$name|"
}

# Run one SQL statement (or a semicolon-separated batch) against the given
# connection URL and print any returned rows as tab-separated lines. Uses
# bun + pg instead of the psql CLI because the devcontainer doesn't ship
# postgresql-client, and pg.Client gives us autocommit semantics that
# Prisma's SQL runners (which force a transaction) can't offer.
pg_exec() {
  local url="$1" sql="$2" pr
  pr="$(primary_root)"
  bun "$pr/packages/server/scripts/pgexec.ts" "$url" "$sql"
}

run_admin() { pg_exec "$(admin_url)" "$1"; }
run_db()    { pg_exec "$(db_url "$1")" "$2"; }

db_exists() {
  local name="$1"
  [[ -n "$(run_admin "SELECT 1 FROM pg_database WHERE datname = '$name'")" ]]
}

# ============================================================================
# Slug derivation
# ============================================================================

compute_slug() {
  # $1: optional worktree path (default $(pwd -P)). Accepting the path as an
  # argument lets callers (list_live_slugs) derive slugs for worktrees other
  # than the caller's, without reimplementing this algorithm.
  local wt_path="${1:-$(pwd -P)}"
  local base hash base_safe max_base
  base="$(basename "$wt_path")"
  hash="$(printf '%s' "$wt_path" | sha1sum | cut -c"1-${SLUG_HASH_LEN}")"
  # Normalize the base first.
  base_safe="$(printf '%s' "$base" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_]/_/g')"
  # Reserve room for the `_<hash>` suffix (SLUG_HASH_LEN + 1 separator) so
  # truncation never eats the hash — if it did, two long-named worktrees
  # would collide, and the slug could end in a reserved `_test`/`_e2e`
  # token, breaking slug_from_dbname.
  max_base=$(( SLUG_MAX_LEN - SLUG_HASH_LEN - 1 ))
  if (( ${#base_safe} > max_base )); then
    base_safe="${base_safe:0:max_base}"
  fi
  printf '%s_%s' "$base_safe" "$hash"
}

slug_hash_int() {
  # Deterministic positive integer from the slug (not its sha, to keep
  # port/redis index tied to the human-readable slug).
  local slug="$1" hex
  hex="$(printf '%s' "$slug" | sha1sum | cut -c1-8)"
  # 32-bit unsigned via bc to avoid shell overflow.
  printf '%d' "$((16#$hex))"
}

# ============================================================================
# Tombstone / state dir
# ============================================================================

state_dir() {
  local pr
  pr="$(primary_root)"
  printf '%s' "$pr/.worktree-state"
}

ensure_state_dir() {
  local dir
  dir="$(state_dir)"
  mkdir -p "$dir"
}

tombstones_file() {
  printf '%s' "$(state_dir)/tombstones.json"
}

allocations_file() {
  printf '%s' "$(state_dir)/allocations.json"
}

template_tombstones_file() {
  printf '%s' "$(state_dir)/template-tombstones.json"
}

# ============================================================================
# Port / Redis allocation
# ============================================================================

port_in_use() {
  local port="$1"
  # ss is in iproute2 — available in the devcontainer.
  ss -tlnH "sport = :$port" 2>/dev/null | grep -q LISTEN
}

allocate_port() {
  # $1 = min, $2 = max, $3 = hash-derived starting offset
  local min="$1" max="$2" start="$3" span port i
  span=$(( max - min + 1 ))
  for (( i=0; i<span; i++ )); do
    port=$(( min + ((start + i) % span) ))
    if ! port_in_use "$port"; then
      printf '%d' "$port"
      return 0
    fi
  done
  die "no free port in [$min, $max] after full band traversal; widen the band or stop some dev servers"
}

port_reserved() {
  local port="$1" reserved="$2"
  printf '%s\n' "$reserved" | grep -qx "$port"
}

allocate_port_excluding() {
  # $1 = min, $2 = max, $3 = hash-derived starting offset, $4 = reserved ports
  local min="$1" max="$2" start="$3" reserved="$4" span port i
  span=$(( max - min + 1 ))
  for (( i=0; i<span; i++ )); do
    port=$(( min + ((start + i) % span) ))
    if ! port_reserved "$port" "$reserved" && ! port_in_use "$port"; then
      printf '%d' "$port"
      return 0
    fi
  done
  die "no free unreserved port in [$min, $max] after full band traversal"
}

allocate_redis_db() {
  local hash="$1" span
  span=$(( REDIS_DB_MAX - REDIS_DB_MIN + 1 ))
  printf '%d' $(( REDIS_DB_MIN + (hash % span) ))
}

redis_reserved() {
  local redis_db="$1" reserved="$2"
  printf '%s\n' "$reserved" | grep -qx "$redis_db"
}

allocate_redis_db_excluding() {
  local hash="$1" reserved="$2" span redis_db i
  span=$(( REDIS_DB_MAX - REDIS_DB_MIN + 1 ))
  for (( i=0; i<span; i++ )); do
    redis_db=$(( REDIS_DB_MIN + ((hash + i) % span) ))
    if ! redis_reserved "$redis_db" "$reserved"; then
      printf '%d' "$redis_db"
      return 0
    fi
  done
  die "no free Redis DB in [$REDIS_DB_MIN, $REDIS_DB_MAX]; stop or drop an existing secondary worktree"
}

# ============================================================================
# Template fingerprint
# ============================================================================

compute_migration_fingerprint() {
  # $1: optional worktree path (default current worktree). This deliberately
  # uses the checked-out code in that worktree, not the primary worktree, so a
  # branch with Prisma/seed changes provisions DBs that match that branch.
  #
  # Hashing happens after `cd "$wt_root"` so `sha256sum`'s output records
  # relative paths only. Two worktrees with byte-identical inputs at different
  # absolute paths must produce the same fingerprint, so they share one
  # musi_template_<hash> DB.
  local wt_root="${1:-$(current_root)}"
  local schema="packages/server/prisma/schema.prisma"
  local migrations="packages/server/prisma/migrations"
  # These are hard requirements — silently hashing their absence would let a
  # broken project state produce a valid-looking fingerprint and defer the
  # failure to `prisma migrate deploy`.
  [[ -f "$wt_root/$schema" ]] || die "missing $wt_root/$schema — can't fingerprint template inputs"
  ( cd "$wt_root" && {
      sha256sum "$schema"
      if [[ -d "$migrations" ]]; then
        find "$migrations" -type f \( -name '*.sql' -o -name '*.toml' \) \
          -print0 | sort -z | xargs -0 -r sha256sum
      fi
    } | sha256sum | cut -d' ' -f1 )
}

compute_seed_fingerprint() {
  # Hash the script that actually builds the template (seed-template.ts),
  # not seed.ts — the latter runs seedUsers, which the template never does,
  # so edits there would trigger a spurious refresh while edits to the real
  # template seeder would go undetected.
  #
  # Hashing happens after `cd "$wt_root"` so the recorded paths are relative
  # — see compute_migration_fingerprint for why.
  local wt_root="${1:-$(current_root)}"
  local seed="packages/server/prisma/seed-template.ts"
  local seed_dir="packages/server/src/seed"
  [[ -f "$wt_root/$seed" ]] || die "missing $wt_root/$seed — can't fingerprint template inputs"
  ( cd "$wt_root" && {
      sha256sum "$seed"
      if [[ -d "$seed_dir" ]]; then
        find "$seed_dir" -type f \( -name '*.ts' -o -name '*.json' \) ! -name '*.test.ts' \
          -print0 | sort -z | xargs -0 -r sha256sum
      fi
    } | sha256sum | cut -d' ' -f1 )
}

compute_fingerprint() {
  # Hashing happens after `cd "$wt_root"` so the recorded paths are relative
  # — see compute_migration_fingerprint for why.
  local wt_root="${1:-$(current_root)}"
  local schema="packages/server/prisma/schema.prisma"
  local seed="packages/server/prisma/seed-template.ts"
  local migrations="packages/server/prisma/migrations"
  local seed_dir="packages/server/src/seed"
  [[ -f "$wt_root/$schema" ]] || die "missing $wt_root/$schema — can't fingerprint template inputs"
  [[ -f "$wt_root/$seed" ]] || die "missing $wt_root/$seed — can't fingerprint template inputs"
  ( cd "$wt_root" && {
      sha256sum "$schema"
      sha256sum "$seed"
      if [[ -d "$migrations" ]]; then
        find "$migrations" -type f \( -name '*.sql' -o -name '*.toml' \) \
          -print0 | sort -z | xargs -0 -r sha256sum
      fi
      if [[ -d "$seed_dir" ]]; then
        find "$seed_dir" -type f \( -name '*.ts' -o -name '*.json' \) ! -name '*.test.ts' \
          -print0 | sort -z | xargs -0 -r sha256sum
      fi
    } | sha256sum | cut -d' ' -f1 )
}

template_db_for_fingerprint() {
  local fp="$1"
  [[ "$fp" =~ ^[a-f0-9]{64}$ ]] \
    || die "invalid template fingerprint: $fp"
  printf '%s_%s' "$TEMPLATE_DB_PREFIX" "${fp:0:TEMPLATE_HASH_LEN}"
}

ensure_meta_db() {
  # Race-safe first-boot creation: two secondaries initializing in parallel
  # can both see db_exists=false and both issue CREATE DATABASE. The loser
  # gets "database already exists" and would abort under set -e; tolerate
  # that as long as the DB is in fact present afterwards.
  if ! db_exists "$META_DB"; then
    log "creating $META_DB"
    local err
    if ! err="$(run_admin "CREATE DATABASE $META_DB" 2>&1 >/dev/null)"; then
      # Only swallow the race-loser case where a parallel init already
      # created it; surface permission/connection failures loudly instead of
      # deferring to a less helpful error from the next db_exists call.
      if [[ "$err" != *"already exists"* ]]; then
        die "ensure_meta_db: failed to CREATE DATABASE $META_DB: $err"
      fi
      db_exists "$META_DB" \
        || die "failed to create $META_DB (and it does not exist)"
      log "$META_DB created concurrently; continuing"
    fi
  fi
  run_db "$META_DB" "
    CREATE TABLE IF NOT EXISTS template_fingerprint (
      id INT PRIMARY KEY DEFAULT 1,
      fingerprint TEXT NOT NULL,
      migration_fingerprint TEXT NOT NULL DEFAULT '',
      seed_fingerprint TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT single_row CHECK (id = 1)
    );
    CREATE TABLE IF NOT EXISTS worktree_clone (
      slug TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      migration_fingerprint TEXT NOT NULL DEFAULT '',
      seed_fingerprint TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS template_build (
      fingerprint TEXT PRIMARY KEY,
      db_name TEXT NOT NULL UNIQUE,
      migration_fingerprint TEXT NOT NULL DEFAULT '',
      seed_fingerprint TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE template_fingerprint ADD COLUMN IF NOT EXISTS migration_fingerprint TEXT NOT NULL DEFAULT '';
    ALTER TABLE template_fingerprint ADD COLUMN IF NOT EXISTS seed_fingerprint TEXT NOT NULL DEFAULT '';
    ALTER TABLE worktree_clone ADD COLUMN IF NOT EXISTS migration_fingerprint TEXT NOT NULL DEFAULT '';
    ALTER TABLE worktree_clone ADD COLUMN IF NOT EXISTS seed_fingerprint TEXT NOT NULL DEFAULT '';
    ALTER TABLE template_build ADD COLUMN IF NOT EXISTS migration_fingerprint TEXT NOT NULL DEFAULT '';
    ALTER TABLE template_build ADD COLUMN IF NOT EXISTS seed_fingerprint TEXT NOT NULL DEFAULT '';
  " >/dev/null
}

stored_fingerprint() {
  # Empty stdout = no row yet (fresh meta DB). Errors propagate via set -e
  # rather than being swallowed — a failed read shouldn't masquerade as
  # "no fingerprint" and trigger an unnecessary template rebuild.
  ensure_meta_db
  run_db "$META_DB" "SELECT fingerprint FROM template_fingerprint WHERE id = 1"
}

store_fingerprint() {
  local fp="$1" migration_fp="${2:-}" seed_fp="${3:-}"
  ensure_meta_db
  run_db "$META_DB" "
    INSERT INTO template_fingerprint (id, fingerprint, migration_fingerprint, seed_fingerprint, updated_at)
    VALUES (1, '$fp', '$migration_fp', '$seed_fp', now())
    ON CONFLICT (id) DO UPDATE SET
      fingerprint = EXCLUDED.fingerprint,
      migration_fingerprint = EXCLUDED.migration_fingerprint,
      seed_fingerprint = EXCLUDED.seed_fingerprint,
      updated_at = now();
  " >/dev/null
}

template_build_recorded() {
  local fp="$1" db="$2"
  ensure_meta_db
  [[ -n "$(run_db "$META_DB" "SELECT 1 FROM template_build WHERE fingerprint = '$fp' AND db_name = '$db'")" ]]
}

store_template_build() {
  local fp="$1" db="$2" migration_fp="${3:-}" seed_fp="${4:-}"
  ensure_meta_db
  run_db "$META_DB" "
    INSERT INTO template_build (fingerprint, db_name, migration_fingerprint, seed_fingerprint, updated_at)
    VALUES ('$fp', '$db', '$migration_fp', '$seed_fp', now())
    ON CONFLICT (fingerprint) DO UPDATE SET
      db_name = EXCLUDED.db_name,
      migration_fingerprint = EXCLUDED.migration_fingerprint,
      seed_fingerprint = EXCLUDED.seed_fingerprint,
      updated_at = now();
  " >/dev/null
}

forget_template_build() {
  local db="$1"
  ensure_meta_db
  run_db "$META_DB" "DELETE FROM template_build WHERE db_name = '$db'" >/dev/null
}

# Per-worktree clone fingerprint. Used by ensure_per_worktree_dbs to skip
# redundant `prisma migrate deploy` calls when all three DBs for a slug are
# already at the current template fingerprint.
stored_worktree_fingerprint() {
  local slug="$1"
  ensure_meta_db
  run_db "$META_DB" "SELECT fingerprint FROM worktree_clone WHERE slug = '$slug'"
}

stored_worktree_migration_fingerprint() {
  local slug="$1"
  ensure_meta_db
  run_db "$META_DB" "SELECT migration_fingerprint FROM worktree_clone WHERE slug = '$slug'"
}

stored_worktree_seed_fingerprint() {
  local slug="$1"
  ensure_meta_db
  run_db "$META_DB" "SELECT seed_fingerprint FROM worktree_clone WHERE slug = '$slug'"
}

store_worktree_fingerprints() {
  local slug="$1" fp="$2" migration_fp="$3" seed_fp="$4"
  ensure_meta_db
  run_db "$META_DB" "
    INSERT INTO worktree_clone (slug, fingerprint, migration_fingerprint, seed_fingerprint, updated_at)
    VALUES ('$slug', '$fp', '$migration_fp', '$seed_fp', now())
    ON CONFLICT (slug) DO UPDATE SET
      fingerprint = EXCLUDED.fingerprint,
      migration_fingerprint = EXCLUDED.migration_fingerprint,
      seed_fingerprint = EXCLUDED.seed_fingerprint,
      updated_at = now();
  " >/dev/null
}

store_worktree_fingerprint() {
  local slug="$1" fp="$2"
  store_worktree_fingerprints "$slug" "$fp" "" ""
}

forget_worktree_fingerprint() {
  local slug="$1"
  ensure_meta_db
  run_db "$META_DB" "DELETE FROM worktree_clone WHERE slug = '$slug'" >/dev/null
}

# ============================================================================
# Template build / refresh
# ============================================================================

template_refresh_for_fingerprint() {
  local current="$1" from_musi="$2" wt_root="$3"
  local target_template current_migration_fp current_seed_fp
  target_template="$(template_db_for_fingerprint "$current")"
  current_migration_fp="$(compute_migration_fingerprint "$wt_root")"
  current_seed_fp="$(compute_seed_fingerprint "$wt_root")"

  ensure_state_dir
  ensure_meta_db

  # Serialize concurrent template creation/rebuild. The lock is global because
  # CREATE DATABASE ... WITH TEMPLATE requires the source DB to be connection
  # free, and branch-specific templates may be created by multiple worktrees at
  # the same time.
  local lock lockfd
  lock="$(state_dir)/template.lock"
  exec {lockfd}>"$lock"
  flock "$lockfd"

  local stored stored_migration stored_seed
  stored="$(stored_fingerprint)"
  stored_migration="$(run_db "$META_DB" "SELECT migration_fingerprint FROM template_fingerprint WHERE id = 1" 2>/dev/null || true)"
  stored_seed="$(run_db "$META_DB" "SELECT seed_fingerprint FROM template_fingerprint WHERE id = 1" 2>/dev/null || true)"

  if (( ! from_musi )) && db_exists "$target_template" && template_build_recorded "$current" "$target_template"; then
    log "template up to date: $target_template (fingerprint $current)"
    if [[ "$stored" != "$current" || "$stored_migration" != "$current_migration_fp" || "$stored_seed" != "$current_seed_fp" ]]; then
      store_fingerprint "$current" "$current_migration_fp" "$current_seed_fp"
    fi
    store_template_build "$current" "$target_template" "$current_migration_fp" "$current_seed_fp"
    template_tombstone_forget "$target_template"
    flock -u "$lockfd"
    return 0
  fi

  log "rebuilding $target_template (fingerprint $stored -> $current)"

  # Terminate connections, drop, recreate.
  run_admin "
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = '$target_template' AND pid <> pg_backend_pid();
  " >/dev/null || true

  if db_exists "$target_template"; then
    run_admin "DROP DATABASE $target_template WITH (FORCE)" >/dev/null
  fi

  if (( from_musi )); then
    log "cloning from musi (--from-musi path; may leak dev data)"
    if ! db_exists "musi"; then
      die "--from-musi requested but the 'musi' database does not exist"
    fi
    run_admin "
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = 'musi' AND pid <> pg_backend_pid();
    " >/dev/null || true
    run_admin "CREATE DATABASE $target_template WITH TEMPLATE musi" >/dev/null
  else
    run_admin "CREATE DATABASE $target_template" >/dev/null
    # Run migrations + SRD seed against the fresh template.
    (
      cd "$wt_root/packages/server"
      DATABASE_URL="$(db_url "$target_template")" bunx prisma migrate deploy
      DATABASE_URL="$(db_url "$target_template")" bun prisma/seed-template.ts
    ) >&2 || die "template_refresh: prisma migrate deploy / seed-template.ts failed for $target_template"
  fi

  store_fingerprint "$current" "$current_migration_fp" "$current_seed_fp"
  store_template_build "$current" "$target_template" "$current_migration_fp" "$current_seed_fp"
  template_tombstone_forget "$target_template"
  log "$target_template rebuilt"
  flock -u "$lockfd"
}

template_refresh() {
  local from_musi=0 arg
  for arg in "$@"; do
    case "$arg" in
      --from-musi) from_musi=1 ;;
      *) die "unknown arg to template-refresh: $arg" ;;
    esac
  done

  local wt_root current
  wt_root="$(current_root)"
  current="$(compute_fingerprint "$wt_root")"
  template_refresh_for_fingerprint "$current" "$from_musi" "$wt_root"
}

# ============================================================================
# Provisioning (init)
# ============================================================================

# Ensure the *current* worktree has node_modules and the generated Prisma
# client. Without this, a fresh secondary worktree can't run its pre-commit
# hook (lint:changed/typecheck/test:changed) or `bun run dev` until the user
# manually bootstraps. Idempotent: warm worktrees return immediately.
ensure_dependencies() {
  local wt_root prisma_out
  wt_root="$(git rev-parse --show-toplevel)"
  # Match the generator's `output` in packages/server/prisma/schema.prisma
  # (relative path "../src/generated/prisma" → packages/server/src/generated/prisma).
  prisma_out="$wt_root/packages/server/src/generated/prisma"

  if [[ -d "$wt_root/node_modules" && -d "$prisma_out" ]]; then
    log "dependencies ok (node_modules + prisma client present)"
    return 0
  fi

  log "bootstrapping worktree dependencies (this may take a moment)"
  (
    cd "$wt_root"
    log "running: bun install"
    bun install >&2
  ) || die "ensure_dependencies: bun install failed"

  (
    cd "$wt_root"
    log "running: bun run --filter @musi/server prisma:generate"
    bun run --filter @musi/server prisma:generate >&2
  ) || die "ensure_dependencies: prisma:generate failed"

  log "dependencies bootstrapped"
}

copy_worktreeinclude_entries() {
  local pr wt_root entry src dst include_file
  pr="$(primary_root)"
  wt_root="$(git rev-parse --show-toplevel)"
  include_file="$wt_root/.worktreeinclude"
  [[ -f "$include_file" ]] || { log "no .worktreeinclude in current worktree; skipping carry-over"; return 0; }

  while IFS= read -r entry || [[ -n "$entry" ]]; do
    entry="${entry%$'\r'}"            # strip CR if any
    [[ -z "$entry" || "${entry:0:1}" == "#" ]] && continue
    src="$pr/$entry"
    dst="$wt_root/$entry"
    if [[ ! -e "$src" ]]; then
      log "skip $entry (not in primary)"
      continue
    fi
    # Directory: merge contents (src/. → dst/) so re-runs don't nest src
    # inside an existing dst dir. File: no-clobber into target path.
    if [[ -d "$src" ]]; then
      mkdir -p "$dst"
      cp -rn "$src/." "$dst/" 2>/dev/null || true
    else
      mkdir -p "$(dirname "$dst")"
      cp -n "$src" "$dst" 2>/dev/null || true
    fi
  done < "$include_file"
}

ensure_per_worktree_dbs() {
  local slug="$1" current_fp="$2" template_db="$3" wt_root="$4"
  local current_migration_fp="$5" current_seed_fp="$6" db testdb e2edb
  db="musi_wt_${slug}"
  testdb="musi_wt_${slug}_test"
  e2edb="musi_wt_${slug}_e2e"

  local target created=() existing_before=()
  for target in "$db" "$testdb" "$e2edb"; do
    if db_exists "$target"; then
      existing_before+=("$target")
    else
      log "creating $target from $template_db"
      # Terminate any connections on template before using it as source.
      run_admin "
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '$template_db' AND pid <> pg_backend_pid();
      " >/dev/null || true
      run_admin "CREATE DATABASE $target WITH TEMPLATE $template_db" >/dev/null
      created+=("$target")
    fi
  done

  # Fast path: all three DBs pre-existed and the per-slug fingerprint stored
  # from a prior init matches the current template fingerprint → nothing to
  # catch up. Skips 3× `prisma migrate deploy` (~6s of Prisma boot) on every
  # warm `bun run dev`.
  local stored_fp stored_migration_fp stored_seed_fp
  stored_fp="$(stored_worktree_fingerprint "$slug")"
  stored_migration_fp="$(stored_worktree_migration_fingerprint "$slug")"
  stored_seed_fp="$(stored_worktree_seed_fingerprint "$slug")"
  local inferred_component_fp=0
  if [[ -z "$stored_migration_fp" && "$stored_fp" == "$current_fp" ]]; then
    stored_migration_fp="$current_migration_fp"
    inferred_component_fp=1
  fi
  if [[ -z "$stored_seed_fp" && "$stored_fp" == "$current_fp" ]]; then
    stored_seed_fp="$current_seed_fp"
    inferred_component_fp=1
  fi
  if (( ${#created[@]} == 0 )) \
    && [[ "$stored_migration_fp" == "$current_migration_fp" ]] \
    && [[ "$stored_seed_fp" == "$current_seed_fp" ]]; then
    if [[ "$stored_fp" != "$current_fp" || "$inferred_component_fp" == "1" ]]; then
      store_worktree_fingerprints "$slug" "$current_fp" "$current_migration_fp" "$current_seed_fp"
    fi
    log "per-worktree DBs up to date (fingerprint $current_fp)"
    return 0
  fi

  # Catch up pre-existing DBs whose clone predates a template refresh.
  # Just-created clones are already at HEAD (template_refresh ran first),
  # so skip them — avoids 3× redundant `prisma migrate deploy` per init.
  local migration_stale=0
  if [[ "$stored_migration_fp" != "$current_migration_fp" ]]; then
    migration_stale=1
  fi
  if (( migration_stale )); then
    local c just_created
    for target in "$db" "$testdb" "$e2edb"; do
      just_created=0
      for c in "${created[@]}"; do
        if [[ "$c" == "$target" ]]; then just_created=1; break; fi
      done
      (( just_created )) && continue
      (
        cd "$wt_root/packages/server"
        DATABASE_URL="$(db_url "$target")" bunx prisma migrate deploy
      ) >&2
    done
  fi

  # Migrations can be caught up safely on warm DBs. SRD seed changes cannot be
  # made exact in place because upserts do not delete removed reference rows.
  # Keep the seed fingerprint stale so status/doctor can point at
  # worktree:refresh-data and the destructive exact-parity option.
  local recorded_fp recorded_seed_fp
  recorded_seed_fp="$stored_seed_fp"
  if (( ${#existing_before[@]} == 0 )) || [[ "$stored_seed_fp" == "$current_seed_fp" ]]; then
    recorded_seed_fp="$current_seed_fp"
  fi
  if [[ "$recorded_seed_fp" == "$current_seed_fp" ]]; then
    recorded_fp="$current_fp"
  else
    recorded_fp="${stored_fp:-seed-drift}"
    log "SRD seed drift remains for $slug; run 'bun run worktree:refresh-data' to re-apply the seed in place (upsert-only — preserves dev rows but will not delete reference rows removed from the seed source), or pass --destructive to reclone dev/test/e2e from the template and clear exact drift"
  fi
  store_worktree_fingerprints "$slug" "$recorded_fp" "$current_migration_fp" "$recorded_seed_fp"
}

write_worktree_env() {
  local slug="$1" server_port="$2" client_port="$3" redis_db="$4"
  local wt_root admin base_url
  wt_root="$(git rev-parse --show-toplevel)"
  admin="$(admin_url)"
  # Strip trailing /postgres to get base credentials.
  base_url="$(printf '%s' "$admin" | sed -E 's|/postgres$||')"

  local db="musi_wt_${slug}"
  local testdb="musi_wt_${slug}_test"
  local e2edb="musi_wt_${slug}_e2e"

  # Preserve non-managed keys in existing .env; replace managed ones.
  local root_env="$wt_root/.env"
  local tmp
  tmp="$(mktemp)"
  {
    if [[ -f "$root_env" ]]; then
      grep -vE '^(DATABASE_URL|TEST_DATABASE_URL|E2E_DATABASE_URL|SERVER_PORT|REDIS_URL|CORS_ORIGIN|VITE_API_URL|VITE_DEV_PORT)=' "$root_env" || true
    fi
    printf 'DATABASE_URL=%s/%s\n'       "$base_url" "$db"
    printf 'TEST_DATABASE_URL=%s/%s\n'  "$base_url" "$testdb"
    printf 'E2E_DATABASE_URL=%s/%s\n'   "$base_url" "$e2edb"
    printf 'SERVER_PORT=%d\n'           "$server_port"
    printf 'REDIS_URL=redis://redis:6379/%d\n' "$redis_db"
    printf 'CORS_ORIGIN=http://localhost:%d\n' "$client_port"
  } > "$tmp"
  mv "$tmp" "$root_env"
  log "wrote $root_env"

  local client_env_dir="$wt_root/packages/client"
  mkdir -p "$client_env_dir"
  local client_env="$client_env_dir/.env"
  tmp="$(mktemp)"
  {
    if [[ -f "$client_env" ]]; then
      grep -vE '^(VITE_DEV_PORT|VITE_API_URL)=' "$client_env" || true
    fi
    printf 'VITE_DEV_PORT=%d\n'  "$client_port"
    printf 'VITE_API_URL=http://localhost:%d\n' "$server_port"
  } > "$tmp"
  mv "$tmp" "$client_env"
  log "wrote $client_env"
}

cmd_init() {
  if is_primary_worktree; then
    log "primary worktree; no provisioning needed"
    return 0
  fi

  local slug hash server_port client_port redis_db wt_root current_fp template_db
  local current_migration_fp current_seed_fp
  slug="$(compute_slug)"
  hash="$(slug_hash_int "$slug")"
  wt_root="$(current_root)"

  log "slug: $slug"

  ensure_state_dir
  local init_lock init_lockfd
  init_lock="$(state_dir)/init-${slug}.lock"
  exec {init_lockfd}>"$init_lock"
  flock "$init_lockfd"

  # Bootstrap node_modules + prisma client for this worktree before any DB
  # provisioning. The template build and catch-up migrations run from this
  # worktree so branch-local Prisma changes are honored.
  ensure_dependencies

  # Opportunistic GC before allocating — reclaim orphaned ports/DBs.
  cmd_gc || true

  # Carry .claude/, .env, package env files, and local-only reference data from
  # primary before template seeding. The seed path reads docs/refs at runtime.
  copy_worktreeinclude_entries

  # Template first (creates a fingerprinted musi_template_<hash> + musi_wt_meta
  # if needed) using this worktree's checked-out Prisma/seed code.
  current_fp="$(compute_fingerprint "$wt_root")"
  current_migration_fp="$(compute_migration_fingerprint "$wt_root")"
  current_seed_fp="$(compute_seed_fingerprint "$wt_root")"
  template_db="$(template_db_for_fingerprint "$current_fp")"
  template_refresh_for_fingerprint "$current_fp" 0 "$wt_root"

  # Per-worktree DBs. Pass the current template fingerprint so
  # ensure_per_worktree_dbs can skip `prisma migrate deploy` when all three
  # DBs are already at HEAD. template_refresh above just guaranteed the
  # stored template fingerprint matches compute_fingerprint.
  ensure_per_worktree_dbs "$slug" "$current_fp" "$template_db" "$wt_root" \
    "$current_migration_fp" "$current_seed_fp"

  # Allocate ports and Redis index from a locked registry so concurrent fresh
  # worktrees cannot reserve the same resources before servers bind.
  local server_start client_start
  server_start=$(( hash % (SERVER_PORT_MAX - SERVER_PORT_MIN + 1) ))
  client_start=$(( hash % (CLIENT_PORT_MAX - CLIENT_PORT_MIN + 1) ))
  IFS=$'\t' read -r server_port client_port redis_db \
    <<< "$(allocate_resources "$slug" "$hash" "$server_start" "$client_start")"
  log "allocated: server=$server_port client=$client_port redis=/$redis_db"

  write_worktree_env "$slug" "$server_port" "$client_port" "$redis_db"

  # Clear tombstone for this slug, if any.
  tombstone_forget "$slug"

  log "init complete for worktree slug=$slug"
}

# ============================================================================
# Drop (current worktree)
# ============================================================================

validate_wt_db_name() {
  local name="$1"
  # Derive the regex from SLUG_MAX_LEN so a future bump can't outgrow the
  # validator silently. compute_slug caps the slug at SLUG_MAX_LEN; anything
  # longer here is a runaway argument, not a real name.
  local re="^musi_wt_[a-z0-9_]{1,${SLUG_MAX_LEN}}((_test|_e2e)|_w[a-z0-9]{1,${WORKER_KEY_MAX_LEN}})?\$|^musi_wt_[a-z0-9_]{1,42}_test_w[a-z0-9]{1,6}\$"
  (( ${#name} <= 63 )) \
    || die "refusing to touch overlong database identifier: $name"
  [[ "$name" =~ $re ]] \
    || die "refusing to touch non-worktree DB name: $name"
  local p
  for p in "${PRIMARY_DB_NAMES[@]}"; do
    [[ "$name" == "$p" ]] && die "refusing to touch primary DB: $name"
  done
  return 0  # tail `[[ ]]` exits 1 under set -e when false, even inside the loop
}

drop_db() {
  local name="$1"
  validate_wt_db_name "$name"
  if ! db_exists "$name"; then
    log "$name does not exist; skipping"
    return 0
  fi
  log "dropping $name"
  run_admin "
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = '$name' AND pid <> pg_backend_pid();
  " >/dev/null || true
  run_admin "DROP DATABASE $name WITH (FORCE)" >/dev/null
}

cmd_drop() {
  if is_primary_worktree; then
    die "refusing to drop DBs from the primary worktree"
  fi
  local slug dbs target
  slug="$(compute_slug)"
  # Fail loudly on admin DB failure: silently treating a connection error as
  # "no DBs" would clear local registry state (fingerprint, tombstone,
  # allocation) while orphan DBs persist. cmd_gc still discovers orphans on a
  # later run, but local state for the slug stays drifted until then.
  dbs="$(list_worktree_dbs)"
  while IFS= read -r target; do
    [[ -z "$target" ]] && continue
    [[ "$(slug_from_dbname "$target")" == "$slug" ]] && drop_db "$target"
  done <<< "$dbs"
  forget_worktree_fingerprint "$slug"
  tombstone_forget "$slug"
  allocation_forget "$slug"
}

# ============================================================================
# Refresh data (current worktree)
# ============================================================================

reseed_worktree_db() {
  local db="$1" wt_root="$2"
  validate_wt_db_name "$db"
  log "applying migrations + SRD seed to $db (preserves non-SRD rows)"
  (
    cd "$wt_root/packages/server"
    DATABASE_URL="$(db_url "$db")" bunx prisma migrate deploy
    DATABASE_URL="$(db_url "$db")" bun prisma/seed-template.ts
  ) >&2 || die "reseed_worktree_db: prisma migrate deploy / seed-template.ts failed for $db"
}

refresh_data_recorded_fingerprints() {
  local destructive="$1" stored_fp="$2" stored_seed_fp="$3"
  local current_fp="$4" current_migration_fp="$5" current_seed_fp="$6"
  if (( destructive )); then
    printf '%s\t%s\t%s\n' "$current_fp" "$current_migration_fp" "$current_seed_fp"
  else
    printf '%s\t%s\t%s\n' "${stored_fp:-seed-drift}" "$current_migration_fp" "${stored_seed_fp:-$PRESERVE_REFRESH_SEED_FP}"
  fi
}

reclone_worktree_db() {
  local db="$1" template_db="$2"
  validate_wt_db_name "$db"
  run_admin "
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = '$db' AND pid <> pg_backend_pid();
  " >/dev/null || true
  if db_exists "$db"; then
    log "dropping $db"
    run_admin "DROP DATABASE $db WITH (FORCE)" >/dev/null
  fi
  run_admin "
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = '$template_db' AND pid <> pg_backend_pid();
  " >/dev/null || true
  log "creating $db from $template_db"
  run_admin "CREATE DATABASE $db WITH TEMPLATE $template_db" >/dev/null
}

cmd_refresh_data() {
  local destructive=0 arg
  for arg in "$@"; do
    case "$arg" in
      --destructive) destructive=1 ;;
      *) die "unknown arg to refresh-data: $arg" ;;
    esac
  done

  if is_primary_worktree; then
    die "refusing to refresh data in the primary worktree"
  fi

  local wt_root slug current_fp current_migration_fp current_seed_fp template_db
  wt_root="$(current_root)"
  slug="$(compute_slug "$wt_root")"

  log "slug: $slug"

  ensure_state_dir
  # Reuse the per-slug init lock so concurrent `worktree:init` and
  # `worktree:refresh-data` cannot interleave migrations / template rebuilds
  # for the same worktree.
  local lock lockfd
  lock="$(state_dir)/init-${slug}.lock"
  exec {lockfd}>"$lock"
  flock "$lockfd"

  ensure_dependencies

  current_fp="$(compute_fingerprint "$wt_root")"
  current_migration_fp="$(compute_migration_fingerprint "$wt_root")"
  current_seed_fp="$(compute_seed_fingerprint "$wt_root")"
  template_db="$(template_db_for_fingerprint "$current_fp")"
  template_refresh_for_fingerprint "$current_fp" 0 "$wt_root"

  local db testdb e2edb target
  db="musi_wt_${slug}"
  testdb="musi_wt_${slug}_test"
  e2edb="musi_wt_${slug}_e2e"

  if (( destructive )); then
    log "destructive refresh: dropping and recloning dev/test/e2e DBs from $template_db (discards local dev data)"
    for target in "$db" "$testdb" "$e2edb"; do
      reclone_worktree_db "$target" "$template_db"
    done
  else
    log "preserve refresh: re-applying migrations + SRD seed in place on dev/test/e2e (removed seed rows are preserved; pass --destructive to reclone and clear exact drift)"
    for target in "$db" "$testdb" "$e2edb"; do
      db_exists "$target" \
        || die "$target does not exist; run 'bun run worktree:init' first, or pass --destructive to recreate from template"
      reseed_worktree_db "$target" "$wt_root"
    done
  fi

  local stored_fp stored_seed_fp recorded_fp recorded_migration_fp recorded_seed_fp
  stored_fp="$(stored_worktree_fingerprint "$slug")"
  stored_seed_fp="$(stored_worktree_seed_fingerprint "$slug")"
  IFS=$'\t' read -r recorded_fp recorded_migration_fp recorded_seed_fp \
    <<< "$(refresh_data_recorded_fingerprints "$destructive" "$stored_fp" "$stored_seed_fp" "$current_fp" "$current_migration_fp" "$current_seed_fp")"
  store_worktree_fingerprints "$slug" "$recorded_fp" "$recorded_migration_fp" "$recorded_seed_fp"
  flock -u "$lockfd"
  if (( destructive )); then
    log "refresh-data complete (destructive) for slug=$slug"
  else
    log "refresh-data complete (preserve) for slug=$slug; exact SRD parity is still unknown, so seed drift remains until 'bun run worktree:refresh-data --destructive'"
  fi
}

# ============================================================================
# Status
# ============================================================================

db_exists_label() {
  local name="$1"
  if db_exists "$name"; then
    printf 'yes'
  else
    printf 'no'
  fi
}

meta_column_exists() {
  local table="$1" column="$2"
  [[ -n "$(run_db "$META_DB" "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$table' AND column_name = '$column'" 2>/dev/null || true)" ]]
}

meta_read_value() {
  local table="$1" column="$2" where="$3"
  meta_column_exists "$table" "$column" || return 0
  run_db "$META_DB" "SELECT $column FROM $table WHERE $where" 2>/dev/null || true
}

cmd_status() {
  local all=0 arg
  for arg in "$@"; do
    case "$arg" in
      --all) all=1 ;;
      *) die "unknown arg to status: $arg" ;;
    esac
  done

  if (( all )); then
    cmd_status_all
    return 0
  fi

  local wt_root pr slug current_fp current_migration_fp current_seed_fp template_db primary_label
  wt_root="$(current_root)"
  pr="$(primary_root)"
  slug="$(compute_slug "$wt_root")"
  current_fp="$(compute_fingerprint "$wt_root")"
  current_migration_fp="$(compute_migration_fingerprint "$wt_root")"
  current_seed_fp="$(compute_seed_fingerprint "$wt_root")"
  template_db="$(template_db_for_fingerprint "$current_fp")"
  if is_primary_worktree; then
    primary_label="yes"
  else
    primary_label="no"
  fi

  printf 'worktree: %s\n' "$wt_root"
  printf 'primary_root: %s\n' "$pr"
  printf 'is_primary: %s\n' "$primary_label"
  printf 'slug: %s\n' "$slug"
  printf 'fingerprint: %s\n' "$current_fp"
  printf 'migration_fingerprint: %s\n' "$current_migration_fp"
  printf 'seed_fingerprint: %s\n' "$current_seed_fp"
  printf 'template_db: %s (exists=%s)\n' "$template_db" "$(db_exists_label "$template_db")"

  local db testdb e2edb
  db="musi_wt_${slug}"
  testdb="musi_wt_${slug}_test"
  e2edb="musi_wt_${slug}_e2e"
  printf 'db: %s (exists=%s)\n' "$db" "$(db_exists_label "$db")"
  printf 'test_db: %s (exists=%s)\n' "$testdb" "$(db_exists_label "$testdb")"
  printf 'e2e_db: %s (exists=%s)\n' "$e2edb" "$(db_exists_label "$e2edb")"

  if db_exists "$META_DB"; then
    local latest_fp latest_migration_fp latest_seed_fp clone_fp clone_migration_fp clone_seed_fp template_recorded
    latest_fp="$(meta_read_value template_fingerprint fingerprint "id = 1")"
    latest_migration_fp="$(meta_read_value template_fingerprint migration_fingerprint "id = 1")"
    latest_seed_fp="$(meta_read_value template_fingerprint seed_fingerprint "id = 1")"
    clone_fp="$(meta_read_value worktree_clone fingerprint "slug = '$slug'")"
    clone_migration_fp="$(meta_read_value worktree_clone migration_fingerprint "slug = '$slug'")"
    clone_seed_fp="$(meta_read_value worktree_clone seed_fingerprint "slug = '$slug'")"
    template_recorded="$(run_db "$META_DB" "SELECT 1 FROM template_build WHERE fingerprint = '$current_fp' AND db_name = '$template_db'" || true)"
    printf 'meta_latest_fingerprint: %s\n' "${latest_fp:-<none>}"
    printf 'meta_latest_migration_fingerprint: %s\n' "${latest_migration_fp:-<none>}"
    printf 'meta_latest_seed_fingerprint: %s\n' "${latest_seed_fp:-<none>}"
    printf 'meta_clone_fingerprint: %s\n' "${clone_fp:-<none>}"
    printf 'meta_clone_migration_fingerprint: %s\n' "${clone_migration_fp:-<none>}"
    printf 'meta_clone_seed_fingerprint: %s\n' "${clone_seed_fp:-<none>}"
    printf 'meta_template_build_recorded: %s\n' "${template_recorded:-no}"

    if [[ "$primary_label" == "no" ]]; then
      local drift_reasons=() seed_drift=0 seed_metadata_missing=0
      if [[ -n "$clone_fp" && -z "$clone_migration_fp" ]]; then
        drift_reasons+=("migration fingerprint missing")
      elif [[ -n "$clone_migration_fp" && "$clone_migration_fp" != "$current_migration_fp" ]]; then
        drift_reasons+=("migration fingerprint stale")
      fi
      if [[ -n "$clone_fp" && -z "$clone_seed_fp" ]]; then
        drift_reasons+=("SRD seed fingerprint missing")
        seed_metadata_missing=1
      elif [[ -n "$clone_seed_fp" && "$clone_seed_fp" != "$current_seed_fp" ]]; then
        drift_reasons+=("SRD seed fingerprint stale")
        seed_drift=1
      fi
      if (( ${#drift_reasons[@]} > 0 )); then
        printf 'drift: %s\n' "$(IFS=,; printf '%s' "${drift_reasons[*]}")"
        if (( seed_drift )); then
          printf "WARN: SRD seed drift detected — run 'bun run worktree:refresh-data' to re-apply the seed in place (upsert-only — preserves dev rows but will not delete reference rows removed from the seed source), or 'bun run worktree:refresh-data --destructive' to reclone dev/test/e2e from the template and clear exact drift\n"
        elif (( seed_metadata_missing )); then
          printf "WARN: SRD seed fingerprint metadata missing — run 'bun run worktree:init' to backfill metadata; if seed drift remains afterwards, run 'bun run worktree:refresh-data'\n"
        fi
      else
        printf 'drift: ok\n'
      fi
    fi
  else
    printf 'meta_db: missing\n'
  fi

  local allocation_json allocation_row
  allocation_json="$(allocation_read)"
  if printf '%s' "$allocation_json" | jq -e --arg s "$slug" 'has($s)' >/dev/null; then
    allocation_row="$(printf '%s' "$allocation_json" | jq -r --arg s "$slug" '.[$s] | "server=\(.server) client=\(.client) redis=/\(.redis) updatedAt=\(.updatedAt)"')"
    printf 'allocation: %s\n' "$allocation_row"
  else
    printf 'allocation: <none>\n'
  fi
}

# ----------------------------------------------------------------------------
# Cross-worktree status (--all)
# ----------------------------------------------------------------------------

# Translate `git worktree list --porcelain` into one tab-separated row per
# worktree: <path>\t<branch-or-token>\t<is_primary>. Reads stdin so tests can
# feed fixtures without a real git repo. `branch` is the short ref name; bare
# and detached worktrees emit `<bare>` / `<detached>`.
parse_worktree_porcelain() {
  local primary="$1"
  local line path="" branch="" is_primary
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == worktree\ * ]]; then
      if [[ -n "$path" ]]; then
        is_primary="no"
        [[ "$path" == "$primary" ]] && is_primary="yes"
        printf '%s\t%s\t%s\n' "$path" "${branch:-<detached>}" "$is_primary"
      fi
      path="${line#worktree }"
      branch=""
    elif [[ "$line" == "branch refs/heads/"* ]]; then
      branch="${line#branch refs/heads/}"
    elif [[ "$line" == "detached" ]]; then
      branch="<detached>"
    elif [[ "$line" == "bare" ]]; then
      branch="<bare>"
    fi
  done
  if [[ -n "$path" ]]; then
    is_primary="no"
    [[ "$path" == "$primary" ]] && is_primary="yes"
    printf '%s\t%s\t%s\n' "$path" "${branch:-<detached>}" "$is_primary"
  fi
}

list_worktrees_porcelain() {
  local pr
  pr="$(primary_root)"
  git worktree list --porcelain | parse_worktree_porcelain "$pr"
}

# Newline-delimited DB membership check. Used to batch one admin-side DB
# listing instead of hitting Postgres once per name.
dbset_contains() {
  local set="$1" name="$2"
  [[ -z "$set" ]] && return 1
  grep -qxF -- "$name" <<< "$set"
}

dbset_label() {
  local set="$1" name="$2"
  if dbset_contains "$set" "$name"; then printf 'yes'; else printf 'no'; fi
}

dbset_has_worktree_slug() {
  local set="$1" slug="$2"
  [[ -z "$set" ]] && return 1
  grep -Eq "^musi_wt_${slug}(_test(_w[a-z0-9]{1,6})?|_e2e|_w[a-z0-9]{1,${WORKER_KEY_MAX_LEN}})?$" <<< "$set"
}

# compute_fingerprint dies on missing schema/seed inputs (e.g. an unfetched
# worktree). For --all we want to surface that as missing data rather than
# abort the whole listing, so trap the die in a subshell.
safe_compute_fingerprint() {
  local out
  out="$( compute_fingerprint "$1" 2>/dev/null )" || true
  printf '%s' "$out"
}

safe_compute_migration_fingerprint() {
  local out
  out="$( compute_migration_fingerprint "$1" 2>/dev/null )" || true
  printf '%s' "$out"
}

safe_compute_seed_fingerprint() {
  local out
  out="$( compute_seed_fingerprint "$1" 2>/dev/null )" || true
  printf '%s' "$out"
}

print_worktree_block() {
  local wt_path="$1" branch="$2" is_primary="$3"
  local existing_dbs="$4" allocation_json="$5" meta_present="$6"

  local slug current_fp current_migration_fp current_seed_fp template_db
  slug="$(compute_slug "$wt_path")"
  current_fp="$(safe_compute_fingerprint "$wt_path")"
  current_migration_fp="$(safe_compute_migration_fingerprint "$wt_path")"
  current_seed_fp="$(safe_compute_seed_fingerprint "$wt_path")"
  if [[ -n "$current_fp" ]]; then
    template_db="$(template_db_for_fingerprint "$current_fp")"
  else
    template_db="<unknown>"
  fi

  printf '\nworktree: %s\n' "$wt_path"
  printf '  branch: %s\n' "$branch"
  printf '  slug: %s\n' "$slug"
  printf '  is_primary: %s\n' "$is_primary"

  local server_port="-" client_port="-" redis_db="-" alloc_present=0
  if printf '%s' "$allocation_json" | jq -e --arg s "$slug" 'has($s)' >/dev/null; then
    server_port="$(printf '%s' "$allocation_json" | jq -r --arg s "$slug" '.[$s].server')"
    client_port="$(printf '%s' "$allocation_json" | jq -r --arg s "$slug" '.[$s].client')"
    redis_db="/$(printf '%s' "$allocation_json" | jq -r --arg s "$slug" '.[$s].redis')"
    alloc_present=1
  fi
  printf '  server_port: %s\n' "$server_port"
  printf '  client_port: %s\n' "$client_port"
  printf '  redis_db: %s\n' "$redis_db"

  local template_exists="-"
  if [[ "$template_db" != "<unknown>" ]]; then
    if dbset_contains "$existing_dbs" "$template_db"; then
      template_exists="yes"
    else
      template_exists="no"
    fi
  fi
  printf '  template_db: %s (exists=%s)\n' "$template_db" "$template_exists"
  printf '  current_fingerprint: %s\n' "${current_fp:-<unknown>}"
  printf '  current_migration_fingerprint: %s\n' "${current_migration_fp:-<unknown>}"
  printf '  current_seed_fingerprint: %s\n' "${current_seed_fp:-<unknown>}"

  local db testdb e2edb db_label test_label e2e_label
  db="musi_wt_${slug}"
  testdb="musi_wt_${slug}_test"
  e2edb="musi_wt_${slug}_e2e"
  db_label="$(dbset_label "$existing_dbs" "$db")"
  test_label="$(dbset_label "$existing_dbs" "$testdb")"
  e2e_label="$(dbset_label "$existing_dbs" "$e2edb")"
  printf '  db: %s (exists=%s)\n' "$db" "$db_label"
  printf '  test_db: %s (exists=%s)\n' "$testdb" "$test_label"
  printf '  e2e_db: %s (exists=%s)\n' "$e2edb" "$e2e_label"

  local clone_fp="<none>" clone_migration_fp="<none>" clone_seed_fp="<none>"
  if (( meta_present )); then
    local fp migration_fp seed_fp
    fp="$(meta_read_value worktree_clone fingerprint "slug = '$slug'")"
    migration_fp="$(meta_read_value worktree_clone migration_fingerprint "slug = '$slug'")"
    seed_fp="$(meta_read_value worktree_clone seed_fingerprint "slug = '$slug'")"
    [[ -n "$fp" ]] && clone_fp="$fp"
    [[ -n "$migration_fp" ]] && clone_migration_fp="$migration_fp"
    [[ -n "$seed_fp" ]] && clone_seed_fp="$seed_fp"
  fi
  printf '  clone_fingerprint: %s\n' "$clone_fp"
  printf '  clone_migration_fingerprint: %s\n' "$clone_migration_fp"
  printf '  clone_seed_fingerprint: %s\n' "$clone_seed_fp"

  local drift drift_reasons=()
  if [[ "$is_primary" == "yes" ]]; then
    drift="primary worktree (no per-worktree DBs)"
  elif [[ "$branch" == "<bare>" ]]; then
    # Bare worktrees inherently have no checked-out tree, so missing prisma
    # inputs and per-slug DBs are expected; surface only that fact.
    drift="bare worktree (not provisionable)"
  else
    if [[ -z "$current_fp" ]];       then drift_reasons+=("missing prisma inputs"); fi
    if [[ "$template_exists" == "no" ]]; then drift_reasons+=("template missing"); fi
    if (( ! alloc_present ));        then drift_reasons+=("no allocation"); fi
    if [[ "$db_label" == "no" ]];    then drift_reasons+=("missing $db"); fi
    if [[ "$test_label" == "no" ]];  then drift_reasons+=("missing $testdb"); fi
    if [[ "$e2e_label" == "no" ]];   then drift_reasons+=("missing $e2edb"); fi
    if [[ "$clone_fp" != "<none>" && "$clone_migration_fp" == "<none>" ]]; then
      drift_reasons+=("migration fingerprint missing")
    elif [[ -n "$current_migration_fp" && "$clone_migration_fp" != "<none>" && "$clone_migration_fp" != "$current_migration_fp" ]]; then
      drift_reasons+=("migration fingerprint stale")
    fi
    if [[ "$clone_fp" != "<none>" && "$clone_seed_fp" == "<none>" ]]; then
      drift_reasons+=("SRD seed fingerprint missing")
    elif [[ -n "$current_seed_fp" && "$clone_seed_fp" != "<none>" && "$clone_seed_fp" != "$current_seed_fp" ]]; then
      drift_reasons+=("SRD seed fingerprint stale")
    fi
    if [[ "$clone_fp" != "<none>" && "$clone_fp" != "$current_fp" ]]; then
      drift_reasons+=("clone fingerprint stale")
    fi
    if (( ${#drift_reasons[@]} == 0 )); then
      drift="ok"
    else
      drift="$(IFS=,; printf '%s' "${drift_reasons[*]}")"
    fi
  fi
  printf '  drift: %s\n' "$drift"
}

print_stale_allocations() {
  local allocation_json="$1" live_slugs="$2"
  local alloc_keys stale_keys
  alloc_keys="$(printf '%s' "$allocation_json" | jq -r 'keys[]')"
  stale_keys=""
  while IFS= read -r slug; do
    [[ -z "$slug" ]] && continue
    if ! grep -qxF -- "$slug" <<< "$live_slugs"; then
      stale_keys+="$slug"$'\n'
    fi
  done <<< "$alloc_keys"

  if [[ -z "$stale_keys" ]]; then
    return 0
  fi

  printf '\nstale_allocations:\n'
  while IFS= read -r slug; do
    [[ -z "$slug" ]] && continue
    local row
    row="$(printf '%s' "$allocation_json" | jq -r --arg s "$slug" '.[$s] | "server=\(.server) client=\(.client) redis=/\(.redis) updatedAt=\(.updatedAt)"')"
    printf '  %s: %s (worktree no longer present)\n' "$slug" "$row"
  done <<< "$stale_keys"
}

cmd_status_all() {
  local pr existing_dbs allocation_json meta_present=0 latest_fp latest_migration_fp latest_seed_fp
  pr="$(primary_root)"
  allocation_json="$(allocation_read)"

  if db_exists "$META_DB"; then
    meta_present=1
    latest_fp="$(meta_read_value template_fingerprint fingerprint "id = 1")"
    latest_migration_fp="$(meta_read_value template_fingerprint migration_fingerprint "id = 1")"
    latest_seed_fp="$(meta_read_value template_fingerprint seed_fingerprint "id = 1")"
  fi

  # Single admin query for all musi-prefixed DBs; per-worktree checks compare
  # against this set instead of round-tripping per name.
  existing_dbs="$(run_admin "SELECT datname FROM pg_database WHERE datname LIKE 'musi%'" 2>/dev/null || true)"

  printf '# worktree:status --all\n'
  printf 'primary_root: %s\n' "$pr"
  if (( meta_present )); then
    printf 'meta_latest_fingerprint: %s\n' "${latest_fp:-<none>}"
    printf 'meta_latest_migration_fingerprint: %s\n' "${latest_migration_fp:-<none>}"
    printf 'meta_latest_seed_fingerprint: %s\n' "${latest_seed_fp:-<none>}"
  else
    printf 'meta_db: missing\n'
  fi

  local live_slugs="" wt_path branch is_primary
  while IFS=$'\t' read -r wt_path branch is_primary; do
    [[ -z "$wt_path" ]] && continue
    print_worktree_block "$wt_path" "$branch" "$is_primary" \
      "$existing_dbs" "$allocation_json" "$meta_present"
    live_slugs+="$(compute_slug "$wt_path")"$'\n'
  done < <(list_worktrees_porcelain)

  print_stale_allocations "$allocation_json" "$live_slugs"
}

# ============================================================================
# GC (cross-worktree cleanup)
# ============================================================================

list_worktree_dbs() {
  run_admin "
    SELECT datname FROM pg_database
    WHERE datname LIKE 'musi_wt\\_%' ESCAPE '\\'
      AND datname NOT IN ('$META_DB')
    ORDER BY datname;
  " | sed '/^$/d'
}

list_live_slugs() {
  # Parse `git worktree list --porcelain` to collect the live worktree paths,
  # then compute each one's slug via compute_slug so the algorithm lives in
  # exactly one place.
  local line wt_path
  git worktree list --porcelain | while IFS= read -r line; do
    if [[ "$line" == worktree* ]]; then
      wt_path="${line#worktree }"
      compute_slug "$wt_path"
      printf '\n'
    fi
  done
}

slug_from_dbname() {
  local name="$1"
  # Strip prefix + optional suffix. musi_wt_<slug>[_test|_e2e|_wN].
  # The `_test_wN` branch is legacy cleanup support for CR15-era worker DBs.
  if [[ "$name" =~ ^musi_wt_(.+)_test_w[a-z0-9]{1,6}$ ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "$name" =~ ^musi_wt_(.+)_w[a-z0-9]{1,${WORKER_KEY_MAX_LEN}}$ ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  name="${name#musi_wt_}"
  name="${name%_test}"
  name="${name%_e2e}"
  printf '%s' "$name"
}

list_template_dbs() {
  run_admin "
    SELECT datname FROM pg_database
    WHERE datname LIKE '${TEMPLATE_DB_PREFIX}\\_%' ESCAPE '\\'
    ORDER BY datname;
  " | sed '/^$/d'
}

list_live_template_dbs() {
  local line wt_path fp
  git worktree list --porcelain | while IFS= read -r line; do
    if [[ "$line" == worktree* ]]; then
      wt_path="${line#worktree }"
      fp="$(compute_fingerprint "$wt_path")" || continue
      template_db_for_fingerprint "$fp"
      printf '\n'
    fi
  done
}

validate_template_db_name() {
  local name="$1"
  local re="^${TEMPLATE_DB_PREFIX}_[a-f0-9]{${TEMPLATE_HASH_LEN}}\$"
  [[ "$name" =~ $re ]] \
    || die "refusing to touch non-fingerprinted template DB name: $name"
}

drop_template_db() {
  local name="$1"
  validate_template_db_name "$name"
  if ! db_exists "$name"; then
    log "$name does not exist; skipping"
    return 0
  fi
  log "dropping $name"
  run_admin "
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = '$name' AND pid <> pg_backend_pid();
  " >/dev/null || true
  run_admin "DROP DATABASE $name WITH (FORCE)" >/dev/null
  forget_template_build "$name"
}

tombstone_read() {
  local file
  file="$(tombstones_file)"
  [[ -f "$file" ]] || { printf '{}'; return 0; }
  cat "$file"
}

tombstone_write() {
  local json="$1" file tmp
  file="$(tombstones_file)"
  ensure_state_dir
  # Create the temp file on the same filesystem as the target so `mv` is a
  # true atomic rename. $TMPDIR often points at a tmpfs (/tmp), and a
  # cross-fs mv degrades to copy+unlink — not atomic, so a crash between
  # the two steps leaves either no tombstones file or a truncated one.
  tmp="$(mktemp -p "$(state_dir)")"
  printf '%s\n' "$json" > "$tmp"
  mv "$tmp" "$file"
}

# Unlocked RMW primitives. The caller MUST hold gc.lock (cmd_gc does).
_tombstone_mark_unlocked() {
  local slug="$1" now json
  now="$(date +%s)"
  json="$(tombstone_read)"
  json="$(printf '%s' "$json" | jq --arg s "$slug" --argjson t "$now" '. + {($s): $t}')"
  tombstone_write "$json"
}

_tombstone_forget_unlocked() {
  local slug="$1" json
  json="$(tombstone_read)"
  json="$(printf '%s' "$json" | jq --arg s "$slug" 'del(.[$s])')"
  tombstone_write "$json"
}

# Public API. Acquires gc.lock (blocking) around the RMW so a concurrent
# `gc` can't race and overwrite our change during its final cleanup pass.
# Runs in a subshell so the lock is released on any exit path.
tombstone_mark() {
  ensure_state_dir
  (
    local lockfd
    exec {lockfd}>"$(state_dir)/gc.lock"
    flock "$lockfd"
    _tombstone_mark_unlocked "$@"
  )
}

tombstone_forget() {
  ensure_state_dir
  (
    local lockfd
    exec {lockfd}>"$(state_dir)/gc.lock"
    flock "$lockfd"
    _tombstone_forget_unlocked "$@"
  )
}

tombstone_age() {
  local slug="$1" json ts now
  json="$(tombstone_read)"
  ts="$(printf '%s' "$json" | jq --arg s "$slug" -r '.[$s] // empty')"
  [[ -z "$ts" ]] && { printf '%d' -1; return; }
  now="$(date +%s)"
  printf '%d' $(( now - ts ))
}

template_tombstone_read() {
  local file
  file="$(template_tombstones_file)"
  [[ -f "$file" ]] || { printf '{}'; return 0; }
  cat "$file"
}

template_tombstone_write() {
  local json="$1" file tmp
  file="$(template_tombstones_file)"
  ensure_state_dir
  tmp="$(mktemp -p "$(state_dir)")"
  printf '%s\n' "$json" > "$tmp"
  mv "$tmp" "$file"
}

_template_tombstone_mark_unlocked() {
  local db="$1" now json
  now="$(date +%s)"
  json="$(template_tombstone_read)"
  json="$(printf '%s' "$json" | jq --arg d "$db" --argjson t "$now" '. + {($d): $t}')"
  template_tombstone_write "$json"
}

_template_tombstone_forget_unlocked() {
  local db="$1" json
  json="$(template_tombstone_read)"
  json="$(printf '%s' "$json" | jq --arg d "$db" 'del(.[$d])')"
  template_tombstone_write "$json"
}

template_tombstone_forget() {
  ensure_state_dir
  (
    local lockfd
    exec {lockfd}>"$(state_dir)/gc.lock"
    flock "$lockfd"
    _template_tombstone_forget_unlocked "$@"
  )
}

template_tombstone_age() {
  local db="$1" json ts now
  json="$(template_tombstone_read)"
  ts="$(printf '%s' "$json" | jq --arg d "$db" -r '.[$d] // empty')"
  [[ -z "$ts" ]] && { printf '%d' -1; return; }
  now="$(date +%s)"
  printf '%d' $(( now - ts ))
}

allocation_read() {
  local file
  file="$(allocations_file)"
  [[ -f "$file" ]] || { printf '{}'; return 0; }
  cat "$file"
}

allocation_write() {
  local json="$1" file tmp
  file="$(allocations_file)"
  ensure_state_dir
  tmp="$(mktemp -p "$(state_dir)")"
  printf '%s\n' "$json" > "$tmp"
  mv "$tmp" "$file"
}

allocation_forget() {
  local slug="$1"
  ensure_state_dir
  (
    local lockfd json
    exec {lockfd}>"$(state_dir)/allocation.lock"
    flock "$lockfd"
    json="$(allocation_read)"
    json="$(printf '%s' "$json" | jq --arg s "$slug" 'del(.[$s])')"
    allocation_write "$json"
  )
}

allocate_resources() {
  local slug="$1" hash="$2" server_start="$3" client_start="$4"
  ensure_state_dir
  (
    local lockfd live_slugs json allocated_slug row server_reserved client_reserved redis_reserved_dbs
    local server_port client_port redis_db now
    exec {lockfd}>"$(state_dir)/allocation.lock"
    flock "$lockfd"

    live_slugs="$(list_live_slugs | sort -u)" \
      || die "git worktree list failed; refusing to allocate ports/Redis"
    json="$(allocation_read)"

    # Drop stale reservations for worktrees git no longer knows about.
    while IFS= read -r allocated_slug; do
      [[ -z "$allocated_slug" ]] && continue
      if ! printf '%s\n' "$live_slugs" | grep -qx "$allocated_slug"; then
        json="$(printf '%s' "$json" | jq --arg s "$allocated_slug" 'del(.[$s])')"
      fi
    done < <(printf '%s' "$json" | jq -r 'keys[]')

    if printf '%s' "$json" | jq -e --arg s "$slug" 'has($s)' >/dev/null; then
      row="$(printf '%s' "$json" | jq -r --arg s "$slug" '.[$s] | [.server, .client, .redis] | @tsv')"
      printf '%s\n' "$row"
      allocation_write "$json"
      return 0
    fi

    server_reserved="$(printf '%s' "$json" | jq -r --arg s "$slug" 'to_entries[] | select(.key != $s) | .value.server')"
    client_reserved="$(printf '%s' "$json" | jq -r --arg s "$slug" 'to_entries[] | select(.key != $s) | .value.client')"
    redis_reserved_dbs="$(printf '%s' "$json" | jq -r --arg s "$slug" 'to_entries[] | select(.key != $s) | .value.redis')"

    server_port="$(allocate_port_excluding "$SERVER_PORT_MIN" "$SERVER_PORT_MAX" "$server_start" "$server_reserved")"
    client_port="$(allocate_port_excluding "$CLIENT_PORT_MIN" "$CLIENT_PORT_MAX" "$client_start" "$client_reserved")"
    redis_db="$(allocate_redis_db_excluding "$hash" "$redis_reserved_dbs")"
    now="$(date +%s)"

    json="$(printf '%s' "$json" | jq \
      --arg s "$slug" \
      --argjson server "$server_port" \
      --argjson client "$client_port" \
      --argjson redis "$redis_db" \
      --argjson updated "$now" \
      '. + {($s): {server: $server, client: $client, redis: $redis, updatedAt: $updated}}')"
    allocation_write "$json"
    printf '%s\t%s\t%s\n' "$server_port" "$client_port" "$redis_db"
  )
}

cmd_gc() {
  local force=0 arg
  for arg in "$@"; do
    case "$arg" in
      --force) force=1 ;;
      *) die "unknown arg to gc: $arg" ;;
    esac
  done

  ensure_state_dir
  # Refresh schema proactively so a GC run with no forget-work-to-do still
  # picks up new meta tables added since this DB was first provisioned.
  # Without this, `worktree_clone` is created lazily inside
  # forget_worktree_fingerprint, which never runs when there are no orphans.
  ensure_meta_db

  # Serialize concurrent GCs with a non-blocking flock. A second caller
  # exits quietly rather than blocking.
  local lock lockfd
  lock="$(state_dir)/gc.lock"
  exec {lockfd}>"$lock"
  if ! flock -n "$lockfd"; then
    log "another gc is already running; exiting"
    return 0
  fi

  local grace="${MUSI_WT_GRACE:-$DEFAULT_GRACE_SECONDS}"
  if (( force )); then grace=0; fi

  # Collect live slugs (from git worktree list). Fail loudly on git errors:
  # silently falling back to "no live worktrees" would mark every DB orphan
  # and start the grace clock on slugs that are actually in use.
  local live_slugs
  live_slugs="$(list_live_slugs | sort -u)" \
    || die "git worktree list failed; refusing to GC with an empty live set"

  # Collect orphan slugs from DB listing.
  local dbs db slug age
  dbs="$(list_worktree_dbs || true)"

  # Pass 1: mark tombstones for slugs whose worktree is gone but aren't yet tracked.
  declare -A seen_slugs=()
  while IFS= read -r db; do
    [[ -z "$db" ]] && continue
    slug="$(slug_from_dbname "$db")"
    [[ -n "${seen_slugs[$slug]:-}" ]] && continue
    seen_slugs[$slug]=1
    if ! printf '%s\n' "$live_slugs" | grep -qx "$slug"; then
      age="$(tombstone_age "$slug")"
      if [[ "$age" == "-1" ]]; then
        log "tombstoning orphan slug $slug"
        _tombstone_mark_unlocked "$slug"
      fi
    else
      # Live worktree — clear any stale tombstone.
      _tombstone_forget_unlocked "$slug" >/dev/null 2>&1 || true
    fi
  done <<< "$dbs"

  # Pass 2: drop DBs whose tombstone age ≥ grace.
  while IFS= read -r db; do
    [[ -z "$db" ]] && continue
    slug="$(slug_from_dbname "$db")"
    if printf '%s\n' "$live_slugs" | grep -qx "$slug"; then continue; fi
    age="$(tombstone_age "$slug")"
    if [[ "$age" == "-1" ]]; then
      # Not yet tombstoned (shouldn't happen after pass 1) — skip.
      continue
    fi
    if (( age >= grace )); then
      drop_db "$db"
    else
      log "keeping $db (tombstone age ${age}s < grace ${grace}s)"
    fi
  done <<< "$dbs"

  # Clean up tombstones + per-slug clone fingerprints for slugs whose DBs no
  # longer exist. Re-query the DB list because pass 2 may have just dropped
  # some of them.
  local current_dbs json all_dead_slugs=""
  current_dbs="$(list_worktree_dbs || true)"
  json="$(tombstone_read)"
  while IFS= read -r slug; do
    [[ -z "$slug" ]] && continue
    if ! dbset_has_worktree_slug "$current_dbs" "$slug"; then
      all_dead_slugs+="$slug"$'\n'
    fi
  done < <(printf '%s' "$json" | jq -r 'keys[]')
  while IFS= read -r slug; do
    [[ -z "$slug" ]] && continue
    _tombstone_forget_unlocked "$slug"
    forget_worktree_fingerprint "$slug"
    allocation_forget "$slug"
  done <<< "$all_dead_slugs"

  # Fingerprinted template DBs are shared by worktrees with matching
  # Prisma/seed inputs. Tombstone and eventually drop templates that no live
  # worktree would currently use. The legacy `musi_template` name is excluded
  # by list_template_dbs/validate_template_db_name and left untouched.
  local live_template_dbs template_dbs template_db template_age
  live_template_dbs="$(list_live_template_dbs | sort -u)" \
    || die "git worktree list failed; refusing to GC templates with an empty live set"
  template_dbs="$(list_template_dbs || true)"
  while IFS= read -r template_db; do
    [[ -z "$template_db" ]] && continue
    if ! printf '%s\n' "$live_template_dbs" | grep -qx "$template_db"; then
      template_age="$(template_tombstone_age "$template_db")"
      if [[ "$template_age" == "-1" ]]; then
        log "tombstoning orphan template $template_db"
        _template_tombstone_mark_unlocked "$template_db"
      fi
    else
      _template_tombstone_forget_unlocked "$template_db" >/dev/null 2>&1 || true
    fi
  done <<< "$template_dbs"

  while IFS= read -r template_db; do
    [[ -z "$template_db" ]] && continue
    if printf '%s\n' "$live_template_dbs" | grep -qx "$template_db"; then continue; fi
    template_age="$(template_tombstone_age "$template_db")"
    if [[ "$template_age" == "-1" ]]; then continue; fi
    if (( template_age >= grace )); then
      drop_template_db "$template_db"
    else
      log "keeping $template_db (tombstone age ${template_age}s < grace ${grace}s)"
    fi
  done <<< "$template_dbs"

  local current_template_dbs template_json dead_template_dbs=""
  current_template_dbs="$(list_template_dbs || true)"
  template_json="$(template_tombstone_read)"
  while IFS= read -r template_db; do
    [[ -z "$template_db" ]] && continue
    if ! printf '%s\n' "$current_template_dbs" | grep -qx "$template_db"; then
      dead_template_dbs+="$template_db"$'\n'
    fi
  done < <(printf '%s' "$template_json" | jq -r 'keys[]')
  while IFS= read -r template_db; do
    [[ -z "$template_db" ]] && continue
    _template_tombstone_forget_unlocked "$template_db"
  done <<< "$dead_template_dbs"

  flock -u "$lockfd"
  exec {lockfd}>&-
}

# ============================================================================
# Dispatch
# ============================================================================

main() {
  require_cmd git jq ss flock sha1sum sha256sum bun
  local sub="${1:-}"
  [[ -z "$sub" ]] && die "usage: worktree-db.sh {slug|init|drop|gc|status|template-refresh|refresh-data}"
  shift
  case "$sub" in
    slug)              compute_slug; printf '\n' ;;
    init)              cmd_init "$@" ;;
    drop)              cmd_drop "$@" ;;
    gc)                cmd_gc "$@" ;;
    status)            cmd_status "$@" ;;
    template-refresh)  template_refresh "$@" ;;
    refresh-data)      cmd_refresh_data "$@" ;;
    *) die "unknown subcommand: $sub" ;;
  esac
}

# Skip main when sourced (e.g. by scripts/test-worktree-db.sh) so tests can
# exercise pure helpers without invoking a subcommand.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
