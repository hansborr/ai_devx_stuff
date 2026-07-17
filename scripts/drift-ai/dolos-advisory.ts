// Prototype-lane advisory surface for the Dolos fragment-level clone engine
// (backlog task 41c). Task 41b owns the tool resolution, runner, and CSV parser;
// this module turns a `DolosRunnerResult` into the shared prototype advisory
// envelope (task 39) so Dolos rows are brand-firewalled the same way as the
// MinHash/LSH `clone-candidates` surface: `kind: "advisory"`, `lane: "prototype"`,
// a mandatory candidate banner, and explicit prerequisite/cap/degradation
// disclosure. Dolos stays opt-in — it is not a check id and not part of
// `--check all`; a missing Dolos binary is an expected absence, surfaced as an
// unmet prerequisite rather than a finding.

import { formatPercent, plural, positiveInt } from "./advisory-format-helpers.js";
import type { DolosRunnerResult } from "./dolos-runner-types.js";
import type { DolosToolInfo } from "./dolos-runner-types.js";
import { DOLOS_TOOL, type DolosFileRange, type DolosPairMetrics } from "./dolos-types.js";
import {
  appendPrototypeSection,
  buildPrototypeAdvisory,
  formatPrototypeAdvisoryJson,
  formatPrototypeHeader,
  type PrototypeAdvisory,
  type PrototypeCap,
  type PrototypeScanProvenance,
  type PrototypeSection,
} from "./prototype-advisory.js";

export const DOLOS_CANDIDATES_SUBCOMMAND = "dolos-candidates";
export const DEFAULT_DOLOS_CANDIDATES_TOP = 20;
const DOLOS_CANDIDATE_KIND = "Dolos fragment-level clone candidates";

type DolosAdvisoryRow = {
  readonly rank: number;
  readonly candidateSource: typeof DOLOS_TOOL;
  readonly engineVersion: string | null;
  readonly languageMode: string;
  readonly score: number;
  readonly threshold: number;
  readonly left: DolosFileRange;
  readonly right: DolosFileRange;
  readonly metrics: DolosPairMetrics;
};

type DolosAdvisorySection = PrototypeSection<DolosAdvisoryRow>;
export type DolosAdvisory = PrototypeAdvisory<DolosAdvisorySection>;

export type DolosAdvisoryOptions = {
  readonly top?: number;
  readonly scanProvenance?: PrototypeScanProvenance;
};

export function buildDolosAdvisory(
  result: DolosRunnerResult,
  options: DolosAdvisoryOptions = {},
): DolosAdvisory {
  if (!result.ok) return failedAdvisory(result, options.scanProvenance);
  const rows = result.candidates.map((candidate, index) => rowForCandidate(candidate, index + 1));
  return buildPrototypeAdvisory({
    subcommand: DOLOS_CANDIDATES_SUBCOMMAND,
    ...(options.scanProvenance === undefined ? {} : { scanProvenance: options.scanProvenance }),
    prerequisites: [
      {
        name: "dolos engine",
        satisfied: true,
        detail: `${describeTool(result.tool)}; language ${
          result.metadata.languageMode
        }, similarity threshold ${formatPercent(result.metadata.threshold, 1)}`,
      },
    ],
    caps: successCaps(result),
    degradations: successDegradations(result),
    sections: [
      {
        candidateKind: DOLOS_CANDIDATE_KIND,
        totalCandidates: rows.length,
        emptyReason:
          rows.length === 0
            ? `no Dolos pairs reached the ${formatPercent(
                result.metadata.threshold,
                1,
              )} similarity threshold.`
            : null,
        entries: rows.slice(0, positiveInt(options.top, DEFAULT_DOLOS_CANDIDATES_TOP)),
      },
    ],
  });
}

export function formatDolosAdvisoryJson(advisory: DolosAdvisory): string {
  return formatPrototypeAdvisoryJson(advisory);
}

export function formatDolosAdvisoryText(advisory: DolosAdvisory): string {
  const lines = formatPrototypeHeader(advisory);
  for (const section of advisory.sections) {
    lines.push("");
    appendPrototypeSection(lines, section, renderRow);
  }
  return lines.join("\n");
}

type FailedDolosResult = Extract<DolosRunnerResult, { readonly ok: false }>;
type SuccessfulDolosResult = Extract<DolosRunnerResult, { readonly ok: true }>;

function failedAdvisory(
  result: FailedDolosResult,
  scanProvenance: PrototypeScanProvenance | undefined,
): DolosAdvisory {
  // Each failure mode has exactly one canonical disclosure: a missing binary is an
  // UNMET prerequisite; a timeout is a HIT wall-clock cap; a run-failure is a
  // degradation. timeout/run-failure both keep the prerequisite satisfied (Dolos
  // was present), so they never read as "checked and clear".
  const available = result.reason !== "tool-unavailable";
  return buildPrototypeAdvisory<DolosAdvisorySection>({
    subcommand: DOLOS_CANDIDATES_SUBCOMMAND,
    ...(scanProvenance === undefined ? {} : { scanProvenance }),
    prerequisites: [
      {
        name: "dolos engine",
        satisfied: available,
        detail: available
          ? `${describeTool(result.tool)} ran but did not complete: ${result.error}`
          : `${describeTool(result.tool)} unavailable: ${result.error}`,
      },
    ],
    caps: [
      fileCap(result.caps.maxFiles, result.truncation),
      timeoutCap(result.caps.timeoutMs, result.reason === "timeout"),
    ],
    degradations: failureDegradations(result),
    sections: [
      {
        candidateKind: DOLOS_CANDIDATE_KIND,
        totalCandidates: 0,
        emptyReason: `Dolos produced no candidate pairs (run ${result.reason}).`,
        entries: [],
      },
    ],
  });
}

function rowForCandidate(
  candidate: SuccessfulDolosResult["candidates"][number],
  rank: number,
): DolosAdvisoryRow {
  return {
    rank,
    candidateSource: DOLOS_TOOL,
    engineVersion: candidate.engineVersion ?? null,
    languageMode: candidate.languageMode,
    score: candidate.score,
    threshold: candidate.threshold,
    left: candidate.left,
    right: candidate.right,
    metrics: candidate.metrics,
  };
}

function successCaps(result: SuccessfulDolosResult): PrototypeCap[] {
  return [
    fileCap(result.caps.maxFiles, result.truncation),
    {
      label: "candidate pairs",
      limit: result.caps.maxCandidatePairs,
      hit: result.truncation.candidatePairsTruncated,
      detail: result.truncation.candidatePairsTruncated
        ? `capped to ${result.caps.maxCandidatePairs} candidate pairs (parsed ${
            result.truncation.parsedPairs
          } raw ${plural("pair", result.truncation.parsedPairs)})`
        : null,
    },
    {
      label: "reported pairs",
      limit: result.caps.maxReportedPairs,
      hit: result.truncation.reportedPairsTruncated,
      detail: result.truncation.reportedPairsTruncated
        ? `stopped after ${result.candidates.length} reported candidate ${plural(
            "pair",
            result.candidates.length,
          )}`
        : null,
    },
    timeoutCap(result.caps.timeoutMs, false),
  ];
}

// Dolos is the only clone subcommand with a real subprocess wall-clock bound (the
// MinHash/LSH and git lenses run in-process), so the timeout is disclosed as a cap
// like any other: `within limit` on a completed run, `HIT -- PARTIAL run` when the
// subprocess was killed at the cap.
function timeoutCap(timeoutMs: number, hit: boolean): PrototypeCap {
  return {
    label: "wall-clock (ms)",
    limit: timeoutMs,
    hit,
    detail: hit ? `Dolos run stopped at the ${timeoutMs}ms wall-clock cap` : null,
  };
}

function fileCap(
  maxFiles: number,
  truncation: {
    readonly consideredFiles: number;
    readonly eligibleFiles: number;
    readonly filesTruncated: boolean;
  },
): PrototypeCap {
  return {
    label: "files",
    limit: maxFiles,
    hit: truncation.filesTruncated,
    detail: truncation.filesTruncated
      ? `considered ${truncation.consideredFiles} of ${truncation.eligibleFiles} eligible files`
      : null,
  };
}

function successDegradations(result: SuccessfulDolosResult): string[] {
  const missing = result.truncation.missingFileRanges;
  if (missing.length === 0) return [];
  return [
    `${missing.length} ${plural(
      "file path",
      missing.length,
    )} had no line-count source; their ranges are shown as full-file 1-1: ${missing.join(", ")}`,
  ];
}

function failureDegradations(result: FailedDolosResult): string[] {
  // tool-unavailable -> unmet prerequisite; timeout -> HIT wall-clock cap; only a
  // run-failure needs a degradation line (its cause is the Dolos exit/error).
  if (result.reason !== "run-failed") return [];
  return [`Dolos run failed before producing a report: ${result.error}`];
}

function renderRow(row: DolosAdvisoryRow): readonly string[] {
  const relation = row.score >= row.threshold ? ">=" : "<";
  return [
    `#${row.rank} ${formatRange(row.left)} <=> ${formatRange(row.right)}`,
    `source dolos${row.engineVersion === null ? "" : `@${row.engineVersion}`} (${
      row.languageMode
    }): similarity ${formatPercent(row.score, 1)} ${relation} threshold ${formatPercent(
      row.threshold,
      1,
    )}; ${formatMetrics(row.metrics)}`,
    "inspect: review the shared fragment before extracting common code.",
  ];
}

function formatMetrics(metrics: DolosPairMetrics): string {
  const parts = [
    `overlap ${metrics.totalOverlap} tokens`,
    `longest fragment ${metrics.longestFragment}`,
  ];
  if (metrics.leftCovered !== undefined || metrics.rightCovered !== undefined) {
    parts.push(`coverage L ${coverage(metrics.leftCovered)} / R ${coverage(metrics.rightCovered)}`);
  }
  return parts.join(", ");
}

function coverage(value: number | undefined): string {
  return value === undefined ? "n/a" : formatPercent(value, 1);
}

function formatRange(range: DolosFileRange): string {
  return `${range.filePath}:${range.startLine}-${range.endLine}`;
}

function describeTool(tool: DolosToolInfo): string {
  const version = tool.version === undefined ? "" : `@${tool.version}`;
  const location =
    tool.source === "override" ? `override ${tool.command}` : `'${tool.command}' on PATH`;
  return `dolos${version} (${location})`;
}
