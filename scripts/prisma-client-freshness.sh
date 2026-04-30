#!/bin/bash
# Shared Prisma generated-client freshness checks.

musi_prisma_client_freshness() {
  local repo_root="$1"
  local schema="$repo_root/packages/server/prisma/schema.prisma"
  local client="$repo_root/packages/server/src/generated/prisma"

  if [ ! -d "$client" ]; then
    printf "missing\tPrisma client not generated - run 'bun run --filter @musi/server prisma:generate'"
  elif [ "$schema" -nt "$client" ]; then
    printf "stale\tschema.prisma newer than generated client - run 'bun run --filter @musi/server prisma:generate'"
  else
    printf "fresh\tPrisma client up to date"
  fi
}
