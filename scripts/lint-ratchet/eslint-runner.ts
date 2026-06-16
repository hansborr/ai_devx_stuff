import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  type ESLintFileResult,
  type ESLintMessage,
  parseEslintOutput,
} from "../lib/eslint-json.js";
import {
  CACHE_HASH_PREFIX_LENGTH,
  cacheKeyHashFor,
  eslintCachePathFor,
  usesEslintCache,
  writeEslintConfig,
} from "./eslint-config.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";
import { ConfigError } from "./lint-ratchet-metrics.js";
import { repoRoot, safeRatchetId } from "./paths.js";

export type { ESLintFileResult, ESLintMessage };

function rejectWithError(rejectResults: (reason?: unknown) => void, error: unknown): void {
  rejectResults(error instanceof Error ? error : new Error(String(error)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sweepStaleCacheSiblings(ratchet: LintRatchetConfig, currentHash: string): void {
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

async function spawnEslint(
  ratchet: LintRatchetConfig,
  args: readonly string[],
): Promise<readonly ESLintFileResult[]> {
  return new Promise((resolveResults, rejectResults) => {
    const child = spawn(resolve(repoRoot, "node_modules/.bin/eslint"), args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", rejectResults);
    child.on("close", (code) => {
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
// leaves it intact — the cache-safe shape the edit-time hook depends on (see
// docs/agent_notes Phase 0 measurement). Never call this with a mutated ratchet.
export async function runEslintForFiles(
  ratchet: LintRatchetConfig,
  ruleSourceHash: string,
  files: readonly string[],
): Promise<readonly ESLintFileResult[]> {
  const configPath = writeEslintConfig(ratchet, ruleSourceHash);
  const cacheArgs: string[] = [];
  if (usesEslintCache(ratchet)) {
    const cachePath = eslintCachePathFor(ratchet, ruleSourceHash);
    mkdirSync(dirname(cachePath), { recursive: true });
    cacheArgs.push("--cache", "--cache-location", cachePath);
  }
  const args = [
    "--format=json",
    "--no-error-on-unmatched-pattern",
    ...cacheArgs,
    "--config",
    configPath,
    ...files,
  ];
  return spawnEslint(ratchet, args);
}

export async function runEslint(
  ratchet: LintRatchetConfig,
  ruleSourceHash: string,
): Promise<readonly ESLintFileResult[]> {
  sweepStaleCacheSiblings(ratchet, cacheKeyHashFor(ratchet, ruleSourceHash));
  return runEslintForFiles(ratchet, ruleSourceHash, ratchet.files);
}
