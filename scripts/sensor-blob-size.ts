#!/usr/bin/env bun
// Staged blob-size sensor. Reads blob sizes from the Git index so the report
// matches what would be committed, not the current working-tree bytes.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_WARN_THRESHOLD_KIBIBYTES = 500;
const DEFAULT_BLOCK_THRESHOLD_MEBIBYTES = 5;
const BYTES_PER_KIBIBYTE = 1024;
const BYTES_PER_MEBIBYTE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE;
const PROCESS_ARGV_USER_ARGS_START = 2;
const HELP_FLAGS = new Set(["--help", "-h"]);

export const DEFAULT_WARN_THRESHOLD_BYTES = DEFAULT_WARN_THRESHOLD_KIBIBYTES * BYTES_PER_KIBIBYTE;
export const DEFAULT_BLOCK_THRESHOLD_BYTES = DEFAULT_BLOCK_THRESHOLD_MEBIBYTES * BYTES_PER_MEBIBYTE;
export const DEFAULT_ALLOWLIST_PATH = ".blob-size-allowlist";

export type BlobSizeMode = "check" | "block";
export type BlobSizeSeverity = "warn" | "block";

export type BlobSizeFileFinding = {
  readonly severity: BlobSizeSeverity;
  readonly file: string;
  readonly sizeBytes: number;
  readonly thresholdBytes: number;
};

export type BlobSizeAllowlistFinding = {
  readonly severity: "warn";
  readonly file: string;
  readonly message: string;
};

export type BlobSizeFinding = BlobSizeFileFinding | BlobSizeAllowlistFinding;

export type BlobSizeCliOptions = {
  readonly mode: BlobSizeMode;
  readonly thresholdWarn: number;
  readonly thresholdBlock: number;
  readonly allowlistPath: string;
};

export type RunBlobSizeCliOptions = {
  readonly argv: readonly string[];
  readonly cwd?: string;
};

export type BlobSizeRunResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly findings: readonly BlobSizeFinding[];
};

class BlobSizeCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobSizeCliError";
  }
}

class BlobSizeHelp extends Error {
  constructor() {
    super(usage());
    this.name = "BlobSizeHelp";
  }
}

function usage(): string {
  return [
    "Usage:",
    "  bun run sensor:blob-size [--check|--block]",
    "  bun run sensor:blob-size --threshold-warn=<bytes>",
    "  bun run sensor:blob-size --threshold-block=<bytes>",
    "  bun run sensor:blob-size --allowlist=<path>",
    "",
    "Report-only by default. Checks staged Git blobs against the size policy.",
  ].join("\n");
}

export function runBlobSizeCli(options: RunBlobSizeCliOptions): BlobSizeRunResult {
  let parsed: BlobSizeCliOptions;
  try {
    parsed = parseArgs(options.argv);
  } catch (err) {
    if (err instanceof BlobSizeHelp) return { exitCode: 0, stdout: err.message, findings: [] };
    if (err instanceof BlobSizeCliError) return { exitCode: 2, stdout: err.message, findings: [] };
    throw err;
  }

  const cwd = options.cwd ?? process.cwd();
  let findings: readonly BlobSizeFinding[];
  try {
    findings = runBlobSizeCheck({ ...parsed, cwd });
  } catch (err) {
    if (err instanceof BlobSizeCliError) {
      return { exitCode: 2, stdout: err.message, findings: [] };
    }
    throw err;
  }
  const severityCounts = countFindingsBySeverity(findings);
  return {
    exitCode: parsed.mode === "block" && severityCounts.block > 0 ? 1 : 0,
    stdout: formatBlobSizeText(parsed, findings),
    findings,
  };
}

function countFindingsBySeverity(
  findings: readonly BlobSizeFinding[],
): Record<BlobSizeSeverity, number> {
  const counts: Record<BlobSizeSeverity, number> = { warn: 0, block: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}

function parseArgs(argv: readonly string[]): BlobSizeCliOptions {
  let mode: BlobSizeMode = "check";
  let thresholdWarn = DEFAULT_WARN_THRESHOLD_BYTES;
  let thresholdBlock = DEFAULT_BLOCK_THRESHOLD_BYTES;
  let allowlistPath = DEFAULT_ALLOWLIST_PATH;

  for (const arg of argv) {
    if (HELP_FLAGS.has(arg)) throw new BlobSizeHelp();
    if (arg === "--check") {
      mode = "check";
      continue;
    }
    if (arg === "--block") {
      mode = "block";
      continue;
    }
    if (arg.startsWith("--threshold-warn=")) {
      thresholdWarn = parseByteThreshold(arg, "--threshold-warn=");
      continue;
    }
    if (arg.startsWith("--threshold-block=")) {
      thresholdBlock = parseByteThreshold(arg, "--threshold-block=");
      continue;
    }
    if (arg.startsWith("--allowlist=")) {
      allowlistPath = arg.slice("--allowlist=".length);
      if (allowlistPath.length === 0) {
        throw new BlobSizeCliError("--allowlist requires a path.");
      }
      continue;
    }
    throw new BlobSizeCliError(`Unknown argument: ${arg}\n${usage()}`);
  }

  if (thresholdBlock < thresholdWarn) {
    throw new BlobSizeCliError(
      "--threshold-block must be greater than or equal to --threshold-warn.",
    );
  }

  return { mode, thresholdWarn, thresholdBlock, allowlistPath };
}

function parseByteThreshold(arg: string, prefix: string): number {
  const raw = arg.slice(prefix.length);
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new BlobSizeCliError(`${prefix.slice(0, -1)} requires a positive integer byte count.`);
  }
  return Number(raw);
}

type RunBlobSizeCheckOptions = BlobSizeCliOptions & {
  readonly cwd: string;
};

function runBlobSizeCheck(options: RunBlobSizeCheckOptions): readonly BlobSizeFinding[] {
  const allowlist = readAllowlist(options.cwd, options.allowlistPath);
  const stagedFiles = listStagedFiles(options.cwd);
  const findings: BlobSizeFinding[] = [...allowlist.findings];
  for (const filePath of stagedFiles) {
    const normalized = normalizeRepoPath(filePath);
    if (allowlist.paths.has(normalized)) continue;
    const sizeBytes = stagedBlobSize(options.cwd, normalized);
    const finding = blobSizeFinding(
      normalized,
      sizeBytes,
      options.thresholdWarn,
      options.thresholdBlock,
    );
    if (finding !== undefined) findings.push(finding);
  }
  return findings;
}

type ParsedAllowlist = {
  readonly paths: ReadonlySet<string>;
  readonly findings: readonly BlobSizeAllowlistFinding[];
};

function readAllowlist(cwd: string, allowlistPath: string): ParsedAllowlist {
  const absolute = path.resolve(cwd, allowlistPath);
  if (!existsSync(absolute)) return { paths: new Set(), findings: [] };
  const source = readFileSync(absolute, "utf8");
  const paths = new Set<string>();
  const findings: BlobSizeAllowlistFinding[] = [];
  const lines = source.replace(/\r\n/gu, "\n").split("\n");
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const hashIndex = trimmed.indexOf("#");
    if (hashIndex < 0) {
      findings.push(allowlistFinding(allowlistPath, index + 1));
      continue;
    }
    const filePath = trimmed.slice(0, hashIndex).trim();
    const reason = trimmed.slice(hashIndex + 1).trim();
    if (filePath.length === 0 || reason.length === 0) {
      findings.push(allowlistFinding(allowlistPath, index + 1));
      continue;
    }
    paths.add(normalizeRepoPath(filePath));
  }
  return { paths, findings };
}

function allowlistFinding(allowlistPath: string, line: number): BlobSizeAllowlistFinding {
  return {
    severity: "warn",
    file: `${allowlistPath}:${String(line)}`,
    message: "allowlist entry must be '<relative-path> # reason'",
  };
}

function listStagedFiles(cwd: string): readonly string[] {
  try {
    const output = execFileSync(
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
      { cwd, encoding: "buffer" },
    );
    return [...parseNulDelimited(output.toString("utf8"))].sort(compareStrings);
  } catch {
    throw new BlobSizeCliError("sensor:blob-size requires a Git repository.");
  }
}

function stagedBlobSize(cwd: string, repoRelativePath: string): number {
  try {
    const output = execFileSync("git", ["cat-file", "-s", `:${repoRelativePath}`], {
      cwd,
      encoding: "utf8",
    }).trim();
    return Number(output);
  } catch {
    throw new BlobSizeCliError(`sensor:blob-size could not read staged blob: ${repoRelativePath}`);
  }
}

function blobSizeFinding(
  filePath: string,
  sizeBytes: number,
  thresholdWarn: number,
  thresholdBlock: number,
): BlobSizeFileFinding | undefined {
  if (sizeBytes > thresholdBlock) {
    return {
      severity: "block",
      file: filePath,
      sizeBytes,
      thresholdBytes: thresholdBlock,
    };
  }
  if (sizeBytes > thresholdWarn) {
    return {
      severity: "warn",
      file: filePath,
      sizeBytes,
      thresholdBytes: thresholdWarn,
    };
  }
  return undefined;
}

function formatBlobSizeText(
  options: BlobSizeCliOptions,
  findings: readonly BlobSizeFinding[],
): string {
  const modeLabel = options.mode === "block" ? "blocking" : "report-only";
  const lines = [
    `sensor:blob-size (${modeLabel}) -- warn ${String(options.thresholdWarn)} bytes, block ${String(options.thresholdBlock)} bytes`,
  ];
  if (findings.length === 0) {
    lines.push("OK: no staged blob-size findings");
    return lines.join("\n");
  }
  for (const finding of findings) {
    lines.push(formatFinding(finding));
  }
  return lines.join("\n");
}

function formatFinding(finding: BlobSizeFinding): string {
  if ("message" in finding) {
    return `WARN: ${finding.file}: ${finding.message}`;
  }
  const prefix = finding.severity === "block" ? "BLOCK" : "WARN";
  return [
    `${prefix}: ${finding.file}: staged blob is ${String(finding.sizeBytes)} bytes;`,
    `exceeds ${finding.severity} threshold ${String(finding.thresholdBytes)} bytes`,
  ].join(" ");
}

function parseNulDelimited(output: string): readonly string[] {
  return output.split("\0").filter((entry) => entry.length > 0);
}

function normalizeRepoPath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function isCliEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isCliEntrypoint()) {
  const result = runBlobSizeCli({ argv: process.argv.slice(PROCESS_ARGV_USER_ARGS_START) });
  if (result.stdout) console.log(result.stdout);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
