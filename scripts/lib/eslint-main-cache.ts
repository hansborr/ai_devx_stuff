// Typed owner for the main ESLint cache identity and argument plan. Both the
// partitioned shell runner and lint-agent consume this module so discovery,
// hashing, pruning, partition validation, and location spelling cannot drift.

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

import { PROCESS_ARGV_USER_ARGS_START } from "./process-argv.js";

const DEFAULT_CACHE_ROOT = "node_modules/.cache/eslint-main";
const IDENTITY_DIRECTORY_PREFIX = "identity-";
const SHELL_RECORD_COMMAND = "--shell-records";
const SHELL_RECORD_MAGIC = "musi-eslint-cache-plan-v1";
const DOT_SLASH_LENGTH = 2;
const ROOT_PRUNED_PATHS = new Set([
  "./.git",
  "./.auth",
  "./.playwright-mcp",
  "./.stryker-tmp",
  "./.tools",
  "./coverage",
  "./e2e-ux-screenshots",
  "./playwright-report",
  "./reports",
  "./test-results",
  "./tmp",
  "./worktrees",
]);
const PARTITION_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

export type EslintCacheArguments = readonly [
  "--cache",
  "--cache-location",
  string,
  "--cache-strategy",
  "content",
];

export type EslintCachePlan = {
  readonly identityDirectory: string;
  readonly eslintArguments: EslintCacheArguments;
};

export type EslintCachePlanInput = {
  readonly repoRoot: string;
  readonly cacheRoot?: string;
  readonly partitionKey?: string;
};

export function discoverEslintCacheIdentityPaths(repoRoot: string): string[] {
  const paths: string[] = [];
  visitIdentityDirectory(resolve(repoRoot), ".", paths);
  return paths.sort(comparePathBytes);
}

export function fingerprintEslintCacheIdentityPaths(
  repoRoot: string,
  relativePaths: readonly string[],
): string {
  const root = resolve(repoRoot);
  const fingerprint = createHash("sha256");
  for (const relativePath of relativePaths) {
    updateIdentityPath(fingerprint, root, relativePath);
  }
  return fingerprint.digest("hex");
}

export function prepareEslintCachePlan(input: EslintCachePlanInput): EslintCachePlan {
  const identityDirectory = prepareIdentityDirectory(input.repoRoot, input.cacheRoot);
  return buildCachePlan(identityDirectory, input.partitionKey);
}

function visitIdentityDirectory(root: string, relativeDirectory: string, paths: string[]): void {
  const absoluteDirectory = relativeDirectory === "." ? root : join(root, relativeDirectory);
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath =
      relativeDirectory === "." ? `./${entry.name}` : `${relativeDirectory}/${entry.name}`;
    if (entry.name === "node_modules" || ROOT_PRUNED_PATHS.has(relativePath)) continue;
    if (entry.isDirectory()) {
      visitIdentityDirectory(root, relativePath, paths);
    } else if (entry.isFile() && isIdentityInput(relativePath, entry.name)) {
      paths.push(relativePath);
    }
  }
}

function isIdentityInput(relativePath: string, name: string): boolean {
  return (
    /\.(?:ts|tsx|mts|cts)$/u.test(name) ||
    /^tsconfig.*\.jsonc?$/u.test(name) ||
    name === "tsconfig.tsbuildinfo" ||
    (relativePath.startsWith("./eslint.config.") &&
      !relativePath.slice(DOT_SLASH_LENGTH).includes("/")) ||
    relativePath.startsWith("./eslint-config/") ||
    (relativePath.startsWith("./eslint-rules/") && name.endsWith(".js")) ||
    name === "package.json" ||
    name === "bun.lock"
  );
}

function comparePathBytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function updateIdentityPath(
  fingerprint: ReturnType<typeof createHash>,
  repoRoot: string,
  relativePath: string,
): void {
  fingerprint.update("path\0");
  fingerprint.update(relativePath);
  fingerprint.update("\0");
  try {
    const content = readFileSync(join(repoRoot, relativePath));
    fingerprint.update("sha256\0");
    fingerprint.update(createHash("sha256").update(content).digest("hex"));
    fingerprint.update("\0");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      fingerprint.update("missing\0");
      fingerprint.update(relativePath);
      fingerprint.update("\0");
      return;
    }
    throw error;
  }
}

function prepareIdentityDirectory(repoRootInput: string, cacheRootInput?: string): string {
  const repoRoot = resolve(repoRootInput);
  const fingerprint = fingerprintEslintCacheIdentityPaths(
    repoRoot,
    discoverEslintCacheIdentityPaths(repoRoot),
  );
  const configuredRoot =
    cacheRootInput === undefined || cacheRootInput.length === 0
      ? DEFAULT_CACHE_ROOT
      : cacheRootInput;
  const cacheRoot = absoluteCacheRoot(repoRoot, configuredRoot);
  const identityDirectory = `${cacheRoot}/${IDENTITY_DIRECTORY_PREFIX}${fingerprint}`;
  mkdirSync(identityDirectory, { recursive: true });
  pruneStaleIdentityDirectories(cacheRoot, identityDirectory);
  return identityDirectory;
}

function pruneStaleIdentityDirectories(cacheRoot: string, currentDirectory: string): void {
  const currentName = basename(currentDirectory);
  for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      entry.name.startsWith(IDENTITY_DIRECTORY_PREFIX) &&
      entry.name !== currentName
    ) {
      rmSync(`${cacheRoot}/${entry.name}`, { recursive: true, force: true });
    }
  }
}

function absoluteCacheRoot(repoRoot: string, configuredRoot: string): string {
  const trailingSlashesRemoved = configuredRoot.replace(/\/+$/u, "");
  const normalizedRoot = trailingSlashesRemoved.length === 0 ? "/" : trailingSlashesRemoved;
  return isAbsolute(normalizedRoot) ? normalizedRoot : `${repoRoot}/${normalizedRoot}`;
}

function buildCachePlan(identityDirectory: string, partitionKey?: string): EslintCachePlan {
  if (
    partitionKey !== undefined &&
    partitionKey.length > 0 &&
    !PARTITION_KEY_PATTERN.test(partitionKey)
  ) {
    throw new Error(`invalid cache partition key '${partitionKey}'`);
  }
  const cacheName =
    partitionKey === undefined || partitionKey.length === 0
      ? ".eslintcache"
      : `${partitionKey}.eslintcache`;
  return {
    identityDirectory,
    eslintArguments: [
      "--cache",
      "--cache-location",
      `${identityDirectory}/${cacheName}`,
      "--cache-strategy",
      "content",
    ],
  };
}

function writeShellRecords(repoRoot: string, partitionKeys: readonly string[]): void {
  if (partitionKeys.length === 0) throw new Error("at least one cache partition key is required");
  const identityDirectory = prepareIdentityDirectory(
    repoRoot,
    globalThis.process.env.MUSI_ESLINT_MAIN_CACHE_ROOT,
  );
  const fields = [SHELL_RECORD_MAGIC, String(partitionKeys.length)];
  for (const partitionKey of partitionKeys) {
    const plan = buildCachePlan(identityDirectory, partitionKey);
    fields.push(
      partitionKey,
      plan.identityDirectory,
      String(plan.eslintArguments.length),
      ...plan.eslintArguments,
    );
  }
  process.stdout.write(`${fields.join("\0")}\0`);
}

function runCli(): void {
  const [command, repoRoot, ...partitionKeys] = process.argv.slice(PROCESS_ARGV_USER_ARGS_START);
  if (command !== SHELL_RECORD_COMMAND || repoRoot === undefined) {
    throw new Error(
      "usage: bun scripts/lib/eslint-main-cache.ts --shell-records <repo-root> <partition>...",
    );
  }
  writeShellRecords(repoRoot, partitionKeys);
}

if (import.meta.main) {
  try {
    runCli();
  } catch (error) {
    console.error(`eslint-main-cache: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
