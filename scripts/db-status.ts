/* Quick DB diagnostics. Run via: bun run db:status */
import { prisma } from "../packages/server/src/prisma/client.ts";

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

type ResolvedE2eDatabase = {
  source: string;
  url: string | undefined;
};

function derivedE2eUrl(databaseUrl: string | undefined): string | undefined {
  if (!databaseUrl) return undefined;
  try {
    const u = new URL(databaseUrl);
    u.pathname = "/musi_test_e2e";
    return u.toString();
  } catch {
    return databaseUrl.replace(/\/[^/]+$/, "/musi_test_e2e");
  }
}

function resolveE2eDatabase(
  e2e: string | undefined,
  test: string | undefined,
  dev: string | undefined,
): ResolvedE2eDatabase {
  if (e2e) return { source: "E2E_DATABASE_URL", url: e2e };
  if (test) return { source: "TEST_DATABASE_URL fallback", url: test };
  return { source: "DATABASE_URL-derived fallback", url: derivedE2eUrl(dev) };
}

async function main(): Promise<void> {
  const dev = process.env["DATABASE_URL"];
  const test = process.env["TEST_DATABASE_URL"];
  const e2e = resolveE2eDatabase(process.env["E2E_DATABASE_URL"], test, dev);
  const redis = process.env["REDIS_URL"];
  const serverPort = process.env["SERVER_PORT"];
  const viteDevPort = process.env["VITE_DEV_PORT"];
  const corsOrigin = process.env["CORS_ORIGIN"];

  console.log(`INFO: dev DB:    ${dbName(dev)} (${maskUrl(dev)})`);
  console.log(`INFO: test DB:   ${dbName(test)} (${maskUrl(test)})`);
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
    console.error("FAIL: cannot connect —", (err as Error).message);
    process.exit(1);
  }

  const speciesCount = await prisma.species.count().catch(() => -1);
  if (speciesCount > 0) {
    console.log(`OK  : SRD seed present (Species rows: ${speciesCount})`);
  } else if (speciesCount === 0) {
    console.warn("WARN: SRD seed is empty — run 'bun run --filter @musi/server db:seed'");
  } else {
    console.warn("WARN: could not query Species — schema may not be migrated");
  }

  await prisma.$disconnect();
}

void main();
