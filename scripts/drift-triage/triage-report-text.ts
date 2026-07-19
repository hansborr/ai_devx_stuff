import type { TriageItem, TriageReport } from "./triage-report.js";

export function formatTriageText(report: TriageReport): string {
  const lines = [
    `drift:triage — ${pluralCount(report.summary.reviewItems, "review item")} from ${pluralCount(
      report.summary.inputRows,
      "displayed row",
    )}`,
    `review evidence: ${String(report.summary.reviewRows)} rows; merged overlaps: ${String(
      report.summary.mergedRows,
    )}; deferred: ${String(report.summary.deferredRows)}; unshown upstream: ${String(
      report.summary.unshownRows,
    )}; unknown capped tails: ${String(report.summary.inputsWithUnknownTail)}`,
  ];
  appendInputDisclosure(lines, report);
  appendDeferred(lines, report);
  appendItems(lines, report.items);
  return lines.join("\n");
}

function appendInputDisclosure(lines: string[], report: TriageReport): void {
  appendDriftCoverage(lines, report);
  appendInapplicableChecks(lines, report);
  appendPartialInputs(lines, report);
}

function appendInapplicableChecks(lines: string[], report: TriageReport): void {
  const inputs = report.inputs.filter((input) => input.inapplicableChecks.length > 0);
  if (inputs.length === 0) return;
  lines.push("", "scope-inapplicable checks:");
  for (const input of inputs) {
    for (const check of input.inapplicableChecks) {
      lines.push(`- ${input.path}: ${check.check} — ${check.reason}`);
    }
  }
}

function appendDriftCoverage(lines: string[], report: TriageReport): void {
  const driftInputs = report.inputs.filter((input) => input.kind === "drift-report");
  if (driftInputs.length === 0) return;
  lines.push("", "drift input coverage:");
  for (const input of driftInputs) {
    lines.push(
      `- ${input.path}: scope ${input.scopeMode ?? "unknown"}; roots ${formatCoverageList(input.roots)}; enabled checks ${formatCoverageList(input.enabledChecks)}`,
    );
  }
}

function appendPartialInputs(lines: string[], report: TriageReport): void {
  const partial = report.inputs.filter((input) => input.partial);
  if (partial.length === 0) return;
  lines.push("", "partial inputs:");
  for (const input of partial) appendPartialInput(lines, input);
}

function appendPartialInput(lines: string[], input: TriageReport["inputs"][number]): void {
  lines.push(
    `- ${input.path}: ${String(input.displayedRows)}/${String(input.totalRows)} rows shown${
      input.degradations.length === 0 ? "" : `; ${String(input.degradations.length)} degradation(s)`
    }`,
  );
  for (const prerequisite of input.unmetPrerequisites) {
    lines.push(`  unmet prerequisite ${prerequisite.name}: ${prerequisite.detail}`);
  }
  for (const skippedCheck of input.skippedChecks) {
    lines.push(`  skipped check ${skippedCheck.check}: ${skippedCheck.reason}`);
  }
  for (const cap of input.hitCaps) {
    lines.push(`  hit cap ${cap.label}: ${cap.detail ?? "no detail provided"}`);
  }
  if (input.unknownBeyondCaps) {
    lines.push("  unknown tail: the producer stopped at a processing cap before counting the rest");
  }
  for (const degradation of input.degradations) {
    lines.push(`  degradation: ${degradation}`);
  }
}

function formatCoverageList(values: readonly string[] | null): string {
  if (values === null) return "unknown";
  return values.length === 0 ? "none" : values.join(", ");
}

function appendDeferred(lines: string[], report: TriageReport): void {
  if (report.deferred.length === 0) return;
  lines.push("", "deferred by policy:");
  for (const group of report.deferred) {
    lines.push(`- ${group.reason}: ${String(group.count)} — ${group.description}`);
  }
}

function appendItems(lines: string[], items: readonly TriageItem[]): void {
  if (items.length === 0) return;
  lines.push("", "review queue:");
  for (const item of items) {
    lines.push(
      `- [${item.priority}] ${item.category}: ${item.title}`,
      `  locations: ${item.locations.join(", ")}`,
      `  evidence: ${item.evidence.map((entry) => formatEvidence(entry, item.title)).join(", ")}`,
    );
  }
}

function formatEvidence(entry: TriageItem["evidence"][number], itemTitle: string): string {
  const origin = `${entry.source} (${entry.inputPath} row ${String(entry.row)})`;
  return entry.message === undefined || entry.message === itemTitle
    ? origin
    : `${origin}: ${entry.message}`;
}

function pluralCount(count: number, singular: string): string {
  return `${String(count)} ${singular}${count === 1 ? "" : "s"}`;
}
