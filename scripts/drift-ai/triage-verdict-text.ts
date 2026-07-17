import type { VerdictCollectionReport } from "./triage-verdict-types.js";

export function formatVerdictCollectionText(report: VerdictCollectionReport): string {
  const lines = [
    `drift:triage collect — ${String(report.summary.receivedVerdicts)}/${String(
      report.summary.assignedItems,
    )} item verdicts collected; ${String(report.summary.completedPackets)}/${String(
      report.summary.totalPackets,
    )} packets complete`,
  ];
  appendSourceWarning(lines, report);
  appendCounts(lines, "verdicts", report.summary.byVerdict);
  appendCounts(lines, "severities", report.summary.bySeverity);
  if (report.missing.length > 0) {
    lines.push("", "missing verdicts:");
    for (const packet of report.missing) {
      lines.push(`- ${packet.packetId}: ${packet.itemIds.join(", ")}`);
    }
  }
  if (report.verificationQueue.length > 0) {
    lines.push("", "second-pass verification queue:");
    for (const item of report.verificationQueue) {
      lines.push(`- ${item.packetId} / ${item.itemId}: ${item.reason}`);
    }
  }
  return lines.join("\n");
}

function appendSourceWarning(lines: string[], report: VerdictCollectionReport): void {
  if (report.sourceState.stale !== true) return;
  lines.push(
    `WARNING: source HEAD changed from ${report.sourceState.manifestGitHead ?? "unknown"} to ${
      report.sourceState.currentGitHead ?? "unknown"
    }`,
  );
}

function appendCounts(
  lines: string[],
  label: string,
  counts: Readonly<Record<string, number>>,
): void {
  const entries = Object.entries(counts);
  if (entries.length === 0) return;
  lines.push("", `${label}:`);
  for (const [key, count] of entries) lines.push(`- ${key}: ${String(count)}`);
}
