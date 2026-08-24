#!/usr/bin/env bun
// Report-only e2e selector drift sensor.
//
// Counts raw `.locator(` source-text usage under e2e/**. Schema 1 also
// reported the local/e2e-prefer-role-selectors debt-file count; that field
// retired with the selector ratchets (lint-followups-2026-06 leaf 03g).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  readRequiredOptionValue,
  requireArgAllowingEmpty as requireArg,
} from "../cli-option-values.js";
import { isCliEntrypoint, PROCESS_ARGV_USER_ARGS_START } from "../lib/process-argv.js";

export type LocatorUsageFile = {
  readonly path: string;
  readonly count: number;
};

// Schema 2: debtFileCount retired with the selector ratchets (leaf 03g).
const REPORT_SCHEMA_VERSION = 2;

export type LocatorUsageReport = {
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly root: string;
  readonly pattern: ".locator(";
  readonly totalLocatorCalls: number;
  readonly filesWithLocatorCalls: number;
  readonly files: readonly LocatorUsageFile[];
};

export type LocatorUsageCliOptions = {
  readonly format: "text" | "json";
  readonly repoRoot: string;
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

export function parseArgs(
  argv: readonly string[],
  repoRoot = process.cwd(),
): LocatorUsageCliOptions {
  let format: "text" | "json" = "text";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = requireArg(argv[index], (message) => {
      throw new LocatorUsageError(message);
    });
    if (arg === "--help" || arg === "-h") throw new LocatorUsageHelp();
    if (arg === "--format" || arg.startsWith("--format=")) {
      const parsed = readRequiredOptionValue({
        arg,
        argv,
        index,
        usage: usage(),
        createError: (message) => new LocatorUsageError(message),
      });
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

export function buildLocatorUsageReport(repoRoot: string): LocatorUsageReport {
  const root = DEFAULT_ROOT;
  const files = discoverSourceFiles(path.join(repoRoot, root), root)
    .map((filePath) => ({
      path: filePath,
      count: countOccurrences(readFileSync(path.join(repoRoot, filePath), "utf8"), LOCATOR_PATTERN),
    }))
    .filter((file) => file.count > 0);
  const totalLocatorCalls = files.reduce((total, file) => total + file.count, 0);
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    root,
    pattern: LOCATOR_PATTERN,
    totalLocatorCalls,
    filesWithLocatorCalls: files.length,
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

export function runLocatorUsage(argv: readonly string[]): {
  readonly exitCode: number;
  readonly stdout: string;
} {
  try {
    const options = parseArgs(argv);
    const report = buildLocatorUsageReport(options.repoRoot);
    const stdout = options.format === "json" ? formatJson(report) : formatText(report);
    return { exitCode: 0, stdout };
  } catch (err) {
    if (err instanceof LocatorUsageHelp) return { exitCode: 0, stdout: err.message };
    if (err instanceof LocatorUsageError) return { exitCode: 2, stdout: err.message };
    throw err;
  }
}

if (isCliEntrypoint(import.meta.url)) {
  const result = runLocatorUsage(process.argv.slice(PROCESS_ARGV_USER_ARGS_START));
  if (result.stdout) console.log(result.stdout);
  process.exitCode = result.exitCode;
}
