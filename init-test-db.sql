-- Create test databases used by vitest (musi_test) and Playwright E2E (musi_test_e2e).
-- This script runs automatically on first container creation via
-- the postgres /docker-entrypoint-initdb.d/ mechanism.
SELECT 'CREATE DATABASE musi_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'musi_test')\gexec

SELECT 'CREATE DATABASE musi_test_e2e'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'musi_test_e2e')\gexec
