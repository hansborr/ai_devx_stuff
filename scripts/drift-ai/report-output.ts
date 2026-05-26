import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  buildChunkManifest,
  chunkFilename,
  formatStableJson,
  groupFindingsForChunks,
} from "./chunks.js";
import {
  type CliOptions,
  DEFAULT_CHUNK_SIZE,
  type DriftFindingChunk,
  type DriftReport,
} from "./types.js";

export type ReportWriter = (path: string, contents: string) => void;

export function defaultReportWriter(target: string, contents: string): void {
  writeFileSync(target, contents);
}

export function writeReportOutputs(
  parsed: CliOptions,
  rendered: string,
  report: DriftReport,
  writer: ReportWriter,
  warnStderr: (message: string) => void,
): string {
  const primary = writePrimaryReport(parsed, rendered, writer);
  const chunkPointer = writeChunkOutput(parsed, report, writer);
  if (chunkPointer === undefined) return primary;
  if (parsed.format === "json" && parsed.outputPath === undefined) {
    warnStderr(chunkPointer);
    return primary;
  }
  return `${primary}\n${chunkPointer}`;
}

function writePrimaryReport(parsed: CliOptions, rendered: string, writer: ReportWriter): string {
  if (parsed.outputPath === undefined) return rendered;
  writer(parsed.outputPath, `${rendered}\n`);
  return `drift:ai: wrote ${parsed.format} report to ${parsed.outputPath}`;
}

function writeChunkOutput(
  parsed: CliOptions,
  report: DriftReport,
  writer: ReportWriter,
): string | undefined {
  if (parsed.chunkDir === undefined) return undefined;
  const chunkSize = parsed.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunks = groupFindingsForChunks(
    report.findings,
    report.scopeMode,
    report.roots,
    report.enabledChecks,
    chunkSize,
  );
  const manifest = buildChunkManifest(
    report.scopeMode,
    report.roots,
    report.enabledChecks,
    report.findings.length,
    chunkSize,
    chunks,
  );
  mkdirSync(parsed.chunkDir, { recursive: true });
  writeChunkFiles(parsed.chunkDir, chunks, writer);
  writer(path.join(parsed.chunkDir, "manifest.json"), `${formatStableJson(manifest)}\n`);
  return chunkPointer(parsed.chunkDir, manifest.chunks.length, manifest.totalFindings);
}

function writeChunkFiles(
  chunkDir: string,
  chunks: readonly DriftFindingChunk[],
  writer: ReportWriter,
): void {
  for (const chunk of chunks) {
    const filename = chunkFilename(chunk.chunkIndex, chunk.check);
    writer(path.join(chunkDir, filename), `${formatStableJson(chunk)}\n`);
  }
}

function chunkPointer(chunkDir: string, chunkCount: number, totalFindings: number): string {
  const manifestPath = path.join(chunkDir, "manifest.json");
  return `chunks: ${manifestPath} (${chunkCount} chunk(s), ${totalFindings} finding(s))`;
}
