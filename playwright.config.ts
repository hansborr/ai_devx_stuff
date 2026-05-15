import { defineConfig } from "@playwright/test";

const DEFAULT_SERVER_PORT = 8001;
const DEFAULT_CLIENT_PORT = 8000;

const SERVER_PORT = Number(process.env["SERVER_PORT"] ?? DEFAULT_SERVER_PORT);
// CLIENT_PORT wins over VITE_DEV_PORT when both are set. In practice
// worktree-db.sh only writes VITE_DEV_PORT (in packages/client/.env); the
// CLIENT_PORT branch is here for callers that export it explicitly (CI,
// local overrides) and should take precedence over the Vite-facing var.
const CLIENT_PORT = Number(
  process.env["CLIENT_PORT"] ?? process.env["VITE_DEV_PORT"] ?? DEFAULT_CLIENT_PORT,
);
const VITE_DEV_PORT = String(CLIENT_PORT);
const VITE_API_URL = process.env["VITE_API_URL"] ?? `http://localhost:${String(SERVER_PORT)}`;

const testDbUrl =
  process.env["E2E_DATABASE_URL"] ??
  process.env["TEST_DATABASE_URL"] ??
  process.env["DATABASE_URL"]?.replace(/\/[^/]+$/, "/musi_test_e2e") ??
  "";

export default defineConfig({
  globalSetup: "./e2e/global-setup.ts",
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: 4,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${String(CLIENT_PORT)}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "setup",
      testMatch: /storage\.setup\.ts/,
    },
    {
      name: "e2e",
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: "bun run --filter @musi/server dev",
      url: `http://127.0.0.1:${String(SERVER_PORT)}/trpc/health.check`,
      reuseExistingServer: !process.env["CI"],
      timeout: 30_000,
      env: {
        E2E_TEST: "true",
        DISABLE_RATE_LIMIT: "true",
        DATABASE_URL: testDbUrl,
        SERVER_PORT: String(SERVER_PORT),
        CLIENT_PORT: String(CLIENT_PORT),
        VITE_DEV_PORT,
        VITE_API_URL,
      },
    },
    {
      command: "bun run --filter @musi/client dev",
      url: `http://127.0.0.1:${String(CLIENT_PORT)}`,
      reuseExistingServer: !process.env["CI"],
      timeout: 30_000,
      env: {
        SERVER_PORT: String(SERVER_PORT),
        CLIENT_PORT: String(CLIENT_PORT),
        VITE_DEV_PORT,
        VITE_API_URL,
      },
    },
  ],
});
