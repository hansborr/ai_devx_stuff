#!/usr/bin/env bun
// Compact drift reports into a review queue and optional deterministic swarm packets.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { triageGeneratedArtifactExclusions } from "./drift-ai/triage-packet-staleness.js";
import type { TriagePacketBundle } from "./drift-ai/triage-packet-types.js";
import { buildTriagePackets } from "./drift-ai/triage-packets.js";
import { buildTriageReport, type TriageReport } from "./drift-ai/triage-report.js";
import { formatTriageText } from "./drift-ai/triage-report-text.js";
import { runDriftTriageCollect, type RunDriftTriageCollectResult } from "./drift-triage-collect.js";
import { loadTriageInputs } from "./drift-triage-inputs.js";
import {
  DriftTriageError,
  DriftTriageHelp,
  type DriftTriageOptions,
  parseArgs,
} from "./drift-triage-options.js";
import {
  type RepoProvenance,
  resolveRepoProvenance,
  writePacketBundle,
} from "./drift-triage-packet-io.js";

const TOOL_ERROR_EXIT_CODE = 2;
const JSON_INDENT_SPACES = 2;
const PROCESS_ARGS_OFFSET = 2;

export type RunDriftTriageOptions = {
  readonly argv: readonly string[];
  readonly readFile?: (filePath: string) => string;
  readonly readSourceFile?: (filePath: string) => string | null;
  readonly writeFile?: (filePath: string, contents: string) => void;
  readonly repoProvenance?: (excludedPaths?: readonly string[]) => RepoProvenance;
  readonly listFiles?: (dirPath: string) => readonly string[];
};

export type RunDriftTriageResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly report?: TriageReport;
  readonly packetBundle?: TriagePacketBundle;
};

type DeliveryContext = {
  readonly inputHashes: readonly { readonly path: string; readonly sha256: string }[];
  readonly writeFile: (filePath: string, contents: string) => void;
  readonly repoProvenance: (excludedPaths?: readonly string[]) => RepoProvenance;
  readonly readSourceFile: (filePath: string) => string | null;
};

export { parseArgs } from "./drift-triage-options.js";

export function runDriftTriageCommand(
  options: RunDriftTriageOptions,
): RunDriftTriageResult | RunDriftTriageCollectResult {
  if (options.argv[0] !== "collect") return runDriftTriage(options);
  return runDriftTriageCollect({
    ...options,
    argv: options.argv.slice(1),
  });
}

export function runDriftTriage(options: RunDriftTriageOptions): RunDriftTriageResult {
  let parsed: DriftTriageOptions;
  try {
    parsed = parseArgs(options.argv);
  } catch (error) {
    return optionErrorResult(error);
  }

  try {
    const loaded = loadTriageInputs(parsed.inputs, options.readFile ?? defaultReadFile);
    const report = buildTriageReport(loaded.inputs, parsed);
    const rendered = renderReport(parsed, report);
    return deliverOutputs(parsed, report, rendered, {
      inputHashes: loaded.inputHashes,
      writeFile: options.writeFile ?? defaultWriteFile,
      repoProvenance: options.repoProvenance ?? resolveRepoProvenance,
      readSourceFile: options.readSourceFile ?? defaultReadFile,
    });
  } catch (error) {
    if (error instanceof DriftTriageError) {
      return { exitCode: TOOL_ERROR_EXIT_CODE, stdout: error.message };
    }
    throw error;
  }
}

function optionErrorResult(error: unknown): RunDriftTriageResult {
  if (error instanceof DriftTriageHelp) return { exitCode: 0, stdout: error.message };
  if (error instanceof DriftTriageError) {
    return { exitCode: TOOL_ERROR_EXIT_CODE, stdout: error.message };
  }
  throw error;
}

function renderReport(options: DriftTriageOptions, report: TriageReport): string {
  return options.format === "json"
    ? JSON.stringify(report, null, JSON_INDENT_SPACES)
    : formatTriageText(report);
}

function deliverOutputs(
  options: DriftTriageOptions,
  report: TriageReport,
  rendered: string,
  context: DeliveryContext,
): RunDriftTriageResult {
  const messages: string[] = [];
  try {
    if (options.output !== undefined) {
      context.writeFile(options.output, rendered);
      messages.push(`drift:triage: wrote ${options.format} report to ${options.output}`);
    }
    const packetBundle = createAndWritePackets(options, report, context);
    if (packetBundle !== undefined && options.packetDir !== undefined) {
      messages.push(packetWriteMessage(packetBundle, options.packetDir));
    }
    if (messages.length === 0) return { exitCode: 0, stdout: rendered, report };
    return { exitCode: 0, stdout: messages.join("\n"), report, packetBundle };
  } catch (error) {
    const target = options.packetDir ?? options.output ?? "output";
    return {
      exitCode: TOOL_ERROR_EXIT_CODE,
      stdout: `${target}: could not write report: ${describeError(error)}`,
    };
  }
}

function createAndWritePackets(
  options: DriftTriageOptions,
  report: TriageReport,
  context: DeliveryContext,
): TriagePacketBundle | undefined {
  if (options.packetDir === undefined) return undefined;
  const excludedArtifacts = triageGeneratedArtifactExclusions([
    ...context.inputHashes.map((input) => input.path),
    ...(options.output === undefined ? [] : [options.output]),
    options.packetDir,
  ]);
  const provenance = {
    ...context.repoProvenance(excludedArtifacts),
    inputHashes: context.inputHashes,
  };
  const bundle = buildTriagePackets(
    report,
    {
      packetSize: options.packetSize,
      filters: options.packetFilters,
      readSourceFile: context.readSourceFile,
    },
    provenance,
  );
  writePacketBundle(options.packetDir, bundle, context.writeFile);
  return bundle;
}

function packetWriteMessage(bundle: TriagePacketBundle, packetDir: string): string {
  const count = bundle.packets.length;
  return `drift:triage: wrote ${String(count)} swarm packet${count === 1 ? "" : "s"} and manifest to ${packetDir}`;
}

export { formatTriageText as formatText };

function defaultReadFile(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

function defaultWriteFile(filePath: string, contents: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCliEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isCliEntrypoint()) {
  const result = runDriftTriageCommand({ argv: process.argv.slice(PROCESS_ARGS_OFFSET) });
  if (result.stdout) console.log(result.stdout);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
