import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  type ESLintFileResult,
  type ESLintMessage,
  parseEslintOutput,
} from "../lib/eslint-json.js";
import { isRecord } from "./baseline-hash.js";
import {
  CACHE_HASH_PREFIX_LENGTH,
  cacheKeyHashFor,
  eslintCachePathFor,
  usesEslintCache,
  writeEslintConfig,
} from "./eslint-config.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";
import { ConfigError } from "./metrics.js";
import { repoRoot, safeRatchetId } from "./paths.js";

export type { ESLintFileResult, ESLintMessage };

const MAX_ESLINT_POSITIONAL_FILES = 500;

let cachedEslintBinPath: string | undefined;

// The relative bin path from an npm `bin` field, which is either a string (single
// bin) or a name-keyed object.
function eslintBinRelative(binField: unknown): string | undefined {
  if (typeof binField === "string") return binField;
  if (isRecord(binField) && typeof binField.eslint === "string") return binField.eslint;
  return undefined;
}

/**
 * Resolve ESLint's actual JS entry so it can be launched with `process.execPath`
 * rather than the `node_modules/.bin/eslint` shim. The shim is a POSIX-ism — on
 * Windows it is a `.cmd`/`.ps1` that `spawn` cannot exec without `shell: true`,
 * and under Yarn PnP `node_modules/.bin` does not exist at all. Resolution goes
 * through `eslint/package.json` (ESLint's `exports` map gates `./bin/eslint.js`
 * but always exposes `./package.json`) and reads its `bin.eslint` field, which
 * also survives an ESLint major relocating the bin. `require.resolve` works
 * under both node_modules and PnP. Memoized; throws an actionable ConfigError
 * (not a mysterious spawn ENOENT) if resolution fails.
 */
export function resolveEslintBinPath(): string {
  if (cachedEslintBinPath !== undefined) return cachedEslintBinPath;
  try {
    const packageJsonPath = createRequire(import.meta.url).resolve("eslint/package.json");
    const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const binRelative = eslintBinRelative(isRecord(parsed) ? parsed.bin : undefined);
    if (binRelative === undefined) {
      throw new Error("eslint package.json has no bin.eslint entry");
    }
    cachedEslintBinPath = resolve(dirname(packageJsonPath), binRelative);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(
      `Could not resolve ESLint's JS entry from eslint/package.json: ${message}. Ensure eslint is installed as a dependency of the ratchet host.`,
    );
  }
  return cachedEslintBinPath;
}

function rejectWithError(rejectResults: (reason?: unknown) => void, error: unknown): void {
  rejectResults(error instanceof Error ? error : new Error(String(error)));
}

function fileChunks(files: readonly string[]): readonly (readonly string[])[] {
  const chunks: string[][] = [];
  for (let index = 0; index < files.length; index += MAX_ESLINT_POSITIONAL_FILES) {
    chunks.push(files.slice(index, index + MAX_ESLINT_POSITIONAL_FILES));
  }
  return chunks;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sweepStaleCacheEntries(ratchet: LintRatchetConfig, currentHash: string): void {
  const id = safeRatchetId(ratchet.id);
  const liveCachePrefix = `${id}-${currentHash}`;
  const liveConfigName = `${liveCachePrefix}.mjs`;
  const cacheRoot = join(repoRoot, "node_modules/.cache/eslint-ratchet");
  const configRoot = join(cacheRoot, "configs");
  const hexHash = `[0-9a-f]{${String(CACHE_HASH_PREFIX_LENGTH)}}`;
  const cacheEntryPattern = new RegExp(`^${escapeRegExp(id)}-${hexHash}$`);
  const configEntryPattern = new RegExp(`^${escapeRegExp(id)}-${hexHash}\\.mjs$`);
  const cacheLiveEntry = usesEslintCache(ratchet) ? liveCachePrefix : undefined;
  for (const [dir, liveEntry, pattern] of [
    [cacheRoot, cacheLiveEntry, cacheEntryPattern],
    [configRoot, liveConfigName, configEntryPattern],
  ] as const) {
    if (!existsSync(dir)) continue;
    let entries: readonly string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!pattern.test(entry)) continue;
      if (entry === liveEntry) continue;
      rmSync(join(dir, entry), { recursive: true, force: true });
    }
  }
}

export function sweepStaleCacheSiblings(ratchet: LintRatchetConfig, ruleSourceHash: string): void {
  sweepStaleCacheEntries(ratchet, cacheKeyHashFor(ratchet, ruleSourceHash));
}

let eslintOutputFileCounter = 0;

function nextEslintOutputPath(ratchet: LintRatchetConfig): string {
  eslintOutputFileCounter += 1;
  const unique = `${String(process.pid)}-${String(eslintOutputFileCounter)}`;
  return join(tmpdir(), `lint-ratchet-eslint-${safeRatchetId(ratchet.id)}-${unique}.json`);
}

async function spawnEslint(
  ratchet: LintRatchetConfig,
  args: readonly string[],
): Promise<readonly ESLintFileResult[]> {
  // Capture ESLint's JSON on a temp file rather than a stdout pipe: Bun (the
  // runtime process.execPath points at here) truncates a child's large piped
  // stdout on exit — the pipe closes before draining — whereas a file fd the
  // child writes to is complete once the process closes. `--format=json`
  // diagnostics still go to stdout, so ESLint's own stderr stays piped for
  // error reporting.
  const outputPath = nextEslintOutputPath(ratchet);
  const outputFd = openSync(outputPath, "w");
  let parentFdOpen = true;
  const closeParentFd = (): void => {
    if (!parentFdOpen) return;
    parentFdOpen = false;
    try {
      closeSync(outputFd);
    } catch {
      // The fd may already be gone; nothing to clean up.
    }
  };
  return new Promise((resolveResults, rejectResults) => {
    // Launch ESLint on the same runtime that ran the gate (process.execPath),
    // pointed at ESLint's resolved JS entry — portable across Windows and PnP,
    // where the .bin shim is unusable. See resolveEslintBinPath.
    const child = spawn(process.execPath, [resolveEslintBinPath(), ...args], {
      cwd: repoRoot,
      stdio: ["ignore", outputFd, "pipe"],
    });
    let stderr = "";
    let settled = false;
    // stdio[2] is "pipe", so stderr is present; the null union comes only from
    // TypeScript widening the ChildProcess type once stdio holds a numeric fd.
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      closeParentFd();
      rmSync(outputPath, { force: true });
      rejectResults(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      closeParentFd();
      let stdout: string;
      try {
        stdout = readFileSync(outputPath, "utf8");
      } catch (error) {
        rmSync(outputPath, { force: true });
        rejectWithError(rejectResults, error);
        return;
      }
      rmSync(outputPath, { force: true });
      if (stdout.trim().length === 0) {
        rejectResults(
          new ConfigError(
            `ESLint produced no JSON output for ${ratchet.id}. exit=${String(code)} stderr:\n${stderr}`,
          ),
        );
        return;
      }
      if (code !== 0 && code !== 1) {
        rejectResults(
          new ConfigError(
            `ESLint failed for ${ratchet.id}. exit=${String(code)} stderr:\n${stderr}`,
          ),
        );
        return;
      }
      try {
        resolveResults(parseEslintOutput(stdout, (message) => new ConfigError(message)));
      } catch (error) {
        rejectWithError(rejectResults, error);
      }
    });
  });
}

// Run ESLint for an explicit file set with the ratchet object UNCHANGED (same
// config/cache hash) and WITHOUT sweeping stale cache siblings. Passing the
// edited file as a positional arg reuses the canonical sweep's warm cache and
// leaves it intact — the cache-safe shape the edit-time hook depends on.
// Never call this with a mutated ratchet.
export async function runEslintForFiles(
  ratchet: LintRatchetConfig,
  ruleSourceHash: string,
  files: readonly string[],
): Promise<readonly ESLintFileResult[]> {
  if (files.length === 0) return [];
  const configPath = writeEslintConfig(ratchet, ruleSourceHash);
  const cacheArgs: string[] = [];
  if (usesEslintCache(ratchet)) {
    const cachePath = eslintCachePathFor(ratchet, ruleSourceHash);
    mkdirSync(dirname(cachePath), { recursive: true });
    cacheArgs.push("--cache", "--cache-location", cachePath);
  }
  const results: ESLintFileResult[] = [];
  for (const chunk of fileChunks(files)) {
    const args = [
      "--format=json",
      "--no-error-on-unmatched-pattern",
      ...cacheArgs,
      "--config",
      configPath,
      ...chunk,
    ];
    results.push(...(await spawnEslint(ratchet, args)));
  }
  return results;
}
