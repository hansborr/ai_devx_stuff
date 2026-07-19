import { DEFAULT_CHECKS } from "../drift-ai/check-metadata.js";
import type { ScopeMode } from "../drift-ai/scope.js";
import type {
  NamedTriageInput,
  SkippedDriftCheckInput,
  TriageInput,
} from "./triage-report-contracts.js";
import type { TriageInputSummary } from "./triage-report-types.js";

export function summarizeInput(namedInput: NamedTriageInput): TriageInputSummary {
  if (namedInput.input.kind === "drift-report") {
    return summarizeDriftInput(namedInput.path, namedInput.input);
  }
  const report = namedInput.input.report;
  const displayedRows = report.sections.reduce(
    (total, section) => total + section.entries.length,
    0,
  );
  const totalRows = report.sections.reduce((total, section) => total + section.totalCandidates, 0);
  const unshownRows = Math.max(0, totalRows - displayedRows);
  const unmetPrerequisites = report.prerequisites.filter((prerequisite) => !prerequisite.satisfied);
  const hitCaps = report.caps
    .filter((cap) => cap.hit)
    .map((cap) => ({ label: cap.label, detail: cap.detail }));
  const unknownBeyondCaps = hitCaps.length > 0 && unshownRows === 0;
  const partial =
    unshownRows > 0 ||
    unknownBeyondCaps ||
    unmetPrerequisites.length > 0 ||
    report.degradations.length > 0;
  return {
    path: namedInput.path,
    kind: namedInput.input.kind,
    ...(report.scanProvenance === undefined ? {} : { scanProvenance: report.scanProvenance }),
    displayedRows,
    totalRows,
    unshownRows,
    partial,
    completeness: partial ? "partial" : "complete",
    unknownBeyondCaps,
    scopeMode: null,
    roots: null,
    enabledChecks: null,
    unmetPrerequisites,
    skippedChecks: [],
    inapplicableChecks: [],
    hitCaps,
    degradations: report.degradations,
  };
}

function summarizeDriftInput(
  path: string,
  input: Extract<TriageInput, { readonly kind: "drift-report" }>,
): TriageInputSummary {
  const displayedRows = input.report.findings.length;
  const { scopeMode, roots, enabledChecks } = input.report;
  const inapplicableChecks = input.report.skippedChecks.filter((check) =>
    isScopeInapplicable(check, scopeMode),
  );
  const skippedChecks = input.report.skippedChecks.filter(
    (check) => !inapplicableChecks.includes(check),
  );
  const partial =
    skippedChecks.length > 0 ||
    scopeMode === null ||
    scopeMode === "changed" ||
    roots === null ||
    hasRestrictedRoots(roots) ||
    enabledChecks === null ||
    !hasDefaultChecks(enabledChecks);
  return {
    path,
    kind: input.kind,
    displayedRows,
    totalRows: displayedRows,
    unshownRows: 0,
    partial,
    completeness: driftCompleteness(partial, inapplicableChecks.length),
    unknownBeyondCaps: false,
    scopeMode,
    roots,
    enabledChecks,
    unmetPrerequisites: [],
    skippedChecks,
    inapplicableChecks,
    hitCaps: [],
    degradations: [],
  };
}

function isScopeInapplicable(check: SkippedDriftCheckInput, scopeMode: ScopeMode | null): boolean {
  return (
    check.code === "scope-inapplicable" ||
    (scopeMode === "current" &&
      check.check === "suppressions" &&
      check.reason === "only available in changed scope")
  );
}

function driftCompleteness(
  partial: boolean,
  inapplicableCheckCount: number,
): TriageInputSummary["completeness"] {
  if (partial) return "partial";
  return inapplicableCheckCount > 0 ? "complete-with-inapplicable-checks" : "complete";
}

function hasRestrictedRoots(roots: readonly string[]): boolean {
  return roots.length > 0 && (roots.length !== 1 || roots[0] !== ".");
}

function hasDefaultChecks(enabledChecks: readonly string[]): boolean {
  return DEFAULT_CHECKS.every((check) => enabledChecks.includes(check));
}
