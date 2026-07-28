import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { ensureDirWriteFileAtomicallySync } from "../lib/atomic-write.js";
import { type CliFormat, parseCli } from "../lib/cli.js";
import { errorMessage } from "../lib/error-message.js";
import { DriftTriageError, DriftTriageHelp } from "./drift-triage-options.js";
import { type RepoProvenance, resolveRepoProvenance } from "./drift-triage-packet-io.js";
import { collectTriageVerdicts } from "./triage-verdict-collect.js";
import { parsePacketManifest, parseVerdictFile } from "./triage-verdict-input.js";
import { formatVerdictCollectionText } from "./triage-verdict-text.js";
import type { NamedTriageVerdictFile, VerdictCollectionReport } from "./triage-verdict-types.js";

const TOOL_ERROR_EXIT_CODE = 2;
const JSON_INDENT = 2;

type DriftTriageCollectOptions = {
  readonly manifest: string;
  readonly verdictDir: string | undefined;
  readonly verdictFiles: readonly string[];
  readonly format: CliFormat;
  readonly output: string | undefined;
};

type RunDriftTriageCollectOptions = {
  readonly argv: readonly string[];
  readonly readFile?: (filePath: string) => string;
  readonly listFiles?: (dirPath: string) => readonly string[];
  readonly writeFile?: (filePath: string, contents: string) => void;
  readonly repoProvenance?: () => RepoProvenance;
};

export type RunDriftTriageCollectResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly report?: VerdictCollectionReport;
};

const cliOptionsSchema = z.object({
  "--manifest": z.string().optional(),
  "--verdict-dir": z.string().optional(),
  "--format": z
    .enum(["text", "json"], { error: "--format requires text or json." })
    .default("text"),
  "--output": z.string().optional(),
});

export function parseCollectArgs(argv: readonly string[]): DriftTriageCollectOptions {
  const parsed = parseCli({
    argv,
    usage: collectUsage(),
    createError: (message) => new DriftTriageError(message),
    onHelp: () => {
      throw new DriftTriageHelp();
    },
    options: [
      { name: "--manifest", kind: "value" },
      { name: "--verdict-dir", kind: "value" },
      { name: "--format", kind: "value" },
      { name: "--output", kind: "value" },
    ],
    schema: cliOptionsSchema,
  });
  const manifest = parsed.options["--manifest"];
  if (manifest === undefined) {
    throw new DriftTriageError(`drift:triage collect requires --manifest.\n${collectUsage()}`);
  }
  return {
    manifest,
    verdictDir: parsed.options["--verdict-dir"],
    verdictFiles: parsed.positionals,
    format: parsed.options["--format"],
    output: parsed.options["--output"],
  };
}

export function runDriftTriageCollect(
  options: RunDriftTriageCollectOptions,
): RunDriftTriageCollectResult {
  let parsed: DriftTriageCollectOptions;
  try {
    parsed = parseCollectArgs(options.argv);
  } catch (error) {
    return collectOptionError(error);
  }
  try {
    const readFile = options.readFile ?? defaultReadFile;
    const manifest = parsePacketManifest(readJson(parsed.manifest, readFile));
    const verdictPaths = resolveVerdictPaths(parsed, options.listFiles ?? defaultListFiles);
    const verdicts = verdictPaths.map((path) => loadVerdictFile(path, readFile));
    const report = collectTriageVerdicts(
      manifest,
      verdicts,
      (options.repoProvenance ?? resolveRepoProvenance)(),
    );
    return deliverCollection(parsed, report, options.writeFile ?? defaultWriteFile);
  } catch (error) {
    return {
      exitCode: TOOL_ERROR_EXIT_CODE,
      stdout: error instanceof Error ? error.message : String(error),
    };
  }
}

function collectOptionError(error: unknown): RunDriftTriageCollectResult {
  if (error instanceof DriftTriageHelp) return { exitCode: 0, stdout: collectUsage() };
  if (error instanceof DriftTriageError) {
    return { exitCode: TOOL_ERROR_EXIT_CODE, stdout: error.message };
  }
  throw error;
}

function resolveVerdictPaths(
  options: DriftTriageCollectOptions,
  listFiles: (dirPath: string) => readonly string[],
): string[] {
  const paths = [...options.verdictFiles];
  if (options.verdictDir !== undefined) {
    const directoryFiles = listFiles(options.verdictDir)
      .filter((file) => file.endsWith(".json"))
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((file) => join(options.verdictDir ?? "", file));
    paths.push(...directoryFiles);
  }
  return [...new Set(paths)];
}

function loadVerdictFile(
  path: string,
  readFile: (filePath: string) => string,
): NamedTriageVerdictFile {
  try {
    return { path, result: parseVerdictFile(readJson(path, readFile)) };
  } catch (error) {
    throw new DriftTriageError(`${path}: ${errorMessage(error)}`);
  }
}

function readJson(path: string, readFile: (filePath: string) => string): unknown {
  let contents: string;
  try {
    contents = readFile(path);
  } catch (error) {
    throw new DriftTriageError(`${path}: could not read JSON: ${errorMessage(error)}`);
  }
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new DriftTriageError(`${path}: not valid JSON: ${errorMessage(error)}`);
  }
}

function deliverCollection(
  options: DriftTriageCollectOptions,
  report: VerdictCollectionReport,
  writeFile: (filePath: string, contents: string) => void,
): RunDriftTriageCollectResult {
  const rendered =
    options.format === "json"
      ? JSON.stringify(report, null, JSON_INDENT)
      : formatVerdictCollectionText(report);
  if (options.output === undefined) return { exitCode: 0, stdout: rendered, report };
  try {
    writeFile(options.output, rendered);
  } catch (error) {
    return {
      exitCode: TOOL_ERROR_EXIT_CODE,
      stdout: `${options.output}: could not write collection: ${errorMessage(error)}`,
    };
  }
  return {
    exitCode: 0,
    stdout: `drift:triage collect: wrote ${options.format} report to ${options.output} (${String(
      report.summary.receivedVerdicts,
    )}/${String(report.summary.assignedItems)} verdicts)`,
    report,
  };
}

function collectUsage(): string {
  return [
    "Usage:",
    "  bun run drift:triage collect --manifest <manifest.json> [verdict.json...]",
    "  bun run drift:triage collect --manifest <manifest.json> --verdict-dir <dir>",
    "  [--format <text|json>] [--output <path>]",
  ].join("\n");
}

function defaultReadFile(path: string): string {
  return readFileSync(path, "utf8");
}

function defaultListFiles(path: string): string[] {
  return readdirSync(path);
}

function defaultWriteFile(path: string, contents: string): void {
  ensureDirWriteFileAtomicallySync(path, contents);
}
