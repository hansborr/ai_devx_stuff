import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const DEFAULT_TEST_DATABASE_NAME = "musi_test";
const WORKER_ID_PATTERN = /^[1-9]\d*$/;
const REGISTRY_HASH_LENGTH = 16;
const WORKER_KEY_PATTERN = /^[a-z0-9]{1,2}$/;

// 6 workers on an 8-core box. Raising the cap from 4 to 6 cut the server vitest
// project from ~134s to ~50s (measured in isolation). 8 is within noise of 6 in
// isolation (~46s vs ~50s), so the extra two workers buy nothing on their own —
// and the test step runs concurrently with the other parallel verify/pre-commit
// steps (lint, typecheck, ratchet, the client test workers, …) on the same 8
// cores, so capping at 6 leaves headroom instead of oversubscribing the box.
// Each worker gets its own postgres DB (musi_*_w<n>); at SERVER_TEST_POOL_MAX=5
// that is 6*5=30 connections, well under postgres' default 100 ceiling.
export const SERVER_TEST_MAX_WORKERS = 6;
export const SERVER_TEST_POOL_MAX = 5;

// Two characters covers SERVER_TEST_MAX_WORKERS and keeps
// `musi_wt_<49-byte slug>_w<key>` under Postgres' 63-byte identifier limit.
const WORKER_KEY_MAX_LENGTH = 2;

export function getBaseTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const testDatabaseUrl = env["TEST_DATABASE_URL"];
  if (testDatabaseUrl) return testDatabaseUrl;

  const databaseUrl = env["DATABASE_URL"];
  if (databaseUrl) {
    return databaseUrl.replace(/\/[^/]+$/, `/${DEFAULT_TEST_DATABASE_NAME}`);
  }

  throw new Error(
    "Neither TEST_DATABASE_URL nor DATABASE_URL is set. " +
      "Add TEST_DATABASE_URL to your .env file (e.g. postgresql://postgres:ThisIsNotTheRealDatabasePassword@db:5432/musi_test).",
  );
}

export function getVitestWorkerKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const poolId = parseWorkerId(env["VITEST_POOL_ID"]);
  if (poolId === null) return null;
  return String(poolId);
}

export function getWorkerTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const baseUrl = getBaseTestDatabaseUrl(env);
  const workerKey = getVitestWorkerKey(env);
  if (workerKey === null) return baseUrl;
  return deriveWorkerTestDatabaseUrl(baseUrl, workerKey);
}

export function deriveWorkerTestDatabaseUrl(baseUrl: string, workerKey: string): string {
  assertWorkerKey(workerKey);

  const parsed = new URL(baseUrl);
  const databaseName = databaseNameFromUrl(parsed);
  parsed.pathname = `/${deriveWorkerTestDatabaseName(databaseName, workerKey)}`;
  return parsed.toString();
}

export function databaseNameFromUrl(url: URL): string {
  const databaseName = decodeURIComponent(url.pathname).replace(/^\//, "");
  if (!databaseName) throw new Error(`Database URL is missing a database name: ${url.toString()}`);
  return databaseName;
}

export function workerDatabaseRegistryPath(baseUrl: string): string {
  const key = createHash("sha256").update(baseUrl).digest("hex").slice(0, REGISTRY_HASH_LENGTH);
  return resolve(tmpdir(), `musi-server-test-dbs-${key}.txt`);
}

function parseWorkerId(value: string | undefined): number | null {
  if (!value || !WORKER_ID_PATTERN.test(value)) return null;
  return Number(value);
}

function assertWorkerKey(value: string): void {
  if (!WORKER_KEY_PATTERN.test(value)) {
    throw new Error(
      `Invalid Vitest worker database key ${value}; expected 1-${String(
        WORKER_KEY_MAX_LENGTH,
      )} lowercase alphanumeric characters.`,
    );
  }
}

function deriveWorkerTestDatabaseName(databaseName: string, workerKey: string): string {
  const worktreeSlug = worktreeTestDatabaseSlug(databaseName);
  if (worktreeSlug !== null) return `musi_wt_${worktreeSlug}_w${workerKey}`;
  return `${databaseName}_w${workerKey}`;
}

function worktreeTestDatabaseSlug(databaseName: string): string | null {
  const prefix = "musi_wt_";
  const suffix = "_test";
  if (!databaseName.startsWith(prefix) || !databaseName.endsWith(suffix)) return null;
  const slug = databaseName.slice(prefix.length, -suffix.length);
  if (!/^[a-z0-9_]+$/.test(slug)) return null;
  return slug;
}
