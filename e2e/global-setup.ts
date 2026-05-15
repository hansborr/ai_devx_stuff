/**
 * Playwright global setup — runs once before all E2E tests.
 *
 * Builds the test schema from migrations and seeds SRD + test users. Both
 * steps are skipped when the DB is already in the expected state, so
 * reruns against a warm DB pay near-zero cost.
 */
import { seedSrd } from "../packages/server/src/seed/seed-srd.js";
import { seedUsers } from "../packages/server/src/seed/seed-users.js";
import { prepareTestDb } from "../packages/server/src/test/prepare-test-db.js";

function getTestDatabaseUrl(): string {
  if (process.env["E2E_DATABASE_URL"]) {
    return process.env["E2E_DATABASE_URL"];
  }
  if (process.env["TEST_DATABASE_URL"]) {
    return process.env["TEST_DATABASE_URL"];
  }
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl) {
    return databaseUrl.replace(/\/[^/]+$/, "/musi_test_e2e");
  }
  throw new Error(
    "Neither E2E_DATABASE_URL, TEST_DATABASE_URL, nor DATABASE_URL is set. " +
      "Add E2E_DATABASE_URL to your .env file.",
  );
}

export default async function globalSetup(): Promise<void> {
  await prepareTestDb({
    dbUrl: getTestDatabaseUrl(),
    seed: async (prisma) => {
      await seedUsers(prisma);
      await seedSrd(prisma);
    },
  });
}
