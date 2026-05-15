import type {
  CodeIntelQueryResult,
  DefinitionNearMatchHint,
  FormatResultsOptions,
  IntelResult,
  OutputFormat,
  OverviewResult,
  ProjectBucket,
  ProjectBucketSummary,
  ProjectFilter,
  ResultMetadata,
  SourceLocation,
} from "./types.js";
import { PROJECT_BUCKETS } from "./types.js";

const JSON_INDENT_SPACES = 2;
const MIN_PROJECT_SUMMARY_BUCKETS = 2;

export function formatCodeIntelQueryResult(
  execution: CodeIntelQueryResult,
  format: OutputFormat,
): string {
  if (execution.kind === "definitionNameMiss") {
    return formatDefinitionNameMiss(execution.header, execution.hint, format);
  }
  if (execution.kind === "overview") {
    return formatOverview(execution.file, execution.results, format);
  }
  return formatResults(execution.header, execution.results, format, {
    byProject: execution.projectSummary?.byProject,
    limit: execution.limit,
    metadata: execution.metadata,
    textSuffix: formatQueryTextSuffix(execution),
  });
}

function formatOverview(file: string, results: OverviewResult[], format: OutputFormat): string {
  if (format === "json") return JSON.stringify(results, undefined, JSON_INDENT_SPACES);

  const lines = [`overview: ${file} — ${String(results.length)} procedure(s)`];
  for (const result of results) {
    lines.push(`  ${result.procedure}  ${result.kind}  auth=${result.authHelper}`);
    lines.push(`    input:  ${formatSchema(result.inputSchema)}`);
    lines.push(`    output: ${formatSchema(result.outputSchema)}`);
    if (result.serviceCalls.length > 0) {
      lines.push(`    services:    ${result.serviceCalls.join(", ")}`);
    }
    if (result.broadcasts.length > 0) {
      lines.push(`    broadcasts:  ${result.broadcasts.join(", ")}`);
    }
    appendCandidateTests(lines, result.candidateTests);
  }
  return lines.join("\n");
}

function formatSchema(schema: string | null): string {
  return schema ?? "null";
}

function appendCandidateTests(lines: string[], tests: string[]): void {
  for (let index = 0; index < tests.length; index += 1) {
    const test = tests[index];
    if (!test) continue;
    const prefix = index === 0 ? "    tests:       " : "                 ";
    lines.push(`${prefix}${test}`);
  }
}

export function formatResults(
  header: string,
  results: IntelResult[],
  format: OutputFormat,
  options: FormatResultsOptions = {},
): string {
  const display = limitResults(results, options.limit);
  const metadata = options.metadata ?? {};

  if (format === "json") {
    const payload: {
      byProject?: ProjectBucketSummary;
      count: number;
      header: string;
      limit?: number;
      meta?: ResultMetadata;
      results: IntelResult[];
      total?: number;
      truncated?: boolean;
    } = { header, count: display.results.length, results: display.results };
    if (display.truncated) {
      payload.limit = display.limit;
      payload.total = results.length;
      payload.truncated = true;
    }
    if (Object.keys(metadata).length > 0) payload.meta = metadata;
    if (options.byProject) payload.byProject = options.byProject;
    return JSON.stringify(payload, undefined, JSON_INDENT_SPACES);
  }

  const heading = `${header} (${formatResultSummary(results.length, metadata)})${
    options.textSuffix ?? ""
  }`;
  if (results.length === 0) return [heading, emptyResultLine(header)].join("\n");
  const lines = [heading, ...display.results.map(formatResultLine)];
  if (display.truncated) lines.push(formatLimitFooter(display.omitted));
  return lines.join("\n");
}

export function formatDefinitionNameMiss(
  header: string,
  hint: DefinitionNearMatchHint,
  format: OutputFormat,
): string {
  if (format === "json") {
    const payload = {
      header,
      count: 0,
      results: [],
      nearMatches: hint.results,
      nearMatchTotal: hint.total,
    };
    return JSON.stringify(payload, undefined, JSON_INDENT_SPACES);
  }

  const heading = `${header} (${formatResultSummary(0, {})})`;
  const lines = [heading, emptyResultLine(header)];
  const hintLine = formatNearMatchHintLine(hint);
  if (hintLine) lines.push(hintLine);
  return lines.join("\n");
}

export function formatDependentsProjectSummary(
  summary: ProjectBucketSummary,
  project: ProjectFilter | undefined,
): string | undefined {
  if (project) return undefined;
  const entries = projectSummaryEntries(summary);
  if (entries.length < MIN_PROJECT_SUMMARY_BUCKETS) return undefined;
  return ` -- ${entries.map((entry) => `${entry.bucket}: ${String(entry.count)}`).join(", ")}`;
}

export function formatLocation(location: SourceLocation): string {
  return `${location.file}:${String(location.line)}:${String(location.col)}`;
}

function formatQueryTextSuffix(execution: CodeIntelQueryResult): string | undefined {
  if (execution.kind !== "results" || !execution.projectSummary) return undefined;
  return formatDependentsProjectSummary(
    execution.projectSummary.byProject,
    execution.projectSummary.filter,
  );
}

function formatNearMatchHintLine(hint: DefinitionNearMatchHint): string | undefined {
  if (hint.results.length === 0) return undefined;
  const names = uniqueStrings(hint.results.map((result) => result.name));
  const suffix = hint.total > hint.results.length ? ", ..." : "";
  return `  near matches (${String(hint.total)} total): ${names.join(", ")}${suffix}`;
}

function limitResults(
  results: IntelResult[],
  limit: number | undefined,
): { limit: number; omitted: number; results: IntelResult[]; truncated: boolean } {
  if (limit === undefined || limit === 0 || results.length <= limit) {
    return { limit: 0, omitted: 0, results, truncated: false };
  }
  return {
    limit,
    omitted: results.length - limit,
    results: results.slice(0, limit),
    truncated: true,
  };
}

function formatLimitFooter(omitted: number): string {
  return `  ... and ${String(omitted)} more (use --limit 0 or omit --limit for full list)`;
}

function formatResultSummary(count: number, metadata: ResultMetadata): string {
  return [`${String(count)} ${pluralize("result", count)}`, ...formatMetadata(metadata)].join(", ");
}

function formatMetadata(metadata: ResultMetadata): string[] {
  return Object.entries(metadata).map(([key, value]) => `${key}=${String(value)}`);
}

function projectSummaryEntries(
  summary: ProjectBucketSummary,
): { bucket: ProjectBucket; count: number }[] {
  const entries: { bucket: ProjectBucket; count: number }[] = [];
  for (const bucket of PROJECT_BUCKETS) {
    const count = summary[bucket];
    if (count !== undefined && count > 0) entries.push({ bucket, count });
  }
  return entries;
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

function emptyResultLine(header: string): string {
  if (header.startsWith("definition ")) return "  no definitions found";
  if (header.startsWith("exports ")) return "  no exports found";
  if (header.startsWith("dependents ")) return "  no dependents found";
  if (header.startsWith("references ")) return "  no references found";
  if (header.startsWith("tests ")) return "  no tests found";
  return "  no results found";
}

function formatResultLine(result: IntelResult): string {
  if (result.kind === "definition") return formatDefinitionLine(result);
  if (result.kind === "export") return formatExportLine(result);
  if (result.kind === "dependent") return formatDependentLine(result);
  if (result.kind === "reference") return formatReferenceLine(result);
  return formatTestLine(result);
}

function formatReferenceLine(result: IntelResult): string {
  if (result.kind !== "reference") throw new Error("Expected reference result.");
  return `  ${result.file}:${String(result.line)}:${String(result.col)} ${result.referenceKind}`;
}

function formatDefinitionLine(result: IntelResult): string {
  if (result.kind !== "definition") throw new Error("Expected definition result.");
  return `  ${result.file}:${String(result.line)}:${String(result.col)} ${result.exportKind}`;
}

function formatExportLine(result: IntelResult): string {
  if (result.kind !== "export") throw new Error("Expected export result.");
  return `  ${result.name} ${result.exportKind}`;
}

function formatDependentLine(result: IntelResult): string {
  if (result.kind !== "dependent") throw new Error("Expected dependent result.");
  const reason = result.depth === 1 ? result.via : formatTransitiveReason(result);
  return `  ${result.file} ${reason}`;
}

function formatTransitiveReason(result: IntelResult): string {
  if (result.kind !== "dependent") throw new Error("Expected dependent result.");
  const via = result.via === "direct" ? "" : ` via ${result.via}`;
  return `transitive (depth=${String(result.depth)})${via}`;
}

function formatTestLine(result: IntelResult): string {
  if (result.kind !== "test") throw new Error("Expected test result.");
  const reason = formatTestReason(result);
  const via = result.via && result.via !== "direct" ? ` via ${result.via}` : "";
  const slow = result.slow ? " slow" : "";
  return `  ${result.file} ${reason}${via}${slow}`;
}

function formatTestReason(result: IntelResult): string {
  if (result.kind !== "test") throw new Error("Expected test result.");
  if (result.reason === "co-located") return "co-located";
  if (result.reason === "direct") return "direct candidate";
  const depth = result.depth ? ` (depth=${String(result.depth)})` : "";
  return `transitive candidate${depth}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
