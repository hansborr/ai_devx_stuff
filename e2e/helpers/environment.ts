import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SERVER_PORT = 8001;
const DEFAULT_CLIENT_PORT = 8000;
const MAX_PORT = 65_535;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function gitPath(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function isSecondaryWorktree(): boolean {
  const commonDir = gitPath(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const gitDir = gitPath(["rev-parse", "--path-format=absolute", "--git-dir"]);
  return commonDir !== null && gitDir !== null && commonDir !== gitDir;
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

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};

  const values: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\n/u)) {
    const line = rawLine.trim().replace(/\r$/u, "");
    if (!line || line.startsWith("#")) continue;

    const assignment = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separator = assignment.indexOf("=");
    if (separator <= 0) continue;

    const key = assignment.slice(0, separator).trim();
    if (!/^[A-Za-z_]\w*$/u.test(key)) continue;
    values[key] = unquoteEnvValue(assignment.slice(separator + 1).trim());
  }
  return values;
}

/** Load generated worktree values without overriding explicitly exported values. */
export function loadE2eEnvironment(): void {
  const fileValues = {
    ...readEnvFile(join(REPO_ROOT, ".env")),
    ...readEnvFile(join(REPO_ROOT, "packages/client/.env")),
  };

  for (const [key, value] of Object.entries(fileValues)) {
    if (!process.env[key]?.trim()) process.env[key] = value;
  }
}

function parsePort(rawPort: string, source: string): number {
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > MAX_PORT) {
    throw new Error(`${source} must be an integer between 1 and 65535; received ${rawPort}.`);
  }
  return port;
}

function missingPortError(keys: string, envFile: string): Error {
  return new Error(
    `${keys} was not exported and no allocated port was found in ${envFile}; run \`bun run worktree:init\` to provision this secondary worktree.`,
  );
}

export function resolveServerPort(): number {
  loadE2eEnvironment();
  const serverPort = process.env["SERVER_PORT"]?.trim();
  if (serverPort) return parsePort(serverPort, "SERVER_PORT");
  if (isSecondaryWorktree()) throw missingPortError("SERVER_PORT", ".env");
  return DEFAULT_SERVER_PORT;
}

export function resolveClientPort(): number {
  loadE2eEnvironment();
  // Shared by Playwright's page/webServer config and browser-origin API
  // helpers so both resolve the identical normalized port. Explicit
  // CLIENT_PORT wins, followed by the generated client env allocation.
  const clientPort = process.env["CLIENT_PORT"]?.trim();
  if (clientPort) return parsePort(clientPort, "CLIENT_PORT");

  const viteDevPort = process.env["VITE_DEV_PORT"]?.trim();
  if (viteDevPort) return parsePort(viteDevPort, "VITE_DEV_PORT");
  if (isSecondaryWorktree()) {
    throw missingPortError("CLIENT_PORT or VITE_DEV_PORT", "packages/client/.env");
  }
  return DEFAULT_CLIENT_PORT;
}

export function resolveServerBaseUrl(): string {
  loadE2eEnvironment();
  const explicitUrl = process.env["E2E_SERVER_URL"]?.trim();
  return explicitUrl || `http://localhost:${String(resolveServerPort())}`;
}

export function resolveClientBaseUrl(): string {
  return `http://localhost:${String(resolveClientPort())}`;
}
