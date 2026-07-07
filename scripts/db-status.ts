/* Quick DB diagnostics. Run via: bun run db:status */
import { prisma } from "../packages/server/src/prisma/client.js";
import { DEFAULT_TEST_DATABASE_NAME } from "../packages/server/src/test/test-database-url.js";

function maskUrl(raw: string | undefined): string {
  if (!raw) return "<unset>";
  try {
    const u = new URL(raw);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<invalid>";
  }
}

function dbName(raw: string | undefined): string {
  if (!raw) return "<unset>";
  try {
    const u = new URL(raw);
    return u.pathname.replace(/^\//, "") || "<empty>";
  } catch {
    return "<invalid>";
  }
}

function clientPort(corsOrigin: string | undefined): string | undefined {
  if (!corsOrigin) return undefined;
  try {
    return new URL(corsOrigin).port || undefined;
  } catch {
    return undefined;
  }
}

type ResolvedDatabase = {
  source: string;
  url: string | undefined;
};

function derivedUrl(databaseUrl: string | undefined, name: string): string | undefined {
  if (!databaseUrl) return undefined;
  try {
    const u = new URL(databaseUrl);
    u.pathname = `/${name}`;
    return u.toString();
  } catch {
    return databaseUrl.replace(/\/[^/]+$/, `/${name}`);
  }
}

// Mirror the vitest/Playwright harness (packages/server/src/test/test-database-url.ts):
// TEST_DATABASE_URL takes precedence, otherwise it derives the base test DB from
// DATABASE_URL by swapping the database name to `musi_test`. db-status.ts must
// resolve the same way, or the presence check below reports the test DB present
// while the database the harness will actually use is missing.
function resolveTestDatabase(test: string | undefined, dev: string | undefined): ResolvedDatabase {
  if (test) return { source: "TEST_DATABASE_URL", url: test };
  return {
    source: "DATABASE_URL-derived fallback",
    url: derivedUrl(dev, DEFAULT_TEST_DATABASE_NAME),
  };
}

function resolveE2eDatabase(
  e2e: string | undefined,
  test: string | undefined,
  dev: string | undefined,
): ResolvedDatabase {
  if (e2e) return { source: "E2E_DATABASE_URL", url: e2e };
  if (test) return { source: "TEST_DATABASE_URL fallback", url: test };
  return {
    source: "DATABASE_URL-derived fallback",
    url: derivedUrl(dev, `${DEFAULT_TEST_DATABASE_NAME}_e2e`),
  };
}

// Verify the test/e2e databases the vitest/Playwright harnesses assume exist.
// pg_database is a cluster-wide catalog visible from the dev-DB connection we
// already hold, so a single read confirms presence without a postgres-client
// CLI. On a fresh volume the initdb hook has been seen to leave these absent;
// .devcontainer/post-create.sh provisions them.
async function reportTestDatabasesPresent(
  test: string | undefined,
  e2eUrl: string | undefined,
): Promise<void> {
  const expected = [...new Set([dbName(test), dbName(e2eUrl)])].filter(
    (name) => !name.startsWith("<"),
  );
  if (expected.length === 0) return;
  try {
    const rows = await prisma.$queryRaw<{ datname: string }[]>`SELECT datname FROM pg_database`;
    const present = new Set(rows.map((r) => r.datname));
    const missing = expected.filter((name) => !present.has(name));
    if (missing.length === 0) {
      console.log(`OK  : test/e2e databases present (${expected.join(", ")})`);
    } else {
      console.warn(
        `WARN: missing test database(s): ${missing.join(", ")} — provision with .devcontainer/post-create.sh`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("WARN: could not enumerate databases —", message);
  }
}

async function main(): Promise<void> {
  const dev = process.env["DATABASE_URL"];
  const rawTest = process.env["TEST_DATABASE_URL"];
  const test = resolveTestDatabase(rawTest, dev);
  // e2e falls back to the raw TEST_DATABASE_URL (not the derived test URL),
  // matching the harness's E2E_DATABASE_URL ?? TEST_DATABASE_URL precedence.
  const e2e = resolveE2eDatabase(process.env["E2E_DATABASE_URL"], rawTest, dev);
  const redis = process.env["REDIS_URL"];
  const serverPort = process.env["SERVER_PORT"];
  const viteDevPort = process.env["VITE_DEV_PORT"];
  const corsOrigin = process.env["CORS_ORIGIN"];

  console.log(`INFO: dev DB:    ${dbName(dev)} (${maskUrl(dev)})`);
  console.log(`INFO: test DB:   ${dbName(test.url)} (${maskUrl(test.url)}, ${test.source})`);
  console.log(`INFO: e2e DB:    ${dbName(e2e.url)} (${maskUrl(e2e.url)}, ${e2e.source})`);
  if (e2e.source === "TEST_DATABASE_URL fallback") {
    console.warn(
      "WARN: e2e uses TEST_DATABASE_URL — set E2E_DATABASE_URL to isolate Playwright data",
    );
  }
  console.log(`INFO: redis URL: ${maskUrl(redis)}`);
  console.log(`INFO: server port: ${serverPort ?? "<default>"}`);
  console.log(`INFO: client port: ${viteDevPort ?? clientPort(corsOrigin) ?? "<default>"}`);

  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log("OK  : connected to database");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("FAIL: cannot connect —", message);
    process.exit(1);
  }

  await reportTestDatabasesPresent(test.url, e2e.url);

  const speciesCount = await prisma.species.count().catch(() => -1);
  if (speciesCount > 0) {
    console.log(`OK  : SRD seed present (Species rows: ${String(speciesCount)})`);
  } else if (speciesCount === 0) {
    console.warn("WARN: SRD seed is empty — run 'bun run --filter @musi/server db:seed'");
  } else {
    console.warn("WARN: could not query Species — schema may not be migrated");
  }

  await prisma.$disconnect();
}

void main();
