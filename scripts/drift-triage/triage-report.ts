import { driftItemId, pairItemId, pairKey, semgrepItemId } from "./triage-item-id.js";
import { formatItemLocation, parseDisplayLocation, uniqueLocations } from "./triage-location.js";
import {
  type DolosAdvisoryInput,
  type DolosRowInput,
  type DriftReportInput,
  type NamedTriageInput,
  type SemgrepAdvisoryInput,
  type SemgrepRowInput,
} from "./triage-report-contracts.js";
import { summarizeInput } from "./triage-report-summary.js";
import {
  addReviewItem,
  CLONE_CHECKS,
  DEFERRED_DESCRIPTIONS,
  driftDeferredReason,
  isTestLocation,
} from "./triage-report-support.js";
import type {
  BuildState,
  DeferredReason,
  MutableItem,
  TriageCategory,
  TriageItem,
  TriageOptions,
  TriagePolicy,
  TriageReport,
} from "./triage-report-types.js";

export { type NamedTriageInput, parseTriageInput } from "./triage-report-input.js";
export type { TriageItem, TriageOptions, TriageReport } from "./triage-report-types.js";

const REVIEW_FIRST_CHECKS = new Set([
  "duplicates",
  "import-cycles",
  "knip-duplicates",
  "layer-direction",
  "module-doc-paths",
  "orphan-files",
  "unused-exports",
]);

const MAINTENANCE_CHECKS = new Set([
  "comments",
  "knip-duplicates",
  "module-doc-paths",
  "orphan-files",
  "unused-exports",
]);

export const DEFAULT_MIN_CLONE_FRAGMENT = 20;

export function buildTriageReport(
  inputs: readonly NamedTriageInput[],
  options: TriageOptions = {},
): TriageReport {
  const policy = {
    includeLiterals: options.includeLiterals ?? false,
    includeTypeOnlyCycles: options.includeTypeOnlyCycles ?? false,
    minCloneFragment: options.minCloneFragment ?? DEFAULT_MIN_CLONE_FRAGMENT,
  };
  if (!Number.isFinite(policy.minCloneFragment) || policy.minCloneFragment < 0) {
    throw new Error("minCloneFragment must be a non-negative number");
  }

  const state: BuildState = {
    items: new Map(),
    deferred: new Map(),
    reviewRows: 0,
    deferredRows: 0,
  };
  const inputSummaries = inputs.map((namedInput) => summarizeInput(namedInput));

  for (const namedInput of inputs) processInput(namedInput, policy, state);

  const items = [...state.items.values()].map(toTriageItem).sort(compareItems);
  const deferred = [...state.deferred.entries()]
    .map(([reason, count]) => ({ reason, count, description: DEFERRED_DESCRIPTIONS[reason] }))
    .sort((left, right) => left.reason.localeCompare(right.reason, "en"));
  const inputRows = inputSummaries.reduce((total, input) => total + input.displayedRows, 0);
  const unshownRows = inputSummaries.reduce((total, input) => total + input.unshownRows, 0);
  const inputsWithUnknownTail = inputSummaries.filter((input) => input.unknownBeyondCaps).length;

  return {
    schemaVersion: 1,
    kind: "drift-triage",
    policy,
    summary: {
      inputRows,
      reviewRows: state.reviewRows,
      reviewItems: items.length,
      deferredRows: state.deferredRows,
      mergedRows: state.reviewRows - items.length,
      unshownRows,
      inputsWithUnknownTail,
    },
    inputs: inputSummaries,
    deferred,
    items,
  };
}

function processInput(namedInput: NamedTriageInput, policy: TriagePolicy, state: BuildState): void {
  switch (namedInput.input.kind) {
    case "drift-report":
      processDriftReport(namedInput.path, namedInput.input.report, policy, state);
      break;
    case "semgrep-advisory":
      processSemgrepAdvisory(namedInput.path, namedInput.input.report, state);
      break;
    case "dolos-advisory":
      processDolosAdvisory(namedInput.path, namedInput.input.report, policy, state);
      break;
  }
}

function processDriftReport(
  inputPath: string,
  report: DriftReportInput,
  policy: TriagePolicy,
  state: BuildState,
): void {
  report.findings.forEach((finding, index) => {
    const deferred = driftDeferredReason(finding, policy);
    if (deferred !== null) {
      addDeferred(state, deferred);
      return;
    }
    const inputLocations = uniqueLocations([finding.file, ...(finding.relatedFiles ?? [])]);
    // Pair identity must consume the admitted input spellings before parsing:
    // asymmetric legacy suffixes cannot all round-trip through TriageLocation.
    const pair = CLONE_CHECKS.has(finding.check) ? pairKey(inputLocations) : null;
    const key = pair ?? driftItemId({ inputPath, check: finding.check, index, file: finding.file });
    addReviewItem(state, key, {
      id: key,
      priority: REVIEW_FIRST_CHECKS.has(finding.check) ? "review-first" : "review",
      category: categoryForCheck(finding.check),
      title: finding.message,
      locationDetails: inputLocations.map(parseDisplayLocation),
      evidence: {
        inputPath,
        source: `drift:${finding.check}`,
        row: index + 1,
        message: finding.message,
        ...(finding.hint === undefined ? {} : { detail: finding.hint }),
        ...(finding.provenance === undefined ? {} : { provenance: finding.provenance }),
      },
    });
  });
}

function processSemgrepAdvisory(
  inputPath: string,
  report: SemgrepAdvisoryInput,
  state: BuildState,
): void {
  for (const section of report.sections) {
    for (const row of section.entries) processSemgrepRow(inputPath, row, state);
  }
}

function processSemgrepRow(inputPath: string, row: SemgrepRowInput, state: BuildState): void {
  if (isTestLocation(row.path)) {
    addDeferred(state, "test-only-security-example");
    return;
  }
  const cwes = [...(row.metadata.cwe ?? [])].sort((left, right) => left.localeCompare(right, "en"));
  const identity = cwes.length > 0 ? cwes.join(",") : row.checkId;
  const key = semgrepItemId({ path: row.path, ranges: row.ranges, identity });
  const label = cwes.length > 0 ? cwes.join(", ") : row.checkId;
  addReviewItem(state, key, {
    id: key,
    priority: semgrepPriority(row),
    category: "security",
    title: row.message ?? `Semgrep ${label} candidate`,
    locationDetails: row.ranges.map((range) => ({
      path: row.path,
      startLine: range.startLine,
      startCol: range.startCol,
      endLine: range.endLine,
      endCol: range.endCol,
    })),
    evidence: {
      inputPath,
      source: "semgrep",
      row: row.rank,
      detail: `${row.checkId}; severity ${row.severity ?? "unspecified"}`,
    },
  });
}

function processDolosAdvisory(
  inputPath: string,
  report: DolosAdvisoryInput,
  policy: TriagePolicy,
  state: BuildState,
): void {
  for (const section of report.sections) {
    for (const row of section.entries) processDolosRow(inputPath, row, policy, state);
  }
}

function processDolosRow(
  inputPath: string,
  row: DolosRowInput,
  policy: TriagePolicy,
  state: BuildState,
): void {
  if ([row.left.filePath, row.right.filePath].every(isTestLocation)) {
    addDeferred(state, "test-only-clone");
    return;
  }
  if (row.metrics.longestFragment < policy.minCloneFragment) {
    addDeferred(state, "short-clone-fragment");
    return;
  }
  const leftLocation = {
    path: row.left.filePath,
    startLine: row.left.startLine,
    startCol: null,
    endLine: row.left.endLine,
    endCol: null,
  };
  const rightLocation = {
    path: row.right.filePath,
    startLine: row.right.startLine,
    startCol: null,
    endLine: row.right.endLine,
    endCol: null,
  };
  const key = pairItemId({
    locations: [
      {
        path: leftLocation.path,
        range: `${String(leftLocation.startLine)}-${String(leftLocation.endLine)}`,
      },
      {
        path: rightLocation.path,
        range: `${String(rightLocation.startLine)}-${String(rightLocation.endLine)}`,
      },
    ],
  });
  addReviewItem(state, key, {
    id: key,
    priority: "review",
    category: "clone",
    title: `Dolos clone candidate (${formatPercent(row.score)} similarity)`,
    locationDetails: [leftLocation, rightLocation],
    evidence: {
      inputPath,
      source: "dolos",
      row: row.rank,
      detail: `longest fragment ${String(row.metrics.longestFragment)}, total overlap ${String(row.metrics.totalOverlap)}`,
    },
  });
}

function semgrepPriority(row: SemgrepRowInput): "review-first" | "review" {
  const severity = row.severity?.toUpperCase();
  const confidence = row.metadata.confidence?.toUpperCase();
  return severity === "CRITICAL" || severity === "ERROR" || confidence === "HIGH"
    ? "review-first"
    : "review";
}

function addDeferred(state: BuildState, reason: DeferredReason): void {
  state.deferredRows += 1;
  state.deferred.set(reason, (state.deferred.get(reason) ?? 0) + 1);
}

function categoryForCheck(check: string): TriageCategory {
  if (MAINTENANCE_CHECKS.has(check)) return "maintenance";
  if (CLONE_CHECKS.has(check)) return "clone";
  return "structure";
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function toTriageItem(item: MutableItem): TriageItem {
  return {
    ...item,
    locations: uniqueLocations(item.locationDetails.map(formatItemLocation)),
  };
}

function compareItems(left: TriageItem, right: TriageItem): number {
  if (left.priority !== right.priority) return left.priority === "review-first" ? -1 : 1;
  const category = left.category.localeCompare(right.category, "en");
  if (category !== 0) return category;
  return left.id.localeCompare(right.id, "en");
}
