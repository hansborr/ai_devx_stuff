#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyClientTestFileSource } from "./client-test-isolation-classifier-source.js";
import type {
  ClassifyClientTestIsolationOptions,
  ClientTestFileClassification,
  ClientTestIsolationClassification,
  ClientTestIsolationClassifierCliResult,
  IsolatedClientTestFileClassification,
  RunClientTestIsolationClassifierCliOptions,
} from "./client-test-isolation-classifier-types.js";
import { isCliEntrypoint, PROCESS_ARGV_USER_ARGS_START } from "./lib/process-argv.js";

export { classifyClientTestFileSource } from "./client-test-isolation-classifier-source.js";

const JSON_INDENT_SPACES = 2;
const DEFAULT_CLIENT_SOURCE_DIR = "packages/client/src";
const HELP_FLAGS = new Set(["--help", "-h"]);
const SKIPPED_DIRECTORY_NAMES = new Set(["worktrees", "node_modules", "dist"]);

type ParsedCliArgs = {
  readonly json: boolean;
  readonly root?: string;
  readonly clientSourceDir?: string;
  readonly files: readonly string[];
};

class ClientTestIsolationClassifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientTestIsolationClassifierError";
  }
}

class ClientTestIsolationClassifierHelp extends Error {
  constructor() {
    super(usage());
    this.name = "ClientTestIsolationClassifierHelp";
  }
}

export function classifyClientTestIsolation(
  options: ClassifyClientTestIsolationOptions = {},
): ClientTestIsolationClassification {
  const cwd = path.resolve(options.cwd ?? repoRoot());
  const files =
    options.files === undefined
      ? discoverClientTestFiles(cwd, options.clientSourceDir ?? DEFAULT_CLIENT_SOURCE_DIR)
      : normalizeInputFiles(cwd, options.files);
  const classifications = classifyFiles(cwd, files);
  const noIsolateFiles = noIsolateFileNames(classifications);
  const isolatedFiles = classifications.filter(isolatedClassification);

  return {
    noIsolateFiles,
    isolatedFiles,
    totals: {
      testFiles: classifications.length,
      noIsolate: noIsolateFiles.length,
      isolated: isolatedFiles.length,
    },
  };
}

export function runClientTestIsolationClassifierCli(
  options: RunClientTestIsolationClassifierCliOptions,
): ClientTestIsolationClassifierCliResult {
  const parsed = parseCliArgsResult(options.argv);
  if (parsed instanceof ClientTestIsolationClassifierHelp) {
    return { exitCode: 0, stdout: `${parsed.message}\n`, stderr: "" };
  }
  if (parsed instanceof ClientTestIsolationClassifierError) {
    return { exitCode: 2, stdout: "", stderr: `${parsed.message}\n${usage()}\n` };
  }

  return runClientTestIsolationClassifier(parsed, options.cwd ?? process.cwd());
}

function runClientTestIsolationClassifier(
  parsed: ParsedCliArgs,
  baseCwd: string,
): ClientTestIsolationClassifierCliResult {
  const cwd = path.resolve(baseCwd, parsed.root ?? ".");
  try {
    const classification = classifyClientTestIsolation({
      cwd,
      clientSourceDir: parsed.clientSourceDir,
      files: parsed.files.length === 0 ? undefined : parsed.files,
    });
    return {
      exitCode: 0,
      stdout: parsed.json
        ? `${JSON.stringify(classification, null, JSON_INDENT_SPACES)}\n`
        : formatClientTestIsolationText(classification),
      stderr: "",
    };
  } catch (err) {
    if (err instanceof ClientTestIsolationClassifierError) {
      return { exitCode: 2, stdout: "", stderr: `${err.message}\n` };
    }
    throw err;
  }
}

function usage(): string {
  return [
    "Usage:",
    "  bun scripts/client-test-isolation-classifier.ts [--json]",
    "  bun scripts/client-test-isolation-classifier.ts [--client-source-dir=<path>]",
    "  bun scripts/client-test-isolation-classifier.ts [--root=<path>] [test-file ...]",
    "",
    "Classify client Vitest files into no-isolate and isolated buckets.",
  ].join("\n");
}

function classifyFiles(
  cwd: string,
  files: readonly string[],
): readonly ClientTestFileClassification[] {
  return files
    .map((file) => classifyFile(cwd, file))
    .sort((left, right) => left.file.localeCompare(right.file));
}

function classifyFile(cwd: string, file: string): ClientTestFileClassification {
  const absolutePath = path.resolve(cwd, file);
  if (!existsSync(absolutePath)) {
    throw new ClientTestIsolationClassifierError(`Client test file does not exist: ${file}`);
  }
  return classifyClientTestFileSource({
    file,
    source: readFileSync(absolutePath, "utf8"),
  });
}

function noIsolateFileNames(classifications: readonly ClientTestFileClassification[]): string[] {
  return classifications
    .filter((classification) => classification.mode === "no-isolate")
    .map((classification) => classification.file);
}

function isolatedClassification(
  classification: ClientTestFileClassification,
): classification is IsolatedClientTestFileClassification {
  return classification.mode === "isolated" && classification.reasons.length > 0;
}

function discoverClientTestFiles(cwd: string, clientSourceDir: string): readonly string[] {
  const root = path.resolve(cwd, clientSourceDir);
  if (!existsSync(root)) {
    throw new ClientTestIsolationClassifierError(
      `Client source directory does not exist: ${clientSourceDir}`,
    );
  }
  return walkFiles(root)
    .filter(isDefaultClientTestFile)
    .map((file) => normalizeRepoPath(path.relative(cwd, file)))
    .sort();
}

function normalizeInputFiles(cwd: string, files: readonly string[]): readonly string[] {
  return files.map((file) => normalizeRepoPath(path.relative(cwd, path.resolve(cwd, file)))).sort();
}

function walkFiles(root: string): readonly string[] {
  const files: string[] = [];
  const entries = readdirSync(root, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue;
      files.push(...walkFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function isDefaultClientTestFile(file: string): boolean {
  const normalized = normalizeRepoPath(file);
  if (normalized.endsWith(".slow.test.ts") || normalized.endsWith(".slow.test.tsx")) return false;
  return normalized.endsWith(".test.ts") || normalized.endsWith(".test.tsx");
}

function normalizeRepoPath(file: string): string {
  return file.split(path.sep).join("/");
}

function formatClientTestIsolationText(classification: ClientTestIsolationClassification): string {
  const { totals } = classification;
  const lines = [
    `client-test-isolation-classifier OK - ${String(totals.noIsolate)} no-isolate file(s), ${String(totals.isolated)} isolated file(s), ${String(totals.testFiles)} total.`,
  ];

  if (classification.isolatedFiles.length > 0) {
    lines.push("", "Isolated files:");
    for (const file of classification.isolatedFiles) pushIsolatedFileLines(lines, file);
  }

  return `${lines.join("\n")}\n`;
}

function pushIsolatedFileLines(lines: string[], file: IsolatedClientTestFileClassification): void {
  const firstReason = file.reasons[0];
  lines.push(`  ${file.file}:${String(firstReason.line)} ${firstReason.expression}`);
  for (const reason of file.reasons.slice(1)) {
    lines.push(`    ${String(reason.line)} ${reason.expression}`);
  }
}

function parseCliArgsResult(
  args: readonly string[],
): ParsedCliArgs | ClientTestIsolationClassifierError | ClientTestIsolationClassifierHelp {
  try {
    return parseCliArgs(args);
  } catch (err) {
    if (
      err instanceof ClientTestIsolationClassifierError ||
      err instanceof ClientTestIsolationClassifierHelp
    ) {
      return err;
    }
    throw err;
  }
}

function parseCliArgs(args: readonly string[]): ParsedCliArgs {
  let json = false;
  let root: string | undefined;
  let clientSourceDir: string | undefined;
  const files: string[] = [];

  for (const arg of args) {
    const parsed = parseCliArg(arg);
    json = json || parsed.json;
    root = parsed.root ?? root;
    clientSourceDir = parsed.clientSourceDir ?? clientSourceDir;
    if (parsed.file !== undefined) files.push(parsed.file);
  }

  return { json, root, clientSourceDir, files };
}

function parseCliArg(arg: string): {
  readonly json: boolean;
  readonly root?: string;
  readonly clientSourceDir?: string;
  readonly file?: string;
} {
  if (HELP_FLAGS.has(arg)) throw new ClientTestIsolationClassifierHelp();
  if (arg === "--json") return { json: true };
  if (arg.startsWith("--root=")) return { json: false, root: parsePathArg(arg, "--root=") };
  if (arg.startsWith("--client-source-dir=")) {
    return { json: false, clientSourceDir: parsePathArg(arg, "--client-source-dir=") };
  }
  if (arg.startsWith("--")) {
    throw new ClientTestIsolationClassifierError(`Unknown argument: ${arg}`);
  }
  return { json: false, file: arg };
}

function parsePathArg(arg: string, prefix: string): string {
  const value = arg.slice(prefix.length);
  if (value.length === 0) {
    throw new ClientTestIsolationClassifierError(`${prefix.slice(0, -1)} requires a path.`);
  }
  return value;
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

if (isCliEntrypoint(import.meta.url)) {
  const result = runClientTestIsolationClassifierCli({
    argv: process.argv.slice(PROCESS_ARGV_USER_ARGS_START),
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
