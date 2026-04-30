#!/bin/bash
# One-shot DB diagnostic: env config, connectivity, migrations, seed,
# Prisma client freshness. Worktree-aware — derives the repo root via
# `git rev-parse --show-toplevel` and loads that worktree's `.env`, so
# secondary worktrees report against their own clone DBs instead of the
# primary `musi` DB.
set -u

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "FAIL: not inside a git repository" >&2
  exit 1
}
PRIMARY_ROOT="$(cd "$(git rev-parse --git-common-dir)/.." && pwd -P)"

GIT_COMMON_DIR="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"
GIT_DIR="$(cd "$(git rev-parse --git-dir)" && pwd -P)"
if [[ "$GIT_COMMON_DIR" == "$GIT_DIR" ]]; then
  WT_LABEL="primary"
else
  WT_LABEL="secondary"
fi

# Load admin creds first (devcontainer), then per-worktree `.env` files so
# their values override. The worktree `.env` is written by `worktree:init`
# and is the source of truth for DATABASE_URL/REDIS_URL/SERVER_PORT in
# secondaries; the primary worktree typically has none of those set there
# and falls back to the devcontainer values.
for env_file in \
  "$PRIMARY_ROOT/.devcontainer/.env" \
  "$REPO_ROOT/.env" \
  "$REPO_ROOT/packages/client/.env"; do
  if [ -f "$env_file" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$env_file"
    set +a
  fi
done

# shellcheck source=/dev/null
. "$REPO_ROOT/scripts/prisma-client-freshness.sh"

echo "INFO: worktree=$REPO_ROOT ($WT_LABEL)"
if [[ "$REPO_ROOT" != "$PRIMARY_ROOT" ]]; then
  echo "INFO: primary=$PRIMARY_ROOT"
  if [ ! -f "$REPO_ROOT/.env" ]; then
    # Without a worktree .env, DATABASE_URL falls back to the primary
    # devcontainer creds and points at the primary `musi` DB — which is
    # almost never what the user wanted from a secondary worktree.
    echo "WARN: no $REPO_ROOT/.env — using primary devcontainer DATABASE_URL; run 'bun run worktree:init' to provision this worktree" >&2
  fi
fi

# --- Migrations (also validates connectivity) ---
cd "$REPO_ROOT/packages/server"
STATUS=$(bun x prisma migrate status 2>&1 || true)
if echo "$STATUS" | grep -q "Database schema is up to date"; then
  echo "OK  : migrations up to date"
elif echo "$STATUS" | grep -q "have not yet been applied"; then
  PENDING=$(echo "$STATUS" | grep -cE '^[[:space:]]*[0-9]{14}_' || true)
  echo "WARN: $PENDING pending migration(s) — run 'bun run --filter @musi/server db:migrate'" >&2
elif echo "$STATUS" | grep -qiE "can't reach|connection.*refused|authentication"; then
  echo "FAIL: database not reachable — see output below:" >&2
  echo "$STATUS" | tail -10 >&2
  exit 1
else
  echo "WARN: migrate status unclear; last lines:" >&2
  echo "$STATUS" | tail -5 >&2
fi

# --- Env diagnostics + connectivity + SRD seed ---
cd "$REPO_ROOT"
bun run scripts/db-status.ts

# --- Prisma client freshness ---
PRISMA_FRESHNESS="$(musi_prisma_client_freshness "$REPO_ROOT")"
PRISMA_STATUS="${PRISMA_FRESHNESS%%$'\t'*}"
PRISMA_MESSAGE="${PRISMA_FRESHNESS#*$'\t'}"
if [ "$PRISMA_STATUS" = "fresh" ]; then
  echo "OK  : $PRISMA_MESSAGE"
else
  echo "WARN: $PRISMA_MESSAGE" >&2
fi
