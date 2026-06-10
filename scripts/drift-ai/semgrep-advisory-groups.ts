// (check_id, path) group building and ranking for the Semgrep prototype
// advisory (semgrep plan, slice 3), split from semgrep-advisory.ts the way
// the types and formatter are split so the builder module stays focused on
// the prerequisite/cap/degradation envelope.

import type { SemgrepAdvisoryRow, SemgrepCandidateRange } from "./semgrep-advisory-types.js";
import { SEMGREP_TOOL, type SemgrepScanOutput } from "./semgrep-types.js";

type UnrankedRow = Omit<SemgrepAdvisoryRow, "rank">;

// `check_id` arrives as Semgrep namespaces it (slice 0: a local config's path
// stem prefixes the bare rule id), so the (checkId, path) key never assumes
// bare ids — and joins on NUL, since path stems can put spaces in either part.
// Rule-level fields (severity/message/metadata) come from the group's first
// hit; they are declared on the rule, so they agree within a group. The
// rendered message reaches the row only under `--include-rule-messages`
// (snippet policy: Semgrep interpolates matched metavariable values into it).
export function buildGroups(
  scan: SemgrepScanOutput,
  includeRuleMessages: boolean,
): SemgrepAdvisoryRow[] {
  const groups = new Map<string, { row: UnrankedRow; ranges: SemgrepCandidateRange[] }>();
  for (const finding of scan.findings) {
    const key = `${finding.checkId}\u0000${finding.path}`;
    const range = {
      startLine: finding.startLine,
      startCol: finding.startCol,
      endLine: finding.endLine,
      endCol: finding.endCol,
    };
    const group = groups.get(key);
    if (group !== undefined) {
      group.ranges.push(range);
      continue;
    }
    const ranges: SemgrepCandidateRange[] = [range];
    groups.set(key, {
      ranges,
      row: {
        candidateSource: SEMGREP_TOOL,
        checkId: finding.checkId,
        path: finding.path,
        count: 0,
        ranges,
        severity: finding.severity,
        message: includeRuleMessages ? finding.message : null,
        metadata: finding.metadata,
      },
    });
  }
  return [...groups.values()]
    .map(({ row, ranges }) => ({
      ...row,
      count: ranges.length,
      ranges: [...ranges].sort(compareRanges),
    }))
    .sort(compareRows)
    .map((row, index) => ({ rank: index + 1, ...row }));
}

function compareRanges(a: SemgrepCandidateRange, b: SemgrepCandidateRange): number {
  return (
    a.startLine - b.startLine || a.endLine - b.endLine || (a.startCol ?? 0) - (b.startCol ?? 0)
  );
}

// Sort order per plan decision 4: confidence desc, severity desc, smaller
// group first, then rule id and path. CRITICAL is modern semgrep's top
// severity tier; unknown/unrecognized enum values rank after the known ones
// so uncalibrated rows never jump the queue.
const CONFIDENCE_ORDER = ["HIGH", "MEDIUM", "LOW"];
const SEVERITY_ORDER = ["CRITICAL", "ERROR", "WARNING", "INFO"];

function orderRank(order: readonly string[], value: string | null): number {
  if (value === null) return order.length;
  const index = order.indexOf(value.toUpperCase());
  return index === -1 ? order.length : index;
}

function compareRows(a: UnrankedRow, b: UnrankedRow): number {
  return (
    orderRank(CONFIDENCE_ORDER, a.metadata.confidence) -
      orderRank(CONFIDENCE_ORDER, b.metadata.confidence) ||
    orderRank(SEVERITY_ORDER, a.severity) - orderRank(SEVERITY_ORDER, b.severity) ||
    a.count - b.count ||
    a.checkId.localeCompare(b.checkId) ||
    a.path.localeCompare(b.path)
  );
}
