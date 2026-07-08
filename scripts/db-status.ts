/* Quick DB diagnostics. Run via: bun run db:status */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { prisma as prismaSingleton } from "../packages/server/src/prisma/client.js";
import { DEFAULT_TEST_DATABASE_NAME } from "../packages/server/src/test/test-database-url.js";

type PrismaSingleton = typeof prismaSingleton;

const MIGRATION_STATUS_TAIL_LINES = 10;
const MIGRATION_UNCLEAR_TAIL_LINES = 5;

type RepoContext = {
  repoRoot: string;
  primaryRoot: string;
  worktreeLabel: "primary" | "secondary";
};

type CommandResult = {
  status: number;
  output: string;
};

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

function commandOutput(command: string, args: readonly string[], cwd?: string): CommandResult {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
  });

  return {
    status: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`,
  };
}

function gitOutput(args: readonly string[], cwd?: string): string {
  const result = commandOutput("git", args, cwd);
  if (result.status !== 0) {
    throw new Error(result.output.trim() || `git ${args.join(" ")} failed`);
  }
  return result.output.trim();
}

function resolveGitPath(repoRoot: string, path: string): string {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

function repoContext(): RepoContext {
  const repoRoot = realpathSync(gitOutput(["rev-parse", "--show-toplevel"]));
  const gitCommonDir = realpathSync(
    resolveGitPath(repoRoot, gitOutput(["rev-parse", "--git-common-dir"])),
  );
  const gitDir = realpathSync(resolveGitPath(repoRoot, gitOutput(["rev-parse", "--git-dir"])));
  return {
    repoRoot,
    primaryRoot: realpathSync(dirname(gitCommonDir)),
    worktreeLabel: gitCommonDir === gitDir ? "primary" : "secondary",
  };
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\n/u)) {
    const line = rawLine.trim().replace(/\r$/u, "");
    if (!line || line.startsWith("#")) continue;
    const assignment = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separator = assignment.indexOf("=");
    if (separator <= 0) continue;
    const key = assignment.slice(0, separator).trim();
    if (!/^[A-Za-z_]\w*$/u.test(key)) continue;
    process.env[key] = unquoteEnvValue(assignment.slice(separator + 1).trim());
  }
}

function loadWorktreeEnv(context: RepoContext): void {
  for (const envFile of [
    join(context.primaryRoot, ".devcontainer/.env"),
    join(context.repoRoot, ".env"),
    join(context.repoRoot, "packages/client/.env"),
  ]) {
    loadEnvFile(envFile);
  }
}

function reportWorktreeContext(context: RepoContext): void {
  console.log(`INFO: worktree=${context.repoRoot} (${context.worktreeLabel})`);
  if (context.repoRoot === context.primaryRoot) return;
  console.log(`INFO: primary=${context.primaryRoot}`);
  if (!existsSync(join(context.repoRoot, ".env"))) {
    console.warn(
      `WARN: no ${context.repoRoot}/.env — using primary devcontainer DATABASE_URL; run 'bun run worktree:init' to provision this worktree`,
    );
  }
}

function lastLines(text: string, count: number): string[] {
  const lines = text.trimEnd().split(/\n/u);
  return lines.slice(-count);
}

function reportMigrationStatus(repoRoot: string): boolean {
  const result = commandOutput(
    "bun",
    ["x", "prisma", "migrate", "status"],
    join(repoRoot, "packages/server"),
  );
  const status = result.output;

  if (status.includes("Database schema is up to date")) {
    console.log("OK  : migrations up to date");
    return true;
  }

  if (status.includes("have not yet been applied")) {
    const pending = status.match(/^[ \t]*\d{14}_/gmu)?.length ?? 0;
    console.warn(
      `WARN: ${String(pending)} pending migration(s) — run 'bun run --filter @musi/server db:migrate'`,
    );
    return true;
  }

  if (/can't reach|connection.*refused|authentication/iu.test(status)) {
    console.error("FAIL: database not reachable — see output below:");
    for (const line of lastLines(status, MIGRATION_STATUS_TAIL_LINES)) {
      console.error(line);
    }
    return false;
  }

  console.warn("WARN: migrate status unclear; last lines:");
  for (const line of lastLines(status, MIGRATION_UNCLEAR_TAIL_LINES)) {
    console.warn(line);
  }
  return true;
}

// Verify the test/e2e databases the vitest/Playwright harnesses assume exist.
// pg_database is a cluster-wide catalog visible from the dev-DB connection we
// already hold, so a single read confirms presence without a postgres-client
// CLI. On a fresh volume the initdb hook has been seen to leave these absent;
// .devcontainer/post-create.sh provisions them.
async function reportTestDatabasesPresent(
  prisma: PrismaSingleton,
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

async function reportRuntimeDatabaseStatus(prisma: PrismaSingleton): Promise<boolean> {
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
    return false;
  }

  await reportTestDatabasesPresent(prisma, test.url, e2e.url);

  const speciesCount = await prisma.species.count().catch(() => -1);
  if (speciesCount > 0) {
    console.log(`OK  : SRD seed present (Species rows: ${String(speciesCount)})`);
  } else if (speciesCount === 0) {
    console.warn("WARN: SRD seed is empty — run 'bun run --filter @musi/server db:seed'");
  } else {
    console.warn("WARN: could not query Species — schema may not be migrated");
  }

  return true;
}

function reportPrismaClientFreshness(repoRoot: string): void {
  const schema = join(repoRoot, "packages/server/prisma/schema.prisma");
  const client = join(repoRoot, "packages/server/src/generated/prisma");

  if (!existsSync(client)) {
    console.warn(
      "WARN: Prisma client not generated - run 'bun run --filter @musi/server prisma:generate'",
    );
    return;
  }

  if (statSync(schema).mtimeMs > statSync(client).mtimeMs) {
    console.warn(
      "WARN: schema.prisma newer than generated client - run 'bun run --filter @musi/server prisma:generate'",
    );
    return;
  }

  console.log("OK  : Prisma client up to date");
}

async function main(): Promise<void> {
  const context = repoContext();
  loadWorktreeEnv(context);
  reportWorktreeContext(context);

  if (!reportMigrationStatus(context.repoRoot)) {
    process.exit(1);
  }

  const { prisma } = await import("../packages/server/src/prisma/client.js");
  let runtimeOk: boolean;
  try {
    runtimeOk = await reportRuntimeDatabaseStatus(prisma);
  } finally {
    await prisma.$disconnect();
  }

  if (!runtimeOk) {
    process.exit(1);
  }

  reportPrismaClientFreshness(context.repoRoot);
}

if (import.meta.main) {
  void main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("FAIL: db status crashed —", message);
    process.exit(1);
  });
}
