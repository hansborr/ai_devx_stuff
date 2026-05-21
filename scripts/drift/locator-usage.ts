#!/usr/bin/env bun
// Report-only e2e selector drift sensor.
//
// Counts raw `.locator(` source-text usage under e2e/** and reports the
// current legacy allowlist size for local/e2e-prefer-role-selectors.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type LocatorUsageFile = {
  readonly path: string;
  readonly count: number;
};

export type LocatorUsageReport = {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly pattern: ".locator(";
  readonly totalLocatorCalls: number;
  readonly filesWithLocatorCalls: number;
  readonly allowlistedFileCount: number;
  readonly files: readonly LocatorUsageFile[];
};

export type LocatorUsageCliOptions = {
  readonly format: "text" | "json";
  readonly repoRoot: string;
};

type EslintConfigExports = {
  readonly e2ePreferRoleSelectorAllowlist?: readonly string[];
};

const DEFAULT_ROOT = "e2e";
const JSON_INDENT_SPACES = 2;
const LOCATOR_PATTERN = ".locator(";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

class LocatorUsageHelp extends Error {
  constructor() {
    super(usage());
    this.name = "LocatorUsageHelp";
  }
}

class LocatorUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocatorUsageError";
  }
}

function usage(): string {
  return [
    "Usage:",
    "  bun run drift:e2e",
    "  bun run drift:e2e --format <text|json>",
    "",
    "Report-only. Counts raw `.locator(` calls under e2e/**.",
  ].join("\n");
}

function readOptionValue(
  arg: string,
  argv: readonly string[],
  index: number,
): {
  value: string;
  nextIndex: number;
} {
  const equalsIndex = arg.indexOf("=");
  if (equalsIndex >= 0) return { value: arg.slice(equalsIndex + 1), nextIndex: index };
  const next = argv[index + 1];
  if (next === undefined) throw new LocatorUsageError(`${arg} requires a value.\n${usage()}`);
  return { value: next, nextIndex: index + 1 };
}

export function parseArgs(argv: readonly string[], repoRoot = process.cwd()): LocatorUsageCliOptions {
  let format: "text" | "json" = "text";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) throw new LocatorUsageError("Empty arguments are not supported.");
    if (arg === "--help" || arg === "-h") throw new LocatorUsageHelp();
    if (arg === "--format" || arg.startsWith("--format=")) {
      const parsed = readOptionValue(arg, argv, index);
      if (parsed.value !== "text" && parsed.value !== "json") {
        throw new LocatorUsageError("--format requires text or json.");
      }
      format = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    throw new LocatorUsageError(`Unknown argument: ${arg}\n${usage()}`);
  }
  return { format, repoRoot };
}

export function buildLocatorUsageReport(
  repoRoot: string,
  allowlistedFileCount: number,
): LocatorUsageReport {
  const root = DEFAULT_ROOT;
  const files = discoverSourceFiles(path.join(repoRoot, root), root)
    .map((filePath) => ({
      path: filePath,
      count: countOccurrences(readFileSync(path.join(repoRoot, filePath), "utf8"), LOCATOR_PATTERN),
    }))
    .filter((file) => file.count > 0);
  const totalLocatorCalls = files.reduce((total, file) => total + file.count, 0);
  return {
    schemaVersion: 1,
    root,
    pattern: LOCATOR_PATTERN,
    totalLocatorCalls,
    filesWithLocatorCalls: files.length,
    allowlistedFileCount,
    files,
  };
}

export function discoverSourceFiles(absoluteDir: string, relativeDir: string): string[] {
  const entries = readdirSync(absoluteDir, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = `${relativeDir}/${entry.name}`;
    const absolutePath = path.join(absoluteDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...discoverSourceFiles(absolutePath, relativePath));
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

export function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while (offset < source.length) {
    const matchIndex = source.indexOf(needle, offset);
    if (matchIndex < 0) break;
    count += 1;
    offset = matchIndex + needle.length;
  }
  return count;
}

export function formatText(report: LocatorUsageReport): string {
  const lines = [
    "drift:e2e (report-only) -- raw locator usage",
    `  root: ${report.root}/**`,
    `  raw .locator( calls: ${String(report.totalLocatorCalls)}`,
    `  files with raw .locator(: ${String(report.filesWithLocatorCalls)}`,
    `  local/e2e-prefer-role-selectors allowlisted files: ${String(report.allowlistedFileCount)}`,
  ];
  if (report.files.length === 0) {
    lines.push("OK: no raw .locator( calls found.");
    return lines.join("\n");
  }
  lines.push("  by file:");
  for (const file of report.files) lines.push(`    ${file.path}: ${String(file.count)}`);
  return lines.join("\n");
}

export function formatJson(report: LocatorUsageReport): string {
  return JSON.stringify(report, null, JSON_INDENT_SPACES);
}

export async function runLocatorUsage(
  argv: readonly string[],
): Promise<{ readonly exitCode: number; readonly stdout: string }> {
  try {
    const options = parseArgs(argv);
    const allowlistedFileCount = await loadAllowlistedFileCount(options.repoRoot);
    const report = buildLocatorUsageReport(options.repoRoot, allowlistedFileCount);
    const stdout = options.format === "json" ? formatJson(report) : formatText(report);
    return { exitCode: 0, stdout };
  } catch (err) {
    if (err instanceof LocatorUsageHelp) return { exitCode: 0, stdout: err.message };
    if (err instanceof LocatorUsageError) return { exitCode: 2, stdout: err.message };
    throw err;
  }
}

async function loadAllowlistedFileCount(repoRoot: string): Promise<number> {
  const configUrl = pathToFileURL(path.join(repoRoot, "eslint.config.js")).href;
  // type-assertion-boundary: interop - dynamic import of eslint config; module shape is external and not exported as a type
  const config = (await import(configUrl)) as EslintConfigExports;
  const allowlist = config.e2ePreferRoleSelectorAllowlist;
  if (!Array.isArray(allowlist)) {
    throw new LocatorUsageError(
      "eslint.config.js must export e2ePreferRoleSelectorAllowlist for drift:e2e.",
    );
  }
  return allowlist.length;
}

function isDirectRun(): boolean {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectRun()) {
  // eslint-disable-next-line no-magic-numbers -- standard Node argv skips node and script path
  const result = await runLocatorUsage(process.argv.slice(2));
  if (result.stdout) console.log(result.stdout);
  process.exitCode = result.exitCode;
}
