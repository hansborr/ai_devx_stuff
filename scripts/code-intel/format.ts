import type {
  CodeIntelQueryResult,
  DefinitionNearMatchHint,
  DefinitionResult,
  DependentResult,
  ExecutableCliCommand,
  ExportResult,
  FormatResultsOptions,
  IntelResult,
  OutputFormat,
  OverviewResult,
  ProjectBucket,
  ProjectBucketSummary,
  ProjectFilter,
  ReferenceResult,
  ResultMetadata,
  SourceLocation,
  TestResult,
} from "./types.js";
import { DISCOVERY_SCOPE_STATEMENT, PROJECT_BUCKETS } from "./types.js";

const JSON_INDENT_SPACES = 2;
const MIN_PROJECT_SUMMARY_BUCKETS = 2;
const EMPTY_RESULT_LINE_BY_COMMAND = {
  def: "  no definitions found",
  defName: "  no definitions found",
  dependents: "  no dependents found",
  exports: "  no exports found",
  overview: "  no results found",
  refs: "  no references found",
  tests: "  no tests found",
} as const satisfies Record<ExecutableCliCommand["kind"], string>;

export function formatCodeIntelQueryResult(
  execution: CodeIntelQueryResult,
  format: OutputFormat,
  commandKind: ExecutableCliCommand["kind"],
): string {
  if (execution.kind === "definitionNameMiss") {
    return formatDefinitionNameMiss(execution.header, execution.hint, format);
  }
  if (execution.kind === "overview") {
    return formatOverview(execution.file, execution.results, format);
  }
  return formatResults(execution.header, execution.results, format, {
    byProject: execution.projectSummary?.byProject,
    commandKind,
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

function formatResults(
  header: string,
  results: IntelResult[],
  format: OutputFormat,
  options: FormatResultsOptions,
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
      scope?: string;
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
    // Name-only search is discovery-mode even on a hit: a matching symbol in
    // an excluded workspace stays silently omitted, so defName hits carry the
    // searched scope exactly as the miss payload does.
    if (options.commandKind === "defName") payload.scope = DISCOVERY_SCOPE_STATEMENT;
    return JSON.stringify(payload, undefined, JSON_INDENT_SPACES);
  }

  const heading = `${header} (${formatResultSummary(results.length, metadata)})${
    options.textSuffix ?? ""
  }`;
  const lines = [heading, ...formatTextBodyLines(results, display, options)];
  // Name-only search is discovery-mode even on a hit; the statement line
  // accompanies defName hits exactly as it accompanies misses.
  if (options.commandKind === "defName") lines.push(`  ${DISCOVERY_SCOPE_STATEMENT}`);
  return lines.join("\n");
}

// Extracted, not inlined: formatResults sits at the complexity-10 lint cap,
// and inlining this empty/truncated branching pushes it to 11.
function formatTextBodyLines(
  results: IntelResult[],
  display: ReturnType<typeof limitResults>,
  options: FormatResultsOptions,
): string[] {
  if (results.length === 0) return [emptyResultLine(options.commandKind)];
  const lines = display.results.map(formatResultLine);
  if (display.truncated) lines.push(formatLimitFooter(display.omitted));
  return lines;
}

function formatDefinitionNameMiss(
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
      // JSON misses must carry the searched scope like the text path below:
      // JSON is the piping format, whose consumers are least able to infer
      // that an empty result is not whole-workspace authority.
      scope: DISCOVERY_SCOPE_STATEMENT,
    };
    return JSON.stringify(payload, undefined, JSON_INDENT_SPACES);
  }

  const heading = `${header} (${formatResultSummary(0, {})})`;
  const lines = [heading, emptyResultLine("defName")];
  const hintLine = formatNearMatchHintLine(hint);
  if (hintLine) lines.push(hintLine);
  // Name-only search is discovery-mode: nothing validates that the symbol's
  // home is inside the supported roots, so a miss must state the searched
  // scope instead of reading as whole-workspace authority.
  lines.push(`  ${DISCOVERY_SCOPE_STATEMENT}`);
  return lines.join("\n");
}

function formatDependentsProjectSummary(
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

function emptyResultLine(kind: ExecutableCliCommand["kind"]): string {
  return EMPTY_RESULT_LINE_BY_COMMAND[kind];
}

function formatResultLine(result: IntelResult): string {
  if (result.kind === "definition") return formatDefinitionLine(result);
  if (result.kind === "export") return formatExportLine(result);
  if (result.kind === "dependent") return formatDependentLine(result);
  if (result.kind === "reference") return formatReferenceLine(result);
  return formatTestLine(result);
}

function formatReferenceLine(result: ReferenceResult): string {
  return `  ${result.file}:${String(result.line)}:${String(result.col)} ${result.referenceKind}`;
}

function formatDefinitionLine(result: DefinitionResult): string {
  return `  ${result.file}:${String(result.line)}:${String(result.col)} ${result.exportKind}`;
}

function formatExportLine(result: ExportResult): string {
  return `  ${result.name} ${result.exportKind}`;
}

function formatDependentLine(result: DependentResult): string {
  const reason = result.depth === 1 ? result.via : formatTransitiveReason(result);
  return `  ${result.file} ${reason}`;
}

function formatTransitiveReason(result: DependentResult): string {
  const via = result.via === "direct" ? "" : ` via ${result.via}`;
  return `transitive (depth=${String(result.depth)})${via}`;
}

function formatTestLine(result: TestResult): string {
  const reason = formatTestReason(result);
  const via = result.via && result.via !== "direct" ? ` via ${result.via}` : "";
  const slow = result.slow ? " slow" : "";
  return `  ${result.file} ${reason}${via}${slow}`;
}

function formatTestReason(result: TestResult): string {
  if (result.reason === "co-located") return "co-located";
  if (result.reason === "direct") return "direct candidate";
  const depth = result.depth ? ` (depth=${String(result.depth)})` : "";
  return `transitive candidate${depth}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
