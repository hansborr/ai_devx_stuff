// Parser and corpus-evaluation helpers for Dolos clone candidates. This is
// prototype-lane plumbing only: it does not register a drift check or emit report
// rows. Dolos' CLI CSV output is file-pair oriented, so ranges are full-file
// spans derived from files.csv content or a caller-provided line-count map.

import {
  type CloneCorpusLabels,
  DEFAULT_CLONE_CORPUS_DIR,
  extractCloneCorpusFunctions,
  type LabeledPairScore,
  loadCloneCorpusLabels,
  scoreDetectedPairsAgainstLabels,
} from "./clone-corpus.js";
import { type CsvObject, parseCsvObjects } from "./dolos-csv.js";
import {
  DOLOS_TOOL,
  type DolosCandidatePair,
  type DolosFileRange,
  type DolosPairMetrics,
  type DolosParseResult,
  type DolosReportFiles,
  type ParseDolosReportOptions,
} from "./dolos-types.js";
import { toPosix } from "./path-util.js";
import { sourceLineCount } from "./ts-source-util.js";

export type DolosCloneCorpusEvaluation = LabeledPairScore & {
  readonly labels: CloneCorpusLabels;
  readonly candidates: readonly DolosCandidatePair[];
};

export type { DolosCandidatePair, DolosReportFiles } from "./dolos-types.js";

export function parseDolosVersionOutput(output: string): string | undefined {
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const version = versionFromLine(trimmed);
    if (version !== undefined) return version;
  }
  return undefined;
}

export function parseDolosCsvReport(
  report: DolosReportFiles,
  options: ParseDolosReportOptions = {},
): DolosParseResult {
  const context = parseContext(report, options);
  const parsedPairs = readCandidatePairs(report.pairsCsv, context);
  const capped = capCandidates(parsedPairs, context.threshold, options);
  return {
    metadata: reportMetadata(context),
    candidates: capped.candidates,
    caps: capped.caps,
    truncation: {
      parsedPairs: parsedPairs.length,
      candidatePairsTruncated: capped.candidatePairsTruncated,
      reportedPairsTruncated: capped.reportedPairsTruncated,
      missingFileRanges: missingRanges(parsedPairs, context.lineCounts),
    },
  };
}

export function evaluateDolosCloneCorpusCandidates(
  candidates: readonly DolosCandidatePair[],
  corpusDir = DEFAULT_CLONE_CORPUS_DIR,
): DolosCloneCorpusEvaluation {
  const labels = loadCloneCorpusLabels(corpusDir);
  const known = new Set(extractCloneCorpusFunctions(corpusDir).map((fn) => fn.id));
  return {
    labels,
    candidates,
    ...scoreDetectedPairsAgainstLabels(
      candidates.map((candidate) => ({
        a: candidate.left.filePath,
        b: candidate.right.filePath,
      })),
      labels,
      known,
    ),
  };
}

function versionFromLine(line: string): string | undefined {
  if (/\bdolos\b/iu.test(line)) {
    const dolosVersion = /(\d+\.\d+\.\d+(?:[-+.][\w.-]+)?)/u.exec(line);
    if (dolosVersion?.[1] !== undefined) return dolosVersion[1];
  }
  const trimmedMatch = /^v?(\d+\.\d+\.\d+(?:[-+.][\w.-]+)?)$/u.exec(line);
  return trimmedMatch?.[1];
}

type DolosParseContext = {
  readonly engineVersion?: string;
  readonly languageMode: string;
  readonly lineCounts: ReadonlyMap<string, number>;
  readonly threshold: number;
};

function parseContext(
  report: DolosReportFiles,
  options: ParseDolosReportOptions,
): DolosParseContext {
  const metadataRows = readMetadata(report.metadataCsv ?? "");
  return {
    ...(options.engineVersion === undefined ? {} : { engineVersion: options.engineVersion }),
    languageMode: options.languageMode ?? metadataRows.get("language") ?? "unknown",
    lineCounts: mergeLineCounts(readFileLineCounts(report.filesCsv ?? ""), options),
    threshold: options.threshold ?? readFiniteNumber(metadataRows.get("minSimilarity")) ?? 0,
  };
}

function reportMetadata(context: DolosParseContext): {
  readonly engine: typeof DOLOS_TOOL;
  readonly engineVersion?: string;
  readonly languageMode: string;
  readonly threshold: number;
} {
  return {
    engine: DOLOS_TOOL,
    ...(context.engineVersion === undefined ? {} : { engineVersion: context.engineVersion }),
    languageMode: context.languageMode,
    threshold: context.threshold,
  };
}

function readCandidatePairs(csv: string, options: DolosParseContext): DolosCandidatePair[] {
  const candidates: DolosCandidatePair[] = [];
  for (const row of parseCsvObjects(csv)) {
    const leftPath = readPath(row, "leftFilePath");
    const rightPath = readPath(row, "rightFilePath");
    const similarity = readFiniteNumber(row["similarity"]);
    if (leftPath === undefined || rightPath === undefined || similarity === undefined) continue;
    const totalOverlap = readFiniteNumber(row["totalOverlap"]) ?? 0;
    const longestFragment = readFiniteNumber(row["longestFragment"]) ?? 0;
    candidates.push({
      engine: DOLOS_TOOL,
      ...(options.engineVersion === undefined ? {} : { engineVersion: options.engineVersion }),
      languageMode: options.languageMode,
      threshold: options.threshold,
      score: similarity,
      left: fileRange(leftPath, options.lineCounts),
      right: fileRange(rightPath, options.lineCounts),
      metrics: {
        similarity,
        totalOverlap,
        longestFragment,
        ...optionalMetric("leftCovered", row["leftCovered"]),
        ...optionalMetric("rightCovered", row["rightCovered"]),
      },
    });
  }
  return candidates;
}

function readPath(row: CsvObject, key: string): string | undefined {
  const value = row[key]?.trim();
  if (value === undefined || value.length === 0) return undefined;
  return toPosix(value);
}

function optionalMetric(
  key: "leftCovered" | "rightCovered",
  raw: string | undefined,
): Partial<Pick<DolosPairMetrics, "leftCovered" | "rightCovered">> {
  const value = readFiniteNumber(raw);
  return value === undefined ? {} : { [key]: value };
}

function fileRange(filePath: string, lineCounts: ReadonlyMap<string, number>): DolosFileRange {
  const lineCount = lineCounts.get(filePath) ?? 1;
  return { filePath, startLine: 1, endLine: lineCount, lineCount };
}

function missingRanges(
  candidates: readonly DolosCandidatePair[],
  lineCounts: ReadonlyMap<string, number>,
): string[] {
  const missing = candidates
    .flatMap((candidate) => [candidate.left, candidate.right])
    .filter((range) => !lineCounts.has(range.filePath))
    .map((range) => range.filePath);
  return [...new Set(missing)].sort((left, right) => left.localeCompare(right, "en"));
}

function readMetadata(csv: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const row of parseCsvObjects(csv)) {
    const property = row["property"]?.trim();
    const value = row["value"];
    if (property !== undefined && property.length > 0 && value !== undefined) {
      values.set(property, value);
    }
  }
  return values;
}

function readFileLineCounts(csv: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of parseCsvObjects(csv)) {
    const filePath = readPath(row, "path");
    const content = row["content"];
    if (filePath === undefined || content === undefined) continue;
    counts.set(filePath, sourceLineCount(content));
  }
  return counts;
}

function mergeLineCounts(
  fromFilesCsv: Map<string, number>,
  options: ParseDolosReportOptions,
): Map<string, number> {
  const counts = new Map(fromFilesCsv);
  for (const [filePath, lineCount] of options.fileLineCounts ?? []) {
    if (Number.isFinite(lineCount) && lineCount > 0) counts.set(toPosix(filePath), lineCount);
  }
  return counts;
}

function readFiniteNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : undefined;
}

function positiveCap(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

function capCandidates(
  parsedPairs: readonly DolosCandidatePair[],
  threshold: number,
  options: ParseDolosReportOptions,
): {
  readonly candidatePairsTruncated: boolean;
  readonly candidates: readonly DolosCandidatePair[];
  readonly caps: {
    readonly maxCandidatePairs?: number;
    readonly maxReportedPairs?: number;
  };
  readonly reportedPairsTruncated: boolean;
} {
  const aboveThreshold = parsedPairs
    .filter((pair) => pair.score >= threshold)
    .sort(compareDolosCandidates);
  const maxCandidatePairs = positiveCap(options.maxCandidatePairs);
  const candidateCapped = capList(aboveThreshold, maxCandidatePairs);
  const maxReportedPairs = positiveCap(options.maxReportedPairs);
  return {
    candidatePairsTruncated:
      maxCandidatePairs !== undefined && aboveThreshold.length > maxCandidatePairs,
    candidates: capList(candidateCapped, maxReportedPairs),
    caps: {
      ...(maxCandidatePairs === undefined ? {} : { maxCandidatePairs }),
      ...(maxReportedPairs === undefined ? {} : { maxReportedPairs }),
    },
    reportedPairsTruncated:
      maxReportedPairs !== undefined && candidateCapped.length > maxReportedPairs,
  };
}

function capList<T>(items: readonly T[], cap: number | undefined): readonly T[] {
  return cap === undefined ? items : items.slice(0, cap);
}

function compareDolosCandidates(left: DolosCandidatePair, right: DolosCandidatePair): number {
  return (
    right.score - left.score ||
    left.left.filePath.localeCompare(right.left.filePath, "en") ||
    left.right.filePath.localeCompare(right.right.filePath, "en")
  );
}
