-- Create test databases used by vitest (musi_test) and Playwright E2E (musi_test_e2e).
-- This script runs automatically via the postgres
-- /docker-entrypoint-initdb.d/ mechanism — but ONLY on first init of an EMPTY
-- data volume. A volume that was already initialized (PG_VERSION present) skips
-- it entirely, so it is not a reliable provisioning path on its own.
-- Both Compose stacks mount this one file — keep it single-sourced.
-- The devcontainer covers the skipped-hook gap with a self-healing fallback:
-- .devcontainer/post-create.sh re-creates these databases idempotently on every
-- container create. The root stack runs no such fallback, so create them by
-- hand (or recreate the volume) if this hook did not fire.
SELECT 'CREATE DATABASE musi_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'musi_test')\gexec

SELECT 'CREATE DATABASE musi_test_e2e'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'musi_test_e2e')\gexec
