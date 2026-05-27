import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { LintRatchetConfig } from "../lint-ratchet-config.js";
import { ConfigError } from "../lint-ratchet-metrics.js";
import {
  cacheKeyHashFor,
  CACHE_HASH_PREFIX_LENGTH,
  eslintCachePathFor,
  usesEslintCache,
  writeEslintConfig,
} from "./eslint-config.js";
import { repoRoot, safeRatchetId } from "./paths.js";

export interface ESLintMessage {
  readonly ruleId: string | null;
  readonly severity: number;
  readonly message: string;
  readonly line?: number;
  readonly nodeType?: string;
  readonly messageId?: string;
  readonly fatal?: boolean;
}

export interface ESLintFileResult {
  readonly filePath: string;
  readonly messages: readonly ESLintMessage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEslintMessage(value: unknown): value is ESLintMessage {
  if (!isRecord(value)) return false;
  if (typeof value.message !== "string") return false;
  if (typeof value.severity !== "number") return false;
  const ruleId = value.ruleId;
  return ruleId === null || typeof ruleId === "string";
}

function parseEslintOutput(stdout: string): readonly ESLintFileResult[] {
  if (stdout.trim().length === 0) return [];
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new ConfigError("ESLint --format=json output is not an array");
  }
  const results: ESLintFileResult[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry)) continue;
    if (typeof entry.filePath !== "string") continue;
    if (!Array.isArray(entry.messages)) continue;
    const messages: ESLintMessage[] = [];
    for (const raw of entry.messages) {
      if (isEslintMessage(raw)) messages.push(raw);
    }
    results.push({ filePath: entry.filePath, messages });
  }
  return results;
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

export async function runEslint(
  ratchet: LintRatchetConfig,
  ruleSourceHash: string,
): Promise<readonly ESLintFileResult[]> {
  sweepStaleCacheSiblings(ratchet, cacheKeyHashFor(ratchet, ruleSourceHash));
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
    ...ratchet.files,
  ];

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
        resolveResults(parseEslintOutput(stdout));
      } catch (error) {
        rejectResults(error);
      }
    });
  });
}
